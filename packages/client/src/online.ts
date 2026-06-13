/**
 * @kingen/client — online.ts
 * Online-modus (Fase 1, verticale plak): verbindt met de server, toont een
 * minimale lobby (naam + Start), en speelt een autoritatieve partij. Server-
 * GameEvents worden op een lokale bus geëmit zodat de bestaande scene + HUD
 * exact zoals offline renderen; alleen de bron is het netwerk. Bij een
 * requestMove toont de client de bestaande kaart-/keuze-UI en stuurt een
 * moveRequest terug. De lobby met meerdere rooms volgt in Fase 2.
 */

import { createGameEventBus } from '@shared/core/events.ts';
import { ScoreSheet } from '@shared/core/scoresheet.ts';
import { SUITS, SUIT_SYMBOLS, type Card, type GameEvent, type PublicGameView, type Seat, type Suit } from '@shared/core/types.ts';
import { DEFAULT_VARIANT, type KingenRoundKind } from '@shared/games/kingen/types.ts';
import { getTableParams } from '@shared/games/kingen/params.ts';
import type { RoomInfo } from '@shared/net/protocol.ts';

import { createSceneManager } from './render/scene.ts';
import { createHud } from './ui/hud.ts';
import { createScoreboard } from './ui/scoreboard.ts';
import { createChatPanel } from './ui/chat.ts';
import { createChoiceDialogs, createNotifications } from './ui/notifications.ts';
import { el, onEnvironmentChange, onUiEvent } from './ui/uiBus.ts';
import { onLangChange, rankLabels, roundKindName, suitName, t } from './ui/i18n.ts';
import { WebSocketTransport, defaultWsUrl } from './net/wsTransport.ts';

const ROOM_ID = 'ONLINE';

function clientId(): string {
  try {
    let id = localStorage.getItem('kingen.clientId');
    if (!id) {
      id = `c-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      localStorage.setItem('kingen.clientId', id);
    }
    return id;
  } catch {
    return `c-${Math.random().toString(36).slice(2)}`;
  }
}

export async function runOnlineGame(app: HTMLElement, ui: HTMLElement): Promise<void> {
  const bus = createGameEventBus();
  const hud = createHud(ui);
  const scoreboard = createScoreboard(ui);
  const notifications = createNotifications(ui);
  const dialogs = createChoiceDialogs(ui);

  const scene = await createSceneManager(app, bus, 'cafe');
  scene.start();
  scene.cardRenderer.setRankLabels(rankLabels());
  onLangChange(() => scene.cardRenderer.setRankLabels(rankLabels()));

  // Weergave-instellingen uit het HUD-menu (zelfde als offline).
  onEnvironmentChange(ui, (id) => void scene.setEnvironment(id));
  onUiEvent(ui, (ev) => {
    if (ev.type === 'brightnessChanged') scene.setBrightness(ev.percent);
    if (ev.type === 'cameraMotionChanged') scene.setCameraMotion(ev.enabled);
  });

  // --- spelstate (afgeleid uit events) ---
  let mySeat: Seat = 0;
  let names: string[] = [];
  let n: number = DEFAULT_VARIANT.playerCount;
  const totalRondes = getTableParams(DEFAULT_VARIANT).totalRounds;
  let sheet: ScoreSheet | null = null;
  const slagen: number[] = new Array<number>(n).fill(0);
  // Lopende kaartkeuze (gezet zodra het jouw beurt is om een kaart te spelen).
  let kaartKeuze: { legaal: string[]; kies: (id: string) => void } | null = null;
  const naamVan = (seat: number): string => names[seat] ?? t('app.seat', { num: seat + 1 });

  // --- HUD-wiring op de bus (gespiegeld van de offline offUiState) ---
  bus.onAny((ev: GameEvent) => {
    switch (ev.type) {
      case 'gameStart':
        names = ev.players.map((p) => p.name);
        n = ev.seatCount;
        sheet = new ScoreSheet(n);
        slagen.length = 0;
        for (let i = 0; i < n; i++) slagen.push(0);
        hud.setPlayers(names, ev.players.map((p) => p.kind));
        hud.setScores(new Array<number>(n).fill(0));
        hud.show();
        break;
      case 'roundStart':
        slagen.fill(0);
        hud.setRound(ev.roundKind, ev.roundIndex, totalRondes);
        hud.setTrump(null);
        hud.setTrickCounts([...slagen]);
        break;
      case 'trumpChosen':
        hud.setTrump(ev.trump);
        void notifications.toon(
          t('toast.trumpChosen', { name: naamVan(ev.chooser), suit: `${SUIT_SYMBOLS[ev.trump]} ${suitName(ev.trump)}` }),
          { soort: 'info', duurMs: 1800 },
        );
        break;
      case 'roundKindChosen':
        void notifications.toon(t('toast.dealerPicks', { name: naamVan(ev.chooser) }), { duurMs: 1400 });
        break;
      case 'turnStart':
        hud.setTurn(ev.seat);
        break;
      case 'trickWon':
        slagen[ev.winner] = (slagen[ev.winner] ?? 0) + 1;
        hud.setTrickCounts([...slagen]);
        hud.setTurn(null);
        void notifications.toon(
          t('toast.trickWon', { name: naamVan(ev.winner), num: ev.trickIndex + 1 }),
          { soort: ev.winner === mySeat ? 'succes' : 'info', duurMs: 1500 },
        );
        break;
      case 'roundEnd': {
        if (!sheet) break;
        const scores = new Array<number>(n).fill(0);
        for (let i = 0; i < n; i++) scores[i] = ev.scores[i] ?? 0;
        sheet.addRound(ev.roundIndex, ev.roundKind, roundKindName(ev.roundKind), scores);
        scoreboard.update([...sheet.getRows()], names);
        hud.setScores(sheet.getTotals());
        break;
      }
      default:
        break;
    }
  });

  // --- transport + lobby + chat ---
  const transport = new WebSocketTransport(defaultWsUrl());
  const lobby = maakLobby(ui);
  const chat = createChatPanel(ui);
  chat.onVerstuur((tekst) => transport.sendChat(ROOM_ID, tekst));
  transport.onChat((msg) => chat.voegToe(msg));

  transport.onMessage((msg) => {
    switch (msg.kind) {
      case 'joinedRoom':
        mySeat = msg.yourSeat;
        scene.setViewerSeat(mySeat);
        chat.setEigenStoel(mySeat);
        chat.toon();
        lobby.toonWachtkamer(msg.room, mySeat);
        break;
      case 'roomUpdate':
        lobby.update(msg.room);
        break;
      case 'gameEvent':
        if (msg.event.type === 'gameStart') lobby.verberg();
        bus.emit(msg.event);
        if (msg.event.type === 'gameEnd') {
          const winnaars = msg.event.winners.map((s) => naamVan(s)).join(', ');
          void scene.waitForIdle().then(() =>
            notifications.toon(t('online.gameOver', { winner: winnaars }), { soort: 'succes', duurMs: 8000 }),
          );
        }
        break;
      case 'snapshot':
        mySeat = msg.seat;
        scene.setViewerSeat(mySeat);
        chat.setEigenStoel(mySeat);
        toepassenSnapshot(msg.view);
        break;
      case 'requestMove':
        void handleRequest(msg);
        break;
      case 'error':
        void notifications.toon(msg.melding, { soort: 'waarschuwing', duurMs: 3000 });
        break;
      default:
        break;
    }
  });

  // Bewaar het hello-bericht en (her)stuur het bij elke verbinding, zodat de
  // server na een reconnect je stoel op je clientId herkent en herstelt.
  let laatsteHello: Extract<import('@shared/net/protocol.ts').NetMessage, { kind: 'hello' }> | null = null;
  let alEensVerbonden = false;

  transport.onStateChange((state) => {
    lobby.setStatus(state);
    if (state === 'connected') {
      chat.setStatus(null);
      if (laatsteHello) transport.send(laatsteHello);
      if (alEensVerbonden) void notifications.toon(t('online.reconnected'), { soort: 'succes', duurMs: 2500 });
      alEensVerbonden = true;
    } else if (state === 'connecting') {
      chat.setStatus(alEensVerbonden ? t('online.reconnecting') : t('online.connecting'));
    } else {
      chat.setStatus(t('online.disconnected'));
    }
  });

  const verbind = async (naam: string): Promise<void> => {
    laatsteHello = { kind: 'hello', clientId: clientId(), name: naam };
    try {
      localStorage.setItem('kingen.name', naam);
    } catch {
      // best-effort
    }
    try {
      await transport.connect();
    } catch {
      void notifications.toon(t('online.connectFailed'), { soort: 'waarschuwing', duurMs: 4000 });
    }
  };
  lobby.onVerbinden(verbind);

  // Bij herladen (reconnect) automatisch opnieuw verbinden met de bewaarde naam,
  // zodat je via je clientId je stoel + een snapshot terugkrijgt.
  let bewaardeNaam = '';
  try {
    bewaardeNaam = localStorage.getItem('kingen.name') ?? '';
  } catch {
    bewaardeNaam = '';
  }
  if (bewaardeNaam) void verbind(bewaardeNaam);
  lobby.onStart(() => transport.send({ kind: 'startGame', roomId: ROOM_ID }));

  // Dev-only hook: speel de eerste legale kaart als het jouw beurt is (voor
  // geautomatiseerde tests; in productie niet aanwezig).
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>)['__kingenAutoplay'] = (): boolean => {
      const eerste = kaartKeuze?.legaal[0];
      if (eerste && kaartKeuze) {
        kaartKeuze.kies(eerste);
        return true;
      }
      return false;
    };
  }

  /** Herstel de hele weergave uit een reconnect-snapshot (HUD + 3D-tafel). */
  function toepassenSnapshot(view: PublicGameView): void {
    n = view.seatCount;
    names = view.playerNames.slice();
    if (!sheet) sheet = new ScoreSheet(n);
    lobby.verberg();
    hud.show();
    // Soort per stoel is in de view niet bekend; eigen stoel = mens, rest = computer
    // (best-effort label; weggevallen mensen worden toch door de AI gedekt).
    hud.setPlayers(names, names.map((_, i) => (i === mySeat ? 'human' : 'ai')));
    hud.setRound(view.round.kind, view.round.index, totalRondes);
    hud.setTrump(view.round.trump);
    hud.setTrickCounts(view.trickCounts);
    hud.setScores(view.totals);
    hud.setTurn(view.turn);
    scene.toonSnapshot(view);
  }

  async function handleRequest(msg: Extract<import('@shared/net/protocol.ts').NetMessage, { kind: 'requestMove' }>): Promise<void> {
    // Wacht tot de animaties bij zijn, zodat de keuze-UI synchroon loopt.
    await scene.waitForIdle();
    if (msg.seat !== mySeat) return;
    if (msg.moveType === 'card') {
      const legaal = new Map<string, Card>((msg.legalCards ?? []).map((c) => [c.id, c]));
      scene.setPlayableCards([...legaal.keys()]);
      let klaar = false;
      const kies = (id: string): void => {
        const kaart = legaal.get(id);
        if (klaar || !kaart) return;
        klaar = true;
        stopScene();
        stopUi();
        scene.setPlayableCards([]);
        kaartKeuze = null;
        transport.send({ kind: 'moveRequest', roomId: ROOM_ID, seat: mySeat, move: { type: 'playCard', card: kaart } });
      };
      const stopScene = scene.onCardClicked(kies);
      // Ook via een UiEvent (toegankelijkheid + test), net als de offline LokaleMens.
      const stopUi = onUiEvent(ui, (ev) => {
        if (ev.type === 'cardChosen' && ev.seat === mySeat) kies(ev.cardId);
      });
      // Dev-hook (alleen in dev) zodat een geautomatiseerde test een legale
      // kaart kan spelen zonder op de 3D-kaart te hoeven klikken.
      kaartKeuze = { legaal: [...legaal.keys()], kies };
    } else if (msg.moveType === 'trump') {
      const suit = await dialogs.vraagTroef((msg.legalSuits as Suit[]) ?? [...SUITS]);
      transport.send({ kind: 'moveRequest', roomId: ROOM_ID, seat: mySeat, move: { type: 'chooseTrump', suit } });
    } else {
      const kind = await dialogs.vraagRondeKeuze((msg.legalKinds ?? []) as KingenRoundKind[]);
      transport.send({ kind: 'moveRequest', roomId: ROOM_ID, seat: mySeat, move: { type: 'chooseRoundKind', kind } });
    }
  }
}

// ---------------------------------------------------------------------------
// Minimale lobby-overlay (Fase 1). Fase 2 vervangt dit door een echte lobby
// met roomlijst, stoelen claimen en host-instellingen.
// ---------------------------------------------------------------------------

interface Lobby {
  onVerbinden(cb: (naam: string) => void): void;
  onStart(cb: () => void): void;
  toonWachtkamer(room: RoomInfo, mySeat: Seat): void;
  update(room: RoomInfo): void;
  setStatus(state: string): void;
  verberg(): void;
}

function maakLobby(ui: HTMLElement): Lobby {
  const overlay = el('div', 'kg-online-lobby');
  const kaart = el('div', 'kg-online-kaart');
  overlay.appendChild(kaart);

  kaart.appendChild(el('h2', undefined, t('online.title')));
  const status = el('p', 'kg-online-status', t('online.disconnected'));
  kaart.appendChild(status);

  const naamRij = el('div', 'kg-online-rij');
  const naamInput = el('input', 'kg-online-input') as HTMLInputElement;
  naamInput.type = 'text';
  naamInput.maxLength = 16;
  naamInput.placeholder = t('online.namePlaceholder');
  try {
    naamInput.value = localStorage.getItem('kingen.name') ?? '';
  } catch {
    naamInput.value = '';
  }
  naamRij.appendChild(naamInput);
  const verbindKnop = el('button', 'kg-btn', t('online.connect')) as HTMLButtonElement;
  naamRij.appendChild(verbindKnop);
  kaart.appendChild(naamRij);

  const stoelenLijst = el('ul', 'kg-online-stoelen');
  kaart.appendChild(stoelenLijst);

  const startKnop = el('button', 'kg-btn kg-btn--primair', t('online.start')) as HTMLButtonElement;
  startKnop.hidden = true;
  kaart.appendChild(startKnop);

  const terugLink = el('a', 'kg-online-terug', t('online.backLocal')) as HTMLAnchorElement;
  terugLink.href = location.pathname;
  kaart.appendChild(terugLink);

  ui.appendChild(overlay);

  let verbindenCb: ((naam: string) => void) | null = null;
  let startCb: (() => void) | null = null;

  verbindKnop.addEventListener('click', () => {
    const naam = naamInput.value.trim() || t('online.defaultName');
    verbindKnop.disabled = true;
    naamInput.disabled = true;
    verbindenCb?.(naam);
  });
  startKnop.addEventListener('click', () => startCb?.());

  function tekenStoelen(room: RoomInfo, mySeat?: Seat): void {
    stoelenLijst.innerHTML = '';
    for (const p of room.players) {
      const li = el('li', undefined, `${p.seat + 1}. ${p.config.name}${p.seat === mySeat ? ' (jij)' : ''}`);
      stoelenLijst.appendChild(li);
    }
  }

  return {
    onVerbinden(cb) {
      verbindenCb = cb;
    },
    onStart(cb) {
      startCb = cb;
    },
    toonWachtkamer(room, mySeat) {
      status.textContent = t('online.joined', { num: mySeat + 1 });
      tekenStoelen(room, mySeat);
      startKnop.hidden = false;
    },
    update(room) {
      tekenStoelen(room);
    },
    setStatus(state) {
      if (state === 'connecting') status.textContent = t('online.connecting');
      else if (state === 'connected' && startKnop.hidden) status.textContent = t('online.connected');
      else if (state === 'disconnected') status.textContent = t('online.disconnected');
    },
    verberg() {
      overlay.hidden = true;
    },
  };
}
