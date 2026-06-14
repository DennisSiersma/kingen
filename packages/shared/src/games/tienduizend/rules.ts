/**
 * src/games/tienduizend/rules.ts
 * Legale zetten per fase. In 'deciding' levert elke geldige apart-leg-keuze een
 * "doorgooien"-zet op (bank:false) en — als banken daarna is toegestaan (al
 * binnen, óf de pot haalt de openingsdrempel) — ook een "bank"-zet (bank:true).
 */

import type { Seat } from '../../core/types.ts';
import { scoringSelections } from './scoring.ts';
import type { TienduizendMove, TienduizendState } from './types.ts';

export function tienduizendLegalMoves(state: TienduizendState, seat: Seat): TienduizendMove[] {
  if (state.phase === 'finished' || seat !== state.active) return [];
  if (state.phase === 'rolling') return [{ type: 'roll' }];

  if (state.phase === 'deciding') {
    const moves: TienduizendMove[] = [];
    const binnen = state.entered[seat] ?? false;
    for (const { keep, score } of scoringSelections(state.loose)) {
      // Doorgooien mag altijd (push-your-luck).
      moves.push({ type: 'setAside', keep, bank: false });
      // Banken mag als de speler al binnen is, of de pot na deze keuze de drempel haalt.
      if (binnen || state.turnPot + score >= state.config.openingThreshold) {
        moves.push({ type: 'setAside', keep, bank: true });
      }
    }
    return moves;
  }

  return [];
}
