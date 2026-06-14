/**
 * src/games/mexen/rules.ts
 * Legale zetten per fase voor Mexen. Gedeeld door getLegalMoves en getView.legalMoves
 * (zelfde patroon als de andere spellen).
 */

import type { Seat } from '../../core/types.ts';
import { announceableCodes } from './ranking.ts';
import type { MexenMove, MexenState } from './types.ts';

/** Kan de huidige aankondiging nog overboden worden? (Bepaalt of 'believe'/'passUnseen' zin hebben.) */
export function canEscalate(state: MexenState): boolean {
  return announceableCodes(state.currentAnnouncement, state.config.announceMode).length > 0;
}

/** Volgende levende stoel vanaf `from` in de gegeven richting. */
export function nextAliveSeat(state: MexenState, from: Seat): Seat {
  const n = state.seatCount;
  let s = from;
  for (let i = 0; i < n; i++) {
    s = ((s + state.direction + n) % n) as Seat;
    if (state.alive[s]) return s;
  }
  return from; // alleen als er niemand anders meer leeft
}

/** Aantal nog levende spelers. */
export function aliveCount(state: MexenState): number {
  return state.alive.reduce((n, a) => n + (a ? 1 : 0), 0);
}

/**
 * Legale zetten voor `seat`. Alleen de bekerhouder is ooit aan zet; andere
 * stoelen krijgen [].
 */
export function mexenLegalMoves(state: MexenState, seat: Seat): MexenMove[] {
  if (state.phase === 'finished' || seat !== state.cupHolder || !state.alive[seat]) return [];

  if (state.phase === 'rolling') {
    return [{ type: 'roll' }];
  }

  if (state.phase === 'announcing') {
    const codes = announceableCodes(state.currentAnnouncement, state.config.announceMode);
    const moves: MexenMove[] = codes.map((value) => ({ type: 'announce', value }));
    // Nog eens gooien mag tot je het maximum aantal worpen deze beurt hebt gehad.
    if (state.rollsThisTurn < state.config.maxRolls) moves.push({ type: 'roll' });
    return moves;
  }

  if (state.phase === 'responding') {
    const moves: MexenMove[] = [{ type: 'doubt' }];
    if (canEscalate(state)) {
      moves.push({ type: 'believe' });
      if (state.config.allowPassUnseen) {
        for (const value of announceableCodes(state.currentAnnouncement, state.config.announceMode)) {
          moves.push({ type: 'passUnseen', value });
        }
      }
    }
    return moves;
  }

  return [];
}
