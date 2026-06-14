/**
 * src/games/rikken/rules.ts
 * Pure speelregels: welke kaarten mag een stoel spelen?
 *  - Uitkomen: vrije keuze (Rikken kent geen troefplicht).
 *  - Volgen: KLEUR BEKENNEN VERPLICHT; heb je de gevraagde kleur niet, dan vrij
 *    (troeven of afgooien — niet verplicht).
 *  - MAAT-ONTHULLING: wordt de kleur van de gevraagde aas uitgekomen, dan MOET de
 *    aashouder verplicht díe aas spelen (niet vrij bijspelen) → maat onthuld.
 */

import type { Card, Seat } from '../../core/types.ts';
import type { RikkenState } from './types.ts';

/** Legale te spelen kaarten voor `seat` (alleen tijdens 'playing' en aan de beurt). */
export function legalPlays(state: RikkenState, seat: Seat): Card[] {
  if (state.phase !== 'playing' || state.turn !== seat) return [];
  const hand = state.hands[seat] ?? [];
  if (hand.length === 0) return [];
  const plays = state.currentTrick.plays;

  // Uitkomen: vrije keuze.
  if (plays.length === 0) return hand.slice();

  const led = plays[0]!.card.suit;
  const follow = hand.filter((c) => c.suit === led);

  if (follow.length > 0) {
    // Maat moet de gevraagde aas spelen zodra die kleur geleid is (vóór onthulling).
    const c = state.contract;
    if (c && !state.partnerRevealed && c.askedAceId && c.askedSuit === led) {
      const aas = follow.find((x) => x.id === c.askedAceId);
      if (aas) return [aas];
    }
    return follow; // bekennen verplicht
  }

  // Geen gevraagde kleur → vrij (troeven niet verplicht).
  return hand.slice();
}
