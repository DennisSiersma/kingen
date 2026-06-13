/**
 * @kingen/shared — net/protocol.ts
 * Transport-protocol voor spel-events: berichttypen, room-/chatmodellen en het
 * Transport-contract. Puur serialiseerbaar (JSON), geen DOM, geen implementatie.
 * Implementaties leven in de client (LocalTransport, WebSocketTransport) en
 * later de server.
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
 * Transport-contract. Implementaties: LocalTransport (nu, client), later
 * WebSocketTransport (client) en de server-zijde. De spel-loop praat alleen met
 * dit interface; lokaal of online spelen is daardoor voor de rest van de app
 * identiek.
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
