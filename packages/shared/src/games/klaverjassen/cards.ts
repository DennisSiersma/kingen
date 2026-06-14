/**
 * src/games/klaverjassen/cards.ts
 * Kaartwaarden en -kracht voor Klaverjassen. Twee dingen wijken af van een
 * gewoon spel en zitten daarom hier centraal:
 *
 *  1. KAARTPUNTEN (voor de telling, som = 152 + 10 laatste slag = 162):
 *     niet-troef: A 11, 10 10, H 4, V 3, B 2, 9/8/7 0
 *     troef:      B 20, 9 14, A 11, 10 10, H 4, V 3, 8/7 0
 *
 *  2. SLAGKRACHT (wie wint de slag) — wijkt af van de numerieke rang:
 *     niet-troef hoog→laag: A 10 H V B 9 8 7
 *     troef      hoog→laag: B 9 A 10 H V 8 7
 *
 *  3. NATUURLIJKE VOLGORDE voor roem-reeksen (NIET de troefvolgorde):
 *     A H V B 10 9 8 7  (de 10 staat tussen B en 9).
 */

import type { Card, Rank, Suit } from '../../core/types.ts';
import { createDeck } from '../../core/deck.ts';
import type { RankValue } from '../../core/deck.ts';

const NON_TRUMP_POINTS: Record<Rank, number> = {
  14: 11, 10: 10, 13: 4, 12: 3, 11: 2, 9: 0, 8: 0, 7: 0,
  // De lage rangen komen niet voor in het 32-kaartsdek, maar de Record moet
  // compleet zijn:
  6: 0, 5: 0, 4: 0, 3: 0, 2: 0,
};

const TRUMP_POINTS: Record<Rank, number> = {
  11: 20, 9: 14, 14: 11, 10: 10, 13: 4, 12: 3, 8: 0, 7: 0,
  6: 0, 5: 0, 4: 0, 3: 0, 2: 0,
};

/** Kaartpunten van één kaart, gegeven de troefkleur. */
export function cardPoints(card: Card, trump: Suit | null): number {
  return card.suit === trump ? TRUMP_POINTS[card.rank] : NON_TRUMP_POINTS[card.rank];
}

// Slagkracht: hoger getal = sterker. Alleen de relatieve volgorde binnen een
// kleur telt (trickWinner vergelijkt nooit kaarten van verschillende kleuren
// zonder troef-/leidregel), dus we mogen troef en niet-troef los schalen.
const NON_TRUMP_STRENGTH: Record<Rank, number> = {
  14: 8, 10: 7, 13: 6, 12: 5, 11: 4, 9: 3, 8: 2, 7: 1,
  6: 0, 5: 0, 4: 0, 3: 0, 2: 0,
};

const TRUMP_STRENGTH: Record<Rank, number> = {
  11: 8, 9: 7, 14: 6, 10: 5, 13: 4, 12: 3, 8: 2, 7: 1,
  6: 0, 5: 0, 4: 0, 3: 0, 2: 0,
};

/**
 * RankValue-comparator voor trickWinner: troefkaarten gebruiken de troefvolgorde
 * (B>9>A>10>H>V>8>7), niet-troefkaarten de gewone volgorde (A>10>H>V>B>9>8>7).
 */
export const klaverjasRankValue: RankValue = (card, trump) =>
  card.suit === trump ? TRUMP_STRENGTH[card.rank] : NON_TRUMP_STRENGTH[card.rank];

// Natuurlijke volgorde voor roem-reeksen: A H V B 10 9 8 7. We geven elke rang
// een opeenvolgende positie; aaneengesloten = posities die exact 1 verschillen.
const NATURAL_POS: Record<Rank, number> = {
  14: 0, 13: 1, 12: 2, 11: 3, 10: 4, 9: 5, 8: 6, 7: 7,
  6: 8, 5: 9, 4: 10, 3: 11, 2: 12,
};

/** Positie van een rang in de natuurlijke reeksvolgorde (lager = hoger in reeks). */
export const naturalPos = (rank: Rank): number => NATURAL_POS[rank];

/**
 * Het 32-kaartsdek voor Klaverjassen: alle rangen 2..6 verwijderd (16 ids),
 * blijft 7,8,9,10,B,V,H,A in vier kleuren = 32 kaarten.
 */
export function klaverjasDeck(): Card[] {
  const weg: string[] = [];
  for (const s of ['clubs', 'diamonds', 'hearts', 'spades']) {
    for (const r of [2, 3, 4, 5, 6]) weg.push(`${s}-${r}`);
  }
  return createDeck(weg);
}
