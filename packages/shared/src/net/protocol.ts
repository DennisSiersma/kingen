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
  /** Lobby: maak een nieuwe tafel en treed toe als host. `gameId` default 'kingen'. */
  | { kind: 'createRoom'; naam: string; gameId?: string; maxPlayers: number; zichtbaarheid: 'open' | 'prive' }
  /** Lobby: treed toe tot een bestaande tafel via code. */
  | { kind: 'joinRoom'; code: string }
  /** Verlaat de huidige tafel (terug naar de lobby). */
  | { kind: 'leaveRoom' }
  /** Host start de partij (lege stoelen worden door de server met AI gevuld). */
  | { kind: 'startGame'; roomId: string }
  | { kind: 'gameEvent'; roomId: string; event: GameEvent }
  /**
   * Server vraagt de aan-zet-zijnde client om een zet. `legalMoves` zijn de
   * (geserialiseerde) legale zetten zoals GameDefinition.getLegalMoves
   * teruggeeft — de client kiest er één en stuurt die ONGEWIJZIGD terug in een
   * moveRequest, zodat de client geen spelregels hoeft te kennen. `moveType` is
   * een hint (het `type`-veld van de zetten) waarop de client de juiste
   * invoer-UI kiest. Spel-agnostisch: werkt voor kaart/troef/rondekeuze net zo
   * goed als voor bieden/trekken/afleggen in toekomstige spellen.
   */
  | {
      kind: 'requestMove';
      roomId: string;
      seat: Seat;
      moveType: string;
      legalMoves: unknown[];
      /**
       * Spel-specifieke view-extra's van de aan-zet-zijnde stoel (alleen voor hem
       * zichtbaar), bijv. Mexen's eigen verborgen worp. Optioneel; kaartspellen
       * laten dit weg.
       */
      viewExtras?: unknown;
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
