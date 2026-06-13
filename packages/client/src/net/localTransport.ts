/**
 * @kingen/client — net/localTransport.ts
 * In-memory loopback-transport voor lokaal spelen (mens + AI's in één client).
 * Berichten worden asynchroon (queueMicrotask) bij de handlers bezorgd zodat
 * de semantiek gelijk is aan een echt netwerk. Implementeert het gedeelde
 * Transport-contract uit @shared/net/protocol.ts.
 */

import type { PlayerConfig, Seat } from '@shared/core/types.ts';
import type {
  ChatMessage,
  ConnectionState,
  MessageHandler,
  NetMessage,
  RoomInfo,
  Transport,
  Unsubscribe,
} from '@shared/net/protocol.ts';

export class LocalTransport implements Transport {
  private connectionState: ConnectionState = 'disconnected';
  private readonly messageHandlers = new Set<MessageHandler>();
  private readonly stateHandlers = new Set<(state: ConnectionState) => void>();
  private readonly chatHandlers = new Set<(message: ChatMessage) => void>();
  private readonly rooms = new Map<string, RoomInfo>();
  private roomTeller = 0;
  private berichtTeller = 0;

  get state(): ConnectionState {
    return this.connectionState;
  }

  private setState(state: ConnectionState): void {
    if (state === this.connectionState) return;
    this.connectionState = state;
    for (const handler of [...this.stateHandlers]) handler(state);
  }

  /** Bezorg een bericht asynchroon (microtask) bij alle abonnees — zelfde
   *  semantiek als een echt netwerk, maar zonder latency. */
  private deliver(message: NetMessage): void {
    queueMicrotask(() => {
      for (const handler of [...this.messageHandlers]) handler(message);
      if (message.kind === 'chat') {
        for (const handler of [...this.chatHandlers]) handler(message.message);
      }
    });
  }

  async connect(): Promise<void> {
    if (this.connectionState === 'connected') return;
    this.setState('connecting');
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    this.setState('connected');
  }

  async disconnect(): Promise<void> {
    this.rooms.clear();
    this.setState('disconnected');
  }

  send(message: NetMessage): void {
    if (this.connectionState !== 'connected') {
      throw new Error('LocalTransport: niet verbonden (roep eerst connect() aan)');
    }
    this.deliver(message);
  }

  onMessage(handler: MessageHandler): Unsubscribe {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onStateChange(handler: (state: ConnectionState) => void): Unsubscribe {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  async createRoom(naam: string, gameId: string, maxPlayers: number): Promise<RoomInfo> {
    const room: RoomInfo = {
      id: `room-${++this.roomTeller}`,
      naam,
      gameId,
      players: [],
      maxPlayers,
      inProgress: false,
    };
    this.rooms.set(room.id, room);
    this.deliver({ kind: 'roomUpdate', room: structuredClone(room) });
    return structuredClone(room);
  }

  async joinRoom(roomId: string, player: PlayerConfig): Promise<{ room: RoomInfo; seat: Seat }> {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`LocalTransport: onbekende room '${roomId}'`);
    if (room.players.length >= room.maxPlayers) {
      this.deliver({ kind: 'error', code: 'room-vol', melding: `Room '${room.naam}' is vol` });
      throw new Error(`LocalTransport: room '${room.naam}' is vol`);
    }
    const bezet = new Set(room.players.map((p) => p.seat));
    let seat: Seat = 0;
    for (let s = 0; s < room.maxPlayers; s++) {
      if (!bezet.has(s as Seat)) {
        seat = s as Seat;
        break;
      }
    }
    room.players.push({ seat, config: structuredClone(player), connected: true });
    this.deliver({ kind: 'joinedRoom', room: structuredClone(room), yourSeat: seat });
    this.deliver({ kind: 'roomUpdate', room: structuredClone(room) });
    return { room: structuredClone(room), seat };
  }

  async leaveRoom(roomId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return;
    for (const speler of room.players) {
      this.deliver({ kind: 'leftRoom', roomId, seat: speler.seat });
    }
    this.rooms.delete(roomId);
  }

  async listRooms(): Promise<RoomInfo[]> {
    return [...this.rooms.values()].map((room) => structuredClone(room));
  }

  sendChat(roomId: string, tekst: string): void {
    const room = this.rooms.get(roomId);
    const afzender = room?.players[0];
    const message: ChatMessage = {
      id: `chat-${++this.berichtTeller}`,
      roomId,
      from: afzender?.seat ?? null,
      fromName: afzender?.config.name ?? 'Systeem',
      tekst,
      timestamp: Date.now(),
    };
    this.deliver({ kind: 'chat', message });
  }

  onChat(handler: (message: ChatMessage) => void): Unsubscribe {
    this.chatHandlers.add(handler);
    return () => this.chatHandlers.delete(handler);
  }
}
