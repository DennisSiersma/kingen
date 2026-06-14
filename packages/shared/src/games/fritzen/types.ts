/**
 * src/games/fritzen/types.ts
 * Typen voor Fritzen: 6 dobbelstenen, mik op ≥30 óf ≤10 ogen. Per beurt max. 5
 * worpen; na elke worp leg je ≥1 steen vast (die verandert niet meer), de rest
 * gooi je opnieuw. Stoppen mag zodra je tevreden bent. "Slokken uitdelen/drinken"
 * is vertaald naar punten (zie scoring.ts); hoogste totaal over de rondes wint.
 */

import type { GameDefinition, PlayerConfig, Seat } from '../../core/types.ts';

export interface FritzenVariantConfig {
  playerCount: number;
  /** Aantal rondes (iedereen één beurt per ronde); default 3. */
  rounds: number;
  /** Max. aantal worpen per beurt; default 5. */
  maxRolls: number;
}

export const FRITZEN_DEFAULT: FritzenVariantConfig = {
  playerCount: 4,
  rounds: 3,
  maxRolls: 5,
};

export type FritzenPhase = 'rolling' | 'deciding' | 'finished';

/**
 * Zetten:
 *  - roll : de eerste worp van de beurt (alle zes) ('rolling').
 *  - keep : leg `values` (≥1 losse steen) vast; `stop` beëindigt de beurt,
 *           anders worden de overige stenen opnieuw gegooid ('deciding').
 */
export type FritzenMove =
  | { type: 'roll' }
  | { type: 'keep'; values: number[]; stop: boolean };

export interface FritzenState {
  config: FritzenVariantConfig;
  players: PlayerConfig[];
  seatCount: number;
  seed: number;
  phase: FritzenPhase;
  rollSeq: number;
  roundIndex: number;
  /** Aantal beurten dat deze ronde al gespeeld is. */
  turnsThisRound: number;
  active: Seat;
  /** Vastgelegde stenen (waarden, veranderen niet meer deze beurt). */
  locked: number[];
  /** Losse stenen: hun laatst gegooide waarden (leeg vóór de eerste worp). */
  loose: number[];
  /** Aantal worpen deze beurt (0 vóór de eerste). */
  rollsUsed: number;
  turn: Seat | null;
  totals: number[];
  scoresPerRound: number[][];
}

export type FritzenDefinition = GameDefinition<FritzenState, FritzenMove, FritzenVariantConfig>;
