/**
 * src/games/klaverjassen/rules.ts
 * Pure regelfuncties: welke kaarten mag een stoel spelen? Dit is de subtielste
 * en meest bug-gevoelige laag van Klaverjassen — bekennen, troefplicht,
 * overtroefplicht, verplicht ondertroeven en het Rotterdams/Amsterdams-verschil.
 *
 * Prioriteit bij NIET kunnen bekennen van een niet-troefkleur:
 *   1. heb je (hogere) troef → overtroeven verplicht;
 *   2. heb je alleen lagere troef → ondertroeven verplicht (Rotterdams);
 *   3. heb je geen troef → vrij afgooien.
 * AMSTERDAMS: vervalt 1+2 als je MAAT op dat moment de slag al wint.
 */

import type { Card, Seat, Suit } from '../../core/types.ts';
import { trickWinner } from '../../core/deck.ts';
import { klaverjasRankValue } from './cards.ts';
import type { KlaverjasState } from './types.ts';

type Play = { seat: Seat; card: Card };

/** Partner zit tegenover je: (seat+2) mod 4. */
export function partnerSeat(seat: Seat, seatCount: number): Seat {
  return ((seat + Math.floor(seatCount / 2)) % seatCount) as Seat;
}

/** Sterkste troefkracht die op dit moment in de slag ligt (−1 als geen troef). */
function hoogsteTroefKracht(plays: readonly Play[], trump: Suit | null): number {
  let hoogste = -1;
  for (const p of plays) {
    if (p.card.suit === trump) {
      const k = klaverjasRankValue(p.card, trump);
      if (k > hoogste) hoogste = k;
    }
  }
  return hoogste;
}

/** Wint mijn maat de (deel)slag op dit moment? */
function maatStaatHoog(plays: readonly Play[], seat: Seat, trump: Suit | null, seatCount: number): boolean {
  if (plays.length === 0) return false;
  const winnaar = trickWinner(plays, trump, klaverjasRankValue);
  return winnaar === partnerSeat(seat, seatCount);
}

/**
 * Legale te spelen kaarten voor `seat` (alleen tijdens 'playing' en aan de beurt).
 * Geeft een NIEUWE array met (referenties naar) de eigen handkaarten.
 */
export function legalPlays(state: KlaverjasState, seat: Seat): Card[] {
  if (state.phase !== 'playing' || state.turn !== seat) return [];
  const hand = state.hands[seat] ?? [];
  if (hand.length === 0) return [];
  const trump = state.trump;
  const plays = state.currentTrick.plays;
  const n = state.seatCount;

  // --- Uitkomen: vrije keuze ---
  if (plays.length === 0) return hand.slice();

  const led = plays[0]!.card.suit;
  const follow = hand.filter((c) => c.suit === led);

  // --- Bekennen (gevraagde kleur in de hand) ---
  if (follow.length > 0) {
    if (led === trump) {
      // Troef gevraagd: bekennen + overtroeven indien mogelijk; anders een
      // (lagere) troef bijspelen (ondertroeven, want geen keus binnen de kleur).
      const hoogste = hoogsteTroefKracht(plays, trump);
      const hoger = follow.filter((c) => klaverjasRankValue(c, trump) > hoogste);
      return hoger.length > 0 ? hoger : follow;
    }
    // Niet-troef gevraagd: gewoon bijspelen, vrije rang.
    return follow;
  }

  // --- Niet kunnen bekennen ---
  const trumps = hand.filter((c) => c.suit === trump);

  // Gevraagde kleur is troef, maar geen troef in de hand → vrij afgooien.
  if (led === trump) return hand.slice();

  // Geen troef → vrij afgooien ("bok geven").
  if (trumps.length === 0) return hand.slice();

  // AMSTERDAMS: staat de maat al hoog, dan vervalt de (over)troefplicht.
  if (state.config.gewest === 'amsterdams' && maatStaatHoog(plays, seat, trump, n)) {
    return hand.slice();
  }

  // Troefplicht (Rotterdams, of Amsterdams met tegenstander hoog).
  const hoogste = hoogsteTroefKracht(plays, trump);
  if (hoogste >= 0) {
    // Er ligt al troef → overtroeven verplicht indien mogelijk.
    const hoger = trumps.filter((c) => klaverjasRankValue(c, trump) > hoogste);
    if (hoger.length > 0) return hoger;
    // Alleen lagere troef → verplicht ondertroeven (mag niet afgooien).
    return trumps.slice();
  }
  // Nog geen troef in de slag → troeven (kopen) verplicht.
  return trumps.slice();
}
