/**
 * src/core/deck.ts
 * Kaartspel-hulpfuncties: deck bouwen, (seeded) schudden, delen, sorteren.
 * Volledig puur/deterministisch zodat replays en netwerk-sync mogelijk zijn.
 */

import type { Card, CardId, Rank, Seat, Suit } from './types.ts';
import { RANKS, SUITS } from './types.ts';

/** Maak een Card-object (gememoiseerd is toegestaan; objecten zijn immutabel). */
export function makeCard(suit: Suit, rank: Rank): Card {
  return { id: cardId(suit, rank), suit, rank };
}

/** Stabiele id: `${suit}-${rank}`. */
export function cardId(suit: Suit, rank: Rank): CardId {
  return `${suit}-${rank}`;
}

/** Parse een CardId terug naar een Card. Gooit Error bij ongeldig id. */
export function cardFromId(id: CardId): Card {
  const sep = id.lastIndexOf('-');
  const suit = id.slice(0, sep) as Suit;
  const rank = Number(id.slice(sep + 1)) as Rank;
  if (!SUITS.includes(suit) || !RANKS.includes(rank)) {
    throw new Error(`Ongeldige CardId: ${id}`);
  }
  return makeCard(suit, rank);
}

/**
 * Volledig spel van 52 kaarten, optioneel met verwijderde kaarten
 * (bijv. ♠2 bij 3 spelers; ♠2+♣2 of de zwarte zevens bij 5 spelers).
 */
export function createDeck(removed: readonly CardId[] = []): Card[] {
  const out: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      const id = cardId(suit, rank);
      if (!removed.includes(id)) out.push(makeCard(suit, rank));
    }
  }
  return out;
}

/**
 * Deterministische PRNG (mulberry32). Zelfde seed => zelfde reeks.
 * Retourneert een functie die floats in [0,1) levert.
 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates-shuffle, NIET in place: retourneert een nieuwe array. */
export function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Deel een (geschud) deck rond over `seatCount` stoelen, beginnend links van
 * de deler, met de klok mee. Retourneert handen per stoelindex (0..seatCount-1).
 * Het deck moet exact deelbaar zijn door seatCount.
 */
export function deal(deck: readonly Card[], seatCount: number, dealer: Seat): Card[][] {
  if (deck.length % seatCount !== 0) {
    throw new Error(`Deck (${deck.length}) niet deelbaar door ${seatCount} stoelen`);
  }
  const hands: Card[][] = Array.from({ length: seatCount }, () => []);
  for (let i = 0; i < deck.length; i++) {
    const seat = ((dealer + 1 + i) % seatCount) as Seat;
    hands[seat]!.push(deck[i]!);
  }
  return hands;
}

/**
 * Sorteer een hand voor weergave: per kleur (♣ ♦ ♠ ♥ — afwisselend zwart/rood),
 * binnen een kleur oplopend op rang. Retourneert een nieuwe array.
 */
export function sortHand(hand: readonly Card[]): Card[] {
  const order: Suit[] = ['clubs', 'diamonds', 'spades', 'hearts'];
  return hand
    .slice()
    .sort((a, b) =>
      a.suit === b.suit ? a.rank - b.rank : order.indexOf(a.suit) - order.indexOf(b.suit),
    );
}

/**
 * Bepaal de winnaar van een complete slag.
 * Hoogste troef wint; anders hoogste kaart in de gevraagde kleur (aas hoog).
 */
export function trickWinner(
  plays: readonly { seat: Seat; card: Card }[],
  trump: Suit | null,
): Seat {
  if (plays.length === 0) throw new Error('Lege slag');
  const ledSuit = plays[0]!.card.suit;
  let best = plays[0]!;
  for (const p of plays.slice(1)) {
    const beatsAsTrump =
      trump !== null && p.card.suit === trump && (best.card.suit !== trump || p.card.rank > best.card.rank);
    const beatsInLed =
      p.card.suit === ledSuit && best.card.suit === ledSuit &&
      (trump === null || best.card.suit !== trump) && p.card.rank > best.card.rank;
    if (beatsAsTrump || beatsInLed) best = p;
  }
  return best.seat;
}
