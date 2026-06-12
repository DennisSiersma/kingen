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

import type { Card, GameEvent, PlayerConfig, PublicGameView, Seat, Suit } from './core/types.ts';
import { SUITS, SUIT_NAMES_NL, SUIT_SYMBOLS } from './core/types.ts';
import { createGameEventBus, type GameEventBus } from './core/events.ts';
import { ScoreSheet } from './core/scoresheet.ts';
import { AiPlayer, type PlayerController } from './core/player.ts';
import { TurnManager } from './core/turnManager.ts';

import { createKingenDefinition } from './games/kingen/engine.ts';
import { getTableParams } from './games/kingen/params.ts';
import type { KingenRoundKind } from './games/kingen/types.ts';

import { getStrategyForDifficulty } from './ai/strategies.ts';

import { createSceneManager, type KingenSceneManager } from './render/scene.ts';
import type { KingenCardAnimator } from './render/animations.ts';

import { createSetupScreen } from './ui/setup.ts';
import { createHud } from './ui/hud.ts';
import { createScoreboard } from './ui/scoreboard.ts';
import { createChoiceDialogs, createNotifications } from './ui/notifications.ts';
import type { ChoiceDialogs, Hud, Notifications, Scoreboard, SetupConfig } from './ui/types.ts';
import { onEnvironmentChange, onUiEvent } from './ui/uiBus.ts';

import { LocalTransport, type Transport } from './net/transport.ts';

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
  hud.setRound('Kingen', 0, params.totalRounds);
  hud.setTrump(null);
  hud.setTrickCounts(new Array<number>(n).fill(0));
  hud.show();
  scoreboard.update([], namen);

  // --- Room via het transport (lokaal loopback; later: WebSocket-server) ---
  const room = await transport.createRoom(`Tafel van ${namen[0] ?? 'speler'}`, 'kingen', n);
  await transport.joinRoom(room.id, spelers[0]!);
  const offNet = bus.onAny((ev) => {
    transport.send({ kind: 'gameEvent', roomId: room.id, event: ev });
  });

  // --- UI-state bijwerken op GameEvents ---
  let huidigLabel = '';
  const slagen = new Array<number>(n).fill(0);
  let einde: { winners: Seat[]; totals: number[] } | null = null;

  const offUiState = bus.onAny((ev: GameEvent) => {
    switch (ev.type) {
      case 'roundStart':
        huidigLabel = ev.roundLabel;
        slagen.fill(0);
        hud.setRound(ev.roundLabel, ev.roundIndex, params.totalRounds);
        hud.setTrump(null);
        hud.setTrickCounts([...slagen]);
        break;
      case 'trumpChosen': {
        hud.setTrump(ev.trump);
        const kiezer = namen[ev.chooser] ?? `Stoel ${ev.chooser + 1}`;
        void notifications.toon(
          `${kiezer} kiest ${SUIT_SYMBOLS[ev.trump]} ${SUIT_NAMES_NL[ev.trump]} als troef`,
          { soort: 'info', duurMs: 1800 },
        );
        break;
      }
      case 'roundKindChosen': {
        const kiezer = namen[ev.chooser] ?? `Stoel ${ev.chooser + 1}`;
        void notifications.toon(`${kiezer} (deler) kiest het spel`, { duurMs: 1400 });
        break;
      }
      case 'turnStart':
        hud.setTurn(ev.seat);
        break;
      case 'trickWon': {
        slagen[ev.winner] = (slagen[ev.winner] ?? 0) + 1;
        hud.setTrickCounts([...slagen]);
        hud.setTurn(null);
        const winnaar = namen[ev.winner] ?? `Stoel ${ev.winner + 1}`;
        void notifications.toon(`${winnaar} pakt slag ${ev.trickIndex + 1}`, {
          soort: ev.winner === 0 ? 'succes' : 'info',
          duurMs: 1500,
        });
        break;
      }
      case 'handClaimed': {
        const wie = namen[ev.seat] ?? `Stoel ${ev.seat + 1}`;
        void notifications.toon(
          `${wie} legt de hand af en neemt ${ev.acceptedPenalty} strafpunt(en)`,
          { soort: 'waarschuwing', duurMs: 2400 },
        );
        break;
      }
      case 'roundEnd': {
        const scores = naarArray(ev.scores, n);
        sheet.addRound(ev.roundIndex, ev.roundKind, huidigLabel, scores);
        scoreboard.update([...sheet.getRows()], namen);
        break;
      }
      case 'illegalMove':
        void notifications.toon(ev.reason, { soort: 'waarschuwing', duurMs: 2200 });
        break;
      case 'custom': {
        if (ev.subtype === 'troefdwang') {
          const data = ev.data as { melding?: string } | null;
          void notifications.toon(data?.melding ?? 'Troefdwang actief', {
            soort: 'waarschuwing',
            duurMs: 3200,
          });
        }
        break;
      }
      case 'gameEnd':
        hud.setTurn(null);
        einde = { winners: [...ev.winners], totals: naarArray(ev.totals, n) };
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
    void notifications.toon(
      'Meerdere menselijke spelers aan één scherm komt later; de computer speelt die stoelen.',
      { soort: 'info', duurMs: 3600 },
    );
  }

  const controllers: PlayerController[] = spelers.map((cfg, i) => {
    const seat = i as Seat;
    if (seat === 0 && cfg.kind === 'human') return mens;
    return new AiPlayer(seat, cfg, getStrategyForDifficulty(cfg.aiDifficulty ?? 'gemiddeld'));
  });

  // --- Animatie-gate: render/meldingen afronden vóór de volgende zet ---
  const afterEvent = async (ev: GameEvent): Promise<void> => {
    if (ev.type === 'roundStart') {
      await notifications.kondigRondeAan(`Geving ${ev.roundIndex + 1} — ${ev.roundLabel}`);
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

  for (;;) {
    const setup = await setupScreen.show(vorige);
    setupScreen.hide();
    vorige = structuredClone(setup);

    // Scene pas na de eerste setup bouwen (omgeving is dan bekend).
    if (!scene) {
      scene = await createSceneManager(app, bus, setup.omgeving);
      scene.start();
    } else {
      await scene.setEnvironment(setup.omgeving);
    }

    const ctx: AppContext = {
      uiRoot: ui,
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
      keuze = await speelPartij(ctx, setup);
    } while (keuze === 'opnieuw');
  }
}

main().catch((fout) => {
  console.error('Kingen kon niet starten:', fout);
  const ui = document.querySelector<HTMLDivElement>('#ui');
  if (ui) {
    const melding = document.createElement('p');
    melding.style.cssText =
      'color:#fff;font-family:system-ui;padding:1rem;background:rgba(120,0,0,0.8);margin:1rem;border-radius:8px;';
    melding.textContent = `Er ging iets mis bij het starten: ${fout instanceof Error ? fout.message : String(fout)}`;
    ui.appendChild(melding);
  }
});
