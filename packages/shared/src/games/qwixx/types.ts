/**
 * src/games/qwixx/types.ts
 * Typen voor Qwixx-achtig dobbelspel: 2 witte + 4 gekleurde stenen, een
 * scoreblad met vier kleurrijen (rood/geel 2→12, groen/blauw 12→2), simultaan
 * markeren in de witte-worp-fase en een gekleurde actie voor de actieve speler.
 * Mechaniek nagebouwd; presentatie/score-bord is eigen (procedureel).
 * Zie docs/DICEGAME_RULES_RESEARCH.md §5.
 */

import type { GameDefinition, PlayerConfig, Seat } from '../../core/types.ts';

export type QwixxColor = 'red' | 'yellow' | 'green' | 'blue';

export const QWIXX_COLORS: readonly QwixxColor[] = ['red', 'yellow', 'green', 'blue'];

/** Rood/geel lopen oplopend (2→12); groen/blauw aflopend (12→2). */
export function isAscending(color: QwixxColor): boolean {
  return color === 'red' || color === 'yellow';
}

/** Het uiterst rechtse (slot)getal van een rij: 12 bij oplopend, 2 bij aflopend. */
export function lockNumber(color: QwixxColor): number {
  return isAscending(color) ? 12 : 2;
}

/** De getallenvolgorde (links→rechts) van een kleurrij. */
export function rowNumbers(color: QwixxColor): number[] {
  return isAscending(color)
    ? [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    : [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
}

export interface QwixxVariantConfig {
  playerCount: number;
  /** Aantal strafvakken dat de partij beëindigt (default 4). */
  maxPenalties: number;
  /** Aantal vergrendelde kleuren dat de partij beëindigt (default 2). */
  locksToEnd: number;
}

export const QWIXX_DEFAULT: QwixxVariantConfig = {
  playerCount: 4,
  maxPenalties: 4,
  locksToEnd: 2,
};

/** Eén kleurrij op het scoreblad van een speler. */
export interface QwixxRow {
  /** Aangekruiste getallen, in volgorde van markeren (links→rechts). */
  marks: number[];
  /** Of deze rij vergrendeld is (slot gekruist). */
  locked: boolean;
}

export interface QwixxSheet {
  rows: Record<QwixxColor, QwixxRow>;
  penalties: number;
}

export type QwixxPhase = 'rolling' | 'white' | 'color' | 'finished';

/** De ene witte som + de vier gekleurde steenwaarden van de huidige worp. */
export interface QwixxDice {
  white: [number, number];
  colored: Record<QwixxColor, number>;
}

/**
 * Zetten:
 *  - roll        : de actieve speler gooit alle zes ('rolling').
 *  - markWhite   : kruis de witte som in een kleurrij ('white', iedereen).
 *  - markColor   : kruis (wit+gekleurd) in de bijbehorende kleurrij ('color', actieve speler).
 *  - pass        : niets doen in deze (deel)fase.
 */
export type QwixxMove =
  | { type: 'roll' }
  | { type: 'markWhite'; color: QwixxColor; value: number }
  | { type: 'markColor'; color: QwixxColor; value: number }
  | { type: 'pass' };

export interface QwixxState {
  config: QwixxVariantConfig;
  players: PlayerConfig[];
  seatCount: number;
  seed: number;
  phase: QwixxPhase;
  rollSeq: number;
  /** Wie aan de beurt is (gooit en doet de gekleurde actie). */
  active: Seat;
  dice: QwixxDice | null;
  /** Stoelen die in de witte-worp-fase nog moeten beslissen. */
  pendingWhite: Seat[];
  /** Of de actieve speler deze beurt al iets kruiste (anders: strafvak). */
  activeMarked: boolean;
  /** Globaal vergrendelde kleuren (steen verdwijnt voor iedereen). */
  lockedColors: QwixxColor[];
  sheets: QwixxSheet[];
  turn: Seat | null;
  totals: number[];
  scoresPerRound: number[][];
}

export type QwixxDefinition = GameDefinition<QwixxState, QwixxMove, QwixxVariantConfig>;
