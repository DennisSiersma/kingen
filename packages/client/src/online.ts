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

import { createSceneManager } from './render/scene.ts';
import { createHud } from './ui/hud.ts';
import { createScoreboard } from './ui/scoreboard.ts';
import { createChatPanel } from './ui/chat.ts';
import { createLobby } from './ui/lobby.ts';
import { createChoiceDialogs, createNotifications } from './ui/notifications.ts';
import { onEnvironmentChange, onUiEvent } from './ui/uiBus.ts';
import { onLangChange, rankLabels, roundKindName, suitName, t } from './ui/i18n.ts';
import { WebSocketTransport, defaultWsUrl } from './net/wsTransport.ts';

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
  let huidigeRoomId = '';
  let huidigeRoom: import('@shared/net/protocol.ts').RoomInfo | null = null;
  let inRoom = false;
  // Terug-naar-wachtkamer-timer na een partij; annuleerbaar als de speler eerder weggaat.
  let replayTimer: ReturnType<typeof setTimeout> | null = null;
  const leesOpgeslagen = (key: string): string => {
    try {
      return localStorage.getItem(key) ?? '';
    } catch {
      return '';
    }
  };
  const bewaar = (key: string, val: string): void => {
    try {
      localStorage.setItem(key, val);
    } catch {
      // best-effort
    }
  };
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
        scene.setSeatNames(names);
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
  const lobby = createLobby(ui, leesOpgeslagen('kingen.name'));
  const chat = createChatPanel(ui);
  chat.onVerstuur((tekst) => {
    if (huidigeRoomId) transport.sendChat(huidigeRoomId, tekst);
  });
  transport.onChat((msg) => chat.voegToe(msg));

  // Bewaar het hello-bericht en (her)stuur het bij elke verbinding, zodat de
  // server na een reconnect je stoel op je clientId herkent en herstelt.
  let laatsteHello: Extract<import('@shared/net/protocol.ts').NetMessage, { kind: 'hello' }> | null = null;
  let alEensVerbonden = false;

  transport.onMessage((msg) => {
    switch (msg.kind) {
      case 'roomList':
        lobby.updateRoomList(msg.rooms);
        if (!inRoom) {
          // Bij een (her)verbinding automatisch terug naar je laatste tafel, anders de browser.
          const code = leesOpgeslagen('kingen.roomCode');
          if (code) transport.send({ kind: 'joinRoom', code });
          else lobby.toonBrowser();
        }
        break;
      case 'joinedRoom':
        inRoom = true;
        huidigeRoomId = msg.room.id;
        huidigeRoom = msg.room;
        bewaar('kingen.roomCode', msg.room.code ?? '');
        mySeat = msg.yourSeat;
        scene.setViewerSeat(mySeat);
        chat.setEigenStoel(mySeat);
        chat.toon();
        lobby.toonWachtkamer(msg.room, mySeat);
        break;
      case 'roomUpdate':
        if (msg.room.id === huidigeRoomId) {
          huidigeRoom = msg.room;
          lobby.updateRoom(msg.room);
        }
        break;
      case 'gameEvent':
        if (msg.event.type === 'gameStart') lobby.verberg();
        bus.emit(msg.event);
        if (msg.event.type === 'gameEnd') {
          const winnaars = msg.event.winners.map((s) => naamVan(s)).join(', ');
          void scene.waitForIdle().then(() => {
            void notifications.toon(t('online.gameOver', { winner: winnaars }), { soort: 'succes', duurMs: 8000 });
            // Terug naar de wachtkamer zodat de host opnieuw kan starten (anderen wachten).
            if (replayTimer) clearTimeout(replayTimer);
            replayTimer = setTimeout(() => {
              replayTimer = null;
              hud.hide();
              if (huidigeRoom) lobby.toonWachtkamer(huidigeRoom, mySeat);
            }, 5000);
          });
        }
        break;
      case 'snapshot':
        inRoom = true;
        huidigeRoomId = msg.roomId;
        mySeat = msg.seat;
        scene.setViewerSeat(mySeat);
        chat.setEigenStoel(mySeat);
        chat.toon();
        toepassenSnapshot(msg.view);
        break;
      case 'requestMove':
        void handleRequest(msg);
        break;
      case 'error':
        if (msg.code === 'geen-tafel' || msg.code === 'vol' || msg.code === 'in-uitvoering' || msg.code === 'max-tafels') {
          // Tafel niet (meer) beschikbaar → terug naar de browser.
          bewaar('kingen.roomCode', '');
          inRoom = false;
          huidigeRoomId = '';
          lobby.toonBrowser();
        }
        void notifications.toon(msg.melding, { soort: 'waarschuwing', duurMs: 3000 });
        break;
      default:
        break;
    }
  });

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
    bewaar('kingen.name', naam);
    try {
      await transport.connect();
    } catch {
      void notifications.toon(t('online.connectFailed'), { soort: 'waarschuwing', duurMs: 4000 });
    }
  };
  lobby.onConnect(verbind);
  lobby.onCreate((o) =>
    transport.send({ kind: 'createRoom', naam: o.naam, maxPlayers: o.maxPlayers, zichtbaarheid: o.zichtbaarheid }),
  );
  lobby.onJoinCode((code) => transport.send({ kind: 'joinRoom', code }));
  lobby.onStart(() => {
    if (huidigeRoomId) transport.send({ kind: 'startGame', roomId: huidigeRoomId });
  });
  lobby.onLeave(() => {
    transport.send({ kind: 'leaveRoom' });
    inRoom = false;
    huidigeRoomId = '';
    huidigeRoom = null;
    if (replayTimer) {
      clearTimeout(replayTimer);
      replayTimer = null;
    }
    bewaar('kingen.roomCode', '');
    chat.verberg();
    hud.hide();
    lobby.toonBrowser();
  });

  // Bij herladen (reconnect) automatisch opnieuw verbinden met de bewaarde naam,
  // zodat je via je clientId je stoel + een snapshot terugkrijgt.
  const bewaardeNaam = leesOpgeslagen('kingen.name');
  if (bewaardeNaam) {
    lobby.setStatus('connecting');
    void verbind(bewaardeNaam);
  } else {
    lobby.toonNaam();
  }

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
    scene.setSeatNames(names);
    hud.setRound(view.round.kind, view.round.index, totalRondes);
    hud.setTrump(view.round.trump);
    hud.setTrickCounts(view.trickCounts ?? []);
    hud.setScores(view.totals);
    hud.setTurn(view.turn);
    scene.toonSnapshot(view);
  }

  // Kingen-zetvormen zoals de server ze in legalMoves aanlevert. De client
  // kiest er één en stuurt die ONGEWIJZIGD terug (de server matcht op waarde).
  type KingenMoveJSON =
    | { type: 'playCard'; card: Card }
    | { type: 'chooseTrump'; suit: Suit }
    | { type: 'chooseRoundKind'; kind: string }
    | { type: 'claimHand' };

  async function handleRequest(msg: Extract<import('@shared/net/protocol.ts').NetMessage, { kind: 'requestMove' }>): Promise<void> {
    // Wacht tot de animaties bij zijn, zodat de keuze-UI synchroon loopt.
    await scene.waitForIdle();
    if (msg.seat !== mySeat) return;
    const legalMoves = (msg.legalMoves ?? []) as KingenMoveJSON[];
    const stuur = (move: KingenMoveJSON): void => {
      transport.send({ kind: 'moveRequest', roomId: huidigeRoomId, seat: mySeat, move });
    };

    // moveType is het `type` van de aangeboden zetten (spel-agnostische hint).
    if (msg.moveType === 'playCard') {
      const kaartZetten = new Map<string, KingenMoveJSON>();
      for (const m of legalMoves) if (m.type === 'playCard') kaartZetten.set(m.card.id, m);
      scene.setPlayableCards([...kaartZetten.keys()]);
      let klaar = false;
      const kies = (id: string): void => {
        const move = kaartZetten.get(id);
        if (klaar || !move) return;
        klaar = true;
        stopScene();
        stopUi();
        scene.setPlayableCards([]);
        kaartKeuze = null;
        stuur(move);
      };
      const stopScene = scene.onCardClicked(kies);
      // Ook via een UiEvent (toegankelijkheid + test), net als de offline LokaleMens.
      const stopUi = onUiEvent(ui, (ev) => {
        if (ev.type === 'cardChosen' && ev.seat === mySeat) kies(ev.cardId);
      });
      // Dev-hook (alleen in dev) zodat een geautomatiseerde test een legale
      // kaart kan spelen zonder op de 3D-kaart te hoeven klikken.
      kaartKeuze = { legaal: [...kaartZetten.keys()], kies };
    } else if (msg.moveType === 'chooseTrump') {
      const suits = legalMoves.flatMap((m) => (m.type === 'chooseTrump' ? [m.suit] : []));
      const suit = await dialogs.vraagTroef(suits.length ? suits : [...SUITS]);
      const move = legalMoves.find((m) => m.type === 'chooseTrump' && m.suit === suit) ?? legalMoves[0];
      if (move) stuur(move);
    } else if (msg.moveType === 'chooseRoundKind') {
      const kinds = legalMoves.flatMap((m) => (m.type === 'chooseRoundKind' ? [m.kind] : [])) as KingenRoundKind[];
      const kind = await dialogs.vraagRondeKeuze(kinds);
      const move = legalMoves.find((m) => m.type === 'chooseRoundKind' && m.kind === kind) ?? legalMoves[0];
      if (move) stuur(move);
    }
  }
}

