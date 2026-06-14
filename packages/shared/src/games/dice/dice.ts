/**
 * src/games/dice/dice.ts
 * Gedeeld dobbelsteen-model voor alle dobbelspellen (Mexen, later Yahtzee/Tienduizend).
 * Volledig puur/deterministisch: worpen komen uit de seedbare mulberry32-RNG van
 * core/deck.ts, zodat partijen replaybaar en netwerk-synchroon zijn.
 */

import { createRng } from '../../core/deck.ts';

/** Eén dobbelsteen-uitkomst (standaard d6). */
export type DieValue = 1 | 2 | 3 | 4 | 5 | 6;

/** Een worp met twee stenen (Mexen). Volgorde [a, b] is de ruwe worp; de
 * ranking-laag normaliseert naar "hoogste steen eerst". */
export type Roll = readonly [DieValue, DieValue];

/** Eén steen uit een [0,1)-trekking. */
export function dieFrom(x: number): DieValue {
  return (Math.floor(x * 6) + 1) as DieValue;
}

/** Gooi één steen met een gegeven RNG. */
export function rollDie(rng: () => number): DieValue {
  return dieFrom(rng());
}

/** Gooi `n` stenen met een gegeven RNG. */
export function rollDice(rng: () => number, n: number): DieValue[] {
  const out: DieValue[] = [];
  for (let i = 0; i < n; i++) out.push(rollDie(rng));
  return out;
}

/**
 * Deterministische twee-stenen-worp uit een seed. De engine leidt per worp een
 * unieke seed af (bijv. `seed + rollSeq * 7919`) zodat elke worp onafhankelijk
 * en toch reproduceerbaar is.
 */
export function rollTwo(seed: number): Roll {
  const rng = createRng(seed >>> 0);
  return [rollDie(rng), rollDie(rng)] as const;
}
