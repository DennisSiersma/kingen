/**
 * src/net/transport.ts
 * Transport-abstractie voor spel-events. Nu alleen LocalTransport (loopback
 * binnen één client); het interface is zo ontworpen dat een latere
 * WebSocket-server met gamerooms en chat er 1-op-1 in past.
 */

import type { GameEvent, PlayerConfig, Seat } from '../core/types.ts';

// ---------------------------------------------------------------------------
// Protocol-typen (toekomstvast: serialiseerbaar als JSON)
// ---------------------------------------------------------------------------

/** Chatbericht — onderdeel van het protocol zodat rooms later chat krijgen. */
export interface ChatMessage {
  /** Uniek bericht-id. */
  id: string;
  roomId: string;
  /** Afzender-stoel, of null voor systeemberichten. */
  from: Seat | null;
  /** Weergavenaam van de afzender. */
  fromName: string;
  tekst: string;
  /** Unix-ms. */
  timestamp: number;
}

/** Beschrijving van een gameroom. */
export interface RoomInfo {
  id: string;
  /** Nederlandse roomnaam, bijv. "Tafel van Dennis". */
  naam: string;
  gameId: string; // bijv. 'kingen'
  players: { seat: Seat; config: PlayerConfig; connected: boolean }[];
  maxPlayers: number;
  /** Is de partij al bezig? */
  inProgress: boolean;
}

/**
 * Alle berichten die over de lijn gaan. Discriminated union, JSON-serialiseerbaar.
 * GameEvents reizen ingepakt zodat room-routering en chat ernaast passen.
 */
export type NetMessage =
  | { kind: 'gameEvent'; roomId: string; event: GameEvent }
  /** Een zet van een client naar de host/server (host valideert). */
  | { kind: 'moveRequest'; roomId: string; seat: Seat; move: unknown }
  | { kind: 'chat'; message: ChatMessage }
  | { kind: 'roomUpdate'; room: RoomInfo }
  | { kind: 'joinedRoom'; room: RoomInfo; yourSeat: Seat }
  | { kind: 'leftRoom'; roomId: string; seat: Seat }
  | { kind: 'error'; code: string; melding: string };

export type ConnectionState = 'disconnected' | 'connecting' | 'connected';

// ---------------------------------------------------------------------------
// Transport-interface
// ---------------------------------------------------------------------------

export type MessageHandler = (message: NetMessage) => void;
export type Unsubscribe = () => void;

/**
 * Transport-contract. Implementaties: LocalTransport (nu), WebSocketTransport
 * (later). De spel-loop praat alleen met dit interface; lokaal of online spelen
 * is daardoor voor de rest van de app identiek.
 */
export interface Transport {
  readonly state: ConnectionState;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  /** Verstuur een bericht (lokaal: directe loopback met microtask-vertraging). */
  send(message: NetMessage): void;

  /** Abonneer op binnenkomende berichten. */
  onMessage(handler: MessageHandler): Unsubscribe;

  /** Abonneer op verbindingsstatus-wijzigingen. */
  onStateChange(handler: (state: ConnectionState) => void): Unsubscribe;

  // --- Rooms (lokaal: precies één impliciete room) ---
  createRoom(naam: string, gameId: string, maxPlayers: number): Promise<RoomInfo>;
  joinRoom(roomId: string, player: PlayerConfig): Promise<{ room: RoomInfo; seat: Seat }>;
  leaveRoom(roomId: string): Promise<void>;
  listRooms(): Promise<RoomInfo[]>;

  // --- Chat ---
  sendChat(roomId: string, tekst: string): void;
  onChat(handler: (message: ChatMessage) => void): Unsubscribe;
}

// ---------------------------------------------------------------------------
// LocalTransport
// ---------------------------------------------------------------------------

/**
 * In-memory loopback-transport voor lokaal spelen (mens + AI's in één client).
 * Berichten worden asynchroon (queueMicrotask) bij de handlers bezorgd zodat
 * de semantiek gelijk is aan een echt netwerk.
 */
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
