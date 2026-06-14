/**
 * @kingen/server — room.ts
 * Beheert één gameroom (Fase 1: precies één room): verbindingen, stoeltoewijzing,
 * partij starten met AI-fill, en het per-stoel personaliseren + doorsturen van
 * GameEvents. Transport-agnostisch (werkt met een ClientConn-abstractie) zodat
 * het zowel met echte WebSockets als in tests gebruikt kan worden.
 */

import type { GameEvent, PlayerConfig, Seat } from '@kingen/shared/core/types.ts';
import type { ChatMessage, NetMessage, RoomInfo } from '@kingen/shared/net/protocol.ts';
import { GameHost } from '@kingen/shared/net/gameHost.ts';
import type { MoveRequestPayload } from '@kingen/shared/net/remotePlayer.ts';

/** Minimale verbinding-abstractie (echte ws of test-stub). */
export interface ClientConn {
  readonly id: string;
  send(msg: NetMessage): void;
}

const AI_NAME_POOL = ['Ada', 'Kaia', 'Chris', 'Thom', 'Ali', 'Geeta', 'Myrna', 'Lola'];

export interface RoomOpts {
  id: string;
  naam: string;
  code: string;
  zichtbaarheid?: 'open' | 'prive';
  /** Welk spel deze tafel speelt (id in het GameRegistry). */
  gameId: string;
  /** Spel-specifieke config (variant). */
  config: unknown;
  /** Aantal stoelen aan deze tafel. */
  maxPlayers: number;
  aiThinkDelayMs?: [number, number];
  moveTimeoutMs?: number;
  /** Aangeroepen bij elke wijziging die de lobbylijst raakt (join/leave/start/eind). */
  onChange?: () => void;
  /** Aangeroepen wanneer een partij start (voor statistiek). */
  onGameStart?: () => void;
  /** Aangeroepen wanneer een partij eindigt (voor statistiek). */
  onGameEnd?: () => void;
}

export class Room {
  readonly id: string;
  readonly naam: string;
  readonly code: string;
  readonly zichtbaarheid: 'open' | 'prive';
  readonly gameId: string;
  private readonly config: unknown;
  readonly maxPlayers: number;

  private readonly conns = new Map<string, ClientConn>();
  private readonly seatByConn = new Map<string, Seat>();
  private readonly connBySeat = new Map<Seat, string>();
  private readonly names = new Map<Seat, string>();
  // clientId-administratie voor reconnect: een stoel hoort bij een clientId en
  // blijft bij een korte disconnect gereserveerd (AI dekt de beurten af).
  private readonly clientIdByConn = new Map<string, string>();
  private readonly seatByClientId = new Map<string, Seat>();
  private host: GameHost | null = null;
  private inProgress = false;
  private chatTeller = 0;
  private readonly aiThinkDelayMs: [number, number] | undefined;
  private readonly moveTimeoutMs: number;
  private readonly onChange: (() => void) | undefined;
  private readonly onGameStart: (() => void) | undefined;
  private readonly onGameEnd: (() => void) | undefined;

  constructor(opts: RoomOpts) {
    this.id = opts.id;
    this.naam = opts.naam;
    this.code = opts.code;
    this.zichtbaarheid = opts.zichtbaarheid ?? 'open';
    this.gameId = opts.gameId;
    this.config = structuredClone(opts.config);
    this.maxPlayers = opts.maxPlayers;
    this.aiThinkDelayMs = opts.aiThinkDelayMs;
    this.moveTimeoutMs = opts.moveTimeoutMs ?? 60000;
    this.onChange = opts.onChange;
    this.onGameStart = opts.onGameStart;
    this.onGameEnd = opts.onGameEnd;
  }

  /** Aantal verbonden mensen (voor opruimen lege tafels). */
  get aantalVerbonden(): number {
    return this.connBySeat.size;
  }

  get bezig(): boolean {
    return this.inProgress;
  }

  // --- Verbindingen ---------------------------------------------------------

  connect(conn: ClientConn): void {
    this.conns.set(conn.id, conn);
  }

  disconnect(connId: string): void {
    const seat = this.seatByConn.get(connId);
    if (seat !== undefined) {
      const naam = this.names.get(seat) ?? 'Een speler';
      const clientId = this.clientIdByConn.get(connId);
      this.connBySeat.delete(seat);
      this.seatByConn.delete(connId);
      this.broadcast({ kind: 'leftRoom', roomId: this.id, seat });
      this.broadcastRoomUpdate();
      if (this.inProgress) {
        // Stoel blijft gereserveerd op de clientId; de zet-time-out laat de AI
        // de beurten spelen tot de speler terugkomt.
        this.systeemChat('chat.sysAway', { name: naam }, `${naam} is weg — de computer neemt het over`);
      } else {
        // Buiten een partij: stoel helemaal vrijgeven.
        if (clientId) this.seatByClientId.delete(clientId);
        this.names.delete(seat);
        this.systeemChat('chat.sysLeft', { name: naam }, `${naam} heeft de tafel verlaten`);
      }
    }
    this.clientIdByConn.delete(connId);
    this.conns.delete(connId);
  }

  /** In-room berichten (de Hub routeert lobby-berichten zelf). */
  handleMessage(connId: string, msg: NetMessage): void {
    const conn = this.conns.get(connId);
    if (!conn) return;
    switch (msg.kind) {
      case 'startGame':
        this.onStartGame(connId);
        break;
      case 'moveRequest':
        this.onMove(connId, msg.seat, msg.move);
        break;
      case 'chat':
        this.onChat(connId, msg.message?.tekst ?? '');
        break;
      default:
        break;
    }
  }

  /** Treed toe tot deze tafel. Retourneert false als joinen niet kon. */
  join(conn: ClientConn, clientId: string, name: string): boolean {
    this.conns.set(conn.id, conn);
    this.clientIdByConn.set(conn.id, clientId);

    // Reconnect: kent deze clientId al een stoel, dan herbinden we (ook midden
    // in een partij) en sturen een snapshot zodat de tafel direct herstelt.
    const bestaandeStoel = this.seatByClientId.get(clientId);
    if (bestaandeStoel !== undefined) {
      this.connBySeat.set(bestaandeStoel, conn.id);
      this.seatByConn.set(conn.id, bestaandeStoel);
      conn.send({ kind: 'joinedRoom', room: this.toRoomInfo(), yourSeat: bestaandeStoel });
      this.broadcastRoomUpdate();
      const naam = this.names.get(bestaandeStoel) ?? `Speler ${bestaandeStoel + 1}`;
      if (this.inProgress && this.host) {
        const view = this.host.getView(bestaandeStoel);
        if (view) conn.send({ kind: 'snapshot', roomId: this.id, seat: bestaandeStoel, view });
        // Was het zijn beurt? Stuur het zet-verzoek opnieuw naar de nieuwe verbinding.
        this.host.resendRequest(bestaandeStoel);
        this.systeemChat('chat.sysBack', { name: naam }, `${naam} is terug`);
      }
      return true;
    }

    if (this.inProgress) {
      conn.send({ kind: 'error', code: 'in-uitvoering', melding: 'De partij is al bezig' });
      this.conns.delete(conn.id);
      this.clientIdByConn.delete(conn.id);
      return false;
    }
    const seat = this.laagsteVrijeStoel();
    if (seat === null) {
      conn.send({ kind: 'error', code: 'vol', melding: 'De tafel is vol' });
      this.conns.delete(conn.id);
      this.clientIdByConn.delete(conn.id);
      return false;
    }
    this.seatByConn.set(conn.id, seat);
    this.connBySeat.set(seat, conn.id);
    this.seatByClientId.set(clientId, seat);
    this.names.set(seat, name.trim() || `Speler ${seat + 1}`);
    conn.send({ kind: 'joinedRoom', room: this.toRoomInfo(), yourSeat: seat });
    this.broadcastRoomUpdate();
    const naam = this.names.get(seat) ?? `Speler ${seat + 1}`;
    this.systeemChat('chat.sysJoined', { name: naam }, `${naam} is erbij`);
    return true;
  }

  /** De host is de laagste verbonden stoel; mag als enige starten. Schuift door als de host weggaat. */
  private hostSeat(): Seat | null {
    let laagste: Seat | null = null;
    for (const seat of this.connBySeat.keys()) {
      if (laagste === null || seat < laagste) laagste = seat;
    }
    return laagste;
  }

  private onStartGame(connId: string): void {
    if (this.inProgress) return;
    if (this.connBySeat.size === 0) return; // minstens één mens
    // Alleen de host mag de partij starten (voorkomt dat een late joiner per ongeluk start).
    const seat = this.seatByConn.get(connId);
    if (seat === undefined || seat !== this.hostSeat()) {
      this.conns.get(connId)?.send({
        kind: 'error',
        code: 'geen-host',
        melding: 'Alleen de host kan de partij starten',
      });
      return;
    }
    this.inProgress = true;
    this.onGameStart?.();

    const humanSeats = new Set<Seat>(this.connBySeat.keys());
    const gebruikt = new Set<string>([...this.names.values()].map((n) => n.toLowerCase()));
    let poolIdx = 0;
    const players: PlayerConfig[] = [];
    for (let s = 0; s < this.maxPlayers; s++) {
      const seat = s as Seat;
      if (humanSeats.has(seat)) {
        players.push({ name: this.names.get(seat) ?? `Speler ${s + 1}`, kind: 'human' });
      } else {
        // Kies een nog ongebruikte AI-naam.
        let naam = `Computer ${s + 1}`;
        while (poolIdx < AI_NAME_POOL.length) {
          const kandidaat = AI_NAME_POOL[poolIdx++]!;
          if (!gebruikt.has(kandidaat.toLowerCase())) {
            naam = kandidaat;
            gebruikt.add(kandidaat.toLowerCase());
            break;
          }
        }
        players.push({ name: naam, kind: 'ai', aiDifficulty: 'gemiddeld' });
      }
    }

    const seed = Math.floor(Math.random() * 0x7fffffff);
    this.host = new GameHost(
      {
        roomId: this.id,
        players,
        gameId: this.gameId,
        config: this.config,
        humanSeats,
        sendRequestMove: (seat, payload) => this.sendRequestMove(seat, payload),
        forwardEvent: (event) => this.broadcastEvent(event),
        aiThinkDelayMs: this.aiThinkDelayMs,
        moveTimeoutMs: this.moveTimeoutMs,
        onMoveTimeout: (seat) => {
          const naam = this.names.get(seat) ?? `Speler ${seat + 1}`;
          this.systeemChat('chat.sysAiTakeover', { name: naam }, `${naam} is even weg — de computer speelt`);
        },
      },
      seed,
    );
    this.broadcastRoomUpdate();
    void this.host.start().catch((err) => {
      console.error(`[room ${this.id}] partij-fout:`, err);
    });
  }

  private onMove(connId: string, seat: Seat, move: unknown): void {
    const eigen = this.seatByConn.get(connId);
    if (eigen !== seat) {
      this.conns.get(connId)?.send({
        kind: 'error',
        code: 'verkeerde-stoel',
        melding: 'Je kunt alleen voor je eigen stoel een zet doen',
      });
      return;
    }
    this.host?.deliverMove(seat, move ?? {});
  }

  // --- Uitgaand -------------------------------------------------------------

  /** Een chatbericht van een speler: verrijk met afzender-stoel/naam en verspreid. */
  private onChat(connId: string, ruweTekst: string): void {
    const tekst = String(ruweTekst).replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!tekst) return;
    const seat = this.seatByConn.get(connId);
    const message: ChatMessage = {
      id: `m${++this.chatTeller}`,
      roomId: this.id,
      from: seat ?? null,
      fromName: seat !== undefined ? this.names.get(seat) ?? `Speler ${seat + 1}` : 'Onbekend',
      tekst,
      timestamp: Date.now(),
    };
    this.broadcast({ kind: 'chat', message });
  }

  /**
   * Systeemmelding in de chat (from = null). `systemCode` is een i18n-sleutel
   * die elke client in de eigen taal toont; `fallback` is de NL-tekst voor
   * clients zonder die sleutel/logging.
   */
  private systeemChat(systemCode: string, params: Record<string, string | number>, fallback: string): void {
    const message: ChatMessage = {
      id: `m${++this.chatTeller}`,
      roomId: this.id,
      from: null,
      fromName: 'Systeem',
      tekst: fallback,
      timestamp: Date.now(),
      systemCode,
      params,
    };
    this.broadcast({ kind: 'chat', message });
  }

  private sendRequestMove(seat: Seat, payload: MoveRequestPayload): void {
    const connId = this.connBySeat.get(seat);
    if (!connId) return;
    this.conns.get(connId)?.send({ kind: 'requestMove', roomId: this.id, seat, ...payload });
  }

  /** Stuur een GameEvent naar elke verbonden mens, per stoel gefilterd. */
  private broadcastEvent(event: GameEvent): void {
    for (const [seat, connId] of this.connBySeat) {
      const conn = this.conns.get(connId);
      if (conn) conn.send({ kind: 'gameEvent', roomId: this.id, event: this.personalize(event, seat) });
    }
    if (event.type === 'gameEnd') this.partijAfgelopen();
  }

  /** Partij voorbij: tafel terug naar wachtkamer, weggevallen stoelen vrijgeven. */
  private partijAfgelopen(): void {
    this.inProgress = false;
    this.host = null;
    this.onGameEnd?.();
    // Stoelen waarvan de speler weg is (geen live verbinding) helemaal vrijgeven.
    for (const [clientId, seat] of [...this.seatByClientId]) {
      if (!this.connBySeat.has(seat)) {
        this.seatByClientId.delete(clientId);
        this.names.delete(seat);
      }
    }
    this.broadcastRoomUpdate();
  }

  /** Verberg andermans handen: alleen de eigen hand blijft in het deal-event. */
  private personalize(event: GameEvent, seat: Seat): GameEvent {
    if (event.type === 'deal') {
      const own = event.hands[seat] ?? [];
      return { ...event, hands: { [seat]: own } };
    }
    return event;
  }

  private broadcast(msg: NetMessage): void {
    for (const conn of this.conns.values()) conn.send(msg);
  }

  private broadcastRoomUpdate(): void {
    this.broadcast({ kind: 'roomUpdate', room: this.toRoomInfo() });
    this.onChange?.();
  }

  /** Publieke roominfo (voor de lobbylijst). */
  info(): RoomInfo {
    return this.toRoomInfo();
  }

  // --- Hulp -----------------------------------------------------------------

  private laagsteVrijeStoel(): Seat | null {
    for (let s = 0; s < this.maxPlayers; s++) {
      if (!this.connBySeat.has(s as Seat)) return s as Seat;
    }
    return null;
  }

  private toRoomInfo(): RoomInfo {
    const players: RoomInfo['players'] = [];
    for (const [seat, connId] of this.connBySeat) {
      players.push({
        seat,
        config: { name: this.names.get(seat) ?? `Speler ${seat + 1}`, kind: 'human' },
        connected: this.conns.has(connId),
      });
    }
    players.sort((a, b) => a.seat - b.seat);
    return {
      id: this.id,
      naam: this.naam,
      gameId: this.gameId,
      players,
      maxPlayers: this.maxPlayers,
      inProgress: this.inProgress,
      code: this.code,
      zichtbaarheid: this.zichtbaarheid,
      hostSeat: this.hostSeat() ?? undefined,
    };
  }
}
