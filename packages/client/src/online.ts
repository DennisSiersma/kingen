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
import { teamOf } from '@shared/games/klaverjassen/types.ts';
import { cardPoints } from '@shared/games/klaverjassen/cards.ts';

import { createSceneManager } from './render/scene.ts';
import { createHud } from './ui/hud.ts';
import { createScoreboard } from './ui/scoreboard.ts';
import { createChatPanel } from './ui/chat.ts';
import { createLobby } from './ui/lobby.ts';
import { createChoiceDialogs, createNotifications } from './ui/notifications.ts';
import { el, onEnvironmentChange, onUiEvent } from './ui/uiBus.ts';
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

export async function runOnlineGame(
  app: HTMLElement,
  ui: HTMLElement,
  opts: { gameId?: string; transport?: import('@shared/net/protocol.ts').Transport; solo?: boolean } = {},
): Promise<void> {
  const voorkeurGameId = opts.gameId;
  // Solo = lokaal tegen de computer: lobby overslaan, automatisch een tafel
  // maken + starten (de meegegeven transport is dan de in-browser host).
  const solo = opts.solo === true;
  const bus = createGameEventBus();
  const hud = createHud(ui);
  const scoreboard = createScoreboard(ui);
  const notifications = createNotifications(ui);
  const dialogs = createChoiceDialogs(ui);
  const teamPaneel = maakTeamPaneel(ui);
  const rikBanner = maakRikBanner(ui);
  const toepBanner = maakToepBanner(ui);

  const scene = await createSceneManager(app, bus, 'cafe');
  scene.start();
  scene.cardRenderer.setRankLabels(rankLabels());
  onLangChange(() => scene.cardRenderer.setRankLabels(rankLabels()));

  // Weergave-instellingen uit het HUD-menu (zelfde als offline).
  onEnvironmentChange(ui, (id) => void scene.setEnvironment(id));
  onUiEvent(ui, (ev) => {
    if (ev.type === 'brightnessChanged') scene.setBrightness(ev.percent);
    if (ev.type === 'cameraMotionChanged') scene.setCameraMotion(ev.enabled);
    if (ev.type === 'toggleScoreboard') scoreboard.toggle();
    // Partij afbreken → terug naar de spelgalerij (verse staat via herladen).
    if (ev.type === 'quitToSetup') location.href = location.pathname;
  });

  // --- spelstate (afgeleid uit events) ---
  let mySeat: Seat = 0;
  let huidigeRoomId = '';
  let huidigeRoom: import('@shared/net/protocol.ts').RoomInfo | null = null;
  let inRoom = false;
  // Terug-naar-wachtkamer-timer na een partij; annuleerbaar als de speler eerder weggaat.
  let replayTimer: ReturnType<typeof setTimeout> | null = null;
  // Laatste doorgeefrichting (Hartenjagen), uit het passRequest-event; voor de doorgeefdialoog.
  let laatstePassRichting = 'left';
  // Klaverjas-state voor het live team-paneel (Wij/Zij kaartpunten + roem deze boom).
  let isKlaverjas = false;
  let kjTrump: Suit | null = null;
  const kjCardPoints: [number, number] = [0, 0];
  const kjRoem: [number, number] = [0, 0];
  let kjMakingTeam: 0 | 1 | null = null;
  const updateTeamPaneel = (): void => {
    teamPaneel.set((mySeat % 2) as 0 | 1, kjCardPoints, kjRoem, kjMakingTeam);
  };
  // Rikken: contract-banner.
  let isRikken = false;
  // Toepen: inzet/status-banner + per-stoel status (active|folded|eliminated).
  let isToepen = false;
  let toepStatus: string[] = [];
  let toepInzet = 1;
  let laatsteToeper = 0;
  let laatsteClaimer = 0;
  const updateToepBanner = (): void => {
    toepBanner.set(toepStatus, names, mySeat, toepInzet);
  };
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
  // Aantal rondes voor de HUD-teller; 0 = open einde (bijv. Hartenjagen tot endScore).
  let totalRondes = getTableParams(DEFAULT_VARIANT).totalRounds;
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
        // Kingen heeft een vast aantal rondes; andere spellen (Hartenjagen) zijn open einde.
        totalRondes = ev.gameId.startsWith('kingen') ? getTableParams(DEFAULT_VARIANT).totalRounds : 0;
        isKlaverjas = ev.gameId.startsWith('klaverjas');
        if (isKlaverjas) teamPaneel.toon();
        else teamPaneel.verberg();
        isRikken = ev.gameId.startsWith('rikken');
        if (isRikken) rikBanner.toon();
        else rikBanner.verberg();
        isToepen = ev.gameId.startsWith('toepen');
        if (isToepen) {
          toepStatus = new Array<string>(n).fill('active');
          toepInzet = 1;
          updateToepBanner();
          toepBanner.toon();
        } else toepBanner.verberg();
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
        if (isKlaverjas) {
          kjTrump = null;
          kjCardPoints[0] = 0;
          kjCardPoints[1] = 0;
          kjRoem[0] = 0;
          kjRoem[1] = 0;
          // Spelend team = team van de voorhand (links van de deler).
          kjMakingTeam = teamOf(((ev.dealer + 1) % n) as Seat) as 0 | 1;
          updateTeamPaneel();
        }
        if (isRikken) rikBanner.setBidding();
        if (isToepen) {
          // Nieuwe ronde: inzet terug naar 1, gevouwen spelers weer actief
          // (afgevallen spelers blijven 'eliminated').
          toepInzet = 1;
          toepStatus = toepStatus.map((s) => (s === 'eliminated' ? 'eliminated' : 'active'));
          updateToepBanner();
        }
        break;
      case 'trumpChosen':
        hud.setTrump(ev.trump);
        kjTrump = ev.trump;
        if (isKlaverjas) {
          void notifications.toon(
            t('toast.klaverjasTrump', { suit: `${SUIT_SYMBOLS[ev.trump]} ${suitName(ev.trump)}` }),
            { soort: 'info', duurMs: 2200 },
          );
        } else {
          void notifications.toon(
            t('toast.trumpChosen', { name: naamVan(ev.chooser), suit: `${SUIT_SYMBOLS[ev.trump]} ${suitName(ev.trump)}` }),
            { soort: 'info', duurMs: 1800 },
          );
        }
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
        if (isKlaverjas && kjTrump !== null) {
          const winTeam = (teamOf(ev.winner) as 0 | 1);
          let pts = ev.trick.plays.reduce((s, p) => s + cardPoints(p.card, kjTrump), 0);
          if (ev.trickIndex === Math.floor(32 / n) - 1) pts += 10; // laatste-slag-bonus
          kjCardPoints[winTeam] += pts;
          updateTeamPaneel();
        }
        void notifications.toon(
          t('toast.trickWon', { name: naamVan(ev.winner), num: ev.trickIndex + 1 }),
          { soort: ev.winner === mySeat ? 'succes' : 'info', duurMs: 1500 },
        );
        break;
      case 'roundEnd': {
        if (!sheet) break;
        const scores = new Array<number>(n).fill(0);
        // Klaverjas scoort per TEAM (scores gekeyd 0/1); map naar de stoelen van
        // dat team (partners krijgen dezelfde rondescore). Andere spellen per stoel.
        for (let i = 0; i < n; i++) scores[i] = isKlaverjas ? (ev.scores[i % 2] ?? 0) : (ev.scores[i] ?? 0);
        sheet.addRound(ev.roundIndex, ev.roundKind, roundKindName(ev.roundKind), scores);
        scoreboard.update([...sheet.getRows()], names);
        hud.setScores(sheet.getTotals());
        break;
      }
      case 'custom':
        // Spel-specifieke events (o.a. Hartenjagen: doorgeven, harten gebroken, maan).
        if (ev.subtype === 'passRequest') {
          const d = ev.data as { direction?: string };
          if (typeof d?.direction === 'string') laatstePassRichting = d.direction;
        } else if (ev.subtype === 'heartsBroken') {
          void notifications.toon(t('toast.heartsBroken'), { soort: 'info', duurMs: 1600 });
        } else if (ev.subtype === 'shootMoon') {
          const d = ev.data as { seat?: number };
          void notifications.toon(t('toast.shootMoon', { name: naamVan(d?.seat ?? 0) }), { soort: 'succes', duurMs: 3500 });
        } else if (ev.subtype === 'phaseReversed') {
          void notifications.toon(t('toast.phaseReversed'), { soort: 'info', duurMs: 4000 });
        } else if (ev.subtype === 'bidMade') {
          // Leids bieden: het spelende team wordt pas bij het bod bekend (niet de
          // voorhand). Corrigeer het team-paneel zodra een bod het team vastlegt.
          const d = ev.data as { makingTeam?: number };
          if (typeof d?.makingTeam === 'number') {
            kjMakingTeam = (d.makingTeam % 2) as 0 | 1;
            updateTeamPaneel();
          }
        } else if (ev.subtype === 'roemDeclared') {
          const d = ev.data as { team?: number; seat?: number; points?: number };
          if (typeof d?.team === 'number' && typeof d?.points === 'number') {
            kjRoem[(d.team % 2) as 0 | 1] += d.points;
            updateTeamPaneel();
            void notifications.toon(t('toast.roem', { name: naamVan(d.seat ?? 0), points: d.points }), { soort: 'info', duurMs: 1600 });
          }
        } else if (ev.subtype === 'natResult') {
          const d = ev.data as { makingTeam?: number; gehaald?: boolean; makingTotal?: number; defendingTotal?: number };
          const myTeam = mySeat % 2;
          const making = d?.makingTeam ?? 0;
          const teamLabel = t(making === myTeam ? 'team.wij' : 'team.zij');
          if (d?.gehaald) {
            void notifications.toon(
              t('toast.klaverjasGehaald', { team: teamLabel, making: String(d?.makingTotal ?? 0), def: String(d?.defendingTotal ?? 0) }),
              { soort: making === myTeam ? 'succes' : 'info', duurMs: 3000 },
            );
          } else {
            void notifications.toon(t('toast.klaverjasNat', { team: teamLabel }), {
              soort: making === myTeam ? 'waarschuwing' : 'succes',
              duurMs: 3500,
            });
          }
        } else if (ev.subtype === 'pit') {
          const d = ev.data as { team?: number };
          const myTeam = mySeat % 2;
          const team = d?.team ?? -1;
          void notifications.toon(t('toast.klaverjasPit', { team: t(team === myTeam ? 'team.wij' : 'team.zij') }), {
            soort: team === myTeam ? 'succes' : 'waarschuwing',
            duurMs: 4000,
          });
        } else if (ev.subtype === 'bidPlaced') {
          const d = ev.data as { seat: number; bid: 'pass' | { kind: string; beter?: boolean } };
          if (d.bid === 'pass') void notifications.toon(t('rikken.passToast', { name: naamVan(d.seat) }), { duurMs: 1300 });
          else void notifications.toon(t('rikken.bidToast', { name: naamVan(d.seat), bid: rikBidLabel(d.bid) }), { soort: 'info', duurMs: 1500 });
        } else if (ev.subtype === 'contractSet') {
          const d = ev.data as { kind: string; declarer: number; trump: string | null; target: number; passGame?: string };
          rikBanner.setContract(naamVan(d.declarer), rikContractLabel(d.kind, d.passGame), d.trump, d.kind === 'rik' || d.kind === 'beterRik');
          void notifications.toon(t('rikken.contractToast', { name: naamVan(d.declarer), contract: rikContractLabel(d.kind, d.passGame) }), { soort: 'info', duurMs: 2400 });
        } else if (ev.subtype === 'partnerRevealed') {
          const d = ev.data as { partner: number };
          rikBanner.setMaat(naamVan(d.partner));
          void notifications.toon(t('rikken.partnerToast', { name: naamVan(d.partner) }), { soort: 'info', duurMs: 2600 });
        } else if (ev.subtype === 'contractResolved') {
          const d = ev.data as { kind: string; passGame?: string; declarer: number; deltas: number[] };
          if (!d.passGame) {
            const gehaald = (d.deltas[d.declarer] ?? 0) > 0;
            const label = rikContractLabel(d.kind);
            void notifications.toon(t(gehaald ? 'rikken.madeToast' : 'rikken.natToast', { contract: label }), {
              soort: gehaald ? 'succes' : 'waarschuwing',
              duurMs: 3000,
            });
          }
        } else if (ev.subtype === 'stakeChanged') {
          const d = ev.data as { stake?: number };
          if (typeof d?.stake === 'number') {
            toepInzet = d.stake;
            updateToepBanner();
          }
        } else if (ev.subtype === 'toepCalled') {
          const d = ev.data as { seat: number; stake: number };
          laatsteToeper = d.seat;
          void notifications.toon(t('toepen.toastToep', { name: naamVan(d.seat), stake: String(d.stake) }), {
            soort: d.seat === mySeat ? 'succes' : 'waarschuwing',
            duurMs: 2200,
          });
        } else if (ev.subtype === 'playerFolded') {
          const d = ev.data as { seat: number; penalty: number };
          toepStatus[d.seat] = 'folded';
          updateToepBanner();
          void notifications.toon(t('toepen.toastFold', { name: naamVan(d.seat), penalty: String(d.penalty) }), { duurMs: 1800 });
        } else if (ev.subtype === 'vierGelijke') {
          const d = ev.data as { seat: number };
          void notifications.toon(t('toepen.toastVierGelijke', { name: naamVan(d.seat) }), {
            soort: d.seat === mySeat ? 'succes' : 'info',
            duurMs: 3000,
          });
        } else if (ev.subtype === 'vuileWasClaimed') {
          const d = ev.data as { seat: number };
          laatsteClaimer = d.seat;
          void notifications.toon(t('toepen.toastVuileWasClaim', { name: naamVan(d.seat) }), { soort: 'info', duurMs: 1800 });
        } else if (ev.subtype === 'vuileWasResolved') {
          const d = ev.data as { claimer: number; challenger: number; terecht: boolean; penaltySeat: number };
          if (d.terecht) {
            void notifications.toon(t('toepen.toastVuileWasTerecht', { name: naamVan(d.challenger) }), { soort: 'info', duurMs: 2600 });
          } else {
            void notifications.toon(t('toepen.toastVuileWasBluf', { name: naamVan(d.claimer) }), { soort: 'waarschuwing', duurMs: 3000 });
          }
        } else if (ev.subtype === 'handOpened') {
          const d = ev.data as { seat: number };
          void notifications.toon(t('toepen.toastOpenHand', { name: naamVan(d.seat) }), { soort: 'info', duurMs: 3000 });
        } else if (ev.subtype === 'roundWonByLastStanding') {
          const d = ev.data as { seat: number };
          void notifications.toon(t('toepen.toastLastStanding', { name: naamVan(d.seat) }), {
            soort: d.seat === mySeat ? 'succes' : 'info',
            duurMs: 2600,
          });
        } else if (ev.subtype === 'roundResult') {
          const d = ev.data as { winner: number; stake: number };
          if (isToepen) {
            void notifications.toon(t('toepen.toastRound', { name: naamVan(d.winner), stake: String(d.stake) }), {
              soort: d.winner === mySeat ? 'succes' : 'info',
              duurMs: 2400,
            });
          }
        } else if (ev.subtype === 'playerEliminated') {
          const d = ev.data as { seat: number; total: number };
          toepStatus[d.seat] = 'eliminated';
          updateToepBanner();
          void notifications.toon(t('toepen.toastEliminated', { name: naamVan(d.seat), total: String(d.total) }), {
            soort: d.seat === mySeat ? 'waarschuwing' : 'info',
            duurMs: 3000,
          });
        }
        break;
      default:
        break;
    }
  });

  // --- transport + lobby + chat ---
  const transport = opts.transport ?? new WebSocketTransport(defaultWsUrl());
  const lobby = createLobby(ui, leesOpgeslagen('kingen.name'), voorkeurGameId);
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
        if (solo) break; // lokaal: geen lobby
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
        if (solo) {
          // Lokaal: meteen starten, geen wachtkamer of chat.
          transport.send({ kind: 'startGame', roomId: huidigeRoomId });
        } else {
          chat.setEigenStoel(mySeat);
          chat.toon();
          lobby.toonWachtkamer(msg.room, mySeat);
        }
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
            // Lokaal: blijf op de eindstand staan; via 'Partij afbreken' terug naar de galerij.
            if (solo) return;
            // Terug naar de wachtkamer zodat de host opnieuw kan starten (anderen wachten).
            if (replayTimer) clearTimeout(replayTimer);
            replayTimer = setTimeout(() => {
              replayTimer = null;
              hud.hide();
              teamPaneel.verberg();
              rikBanner.verberg();
              toepBanner.verberg();
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
    transport.send({ kind: 'createRoom', naam: o.naam, gameId: o.gameId, maxPlayers: o.maxPlayers, zichtbaarheid: o.zichtbaarheid }),
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
    teamPaneel.verberg();
    rikBanner.verberg();
    toepBanner.verberg();
    lobby.toonBrowser();
  });

  // Bij herladen (reconnect) automatisch opnieuw verbinden met de bewaarde naam,
  // zodat je via je clientId je stoel + een snapshot terugkrijgt.
  const bewaardeNaam = leesOpgeslagen('kingen.name');
  if (solo) {
    // Lokaal: meteen verbinden met de in-browser host; geen naamscherm.
    void verbind(bewaardeNaam || t('online.defaultName'));
  } else if (bewaardeNaam) {
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
    // Reconnect tijdens de doorgeeffase: herstel de doorgeefrichting uit de view
    // (er komt geen passRequest-event opnieuw), zodat de dialoog 'm goed toont.
    const pd = (view.viewExtras as { passDir?: string } | undefined)?.passDir;
    if (typeof pd === 'string') laatstePassRichting = pd;
    // Klaverjas: herstel het live team-paneel uit de view-extra's.
    isKlaverjas = view.round.kind === 'klaverjassen';
    if (isKlaverjas) {
      const ex = view.viewExtras as
        | { teamCardPoints?: number[]; teamRoem?: number[]; makingTeam?: number | null }
        | undefined;
      kjTrump = view.round.trump;
      kjCardPoints[0] = ex?.teamCardPoints?.[0] ?? 0;
      kjCardPoints[1] = ex?.teamCardPoints?.[1] ?? 0;
      kjRoem[0] = ex?.teamRoem?.[0] ?? 0;
      kjRoem[1] = ex?.teamRoem?.[1] ?? 0;
      kjMakingTeam = (ex?.makingTeam ?? null) as 0 | 1 | null;
      updateTeamPaneel();
      teamPaneel.toon();
    } else {
      teamPaneel.verberg();
    }
    // Rikken: contract-banner herstellen uit de view.
    isRikken = view.round.kind === 'rikken';
    if (isRikken) {
      const c = (view.viewExtras as { contract?: { kind: string; declarer: number; trump: string | null; target: number; partner: number | null; passGame?: string } | null })?.contract;
      if (c) {
        rikBanner.setContract(naamVan(c.declarer), rikContractLabel(c.kind, c.passGame), c.trump, c.kind === 'rik' || c.kind === 'beterRik');
        if (c.partner !== null && c.partner !== undefined) rikBanner.setMaat(naamVan(c.partner));
      } else {
        rikBanner.setBidding();
      }
      rikBanner.toon();
    } else {
      rikBanner.verberg();
    }
    // Toepen: inzet/status-banner herstellen uit de view-extra's.
    isToepen = view.round.kind === 'toepen';
    if (isToepen) {
      const ex = view.viewExtras as { stake?: number; status?: string[] } | undefined;
      toepInzet = ex?.stake ?? 1;
      toepStatus = ex?.status ? ex.status.slice() : new Array<string>(n).fill('active');
      updateToepBanner();
      toepBanner.toon();
    } else {
      toepBanner.verberg();
    }
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
    | { type: 'claimHand' }
    | { type: 'passCards'; cards: Card[] }
    // Rikken-zetten (via het generieke moveType-pad):
    | { type: 'bid'; bid: 'pass' | { kind: string; beter?: boolean } }
    | { type: 'askAce'; cardId: string }
    | { type: 'choosePassGame'; game: 'schoppenMie' | 'eenOfVijf' }
    // Toepen-zetten:
    | { type: 'callToep' }
    | { type: 'respondMeegaan' }
    | { type: 'respondPas' }
    | { type: 'declareVierGelijke' }
    | { type: 'claimVuileWas' }
    | { type: 'passClaim' }
    | { type: 'challengeVuileWas' }
    | { type: 'passChallenge' };

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
      // Toepen: een "Toep!"-knop als toepen nu een legale zet is.
      const toepMove = legalMoves.find((m) => m.type === 'callToep');
      let toepKnop: HTMLButtonElement | null = null;
      const opruimenToep = (): void => {
        toepKnop?.remove();
        toepKnop = null;
      };
      let klaar = false;
      const kies = (id: string): void => {
        const move = kaartZetten.get(id);
        if (klaar || !move) return;
        klaar = true;
        stopScene();
        stopUi();
        opruimenToep();
        scene.setPlayableCards([]);
        kaartKeuze = null;
        stuur(move);
      };
      const stopScene = scene.onCardClicked(kies);
      // Ook via een UiEvent (toegankelijkheid + test), net als de offline LokaleMens.
      const stopUi = onUiEvent(ui, (ev) => {
        if (ev.type === 'cardChosen' && ev.seat === mySeat) kies(ev.cardId);
      });
      if (toepMove) {
        toepKnop = el('button', 'kg-toepknop kg-klikbaar') as HTMLButtonElement;
        toepKnop.type = 'button';
        toepKnop.textContent = t('toepen.toepKnop');
        toepKnop.addEventListener('click', () => {
          if (klaar) return;
          klaar = true;
          stopScene();
          stopUi();
          opruimenToep();
          scene.setPlayableCards([]);
          kaartKeuze = null;
          stuur(toepMove);
        });
        ui.appendChild(toepKnop);
      }
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
    } else if (msg.moveType === 'passCards') {
      // De legalMoves zijn alle 3-kaart-combinaties; de hand = de unie ervan.
      const handMap = new Map<string, Card>();
      for (const m of legalMoves) if (m.type === 'passCards') for (const c of m.cards) handMap.set(c.id, c);
      const gekozen = await dialogs.vraagDoorgeven([...handMap.values()], laatstePassRichting);
      const ids = new Set(gekozen.map((c) => c.id));
      const move =
        legalMoves.find((m) => m.type === 'passCards' && m.cards.length === 3 && m.cards.every((c) => ids.has(c.id))) ??
        legalMoves[0];
      if (move) stuur(move);
    } else if (msg.moveType === 'bid') {
      // Rikken: kies een bod (of pas) uit de aangeboden treden.
      const opties = legalMoves.map((m, i) => {
        if (m.type !== 'bid') return { id: String(i), label: '?' };
        return { id: String(i), label: rikBidLabel(m.bid), primair: m.bid !== 'pass' && m.bid.kind === 'rik' };
      });
      const id = await dialogs.vraagOptie(t('rikken.bidTitle'), t('rikken.bidSub'), opties);
      const move = legalMoves[Number(id)];
      if (move) stuur(move);
    } else if (msg.moveType === 'askAce') {
      // Rikken: vraag een maat-aas/heer.
      const opties = legalMoves.flatMap((m, i) => {
        if (m.type !== 'askAce') return [];
        const sep = m.cardId.lastIndexOf('-');
        const suit = m.cardId.slice(0, sep) as Suit;
        const rank = Number(m.cardId.slice(sep + 1));
        const woord = rank === 14 ? t('rikken.aas') : t('rikken.heer');
        return [{ id: String(i), label: `${suitName(suit)} ${woord}` }];
      });
      const id = await dialogs.vraagOptie(t('rikken.askTitle'), t('rikken.askSub'), opties);
      const move = legalMoves[Number(id)];
      if (move) stuur(move);
    } else if (msg.moveType === 'choosePassGame') {
      const opties = legalMoves.flatMap((m, i) => {
        if (m.type !== 'choosePassGame') return [];
        const mie = m.game === 'schoppenMie';
        return [{ id: String(i), label: t(mie ? 'rikken.schoppenMie' : 'rikken.eenOfVijf'), uitleg: t(mie ? 'rikken.schoppenMieUitleg' : 'rikken.eenOfVijfUitleg') }];
      });
      const id = await dialogs.vraagOptie(t('rikken.passTitle'), t('rikken.passSub'), opties);
      const move = legalMoves[Number(id)];
      if (move) stuur(move);
    } else if (msg.moveType === 'respondMeegaan' || msg.moveType === 'respondPas') {
      // Toepen: reageren op een toep (meegaan tegen de hogere inzet, of vouwen).
      const stake = toepInzet;
      const kosten = Math.max(1, toepInzet - 1);
      const opties = [
        { id: 'mee', label: t('toepen.meegaan', { stake: String(stake) }), primair: true },
        { id: 'pas', label: t('toepen.passen', { kosten: String(kosten) }) },
      ];
      const id = await dialogs.vraagOptie(
        t('toepen.responsTitel', { name: naamVan(toepLaatsteToeper()), stake: String(stake) }),
        t('toepen.responsSub', { kosten: String(kosten) }),
        opties,
      );
      const wil = id === 'pas' ? 'respondPas' : 'respondMeegaan';
      const move = legalMoves.find((m) => m.type === wil) ?? legalMoves[0];
      if (move) stuur(move);
    } else if (msg.moveType === 'declareVierGelijke' || msg.moveType === 'claimVuileWas' || msg.moveType === 'passClaim') {
      // Toepen: speciale-hand-fase (vier gelijke / vuile was / doorgaan).
      const opties = legalMoves.flatMap((m, i) => {
        if (m.type === 'declareVierGelijke') return [{ id: String(i), label: t('toepen.vierGelijke'), uitleg: t('toepen.vierGelijkeUitleg'), primair: true }];
        if (m.type === 'claimVuileWas') return [{ id: String(i), label: t('toepen.vuileWas'), uitleg: t('toepen.vuileWasUitleg') }];
        if (m.type === 'passClaim') return [{ id: String(i), label: t('toepen.doorgaan') }];
        return [];
      });
      const id = await dialogs.vraagOptie(t('toepen.claimTitel'), t('toepen.claimSub'), opties);
      const move = legalMoves[Number(id)];
      if (move) stuur(move);
    } else if (msg.moveType === 'challengeVuileWas' || msg.moveType === 'passChallenge') {
      // Toepen: een vuile-was-claim van een ander controleren of laten gaan.
      const opties = [
        { id: 'check', label: t('toepen.controleren') },
        { id: 'laat', label: t('toepen.laatGaan'), primair: true },
      ];
      const id = await dialogs.vraagOptie(
        t('toepen.challengeTitel', { name: naamVan(toepClaimer()) }),
        t('toepen.challengeSub'),
        opties,
      );
      const wil = id === 'check' ? 'challengeVuileWas' : 'passChallenge';
      const move = legalMoves.find((m) => m.type === wil) ?? legalMoves[0];
      if (move) stuur(move);
    }
  }

  /** Wie toepte het laatst (voor de respons-dialoogtitel), uit de banner-state. */
  function toepLaatsteToeper(): number {
    return laatsteToeper;
  }
  /** Wie claimt nu vuile was (voor de challenge-dialoogtitel). */
  function toepClaimer(): number {
    return laatsteClaimer;
  }
}

/** Leesbaar label voor een Rikken-bod. */
function rikBidLabel(bid: 'pass' | { kind: string; beter?: boolean }): string {
  if (bid === 'pass') return t('rikken.pass');
  let label = t(`rikken.kind.${bid.kind}` as Parameters<typeof t>[0]);
  if (bid.beter && bid.kind.startsWith('alleen')) label += t('rikken.beterSuffix');
  return label;
}

/** Leesbaar label voor een Rikken-contract (of passspel). */
function rikContractLabel(kind: string, passGame?: string): string {
  if (passGame) return t(passGame === 'schoppenMie' ? 'rikken.schoppenMie' : 'rikken.eenOfVijf');
  return t(`rikken.kind.${kind}` as Parameters<typeof t>[0]);
}

/**
 * Live team-paneel voor Klaverjassen: toont per team (Wij/Zij, vanuit de kijker)
 * de kaartpunten + roem van de huidige boom, met een "speelt"-badge op het
 * verplichte (spelende) team. De client telt zelf mee uit de slag-events, dus het
 * paneel werkt zonder extra serverberichten.
 */
function maakTeamPaneel(root: HTMLElement): {
  toon(): void;
  verberg(): void;
  set(myTeam: 0 | 1, cp: readonly [number, number], roem: readonly [number, number], making: 0 | 1 | null): void;
} {
  const wrap = el('div', 'kg-teampaneel');
  wrap.hidden = true;
  const titel = el('div', 'kg-teampaneel__titel');
  const rij = el('div', 'kg-teampaneel__rij');
  const maakBlok = () => {
    const blok = el('div', 'kg-teampaneel__team');
    const naam = el('div', 'kg-teampaneel__naam');
    const punten = el('div', 'kg-teampaneel__punten', '0');
    const roem = el('div', 'kg-teampaneel__roem', '');
    const badge = el('div', 'kg-teampaneel__badge');
    badge.hidden = true;
    blok.append(naam, punten, roem, badge);
    return { blok, naam, punten, roem, badge };
  };
  const links = maakBlok();
  const rechts = maakBlok();
  rij.append(links.blok, rechts.blok);
  wrap.append(titel, rij);
  root.appendChild(wrap);

  let laatste: { myTeam: 0 | 1; cp: [number, number]; roem: [number, number]; making: 0 | 1 | null } | null = null;

  function teken(): void {
    titel.textContent = t('klaverjas.deal');
    links.naam.textContent = t('team.wij');
    rechts.naam.textContent = t('team.zij');
    links.badge.textContent = t('klaverjas.making');
    rechts.badge.textContent = t('klaverjas.making');
    if (!laatste) return;
    const { myTeam, cp, roem, making } = laatste;
    const other = (1 - myTeam) as 0 | 1;
    links.punten.textContent = String(cp[myTeam]);
    rechts.punten.textContent = String(cp[other]);
    links.roem.textContent = roem[myTeam] > 0 ? `+${roem[myTeam]} ${t('klaverjas.roem')}` : '';
    rechts.roem.textContent = roem[other] > 0 ? `+${roem[other]} ${t('klaverjas.roem')}` : '';
    links.badge.hidden = making !== myTeam;
    rechts.badge.hidden = making !== other;
    links.blok.classList.toggle('is-speelt', making === myTeam);
    rechts.blok.classList.toggle('is-speelt', making === other);
  }

  onLangChange(() => teken());
  teken();

  return {
    toon(): void {
      wrap.hidden = false;
    },
    verberg(): void {
      wrap.hidden = true;
    },
    set(myTeam, cp, roem, making): void {
      laatste = { myTeam, cp: [cp[0], cp[1]], roem: [roem[0], roem[1]], making };
      teken();
    },
  };
}


/**
 * Rikken contract-banner: toont tijdens het bieden "Bieden…" en daarna het
 * contract (soort + troef + speler + maat — "?" tot de gevraagde aas valt).
 */
function maakRikBanner(root: HTMLElement): {
  toon(): void;
  verberg(): void;
  setBidding(): void;
  setContract(declarer: string, label: string, trump: string | null, hasMaat: boolean): void;
  setMaat(naam: string): void;
} {
  const wrap = el('div', 'kg-rikbanner');
  wrap.hidden = true;
  const titel = el('div', 'kg-rikbanner__titel');
  const regel = el('div', 'kg-rikbanner__regel');
  const maatRegel = el('div', 'kg-rikbanner__maat');
  wrap.append(titel, regel, maatRegel);
  root.appendChild(wrap);
  let huidigMaat: string | null = null;

  function setBidding(): void {
    titel.textContent = t('rikken.biddingLabel');
    regel.textContent = '';
    maatRegel.hidden = true;
    huidigMaat = null;
  }
  function setContract(declarer: string, label: string, trump: string | null, hasMaat: boolean): void {
    titel.textContent = label;
    const troef = trump ? `${SUIT_SYMBOLS[trump as Suit]} ${suitName(trump as Suit)}` : t('rikken.noTrump');
    regel.textContent = `${t('rikken.declarerLabel')}: ${declarer} · ${troef}`;
    maatRegel.hidden = !hasMaat;
    if (hasMaat) maatRegel.textContent = `${t('rikken.maatLabel')}: ${huidigMaat ?? t('rikken.maatUnknown')}`;
  }
  function setMaat(naam: string): void {
    huidigMaat = naam;
    maatRegel.hidden = false;
    maatRegel.textContent = `${t('rikken.maatLabel')}: ${naam}`;
  }
  return {
    toon(): void {
      wrap.hidden = false;
    },
    verberg(): void {
      wrap.hidden = true;
    },
    setBidding,
    setContract,
    setMaat,
  };
}

/**
 * Toepen inzet-/status-banner: toont de huidige inzet (pot) prominent en per
 * stoel de status (speelt mee / gevouwen / af). De client houdt de status zelf
 * bij uit de toep-events, dus de banner werkt zonder extra serverberichten.
 */
function maakToepBanner(root: HTMLElement): {
  toon(): void;
  verberg(): void;
  set(status: readonly string[], names: readonly string[], mySeat: number, inzet: number): void;
} {
  const wrap = el('div', 'kg-toepbanner');
  wrap.hidden = true;
  const titel = el('div', 'kg-toepbanner__titel');
  const inzetBadge = el('div', 'kg-toepbanner__inzet');
  const inzetLabel = el('span', 'kg-toepbanner__inzetlabel');
  const inzetWaarde = el('span', 'kg-toepbanner__inzetwaarde', '1');
  inzetBadge.append(inzetLabel, inzetWaarde);
  const rij = el('div', 'kg-toepbanner__rij');
  wrap.append(titel, inzetBadge, rij);
  root.appendChild(wrap);

  let laatste: { status: string[]; names: string[]; mySeat: number; inzet: number } | null = null;

  const statusWoord = (s: string): string =>
    s === 'folded' ? t('toepen.statusGepast') : s === 'eliminated' ? t('toepen.statusAf') : t('toepen.statusActief');

  function teken(): void {
    titel.textContent = t('toepen.bannerTitel');
    inzetLabel.textContent = `${t('toepen.inzet')}: `;
    if (!laatste) return;
    inzetWaarde.textContent = String(laatste.inzet);
    rij.innerHTML = '';
    laatste.status.forEach((s, seat) => {
      const chip = el('div', 'kg-toepbanner__chip');
      chip.classList.toggle('is-gevouwen', s === 'folded');
      chip.classList.toggle('is-af', s === 'eliminated');
      chip.classList.toggle('is-zelf', seat === laatste!.mySeat);
      const naam = laatste!.names[seat] ?? t('app.seat', { num: seat + 1 });
      chip.textContent = `${naam} · ${statusWoord(s)}`;
      rij.appendChild(chip);
    });
  }

  onLangChange(() => teken());
  teken();

  return {
    toon(): void {
      wrap.hidden = false;
    },
    verberg(): void {
      wrap.hidden = true;
    },
    set(status, names, mySeat, inzet): void {
      laatste = { status: [...status], names: [...names], mySeat, inzet };
      teken();
    },
  };
}
