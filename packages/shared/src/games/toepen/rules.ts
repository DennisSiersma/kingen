/**
 * src/games/toepen/rules.ts
 * Speelregels van Toepen: welke kaarten mogen worden gespeeld (bekennen
 * verplicht, geen troef) en de detectie van de speciale handen (vier gelijke,
 * vuile was). Puur — geen state-mutatie.
 */

import type { Card, Seat } from '../../core/types.ts';
import type { ToepenState } from './types.ts';

/**
 * Legale kaarten voor `seat` in de lopende slag. Bekennen is verplicht: kun je de
 * gevraagde kleur volgen, dan MOET je die kleur leggen; anders mag je vrij
 * afgooien. Geen troef, dus afgooien kan de slag nooit winnen.
 */
export function legalPlays(state: ToepenState, seat: Seat): Card[] {
  const hand = state.hands[seat] ?? [];
  const plays = state.currentTrick.plays;
  if (plays.length === 0) return hand.slice(); // uitkomer: alles mag
  const ledSuit = plays[0]!.card.suit;
  const kleur = hand.filter((c) => c.suit === ledSuit);
  return kleur.length > 0 ? kleur : hand.slice();
}

/** Heeft deze hand vier kaarten van dezelfde waarde (vier gelijke)? */
export function heeftVierGelijke(hand: readonly Card[]): boolean {
  if (hand.length < 4) return false;
  const eerste = hand[0]!.rank;
  return hand.length === 4 && hand.every((c) => c.rank === eerste);
}

/**
 * Voldoet deze hand aan de canonieke vuile-was-definitie: VIER plaatjes (B/V/H/A)
 * ÓF DRIE plaatjes + een 7? Een 8/9/10 in de hand → géén vuile was.
 * (Wordt gebruikt om een claim te CONTROLEREN, niet om hem te verbieden: bluffen
 * mag — een speler kan altijd claimen.)
 */
export function isVuileWas(hand: readonly Card[]): boolean {
  if (hand.length !== 4) return false;
  const plaatjes = hand.filter((c) => c.rank >= 11).length; // B/V/H/A
  const zevens = hand.filter((c) => c.rank === 7).length;
  return plaatjes === 4 || (plaatjes === 3 && zevens === 1);
}
