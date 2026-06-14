/**
 * src/main.ts
 * App-entrypoint: bouwt de lagen op en verbindt ze.
 *
 *  setup-scherm (ui) -> SetupConfig
 *    -> createKingenDefinition (games/kingen) + TurnManager (core)
 *    -> SceneManager (render) + HUD/scorebord/meldingen (ui) op de EventBus
 *    -> LocalTransport (net) als event-doorgeefluik (klaar voor online later)
 */

import './styles.css';

import type { Card, GameEvent, PlayerConfig, PublicGameView, Seat, Suit } from '@shared/core/types.ts';
import { SUITS, SUIT_SYMBOLS } from '@shared/core/types.ts';
import { createGameEventBus, type GameEventBus } from '@shared/core/events.ts';
import { ScoreSheet } from '@shared/core/scoresheet.ts';
import { AiPlayer, type PlayerController } from '@shared/core/player.ts';
import { TurnManager } from '@shared/core/turnManager.ts';
import { setSnelheidNiveau } from '@shared/core/speed.ts';

import { createKingenDefinition } from '@shared/games/kingen/engine.ts';
import { getTableParams } from '@shared/games/kingen/params.ts';
import type { KingenRoundKind } from '@shared/games/kingen/types.ts';

import { getStrategyForDifficulty } from '@shared/ai/strategies.ts';

import type { KingenSceneManager } from './render/scene.ts';
import type { KingenCardAnimator } from './render/animations.ts';

import { createSetupScreen } from './ui/setup.ts';
import { createHud, leesSnelheidNiveau } from './ui/hud.ts';
import { createLanding } from './ui/landing.ts';
import { createGamePage } from './ui/gamePage.ts';
import { onLangChange, rankLabels, roundKindName, suitName, t } from './ui/i18n.ts';
import { createScoreboard } from './ui/scoreboard.ts';
import { createChoiceDialogs, createNotifications } from './ui/notifications.ts';
import { installRotatePrompt } from './ui/rotatePrompt.ts';
import { installWebglNotice } from './ui/webglNotice.ts';
import { reportLocalGame } from './net/statsBeacon.ts';
import type { ChoiceDialogs, Hud, Notifications, Scoreboard, SetupConfig } from './ui/types.ts';
import { onEnvironmentChange, onUiEvent } from './ui/uiBus.ts';

import type { Transport } from '@shared/net/protocol.ts';
import { LocalTransport } from './net/localTransport.ts';

// ---------------------------------------------------------------------------
// Menselijke speler op stoel 0: kiest kaarten door te klikken in de 3D-scene
// (of via een UiEvent), en troef/spelkeuze via de keuzedialogen.
// ---------------------------------------------------------------------------

class LokaleMens implements PlayerController {
  readonly seat: Seat;
  readonly config: PlayerConfig;

  private opruimen: (() => void) | null = null;

  constructor(
    seat: Seat,
    config: PlayerConfig,
    private readonly scene: KingenSceneManager,
    private readonly dialogs: ChoiceDialogs,
    private readonly hud: Hud,
    private readonly uiRoot: HTMLElement,
  ) {
    this.seat = seat;
    this.config = config;
  }

  /** Wacht op een kaartklik; met `metClaim` mag ook de HUD-claimknop gebruikt worden. */
  private kiesKaart(view: PublicGameView, metClaim: boolean): Promise<Card | 'claim'> {
    return new Promise<Card | 'claim'>((resolve) => {
      const legaal = new Map<string, Card>(view.legalCards.map((c) => [c.id, c]));
      this.scene.setPlayableCards([...legaal.keys()]);
      if (metClaim) this.hud.setClaimAvailable(true);

      const stop = (): void => {
        offScene();
        offUi();
        this.scene.setPlayableCards([]);
        if (metClaim) this.hud.setClaimAvailable(false);
        this.opruimen = null;
      };

      const kies = (cardId: string): void => {
        const kaart = legaal.get(cardId);
        if (!kaart) return; // niet-legale kaart aangeklikt: negeren (staat gedimd)
        stop();
        resolve(kaart);
      };

      const offScene = this.scene.onCardClicked(kies);
      const offUi = onUiEvent(this.uiRoot, (ev) => {
        if (ev.type === 'cardChosen' && ev.seat === this.seat) kies(ev.cardId);
        if (metClaim && ev.type === 'claimRequested' && ev.seat === this.seat) {
          stop();
          resolve('claim');
        }
      });

      this.opruimen = stop;
    });
  }

  chooseCard(view: PublicGameView): Promise<Card> {
    return this.kiesKaart(view, false) as Promise<Card>;
  }

  /** Variant 'hand afleggen': kaart klikken óf claimen via de HUD-knop. */
  chooseCardOrClaim(view: PublicGameView): Promise<Card | 'claim'> {
    return this.kiesKaart(view, true);
  }

  chooseTrump(_view: PublicGameView): Promise<Suit> {
    return this.dialogs.vraagTroef([...SUITS]);
  }

  async chooseRoundKind(_view: PublicGameView, available: string[]): Promise<string> {
    return this.dialogs.vraagRondeKeuze(available as KingenRoundKind[]);
  }

  /** Annuleer een lopende kaartkeuze (bij partij afbreken). */
  cancel(): void {
    this.opruimen?.();
  }
}

// ---------------------------------------------------------------------------
// Hulpjes
// ---------------------------------------------------------------------------

/** Record<number,number> (uit GameEvents) -> dichte array per stoel. */
function naarArray(record: Record<number, number>, seatCount: number): number[] {
  const out = new Array<number>(seatCount).fill(0);
  for (let i = 0; i < seatCount; i++) out[i] = record[i] ?? 0;
  return out;
}

interface AppContext {
  uiRoot: HTMLElement;
  bus: GameEventBus;
  scene: KingenSceneManager;
  hud: Hud;
  scoreboard: Scoreboard;
  notifications: Notifications;
  dialogs: ChoiceDialogs;
  transport: Transport;
}

// ---------------------------------------------------------------------------
// Eén partij spelen
// ---------------------------------------------------------------------------

async function speelPartij(ctx: AppContext, setup: SetupConfig): Promise<'opnieuw' | 'setup'> {
  const { uiRoot, bus, scene, hud, scoreboard, notifications, dialogs, transport } = ctx;
  const variant = setup.variant;
  const params = getTableParams(variant);
  const n = variant.playerCount;

  // Hotseat (meerdere mensen aan één scherm) wordt nog niet ondersteund:
  // normaliseer zulke stoelen expliciet naar AI zodat HUD, TurnManager en
  // controllers dezelfde waarheid zien (geen chip 'mens' bij een computerstoel).
  const hotseatStoelen: number[] = [];
  const spelers: PlayerConfig[] = setup.spelers.map((p, i) => {
    if (i > 0 && p.kind === 'human') {
      hotseatStoelen.push(i);
      return { name: p.name, kind: 'ai', aiDifficulty: 'gemiddeld' };
    }
    return structuredClone(p);
  });

  const namen = spelers.map((p) => p.name);
  const soorten = spelers.map((p) => p.kind);
  const sheet = new ScoreSheet(n);

  // --- HUD/scorebord in beginstand ---
  hud.setPlayers(namen, soorten);
  scene.setSeatNames(namen);
  hud.setRound('', 0, params.totalRounds);
  hud.setTrump(null);
  hud.setTrickCounts(new Array<number>(n).fill(0));
  hud.show();
  scoreboard.update([], namen);

  // --- Room via het transport (lokaal loopback; later: WebSocket-server) ---
  const room = await transport.createRoom(
    t('app.roomName', { name: namen[0] ?? t('setup.playerPlaceholder', { n: 1 }) }),
    'kingen',
    n,
  );
  await transport.joinRoom(room.id, spelers[0]!);
  const offNet = bus.onAny((ev) => {
    transport.send({ kind: 'gameEvent', roomId: room.id, event: ev });
  });

  // --- UI-state bijwerken op GameEvents ---
  const slagen = new Array<number>(n).fill(0);
  let einde: { winners: Seat[]; totals: number[] } | null = null;
  const naamVan = (seat: number): string => namen[seat] ?? t('app.seat', { num: seat + 1 });

  const offUiState = bus.onAny((ev: GameEvent) => {
    switch (ev.type) {
      case 'roundStart':
        slagen.fill(0);
        // De UI leidt de zichtbare rondenaam taalbewust af uit ev.roundKind;
        // het (Nederlandse) ev.roundLabel uit de engine wordt genegeerd.
        hud.setRound(ev.roundKind, ev.roundIndex, params.totalRounds);
        hud.setTrump(null);
        hud.setTrickCounts([...slagen]);
        break;
      case 'trumpChosen': {
        hud.setTrump(ev.trump);
        void notifications.toon(
          t('toast.trumpChosen', {
            name: naamVan(ev.chooser),
            suit: `${SUIT_SYMBOLS[ev.trump]} ${suitName(ev.trump)}`,
          }),
          { soort: 'info', duurMs: 1800 },
        );
        break;
      }
      case 'roundKindChosen': {
        void notifications.toon(
          t('toast.dealerPicks', { name: naamVan(ev.chooser) }),
          { duurMs: 1400 },
        );
        break;
      }
      case 'turnStart':
        hud.setTurn(ev.seat);
        break;
      case 'trickWon': {
        slagen[ev.winner] = (slagen[ev.winner] ?? 0) + 1;
        hud.setTrickCounts([...slagen]);
        hud.setTurn(null);
        void notifications.toon(
          t('toast.trickWon', { name: naamVan(ev.winner), num: ev.trickIndex + 1 }),
          { soort: ev.winner === 0 ? 'succes' : 'info', duurMs: 1500 },
        );
        break;
      }
      case 'handClaimed': {
        void notifications.toon(
          t('toast.handClaimed', { name: naamVan(ev.seat), points: ev.acceptedPenalty }),
          { soort: 'waarschuwing', duurMs: 2400 },
        );
        break;
      }
      case 'roundEnd': {
        const scores = naarArray(ev.scores, n);
        sheet.addRound(ev.roundIndex, ev.roundKind, roundKindName(ev.roundKind), scores);
        scoreboard.update([...sheet.getRows()], namen);
        // Lopende totaal-(straf)punten ook in de spelerschips bovenin tonen.
        hud.setScores(sheet.getTotals());
        break;
      }
      case 'illegalMove':
        void notifications.toon(t('toast.illegalMove'), { soort: 'waarschuwing', duurMs: 2200 });
        break;
      case 'custom': {
        if (ev.subtype === 'troefdwang') {
          void notifications.toon(t('toast.trumpForce'), {
            soort: 'waarschuwing',
            duurMs: 3200,
          });
        }
        break;
      }
      case 'gameEnd':
        hud.setTurn(null);
        einde = { winners: [...ev.winners], totals: naarArray(ev.totals, n) };
        reportLocalGame('kingen', 'finish'); // lokale partij uitgespeeld
        break;
      default:
        break;
    }
  });

  // --- Spelers/controllers ---
  const definition = createKingenDefinition();
  const mens = new LokaleMens(0, spelers[0]!, scene, dialogs, hud, uiRoot);

  if (hotseatStoelen.length > 0) {
    // Verdedigend: het setup-scherm biedt dit niet meer aan, maar oudere
    // defaults kunnen nog 'human' bevatten op andere stoelen.
    void notifications.toon(t('toast.hotseat'), { soort: 'info', duurMs: 3600 });
  }

  const controllers: PlayerController[] = spelers.map((cfg, i) => {
    const seat = i as Seat;
    if (seat === 0 && cfg.kind === 'human') return mens;
    return new AiPlayer(seat, cfg, getStrategyForDifficulty(cfg.aiDifficulty ?? 'gemiddeld'));
  });

  // --- Animatie-gate: render/meldingen afronden vóór de volgende zet ---
  const afterEvent = async (ev: GameEvent): Promise<void> => {
    if (ev.type === 'roundStart') {
      await notifications.kondigRondeAan(
        t('announce.round', { num: ev.roundIndex + 1, name: roundKindName(ev.roundKind) }),
      );
    }
    await scene.waitForIdle();
  };

  const manager = new TurnManager({
    definition,
    players: spelers,
    config: variant,
    controllers,
    bus,
    afterEvent,
  });

  // --- HUD-knoppen en afbreken ---
  let verlaat: (() => void) | null = null;
  const verlaatBelofte = new Promise<'afgebroken'>((resolve) => {
    verlaat = () => resolve('afgebroken');
  });

  const offUiEvents = onUiEvent(uiRoot, (ev) => {
    switch (ev.type) {
      case 'toggleScoreboard':
        scoreboard.toggle();
        break;
      case 'quitToSetup':
        manager.stop();
        mens.cancel();
        verlaat?.();
        break;
      default:
        break;
    }
  });

  // --- Spelen tot het einde (of tot de gebruiker afbreekt) ---
  let uitslag: 'klaar' | 'afgebroken';
  try {
    uitslag = await Promise.race([
      manager.run().then(() => 'klaar' as const),
      verlaatBelofte,
    ]);
  } finally {
    offUiEvents();
    offUiState();
    offNet();
    await transport.leaveRoom(room.id);
  }

  if (uitslag === 'afgebroken') {
    const animator = scene.animator as KingenCardAnimator;
    animator.cancelAll();
    animator.clearTable();
    scene.setPlayableCards([]);
    hud.hide();
    scoreboard.hide();
    return 'setup';
  }

  // --- Eindstand tonen ---
  scoreboard.update([...sheet.getRows()], namen);
  const stand = einde ?? {
    winners: sheet.getLeaders(),
    totals: sheet.getTotals(),
  };
  const keuze = await dialogs.toonEindstand(namen, stand.totals, stand.winners);
  hud.hide();
  scoreboard.hide();
  return keuze;
}

// ---------------------------------------------------------------------------
// App-lus: setup -> partij(en) -> terug naar setup
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app');
  const ui = document.querySelector<HTMLDivElement>('#ui');
  if (!app || !ui) throw new Error('#app of #ui ontbreekt in index.html');

  // Landscape-first draai-prompt (mobiel/portret tijdens een 3D-partij).
  installRotatePrompt(ui, app);
  // WebGL-contextverlies-overlay (iOS dumpt de GL-context bij geheugendruk).
  installWebglNotice(ui);

  // Online-modus (Fase 1, verticale plak): ?online → speel via de server.
  if (new URLSearchParams(location.search).has('online')) {
    const { runOnlineGame } = await import('./online.ts');
    await runOnlineGame(app, ui);
    return;
  }

  // UI-componenten (eenmalig aangemaakt, hergebruikt over partijen heen).
  const setupScreen = createSetupScreen(ui);
  const hud = createHud(ui);
  const scoreboard = createScoreboard(ui);
  const notifications = createNotifications(ui);
  const dialogs = createChoiceDialogs(ui);

  // EventBus + transport (lokaal loopback; later inwisselbaar voor WebSocket).
  const bus = createGameEventBus();
  const transport: Transport = new LocalTransport();
  await transport.connect();

  let scene: KingenSceneManager | null = null;
  let vorige: Partial<SetupConfig> | undefined;

  // Live omgevingswissel vanuit het HUD-instellingenmenu.
  onEnvironmentChange(ui, (id) => {
    if (vorige) vorige.omgeving = id;
    void scene?.setEnvironment(id);
  });

  // Weergave-instellingen uit het HUD-menu (helderheid, camerabeweging);
  // het HUD persist ze zelf in localStorage, de scene leest die bij opstart.
  onUiEvent(ui, (ev) => {
    if (ev.type === 'brightnessChanged') scene?.setBrightness(ev.percent);
    if (ev.type === 'cameraMotionChanged') scene?.setCameraMotion(ev.enabled);
    if (ev.type === 'speedChanged') setSnelheidNiveau(ev.niveau);
  });

  // Opgeslagen speelsnelheid meteen toepassen (AI-denktijd + animaties).
  setSnelheidNiveau(leesSnelheidNiveau());

  // Kaartlabels volgen de taal (NL B/V/H ↔ EN J/Q/K); hertekent de textures.
  onLangChange(() => scene?.cardRenderer.setRankLabels(rankLabels()));

  // Kingen lokaal: het bestaande setup→partij→setup-circuit. Oneindige lus; de
  // "← Alle spellen"-link in het setupscherm herlaadt naar de galerij.
  async function runKingenLokaal(): Promise<void> {
    for (;;) {
      const setup = await setupScreen.show(vorige);
      setupScreen.hide();
      vorige = structuredClone(setup);

      // Scene pas na de eerste setup bouwen (omgeving is dan bekend).
      if (!scene) {
        // three.js + render-laag lazy laden zodat de galerij ze niet meetrekt (F6).
        let createSceneManager: typeof import('./render/scene.ts')['createSceneManager'];
        try {
          ({ createSceneManager } = await import('./render/scene.ts'));
        } catch {
          await notifications.toon(t('app.loadError'), { soort: 'waarschuwing', duurMs: 8000 });
          return;
        }
        scene = await createSceneManager(app!, bus, setup.omgeving);
        scene.start();
      } else {
        await scene.setEnvironment(setup.omgeving);
      }
      // Kaartlabels in de juiste taal vóór het delen (textures worden lazy gemaakt).
      scene.cardRenderer.setRankLabels(rankLabels());
      hud.setEnvironment(setup.omgeving);

      const ctx: AppContext = {
        uiRoot: ui!,
        bus,
        scene,
        hud,
        scoreboard,
        notifications,
        dialogs,
        transport,
      };

      // Zelfde instellingen herspelen tot de gebruiker terug wil naar setup.
      let keuze: 'opnieuw' | 'setup';
      do {
        reportLocalGame('kingen', 'start'); // lokale partij meetellen in de stats
        keuze = await speelPartij(ctx, setup);
      } while (keuze === 'opnieuw');
    }
  }

  // --- Navigatie: galerij → spelpagina → lokaal of online ---
  const landing = createLanding(ui);
  const gamePage = createGamePage(ui);

  // De generieke client (render + HUD + zetkeuze) lazy laden zodat lokaal Kingen
  // 'm niet meetrekt. Online = echte server; lokaal = in-browser host (zelfde client).
  const startOnline = async (gameId: string): Promise<void> => {
    const { runOnlineGame } = await import('./online.ts');
    await runOnlineGame(app, ui, { gameId });
  };

  const startLokaal = async (gameId: string): Promise<void> => {
    const [{ runOnlineGame }, { LocalHostTransport }, { getGame }, { registerBuiltinGames }] =
      await Promise.all([
        import('./online.ts'),
        import('./net/localHostTransport.ts'),
        import('@shared/core/gameRegistry.ts'),
        import('@shared/games/registry.ts'),
      ]);
    registerBuiltinGames(); // zodat de in-browser GameHost het spel vindt
    const entry = getGame(gameId);
    // Voorkeur: een tafel van 4 (leuk voor o.a. Toepen 2–8), geclampt op het bereik.
    const playerCount = Math.min(Math.max(4, entry?.minPlayers ?? 4), entry?.maxPlayers ?? 4);
    const config = entry?.configForPlayers(playerCount);
    let naam = t('setup.you');
    try {
      naam = localStorage.getItem('kingen.name') || naam;
    } catch {
      // best-effort
    }
    const transport = new LocalHostTransport({ gameId, config, playerCount, playerName: naam });
    await runOnlineGame(app, ui, { gameId, transport, solo: true });
  };

  for (;;) {
    const family = await landing.kies();
    landing.verberg();
    const keuze = await gamePage.toon(family);
    if (keuze.action === 'back') continue; // terug naar de galerij

    if (keuze.action === 'online') {
      // Online neemt het over (eigen lobby); 'Partij afbreken' herlaadt naar de galerij.
      await startOnline(keuze.gameId);
      return;
    }

    // Lokaal tegen de computer.
    if (family.localKind === 'kingen') {
      await runKingenLokaal(); // oneindig; terug = herladen via de setup-link
      return;
    }
    // Overige spellen lokaal: in-browser host (mens + AI-fill), zelfde client.
    await startLokaal(keuze.gameId);
    return;
  }
}

main().catch((fout) => {
  console.error('Kingen kon niet starten:', fout);
  const ui = document.querySelector<HTMLDivElement>('#ui');
  if (ui) {
    const melding = document.createElement('p');
    melding.style.cssText =
      'color:#fff;font-family:system-ui;padding:1rem;background:rgba(120,0,0,0.8);margin:1rem;border-radius:8px;';
    melding.textContent = t('app.startError', {
      message: fout instanceof Error ? fout.message : String(fout),
    });
    ui.appendChild(melding);
  }
});
