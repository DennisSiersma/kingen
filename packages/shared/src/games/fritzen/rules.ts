/**
 * src/games/fritzen/rules.ts
 * Legale zetten per fase. In 'deciding' enumereren we de distincte deel-multisets
 * van de losse stenen (≥1 vastleggen), elk met stoppen of opnieuw gooien.
 */

import type { Seat } from '../../core/types.ts';
import type { FritzenMove, FritzenState } from './types.ts';

/** Distincte niet-lege deel-multisets van `loose` (gesorteerd, op waarde). */
export function keepSubsets(loose: readonly number[]): number[][] {
  const counts = new Map<number, number>();
  for (const v of loose) counts.set(v, (counts.get(v) ?? 0) + 1);
  const waarden = [...counts.keys()].sort((a, b) => a - b);
  let subsets: number[][] = [[]];
  for (const v of waarden) {
    const max = counts.get(v)!;
    const next: number[][] = [];
    for (const s of subsets) {
      for (let k = 0; k <= max; k++) next.push([...s, ...Array<number>(k).fill(v)]);
    }
    subsets = next;
  }
  return subsets.filter((s) => s.length > 0);
}

/** Legale zetten voor `seat` in de huidige fase. */
export function fritzenLegalMoves(state: FritzenState, seat: Seat): FritzenMove[] {
  if (state.phase === 'finished' || seat !== state.active) return [];

  if (state.phase === 'rolling') return [{ type: 'roll' }];

  if (state.phase === 'deciding') {
    const moves: FritzenMove[] = [];
    const kanHerwerpen = state.rollsUsed < state.config.maxRolls;
    for (const keep of keepSubsets(state.loose)) {
      // Stoppen mag altijd: leg deze stenen vast en eindig de beurt.
      moves.push({ type: 'keep', values: keep, stop: true });
      // Opnieuw gooien mag als er daarna nog losse stenen zijn én er worpen resten.
      if (kanHerwerpen && keep.length < state.loose.length) {
        moves.push({ type: 'keep', values: keep, stop: false });
      }
    }
    return moves;
  }

  return [];
}
