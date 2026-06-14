/**
 * @kingen/client — net/localHostTransport.ts
 * In-browser host voor LOKAAL spelen tegen de computer: implementeert het
 * Transport-contract maar draait zelf één solo-tafel via de gedeelde GameHost
 * (mens op stoel 0 + AI-fill op de rest). Zo speelt de bestaande generieke
 * online-client (online.ts) elk geregistreerd spel offline — zonder server.
 *
 * Het spreekt dezelfde protocol-berichten als de echte server (hello → joinedRoom,
 * startGame → gameEvent/requestMove, moveRequest), en personaliseert net als de
 * server: andermans handen worden uit het deal-event gefilterd (geen valsspelen).
 */

import type { GameEvent, PlayerConfig, Seat } from '@shared/core/types.ts';
import type {
  ChatMessage,
  ConnectionState,
  MessageHandler,
  NetMessage,
  RoomInfo,
  Transport,
  Unsubscribe,
} from '@shared/net/protocol.ts';
import { GameHost } from '@shared/net/gameHost.ts';

const AI_NAMEN = ['Ada', 'Kaia', 'Thom', 'Lola', 'Bastian', 'Geeta', 'Chris'];

export interface LocalHostOpts {
  gameId: string;
  config: unknown;
  playerCount: number;
  /** Naam van de menselijke speler (stoel 0). */
  playerName: string;
  /** AI-denktijd (min,max) ms; weglaten = natuurlijke default. */
  aiThinkDelayMs?: [number, number];
}

export class LocalHostTransport implements Transport {
  private connectionState: ConnectionState = 'disconnected';
  private readonly messageHandlers = new Set<MessageHandler>();
  private readonly stateHandlers = new Set<(state: ConnectionState) => void>();
  private readonly chatHandlers = new Set<(message: ChatMessage) => void>();
  private readonly roomId = 'LOCAL';
  private host: GameHost | null = null;
  private players: PlayerConfig[] = [];

  constructor(private readonly opts: LocalHostOpts) {}

  get state(): ConnectionState {
    return this.connectionState;
  }

  private setState(state: ConnectionState): void {
    if (state === this.connectionState) return;
    this.connectionState = state;
    for (const h of [...this.stateHandlers]) h(state);
  }

  private deliver(message: NetMessage): void {
    queueMicrotask(() => {
      for (const h of [...this.messageHandlers]) h(message);
    });
  }

  /** Verberg andermans handen: alleen de eigen hand blijft in het deal-event. */
  private personalize(event: GameEvent): GameEvent {
    if (event.type === 'deal') {
      const own = event.hands[0] ?? [];
      return { ...event, hands: { 0: own } };
    }
    return event;
  }

  private roomInfo(): RoomInfo {
    return {
      id: this.roomId,
      naam: `Tafel van ${this.opts.playerName}`,
      gameId: this.opts.gameId,
      players: this.players.map((config, seat) => ({ seat: seat as Seat, config, connected: true })),
      maxPlayers: this.opts.playerCount,
      inProgress: this.host !== null,
      hostSeat: 0,
    };
  }

  async connect(): Promise<void> {
    if (this.connectionState === 'connected') return;
    this.setState('connecting');
    await new Promise<void>((r) => queueMicrotask(r));
    this.setState('connected');
  }

  async disconnect(): Promise<void> {
    this.host?.stop();
    this.host = null;
    this.setState('disconnected');
  }

  send(message: NetMessage): void {
    switch (message.kind) {
      case 'hello': {
        // Bouw de solo-tafel: stoel 0 = mens, rest = AI, en meld de stoel.
        const n = this.opts.playerCount;
        this.players = Array.from({ length: n }, (_, i) =>
          i === 0
            ? { name: this.opts.playerName, kind: 'human' as const }
            : { name: AI_NAMEN[(i - 1) % AI_NAMEN.length]!, kind: 'ai' as const, aiDifficulty: 'gemiddeld' as const },
        );
        this.deliver({ kind: 'joinedRoom', room: this.roomInfo(), yourSeat: 0 as Seat });
        break;
      }
      case 'startGame': {
        if (this.host) break;
        const seed = Math.floor(Math.random() * 0x7fffffff);
        this.host = new GameHost(
          {
            roomId: this.roomId,
            players: this.players,
            gameId: this.opts.gameId,
            config: this.opts.config,
            humanSeats: new Set<Seat>([0 as Seat]),
            sendRequestMove: (seat, payload) =>
              this.deliver({ kind: 'requestMove', roomId: this.roomId, seat, moveType: payload.moveType, legalMoves: payload.legalMoves, viewExtras: payload.viewExtras }),
            forwardEvent: (event) => this.deliver({ kind: 'gameEvent', roomId: this.roomId, event: this.personalize(event) }),
            aiThinkDelayMs: this.opts.aiThinkDelayMs,
          },
          seed,
        );
        void this.host.start();
        break;
      }
      case 'moveRequest':
        this.host?.deliverMove(message.seat, message.move);
        break;
      case 'leaveRoom':
        this.host?.stop();
        this.host = null;
        break;
      default:
        break;
    }
  }

  onMessage(handler: MessageHandler): Unsubscribe {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onStateChange(handler: (state: ConnectionState) => void): Unsubscribe {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  // --- Rooms/chat: niet gebruikt door de online-client (die werkt via send/onMessage),
  //     maar het Transport-contract vereist ze. Minimale, veilige implementaties. ---
  async createRoom(): Promise<RoomInfo> {
    return this.roomInfo();
  }
  async joinRoom(): Promise<{ room: RoomInfo; seat: Seat }> {
    return { room: this.roomInfo(), seat: 0 as Seat };
  }
  async leaveRoom(): Promise<void> {
    this.host?.stop();
    this.host = null;
  }
  async listRooms(): Promise<RoomInfo[]> {
    return [];
  }
  sendChat(): void {
    // Geen chat in de lokale modus.
  }
  onChat(handler: (message: ChatMessage) => void): Unsubscribe {
    this.chatHandlers.add(handler);
    return () => this.chatHandlers.delete(handler);
  }
}
