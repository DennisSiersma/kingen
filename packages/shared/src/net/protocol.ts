/**
 * @kingen/shared — net/protocol.ts
 * Transport-protocol voor spel-events: berichttypen, room-/chatmodellen en het
 * Transport-contract. Puur serialiseerbaar (JSON), geen DOM, geen implementatie.
 * Implementaties leven in de client (LocalTransport, WebSocketTransport) en
 * later de server.
 */

import type { Card, GameEvent, PlayerConfig, Seat, Suit } from '../core/types.ts';

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
  /** Letterlijke tekst (spelerschat) óf taalonafhankelijke fallback bij systeemberichten. */
  tekst: string;
  /** Unix-ms. */
  timestamp: number;
  /**
   * Systeemmelding: een i18n-sleutel zodat elke client hem in de eigen taal
   * toont (i.p.v. een vaste servertaal). `params` vult placeholders zoals {name}.
   */
  systemCode?: string;
  params?: Record<string, string | number>;
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
  /** Deelbare code om te joinen (ook voor privé tafels). */
  code?: string;
  /** Open tafels staan in de lobbylijst; privé tafels alleen joinbaar via code. */
  zichtbaarheid?: 'open' | 'prive';
  /** Stoel van de host (mag als enige de partij starten); laagste verbonden stoel. */
  hostSeat?: Seat;
}

/**
 * Alle berichten die over de lijn gaan. Discriminated union, JSON-serialiseerbaar.
 * GameEvents reizen ingepakt zodat room-routering en chat ernaast passen.
 */
export type NetMessage =
  /** Client meldt zich aan na verbinden (gast-identiteit, voor reconnect). */
  | { kind: 'hello'; clientId: string; name: string }
  /** Server bevestigt de verbinding. */
  | { kind: 'helloOk'; connectionId: string; clientId: string }
  /** Lobby: vraag de lijst met open tafels op. */
  | { kind: 'listRooms' }
  /** Lobby: lijst met open tafels (antwoord). */
  | { kind: 'roomList'; rooms: RoomInfo[] }
  /** Lobby: maak een nieuwe tafel en treed toe als host. */
  | { kind: 'createRoom'; naam: string; maxPlayers: number; zichtbaarheid: 'open' | 'prive' }
  /** Lobby: treed toe tot een bestaande tafel via code. */
  | { kind: 'joinRoom'; code: string }
  /** Verlaat de huidige tafel (terug naar de lobby). */
  | { kind: 'leaveRoom' }
  /** Host start de partij (lege stoelen worden door de server met AI gevuld). */
  | { kind: 'startGame'; roomId: string }
  | { kind: 'gameEvent'; roomId: string; event: GameEvent }
  /**
   * Server vraagt de aan-zet-zijnde client om een zet. De server levert de
   * legale opties mee zodat de client zelf geen regels hoeft te kennen.
   */
  | {
      kind: 'requestMove';
      roomId: string;
      seat: Seat;
      moveType: 'card' | 'trump' | 'roundKind';
      legalCards?: Card[];
      legalSuits?: Suit[];
      legalKinds?: string[];
    }
  /** Een zet van een client naar de host/server (host valideert). */
  | { kind: 'moveRequest'; roomId: string; seat: Seat; move: unknown }
  /** Volledige toestand voor een (her)verbindende client. */
  | { kind: 'snapshot'; roomId: string; seat: Seat; view: import('../core/types.ts').PublicGameView }
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
