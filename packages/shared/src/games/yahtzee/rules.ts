/**
 * src/games/yahtzee/rules.ts
 * Legale zetten per fase. In 'deciding' kun je (a) een ongebruikte categorie
 * scoren en (b) — als er nog worpen resten — een deelverzameling (0..4 stenen)
 * vasthouden en de rest opnieuw gooien. Bij een extra-Yahtzee gelden de
 * joker-plaatsingsregels (verplicht bovenvak → anders elk ondervak → anders 0).
 */

import type { Seat } from '../../core/types.ts';
import { LOWER_CATEGORIES, UPPER_CATEGORIES, YAHTZEE_CATEGORIES } from './types.ts';
import type { YahtzeeCard, YahtzeeCategory, YahtzeeMove, YahtzeeState } from './types.ts';
import { isYahtzee } from './scoring.ts';

/**
 * Distincte deel-multisets van `dice` met lengte 0..(n-1) — d.w.z. minstens
 * één steen wordt opnieuw gegooid. De volledige multiset valt af (dat zou geen
 * herworp zijn). Voor weergave: oplopend gesorteerd.
 */
export function keepSubsets(dice: readonly number[]): number[][] {
  const counts = new Map<number, number>();
  for (const v of dice) counts.set(v, (counts.get(v) ?? 0) + 1);
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
  return subsets.filter((s) => s.length < dice.length);
}

/**
 * Welke categorieën mag `card` scoren met deze `dice`? Normaal: elk open vak.
 * Bij een extra-Yahtzee (vijfling terwijl het Yahtzee-vak al vol is) gelden de
 * jokerregels: 1) verplicht het bijbehorende bovenvak; 2) anders elk open
 * ondervak; 3) anders (alleen bovenvakken open) een 0 in een open bovenvak.
 */
export function scorableCategories(card: YahtzeeCard, dice: readonly number[]): YahtzeeCategory[] {
  const open = YAHTZEE_CATEGORIES.filter((c) => card.scores[c] === null);
  if (open.length === 0) return [];

  const yahtzeeRoll = isYahtzee(dice) && dice.length === 5;
  const yahtzeeUsed = card.scores.yahtzee !== null;
  if (yahtzeeRoll && yahtzeeUsed) {
    const value = dice[0]!; // alle vijf gelijk
    const upperCat = UPPER_CATEGORIES[value - 1]!;
    if (card.scores[upperCat] === null) return [upperCat]; // 1) verplicht bovenvak
    const lowerOpen = open.filter((c) => LOWER_CATEGORIES.includes(c));
    if (lowerOpen.length > 0) return lowerOpen; // 2) elk open ondervak (vol tarief)
    return open; // 3) geforceerde 0 in een open bovenvak
  }
  return open;
}

/** Legale zetten voor `seat` in de huidige fase. */
export function yahtzeeLegalMoves(state: YahtzeeState, seat: Seat): YahtzeeMove[] {
  if (state.phase === 'finished' || seat !== state.active) return [];

  if (state.phase === 'rolling') return [{ type: 'roll' }];

  if (state.phase === 'deciding') {
    const moves: YahtzeeMove[] = [];
    // Scoren mag altijd (ook vóór de laatste worp).
    for (const category of scorableCategories(state.cards[seat]!, state.dice)) {
      moves.push({ type: 'score', category });
    }
    // Opnieuw gooien mag zolang er worpen resten.
    if (state.rollsUsed < state.config.maxRolls) {
      for (const keep of keepSubsets(state.dice)) moves.push({ type: 'reroll', keep });
    }
    return moves;
  }

  return [];
}
