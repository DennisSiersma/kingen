/**
 * @kingen/server — room.ts
 * Beheert één gameroom (Fase 1: precies één room): verbindingen, stoeltoewijzing,
 * partij starten met AI-fill, en het per-stoel personaliseren + doorsturen van
 * GameEvents. Transport-agnostisch (werkt met een ClientConn-abstractie) zodat
 * het zowel met echte WebSockets als in tests gebruikt kan worden.
 */

import type { GameEvent, PlayerConfig, Seat } from '@kingen/shared/core/types.ts';
import type { ChatMessage, NetMessage, RoomInfo } from '@kingen/shared/net/protocol.ts';
import type { KingenVariantConfig } from '@kingen/shared/games/kingen/types.ts';
import { DEFAULT_VARIANT } from '@kingen/shared/games/kingen/types.ts';
import { GameHost } from './gameHost.ts';
import type { MoveRequestPayload } from './remotePlayer.ts';

/** Minimale verbinding-abstractie (echte ws of test-stub). */
export interface ClientConn {
  readonly id: string;
  send(msg: NetMessage): void;
}

const AI_NAME_POOL = ['Ada', 'Kaia', 'Chris', 'Thom', 'Ali', 'Geeta', 'Myrna', 'Lola'];

export class Room {
  readonly id: string;
  readonly naam: string;
  readonly gameId = 'kingen';
  readonly variant: KingenVariantConfig;
  readonly maxPlayers: number;

  private readonly conns = new Map<string, ClientConn>();
  private readonly seatByConn = new Map<string, Seat>();
  private readonly connBySeat = new Map<Seat, string>();
  private readonly names = new Map<Seat, string>();
  private host: GameHost | null = null;
  private inProgress = false;
  private chatTeller = 0;
  private readonly aiThinkDelayMs: [number, number] | undefined;
  private readonly moveTimeoutMs: number;

  constructor(
    id: string,
    naam: string,
    variant: KingenVariantConfig = DEFAULT_VARIANT,
    aiThinkDelayMs?: [number, number],
    moveTimeoutMs = 60000,
  ) {
    this.id = id;
    this.naam = naam;
    this.variant = structuredClone(variant);
    this.maxPlayers = this.variant.playerCount;
    this.aiThinkDelayMs = aiThinkDelayMs;
    this.moveTimeoutMs = moveTimeoutMs;
  }

  // --- Verbindingen ---------------------------------------------------------

  connect(conn: ClientConn): void {
    this.conns.set(conn.id, conn);
  }

  disconnect(connId: string): void {
    const seat = this.seatByConn.get(connId);
    if (seat !== undefined) {
      const naam = this.names.get(seat) ?? 'Een speler';
      this.connBySeat.delete(seat);
      this.seatByConn.delete(connId);
      this.broadcast({ kind: 'leftRoom', roomId: this.id, seat });
      this.broadcastRoomUpdate();
      this.systeemChat('chat.sysLeft', { name: naam }, `${naam} heeft de tafel verlaten`);
    }
    this.conns.delete(connId);
  }

  handleMessage(connId: string, msg: NetMessage): void {
    const conn = this.conns.get(connId);
    if (!conn) return;
    switch (msg.kind) {
      case 'hello':
        this.onHello(conn, msg.clientId, msg.name);
        break;
      case 'startGame':
        this.onStartGame();
        break;
      case 'moveRequest':
        this.onMove(connId, msg.seat, msg.move);
        break;
      case 'chat':
        this.onChat(connId, msg.message?.tekst ?? '');
        break;
      default:
        // Overige berichten (server→client) negeren we hier.
        break;
    }
  }

  private onHello(conn: ClientConn, clientId: string, name: string): void {
    conn.send({ kind: 'helloOk', connectionId: conn.id, clientId });
    if (this.inProgress) {
      conn.send({ kind: 'error', code: 'in-uitvoering', melding: 'De partij is al bezig' });
      return;
    }
    const seat = this.laagsteVrijeStoel();
    if (seat === null) {
      conn.send({ kind: 'error', code: 'vol', melding: 'De tafel is vol' });
      return;
    }
    this.seatByConn.set(conn.id, seat);
    this.connBySeat.set(seat, conn.id);
    this.names.set(seat, name.trim() || `Speler ${seat + 1}`);
    conn.send({ kind: 'joinedRoom', room: this.toRoomInfo(), yourSeat: seat });
    this.broadcastRoomUpdate();
    const naam = this.names.get(seat) ?? `Speler ${seat + 1}`;
    this.systeemChat('chat.sysJoined', { name: naam }, `${naam} is erbij`);
  }

  private onStartGame(): void {
    if (this.inProgress) return;
    if (this.connBySeat.size === 0) return; // minstens één mens
    this.inProgress = true;

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
        variant: this.variant,
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
    this.host?.deliverMove(seat, (move ?? {}) as Record<string, never>);
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
    };
  }
}
