/**
 * src/games/yahtzee/types.ts
 * Typen voor Yahtzee (Hasbro, 13 categorieën): 5 dobbelstenen, max. 3 worpen per
 * beurt (2 herworpen, vrij deelverzamelingen houden), daarna verplicht exact één
 * ongebruikte categorie invullen (mag 0). Bovenbonus +35 bij subtotaal ≥63;
 * extra-Yahtzee = +100 (mits het Yahtzee-vak een 50 bevat) met jokerplaatsing.
 * Iedereen vult alle 13 categorieën; hoogste totaal wint.
 * Zie docs/DICEGAME_RULES_RESEARCH.md §2.1.
 */

import type { GameDefinition, PlayerConfig, Seat } from '../../core/types.ts';

export type YahtzeeCategory =
  | 'ones' | 'twos' | 'threes' | 'fours' | 'fives' | 'sixes'
  | 'threeKind' | 'fourKind' | 'fullHouse' | 'smallStraight' | 'largeStraight' | 'yahtzee' | 'chance';

/** Bovensectie (som van de stenen met dat oog), in oog-volgorde 1..6. */
export const UPPER_CATEGORIES: readonly YahtzeeCategory[] =
  ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];

/** Ondersectie (combinaties). */
export const LOWER_CATEGORIES: readonly YahtzeeCategory[] =
  ['threeKind', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'yahtzee', 'chance'];

/** Alle 13 categorieën in scorekaart-volgorde. */
export const YAHTZEE_CATEGORIES: readonly YahtzeeCategory[] = [...UPPER_CATEGORIES, ...LOWER_CATEGORIES];

export const UPPER_BONUS_THRESHOLD = 63;
export const UPPER_BONUS = 35;
export const YAHTZEE_BONUS = 100;

export interface YahtzeeVariantConfig {
  playerCount: number;
  /** Max. aantal worpen per beurt (default 3: één worp + twee herworpen). */
  maxRolls: number;
}

export const YAHTZEE_DEFAULT: YahtzeeVariantConfig = {
  playerCount: 4,
  maxRolls: 3,
};

/** De scorekaart van één speler: per categorie de score (null = nog open). */
export interface YahtzeeCard {
  scores: Record<YahtzeeCategory, number | null>;
  /** Aantal verdiende extra-Yahtzee-bonussen (×100). */
  yahtzeeBonus: number;
}

/** Verse, lege scorekaart (alle categorieën open). */
export function emptyCard(): YahtzeeCard {
  const scores = {} as Record<YahtzeeCategory, number | null>;
  for (const c of YAHTZEE_CATEGORIES) scores[c] = null;
  return { scores, yahtzeeBonus: 0 };
}

export type YahtzeePhase = 'rolling' | 'deciding' | 'finished';

/**
 * Zetten:
 *  - roll   : de eerste worp van de beurt (alle vijf) ('rolling').
 *  - reroll : houd `keep` (0..4 stenen) vast en gooi de rest opnieuw ('deciding').
 *  - score  : leg de huidige worp vast in `category` en beëindig de beurt ('deciding').
 */
export type YahtzeeMove =
  | { type: 'roll' }
  | { type: 'reroll'; keep: number[] }
  | { type: 'score'; category: YahtzeeCategory };

export interface YahtzeeState {
  config: YahtzeeVariantConfig;
  players: PlayerConfig[];
  seatCount: number;
  seed: number;
  phase: YahtzeePhase;
  rollSeq: number;
  /** Welke beurtronde (0..12); na 13 rondes zijn alle kaarten vol. */
  roundIndex: number;
  /** Aantal beurten dat deze ronde al gespeeld is. */
  turnsThisRound: number;
  active: Seat;
  /** Huidige vijf stenen (leeg vóór de eerste worp). */
  dice: number[];
  /** Aantal worpen deze beurt (0 vóór de eerste). */
  rollsUsed: number;
  cards: YahtzeeCard[];
  turn: Seat | null;
  totals: number[];
  scoresPerRound: number[][];
}

export type YahtzeeDefinition = GameDefinition<YahtzeeState, YahtzeeMove, YahtzeeVariantConfig>;
