/**
 * src/games/regenwormen/types.ts
 * Typen voor Regenwormen (Heckmeck am Bratwurmeck / Pickomino): push-your-luck
 * met 8 stenen (vlakken 1-5 + worm = 5) en een gedeelde, steelbare voorraad
 * tegels 21–36. Per worp leg je álle stenen van één nog niet gekozen waarde
 * apart; stoppen vereist ≥1 worm en som ≥21. Pak de centrumtegel ≤ je som of
 * steel een tegenstander-toptegel met exact je som. Mislukken kost je toptegel
 * + de hoogste centrumtegel. Meeste wormen wint. Zie research §5A.
 */

import type { GameDefinition, PlayerConfig, Seat } from '../../core/types.ts';

export interface RegenwormenVariantConfig {
  playerCount: number;
}

export const REGENWORMEN_DEFAULT: RegenwormenVariantConfig = {
  playerCount: 4,
};

export type RegenwormenPhase = 'rolling' | 'deciding' | 'choosing' | 'finished';

/**
 * Zetten:
 *  - roll    : gooi de nog beschikbare stenen ('rolling', of 'choosing' om door te gaan).
 *  - reserve : leg álle stenen met ogenwaarde `value` apart ('deciding').
 *  - take    : stop en pak tegel `tile` uit het midden ('center') of steel hem van
 *              stoel `from` ('choosing').
 */
export type RegenwormenMove =
  | { type: 'roll' }
  | { type: 'reserve'; value: number }
  | { type: 'take'; tile: number; from: 'center' | number };

export interface RegenwormenState {
  config: RegenwormenVariantConfig;
  players: PlayerConfig[];
  seatCount: number;
  seed: number;
  phase: RegenwormenPhase;
  rollSeq: number;
  active: Seat;
  /** Deze beurt apart gelegde stenen (ogenwaarden; 6 = worm). */
  reserved: number[];
  /** De zojuist gegooide, nog niet vastgelegde stenen (in 'deciding'). */
  loose: number[];
  /** Ogenwaarden die deze beurt al zijn vastgelegd (mag elk maar één keer). */
  usedValues: number[];
  /** Tegels die nog in het midden liggen (oplopend gesorteerd). */
  center: number[];
  /** Veroverde tegels per stoel (top = laatste element). */
  stacks: number[][];
  turn: Seat | null;
  /** Wormen-totaal per stoel (HUD-score). */
  totals: number[];
}

export type RegenwormenDefinition = GameDefinition<RegenwormenState, RegenwormenMove, RegenwormenVariantConfig>;
