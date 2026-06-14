/**
 * src/games/klaverjassen/types.ts
 * Typen voor Klaverjassen (Engels: Klaverjas) — de Nederlandse 4-spelersvariant
 * met twee vaste teams (Wij = stoelen 0/2, Zij = 1/3, partners tegenover elkaar),
 * 32 kaarten, troef met afwijkende kaartkracht (Boer>9>Aas>10>Heer>Vrouw>8>7),
 * roem (reeksen/stuk/vier-gelijk/vier-boeren) en nat/pit-telling.
 *
 * Variant-bewust via KlaverjasConfig:
 *  - gewest: 'rotterdams' (default, onvoorwaardelijke (over/onder)troefplicht) of
 *            'amsterdams' (troefplicht vervalt als de maat de slag al heeft).
 *  - trumpSelection: 'verplichtDraaien' (default — troef wordt aangewezen, het
 *            team van de voorhand is verplicht te maken), 'bieden' (Leids) of
 *            'vastKlaverenRonde1' (huisregel).
 *  - dealPattern: '3-2-3' (default) of '4-4'.
 *  - eindvoorwaarde: vast aantal bomen (default 16) of een puntendoel (1500).
 */

import type { Card, GameDefinition, PlayerConfig, Seat, Suit } from '../../core/types.ts';

/** Twee teams: 0 = "Wij" (stoelen 0 en 2), 1 = "Zij" (stoelen 1 en 3). */
export type Team = 0 | 1;

/** Team van een stoel: partners zitten tegenover elkaar, dus stoel % 2. */
export const teamOf = (seat: Seat): Team => (seat % 2) as Team;

export type Gewest = 'rotterdams' | 'amsterdams';
export type TrumpSelection = 'verplichtDraaien' | 'bieden' | 'vastKlaverenRonde1';
export type DealPattern = '3-2-3' | '4-4';

/** Einde van de partij: een vast aantal bomen, of een cumulatief puntendoel. */
export type Eindvoorwaarde =
  | { type: 'aantalBomen'; n: number }
  | { type: 'punten'; n: number };

/** Variant-/spelconfiguratie voor Klaverjassen. */
export interface KlaverjasVariantConfig {
  /** Troefplicht-regelset. */
  gewest: Gewest;
  /** Hoe de troefkleur (en het verplichte team) wordt bepaald. */
  trumpSelection: TrumpSelection;
  /** Deelpatroon (3-2-3 standaard). */
  dealPattern: DealPattern;
  /** Wanneer de partij eindigt. */
  eindvoorwaarde: Eindvoorwaarde;
  /** Vast op 4 voor deze variant. */
  playerCount: number;
}

/** Default = Rotterdams, verplicht draaien, 3-2-3, 16 bomen. */
export const KLAVERJAS_ROTTERDAMS: KlaverjasVariantConfig = {
  gewest: 'rotterdams',
  trumpSelection: 'verplichtDraaien',
  dealPattern: '3-2-3',
  eindvoorwaarde: { type: 'aantalBomen', n: 16 },
  playerCount: 4,
};

/** Amsterdams: troefplicht vervalt als de maat de slag al heeft. */
export const KLAVERJAS_AMSTERDAMS: KlaverjasVariantConfig = {
  ...KLAVERJAS_ROTTERDAMS,
  gewest: 'amsterdams',
};

/** Default-variant voor de NL-app. */
export const KLAVERJAS_DEFAULT = KLAVERJAS_ROTTERDAMS;

export type KlaverjasPhase = 'bidding' | 'playing' | 'finished';

/** Een gedetecteerde roem-melding (los van de kaartpunten). */
export type RoemKind = 'reeks20' | 'reeks50' | 'stuk20' | 'vierGelijk100' | 'vierBoeren200';

export interface RoemEvent {
  team: Team;
  seat: Seat;
  kind: RoemKind;
  points: number;
  /** De betrokken kaarten (voor UI/animatie). */
  cards: Card[];
}

/** Bied-keuze (alleen in de 'bieden'/Leids-modus). */
export type BidChoice = 'pass' | { trump: Suit };

/** Zetten in Klaverjassen. */
export type KlaverjasMove =
  | { type: 'playCard'; card: Card }
  | { type: 'bid'; choice: BidChoice };

/** Substaat van de biedfase (alleen relevant bij trumpSelection 'bieden'). */
export interface BiddingState {
  /** Stoel die nu mag kiezen/passen. */
  current: Seat;
  /** Stoelen die reeds gepast hebben, in volgorde. */
  passes: Seat[];
  /** Of dit de "verplichte" tweede ronde is (na 1 ronde passen mag voorhand niet meer passen). */
  forced: boolean;
}

/** Volledige (geheime) spelstate. Alleen de engine/host ziet deze. */
export interface KlaverjasState {
  config: KlaverjasVariantConfig;
  players: PlayerConfig[];
  seatCount: number;
  seed: number;
  phase: KlaverjasPhase;
  /** Boom-teller (0-based). */
  roundIndex: number;
  dealer: Seat;
  /** Speler links van de deler — komt de eerste slag uit. */
  voorhand: Seat;
  trump: Suit | null;
  /** Het spelende/verplichte team (moet de ronde maken), of null vóór bepaling. */
  makingTeam: Team | null;
  hands: Card[][];
  bidding: BiddingState | null;
  currentTrick: { index: number; leader: Seat; plays: { seat: Seat; card: Card }[]; winner?: Seat };
  completedTricks: { index: number; leader: Seat; plays: { seat: Seat; card: Card }[]; winner?: Seat }[];
  /** Aantal gewonnen slagen per team deze ronde. Index = Team. */
  teamTricks: [number, number];
  /** Lopende kaartpunten deze ronde per team (incl. eventuele laatste-slag-bonus na afloop). */
  teamCardPoints: [number, number];
  /** Roem deze ronde per team. */
  teamRoem: [number, number];
  /** Alle roem-meldingen deze ronde (voor view/animatie). */
  roemEvents: RoemEvent[];
  turn: Seat | null;
  /** Cumulatieve teamscore over de hele partij. Index = Team. */
  teamTotals: [number, number];
  /** Per-boom teamscore: scoresPerRound[boom] = [puntenWij, puntenZij]. */
  scoresPerRound: number[][];
}

export type KlaverjasDefinition = GameDefinition<
  KlaverjasState,
  KlaverjasMove,
  KlaverjasVariantConfig
>;
