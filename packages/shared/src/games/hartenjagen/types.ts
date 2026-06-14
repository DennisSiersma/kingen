/**
 * src/games/hartenjagen/types.ts
 * Typen voor Hartenjagen (Engels: Hearts). Slagvermijdingsspel: harten geven
 * strafpunten (1 elk), ♠V geeft er 13. Wie alle 26 pakt "schiet de maan"
 * (0 voor zichzelf, 26 voor de rest). Laagste totaal wint; de partij eindigt
 * zodra iemand `endScore` bereikt.
 */

import type { Card, GameDefinition, PlayerConfig, Seat } from '../../core/types.ts';

/** Variant-/spelconfiguratie voor Hartenjagen. */
export interface HartenjagenVariantConfig {
  /** Aantal spelers (standaardvariant: 4). */
  playerCount: number;
  /** Strafpunten voor ♠V (schoppenvrouw). Standaard 13. */
  queenPenalty: number;
  /** Strafpunten per hart. Standaard 1. */
  heartPenalty: number;
  /** "Schiet de maan" ingeschakeld (alle 26 pakken → 0 voor jou, 26 voor de rest). */
  shootMoon: boolean;
  /** Doorgeven van 3 kaarten vóór het spelen (rotatie links/rechts/over/niet). */
  passing: boolean;
  /** De partij eindigt zodra een speler dit totaal bereikt of overschrijdt. */
  endScore: number;
}

/** Standaard Hartenjagen: 4 spelers, ♠V=13, hart=1, maan + doorgeven aan, tot 100. */
export const HARTENJAGEN_DEFAULT: HartenjagenVariantConfig = {
  playerCount: 4,
  queenPenalty: 13,
  heartPenalty: 1,
  shootMoon: true,
  passing: true,
  endScore: 100,
};

/** Doorgeefrichting per ronde (roteert); 'none' = ronde zonder doorgeven. */
export type PassDirection = 'left' | 'right' | 'across' | 'none';

export type HartenjagenPhase = 'passing' | 'playing' | 'finished';

/** Zetten in Hartenjagen: 3 kaarten doorgeven, of een kaart spelen. */
export type HartenjagenMove =
  | { type: 'passCards'; cards: Card[] }
  | { type: 'playCard'; card: Card };

/** Volledige (geheime) spelstate. Alleen de engine/host ziet deze. */
export interface HartenjagenState {
  config: HartenjagenVariantConfig;
  players: PlayerConfig[];
  seatCount: number;
  seed: number;
  phase: HartenjagenPhase;
  roundIndex: number;
  /** Doorgeefrichting deze ronde. */
  passDir: PassDirection;
  hands: Card[][];
  /** Per stoel de (geheim) doorgegeven kaarten tijdens de doorgeeffase, of null. */
  passed: (Card[] | null)[];
  currentTrick: { index: number; leader: Seat; plays: { seat: Seat; card: Card }[]; winner?: Seat };
  completedTricks: { index: number; leader: Seat; plays: { seat: Seat; card: Card }[]; winner?: Seat }[];
  trickCounts: number[];
  /** Gepakte strafpunten deze ronde, per stoel. */
  pointsTaken: number[];
  heartsBroken: boolean;
  /** Is dit de eerste slag van de ronde (♣2 komt uit; geen strafkaarten afgooien)? */
  firstTrick: boolean;
  turn: Seat | null;
  totals: number[];
  scoresPerRound: number[][];
}

export type HartenjagenDefinition = GameDefinition<
  HartenjagenState,
  HartenjagenMove,
  HartenjagenVariantConfig
>;
