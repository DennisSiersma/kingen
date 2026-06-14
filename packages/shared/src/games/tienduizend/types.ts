/**
 * src/games/tienduizend/types.ts
 * Typen voor Tienduizend / 10.000 (Farkle-familie): push-your-luck met zes
 * dobbelstenen. Gooi, leg ≥1 scorende steen apart, en kies banken of doorgooien.
 * Scoort een worp niets → "bust": alle losse beurt-punten kwijt. Alle zes apart
 * ("volle bak") → opnieuw met zes en blijven optellen. Eerst binnen via een
 * openingsdrempel (350); eerste naar 10.000 wint (iedereen nog één beurt).
 * Zie docs/DICEGAME_RULES_RESEARCH.md §3.
 */

import type { GameDefinition, PlayerConfig, Seat } from '../../core/types.ts';

export interface TienduizendVariantConfig {
  playerCount: number;
  /** Doelscore om te winnen (default 10.000). */
  targetScore: number;
  /** Minimale beurt-score om "binnen te komen" (default 350). */
  openingThreshold: number;
}

export const TIENDUIZEND_DEFAULT: TienduizendVariantConfig = {
  playerCount: 4,
  targetScore: 10000,
  openingThreshold: 350,
};

export type TienduizendPhase = 'rolling' | 'deciding' | 'finished';

/**
 * Zetten:
 *  - roll     : de eerste worp van de beurt (zes stenen) ('rolling').
 *  - setAside : leg `keep` (≥1 scorende stenen, deel-multiset van de worp) apart;
 *               `bank` beëindigt de beurt en boekt de pot, anders gooi je de rest
 *               opnieuw (of alle zes bij een volle bak) ('deciding').
 */
export type TienduizendMove =
  | { type: 'roll' }
  | { type: 'setAside'; keep: number[]; bank: boolean };

export interface TienduizendState {
  config: TienduizendVariantConfig;
  players: PlayerConfig[];
  seatCount: number;
  seed: number;
  phase: TienduizendPhase;
  rollSeq: number;
  active: Seat;
  /** De zojuist gegooide stenen waaruit gekozen moet worden (in 'deciding'). */
  loose: number[];
  /** Deze beurt al apart gelegde stenen (voor weergave; reset per beurt). */
  setAside: number[];
  /** Verzamelde, nog niet gebankte punten deze beurt. */
  turnPot: number;
  totals: number[];
  /** Of een speler de openingsdrempel al haalde ("binnen" is). */
  entered: boolean[];
  /** Wie de doelscore als eerste haalde (start van de slotronde), of null. */
  finishingSeat: Seat | null;
  turn: Seat | null;
}

export type TienduizendDefinition = GameDefinition<TienduizendState, TienduizendMove, TienduizendVariantConfig>;
