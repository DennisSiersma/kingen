/**
 * src/games/rikken/types.ts
 * Typen voor Rikken (Engels: Rik) — het Nederlandse biedslagenspel voor 4 spelers,
 * 52 kaarten, 13 p.p. Canoniek = Stichting Rikken 2025 (NK-toernooistandaard).
 *
 * Elke ronde wordt geboden (rik+maat, beter rik, 8–13 alleen, piek, misère, en —
 * achter config-vlaggen — open spellen / passspellen / troela). De bieder met het
 * hoogste bod krijgt het contract; bij rik vraagt hij een geheime maat mee via een
 * niet-troef-aas. Telling is per-tegenspeler en nulsom over de 4 spelers.
 */

import type { Card, GameDefinition, PlayerConfig, Seat, Suit } from '../../core/types.ts';
import type { Bid, BidKind } from './bids.ts';

export type Puntenschaal = 'stichting' | 'huiskamer';

/** Variant-/spelconfiguratie voor Rikken. */
export interface RikkenVariantConfig {
  /** Puntenschaal: Stichting 2025 (canoniek) of huiskamer. */
  puntenschaal: Puntenschaal;
  /** Troela (3 azen verplicht melden) — UIT op kampioenschappen (default). */
  troela: boolean;
  /** Open piek/misère (+ praatje) aanzetten. */
  openSpellen: boolean;
  /** Passspellen (Schoppen Mie / 1-of-5) als iedereen past. */
  passSpellen: boolean;
  /** Blind een aas vragen van een renonce-kleur toestaan. */
  blindVragen: boolean;
  /** Meepieken/meemisèren (meerdere claimers van hetzelfde piek/misère-bod). */
  meepieken: boolean;
  /** Vast op 4 voor deze variant. */
  playerCount: number;
  /** Aantal te spelen rondes (gevingen); hoogste totaal wint. */
  rondes: number;
}

/** Stichting Rikken 2025 (canoniek): kern aan, varianten uit. */
export const RIKKEN_STICHTING: RikkenVariantConfig = {
  puntenschaal: 'stichting',
  troela: false,
  openSpellen: false,
  passSpellen: true,
  blindVragen: false,
  meepieken: false,
  playerCount: 4,
  rondes: 16,
};

export const RIKKEN_DEFAULT = RIKKEN_STICHTING;

export type RikkenPhase =
  | 'bidding'
  | 'choosingTrump'
  | 'askingAce'
  | 'choosingPassGame'
  | 'playing'
  | 'finished';

export type PassGame = 'schoppenMie' | 'eenOfVijf';

/** Zetten in Rikken (via het generieke chooseMove-pad). */
export type RikkenMove =
  | { type: 'bid'; bid: Bid | 'pass' }
  | { type: 'chooseTrump'; suit: Suit }
  | { type: 'askAce'; cardId: string }
  | { type: 'choosePassGame'; game: PassGame }
  | { type: 'playCard'; card: Card };

/** Het lopende contract na de biedfase. */
export interface RikkenContract {
  kind: BidKind;
  /** Beter-variant (harten troef) van een alleen-bod. */
  beter: boolean;
  declarer: Seat;
  trump: Suit | null;
  /** Beloofd aantal slagen (8/9/.../13, of 1 voor piek, 0 voor misère). */
  target: number;
  /** Gevraagde aas/heer-id (rik); kleur is publiek, houder verborgen. */
  askedAceId?: string;
  askedSuit?: Suit;
  /** Maat-stoel; pas ingevuld (publiek) nadat de gevraagde aas valt. */
  partner: Seat | null;
  /** Extra claimers bij meepieken/meemisèren (ieder voor zich). */
  claimers?: Seat[];
  passGame?: PassGame;
}

/** Substaat van de biedfase. */
export interface BiddingState {
  current: Seat;
  /** Per stoel: heeft gepast (definitief uit). */
  passed: boolean[];
  /** Hoogste staande bod en wie het deed. */
  highest: Bid | null;
  highestBidder: Seat | null;
  /** Is er al ten minste één keer gerikt? (vereist voor 'alleen'-boden.) */
  rikGeboden: boolean;
  /** Claimers die meegingen op het hoogste piek/misère-bod. */
  claimers: Seat[];
}

type Trick = { index: number; leader: Seat; plays: { seat: Seat; card: Card }[]; winner?: Seat };

/** Volledige (geheime) spelstate. Alleen de engine/host ziet deze. */
export interface RikkenState {
  config: RikkenVariantConfig;
  players: PlayerConfig[];
  seatCount: number;
  seed: number;
  phase: RikkenPhase;
  roundIndex: number;
  dealer: Seat;
  hands: Card[][];
  bidding: BiddingState | null;
  contract: RikkenContract | null;
  /** Is de maat al onthuld (gevraagde aas gevallen)? */
  partnerRevealed: boolean;
  currentTrick: Trick;
  completedTricks: Trick[];
  /** Aantal gewonnen slagen per stoel deze ronde. Index = Seat. */
  trickCounts: number[];
  turn: Seat | null;
  /** Cumulatieve score per stoel (nulsom). Index = Seat. */
  totals: number[];
  /** Per-ronde scores: scoresPerRound[ronde][stoel]. */
  scoresPerRound: number[][];
}

export type RikkenDefinition = GameDefinition<RikkenState, RikkenMove, RikkenVariantConfig>;
