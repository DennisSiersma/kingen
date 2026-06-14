/**
 * src/games/regenwormen/rules.ts
 * Legale zetten per fase. 'deciding' biedt elke nog niet gebruikte ogenwaarde uit
 * de worp; 'choosing' biedt doorgooien (als er stenen resten) en/of een tegel
 * pakken (als er ≥1 worm ligt en de som ≥21 een pakbare tegel oplevert). Bust
 * wordt door de engine afgehandeld, dus deze lijst is in 'deciding'/'choosing'
 * altijd niet-leeg.
 */

import type { Seat } from '../../core/types.ts';
import { hasWorm, sumPips, takeOptions } from './scoring.ts';
import type { RegenwormenMove, RegenwormenState } from './types.ts';

const DICE_COUNT = 8;

/** Ogenwaarden in `loose` die deze beurt nog niet zijn vastgelegd. */
export function reservableValues(loose: readonly number[], usedValues: readonly number[]): number[] {
  const present = [...new Set(loose)].sort((a, b) => a - b);
  return present.filter((v) => !usedValues.includes(v));
}

export function regenwormenLegalMoves(state: RegenwormenState, seat: Seat): RegenwormenMove[] {
  if (state.phase === 'finished' || seat !== state.active) return [];

  if (state.phase === 'rolling') return [{ type: 'roll' }];

  if (state.phase === 'deciding') {
    return reservableValues(state.loose, state.usedValues).map((value) => ({ type: 'reserve', value }));
  }

  if (state.phase === 'choosing') {
    const moves: RegenwormenMove[] = [];
    const remaining = DICE_COUNT - state.reserved.length;
    if (remaining > 0) moves.push({ type: 'roll' });
    const sum = sumPips(state.reserved);
    if (hasWorm(state.reserved) && sum >= 21) {
      for (const o of takeOptions(sum, state.center, state.stacks, seat)) {
        moves.push({ type: 'take', tile: o.tile, from: o.from });
      }
    }
    return moves;
  }

  return [];
}
