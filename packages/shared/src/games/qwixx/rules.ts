/**
 * src/games/qwixx/rules.ts
 * Markeer-legaliteit (links→rechts, slotvereiste) en de legale zetten per fase.
 * Gedeeld door getLegalMoves en getView.legalMoves.
 */

import type { Seat } from '../../core/types.ts';
import type { QwixxColor, QwixxMove, QwixxState } from './types.ts';
import { QWIXX_COLORS, isAscending, lockNumber } from './types.ts';

/** Minimaal aantal kruisjes vereist vóór het slotgetal gekruist mag worden. */
const LOCK_MIN_MARKS = 5;

/**
 * Mag `value` nu in de rij van `color` op het scoreblad van `seat`? Strikt
 * links→rechts (oplopend resp. aflopend), overslaan mag; het slotgetal vereist
 * al ≥5 kruisjes; een globaal vergrendelde of eigen-vergrendelde rij kan niet.
 */
export function canMark(state: QwixxState, seat: Seat, color: QwixxColor, value: number): boolean {
  if (value < 2 || value > 12) return false;
  if (state.lockedColors.includes(color)) return false;
  const row = state.sheets[seat]?.rows[color];
  if (!row || row.locked) return false;

  const last = row.marks.length > 0 ? row.marks[row.marks.length - 1]! : null;
  if (last !== null) {
    if (isAscending(color) ? value <= last : value >= last) return false;
  }
  if (value === lockNumber(color) && row.marks.length < LOCK_MIN_MARKS) return false;
  return true;
}

/** Witte som van de huidige worp. */
export function whiteSum(state: QwixxState): number {
  const d = state.dice;
  return d ? d.white[0] + d.white[1] : 0;
}

/** Legale witte-actie-zetten voor `seat`: de witte som in elke geldige kleurrij, of pass. */
export function legalWhiteMoves(state: QwixxState, seat: Seat): QwixxMove[] {
  const sum = whiteSum(state);
  const moves: QwixxMove[] = [];
  for (const color of QWIXX_COLORS) {
    if (canMark(state, seat, color, sum)) moves.push({ type: 'markWhite', color, value: sum });
  }
  moves.push({ type: 'pass' });
  return moves;
}

/** Legale gekleurde-actie-zetten voor de actieve speler: (wit+gekleurd) per kleur, of pass. */
export function legalColorMoves(state: QwixxState, seat: Seat): QwixxMove[] {
  const d = state.dice;
  const moves: QwixxMove[] = [];
  if (d) {
    const gezien = new Set<string>();
    for (const color of QWIXX_COLORS) {
      const cv = d.colored[color];
      for (const wd of d.white) {
        const value = wd + cv;
        const key = `${color}:${value}`;
        if (!gezien.has(key) && canMark(state, seat, color, value)) {
          gezien.add(key);
          moves.push({ type: 'markColor', color, value });
        }
      }
    }
  }
  moves.push({ type: 'pass' });
  return moves;
}

/** Legale zetten voor `seat` in de huidige fase. */
export function qwixxLegalMoves(state: QwixxState, seat: Seat): QwixxMove[] {
  switch (state.phase) {
    case 'rolling':
      return seat === state.active ? [{ type: 'roll' }] : [];
    case 'white':
      return state.pendingWhite[0] === seat ? legalWhiteMoves(state, seat) : [];
    case 'color':
      return seat === state.active ? legalColorMoves(state, seat) : [];
    default:
      return [];
  }
}
