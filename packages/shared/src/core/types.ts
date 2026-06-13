/**
 * src/core/types.ts
 * Spel-onafhankelijke kerntypes van de engine.
 * Dit bestand is het centrale contract: andere modules importeren hieruit.
 *
 * Conventie: code-identifiers in het Engels; de engine is taalneutraal en
 * levert id's (roundKind, suit, ...). Zichtbare teksten maakt de UI zelf
 * via src/ui/i18n.ts (NL/EN).
 */

// ---------------------------------------------------------------------------
// Kaarten
// ---------------------------------------------------------------------------

/** De vier kleuren van een standaardspel. */
export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';

export const SUITS: readonly Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];

/** Nederlandse weergavenamen per kleur. */
export const SUIT_NAMES_NL: Readonly<Record<Suit, string>> = {
  hearts: 'Harten',
  diamonds: 'Ruiten',
  clubs: 'Klaveren',
  spades: 'Schoppen',
};

/** Unicode-symbolen per kleur (voor UI en textures). */
export const SUIT_SYMBOLS: Readonly<Record<Suit, string>> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
};

/**
 * Rang: 2 t/m 14. Aas is HOOG (14), 2 is laag.
 * 11 = boer (J), 12 = dame (Q), 13 = heer (K), 14 = aas (A).
 */
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export const JACK: Rank = 11;
export const QUEEN: Rank = 12;
export const KING: Rank = 13;
export const ACE: Rank = 14;

/** Nederlandse korte labels per rang (voor textures/UI): '2'..'10', 'B', 'V', 'H', 'A'. */
export const RANK_LABELS_NL: Readonly<Record<Rank, string>> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'B', 12: 'V', 13: 'H', 14: 'A',
};

/** Engelse korte labels per rang: '2'..'10', 'J', 'Q', 'K', 'A'. */
export const RANK_LABELS_EN: Readonly<Record<Rank, string>> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

/**
 * Stabiele kaart-id, als opake sleutel in maps, netwerkprotocol en render-cache.
 * Formaten:
 *  - standaardkaart:        `${suit}-${rank}`     bijv. "hearts-13"
 *  - extra deck-kopie (>0): `${suit}-${rank}#${n}` bijv. "hearts-13#1"
 *  - joker:                 `joker-${n}`          bijv. "joker-0"
 * Parse via cardFromId(). (Was de literal-template `${Suit}-${number}`; verbreed
 * naar string voor jokers en meerdere decks.)
 */
export type CardId = string;

/** Een speelkaart. Immutabel behandelen. */
export interface Card {
  readonly id: CardId;
  readonly suit: Suit;
  readonly rank: Rank;
  /** Kopie-index bij spellen met meerdere decks (0/undefined = eerste/enige deck). */
  readonly instanceId?: number;
  /**
   * True voor een joker. Een joker heeft GEEN betekenisvolle suit/rank
   * (placeholderwaarden); code die jokers kan tegenkomen moet eerst isJoker()
   * checken. Jokers komen alleen voor in spellen die ze gebruiken (Pesten,
   * Jokeren), nooit in slagenspellen.
   */
  readonly joker?: boolean;
}

// ---------------------------------------------------------------------------
// Stoelen en spelers
// ---------------------------------------------------------------------------

/**
 * Stoelindex aan tafel (0-gebaseerd, met de klok mee). Het aantal stoelen
 * hangt van het spel af (Kingen 3-5, Pesten 2-8, Kingsen tot 12, ...), dus Seat
 * is een gewone `number`. Stoel 0 is in de UI de stoel van de lokale speler.
 */
export type Seat = number;

/** De stoelen 0..count-1 voor een tafel met `count` spelers. */
export function seats(count: number): Seat[] {
  return Array.from({ length: count }, (_, i) => i);
}

/** Soort speler op een stoel. */
export type PlayerKind = 'human' | 'ai';

/** Configuratie van één speler/stoel, zoals gekozen op het setup-scherm. */
export interface PlayerConfig {
  /** Weergavenaam, bijv. "Dennis" of "Computer (West)". */
  name: string;
  kind: PlayerKind;
  /** Alleen relevant bij kind === 'ai'. Default: 'gemiddeld'. */
  aiDifficulty?: 'makkelijk' | 'gemiddeld' | 'moeilijk';
  /** Strategie-id uit src/ai (optioneel; default per moeilijkheidsgraad). */
  aiStrategyId?: string;
}

// ---------------------------------------------------------------------------
// Slagen en tafel
// ---------------------------------------------------------------------------

/** Eén gespeelde kaart binnen een slag. */
export interface TrickPlay {
  seat: Seat;
  card: Card;
}

/** Een (lopende of voltooide) slag. */
export interface Trick {
  /** Volgnummer binnen de ronde, 0-based. */
  index: number;
  /** Stoel die uitkwam. */
  leader: Seat;
  /** Gespeelde kaarten in speelvolgorde. */
  plays: TrickPlay[];
  /** Winnaar; alleen gezet zodra de slag compleet is. */
  winner?: Seat;
}

// ---------------------------------------------------------------------------
// Game-events (EventBus / netwerkprotocol)
// ---------------------------------------------------------------------------

/**
 * Discriminated union van alle spel-events. Deze events vormen het volledige
 * verloop van een partij en zijn 1-op-1 serialiseerbaar voor netwerktransport
 * (zie src/net/transport.ts). Render en UI abonneren zich hierop via EventBus.
 */
export type GameEvent =
  /** Partij begint; volledige setup bekend. */
  | { type: 'gameStart'; gameId: string; players: PlayerConfig[]; seatCount: number }
  /** Nieuwe ronde/ronde begint. `roundKind` is game-specifiek (bijv. KingenRoundKind). */
  | { type: 'roundStart'; roundIndex: number; roundKind: string; roundLabel: string; dealer: Seat }
  /** Kaarten gedeeld. `hands` bevat per stoel ALLEEN voor de ontvanger zichtbare handen; bij verzending over een transport wordt dit per speler gefilterd. */
  | { type: 'deal'; roundIndex: number; dealer: Seat; hands: Partial<Record<Seat, Card[]>>; handSizes: Record<number, number> }
  /** Troefkleur bepaald (alleen in troefrondes). `chooser` is wie koos/de deler. */
  | { type: 'trumpChosen'; roundIndex: number; trump: Suit; chooser: Seat }
  /** In varianten met vrije spelkeuze (dubbelkingen): de deler koos het speltype. */
  | { type: 'roundKindChosen'; roundIndex: number; roundKind: string; chooser: Seat }
  /** Een stoel is aan de beurt. */
  | { type: 'turnStart'; seat: Seat; trickIndex: number }
  /** Een kaart is gespeeld. */
  | { type: 'playCard'; seat: Seat; card: Card; trickIndex: number }
  /** Slag voltooid en gewonnen. */
  | { type: 'trickWon'; trickIndex: number; winner: Seat; trick: Trick }
  /** Speler legt hand af en claimt resterende punten (variant 'claimen'). */
  | { type: 'handClaimed'; seat: Seat; acceptedPenalty: number }
  /** Ronde voorbij; delta-scores van deze ronde. */
  | { type: 'roundEnd'; roundIndex: number; roundKind: string; scores: Record<number, number> }
  /** Cumulatieve stand bijgewerkt. */
  | { type: 'scoreUpdate'; totals: Record<number, number> }
  /** Partij voorbij; winnaars (meerdere bij gelijkspel). */
  | { type: 'gameEnd'; winners: Seat[]; totals: Record<number, number> }
  /** Ongeldige zet geweigerd (alleen lokaal/UI-feedback, gaat niet de lijn over). */
  | { type: 'illegalMove'; seat: Seat; reason: string }
  /** Vrij uitbreidpunt voor game-specifieke events. */
  | { type: 'custom'; subtype: string; data: unknown };

export type GameEventType = GameEvent['type'];

// ---------------------------------------------------------------------------
// Publieke game-state-view
// ---------------------------------------------------------------------------

/**
 * Wat één speler (mens of AI) mag zien. AI-strategieën krijgen UITSLUITEND
 * dit object — nooit de volledige state — zodat ze niet kunnen valsspelen
 * en dezelfde view later 1-op-1 over een netwerk kan worden gestuurd.
 */
export interface PublicGameView {
  /** Stoel van de kijker. */
  seat: Seat;
  /** Aantal stoelen in dit spel. */
  seatCount: number;
  /** Eigen hand, gesorteerd. */
  hand: Card[];
  /** Aantal kaarten per stoel (eigen hand incluis). Index = Seat. */
  handSizes: number[];
  /**
   * Slag-specifieke velden (currentTrick/completedTricks/playedCards/trickCounts)
   * zijn OPTIONEEL: alleen slagenspellen vullen ze. Afleg-/match-/party-spellen
   * laten ze weg en zetten hun eigen toestand in `viewExtras`.
   */
  /** De lopende slag op tafel (alleen slagenspellen). */
  currentTrick?: Trick;
  /** Alle voltooide slagen van de huidige ronde (alleen slagenspellen). */
  completedTricks?: Trick[];
  /** Alle in deze ronde reeds gespeelde kaarten (afgeleid, voor AI-gemak). */
  playedCards?: Card[];
  /** Aantal gewonnen slagen per stoel in deze ronde. Index = Seat. */
  trickCounts?: number[];
  /** Huidige ronde/gift. */
  round: {
    index: number;
    /** Game-specifiek soort, bijv. KingenRoundKind. '' als niet van toepassing. */
    kind: string;
    /** Standaardlabel (NL) uit de engine; de UI toont zelf een i18n-naam op basis van `kind`. */
    label: string;
    dealer: Seat;
    /** Troefkleur; null in troefloze rondes/spellen of zolang nog niet gekozen. */
    trump: Suit | null;
  };
  /** Totaal aantal rondes in de partij. */
  totalRounds: number;
  /** Wie is aan de beurt (null tussen rondes / tijdens animaties). */
  turn: Seat | null;
  /** Cumulatieve scores per stoel. Index = Seat. */
  totals: number[];
  /** Per-ronde scores tot nu toe: scoresPerRound[rondeIndex][stoel]. */
  scoresPerRound: number[][];
  /** Spelersnamen per stoel. Index = Seat. */
  playerNames: string[];
  /** Legale kaarten voor de kijker als die aan de beurt is, anders [] (slagenspel-gemak). */
  legalCards: Card[];
  /**
   * Generieke legale zetten voor de kijker als die aan de beurt is (zoals
   * getLegalMoves teruggeeft), anders []. Spel-onafhankelijk; vervangt op termijn
   * `legalCards`.
   */
  legalMoves: unknown[];
  /** Spel-specifieke extra toestand (trekstapel, melds, inzet, rollen, ...). */
  viewExtras?: unknown;
}

// ---------------------------------------------------------------------------
// GameDefinition — generiek contract voor kaartspellen
// ---------------------------------------------------------------------------

/** Resultaat van een toegepaste zet. */
export interface MoveResult<TState> {
  state: TState;
  /** Events die uit deze zet voortvloeien, in volgorde. */
  events: GameEvent[];
}

/**
 * Generiek contract waar elk kaartspel aan voldoet. Kingen is de eerste
 * implementatie (src/games/kingen); latere spellen (klaverjassen, hartenjagen,
 * barbu, ...) implementeren ditzelfde interface zodat TurnManager, render, UI
 * en net-laag ongewijzigd blijven.
 *
 * TState  - volledige (geheime) spelstate; alleen de engine/host ziet deze.
 * TMove   - zet-type van het spel (bij Kingen: KingenMove).
 * TConfig - variant-/spelconfiguratie (bij Kingen: KingenVariantConfig).
 */
export interface GameDefinition<TState, TMove, TConfig> {
  /** Uniek id, bijv. 'kingen'. */
  readonly id: string;
  /** Nederlandse naam, bijv. 'Kingen'. */
  readonly naam: string;
  readonly minPlayers: number;
  readonly maxPlayers: number;

  /** Maak de beginstate. `seed` maakt het delen deterministisch (replay/netwerk). */
  createInitialState(players: PlayerConfig[], config: TConfig, seed?: number): TState;

  /** Events die het opzetten + eerste deal beschrijven (gameStart, roundStart, deal, ...). */
  initialEvents(state: TState): GameEvent[];

  /** Publieke view voor één stoel (informatie-verbergend). */
  getView(state: TState, seat: Seat): PublicGameView;

  /** Alle legale zetten voor een stoel op dit moment. */
  getLegalMoves(state: TState, seat: Seat): TMove[];

  /** Pas een zet toe. Gooit Error bij illegale zet; muteert de input-state niet. */
  applyMove(state: TState, seat: Seat, move: TMove): MoveResult<TState>;

  /** Welke stoel moet nu iets doen (kaart, troefkeuze, spelkeuze)? null = klaar/wachten. */
  currentActor(state: TState): Seat | null;

  isFinished(state: TState): boolean;

  /** Winnaars (meerdere bij gelijke topscore). Alleen geldig als isFinished. */
  getWinners(state: TState): Seat[];
}
