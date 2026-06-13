/**
 * src/core/deck.ts
 * Kaartspel-hulpfuncties: deck bouwen, (seeded) schudden, delen, sorteren.
 * Volledig puur/deterministisch zodat replays en netwerk-sync mogelijk zijn.
 */

import type { Card, CardId, Rank, Seat, Suit } from './types.ts';
import { ACE, RANKS, SUITS } from './types.ts';

/**
 * Maak een Card-object. `instance` > 0 markeert een extra deck-kopie (krijgt een
 * uniek id met `#n` en `instanceId`); 0/undefined = eerste/enige deck (kaal id,
 * byte-identiek aan vroeger).
 */
export function makeCard(suit: Suit, rank: Rank, instance?: number): Card {
  const id = cardId(suit, rank, instance);
  return instance && instance > 0 ? { id, suit, rank, instanceId: instance } : { id, suit, rank };
}

/** Stabiele id: `${suit}-${rank}`, of `${suit}-${rank}#${instance}` voor extra decks. */
export function cardId(suit: Suit, rank: Rank, instance?: number): CardId {
  return instance && instance > 0 ? `${suit}-${rank}#${instance}` : `${suit}-${rank}`;
}

/** Suit/rank van een joker zijn placeholders; gebruik isJoker() om hem te herkennen. */
const JOKER_SUIT: Suit = 'spades';

/** Maak een joker met index `n` (id `joker-${n}`). */
export function makeJoker(n: number): Card {
  return { id: `joker-${n}`, suit: JOKER_SUIT, rank: ACE, joker: true, instanceId: n };
}

/** Is deze kaart een joker? (Suit/rank zijn dan placeholders.) */
export function isJoker(card: Card): boolean {
  return card.joker === true;
}

/** Parse een CardId terug naar een Card. Gooit Error bij ongeldig id. */
export function cardFromId(id: CardId): Card {
  if (id.startsWith('joker-')) {
    const n = Number(id.slice('joker-'.length));
    return makeJoker(Number.isFinite(n) ? n : 0);
  }
  const hash = id.indexOf('#');
  const core = hash === -1 ? id : id.slice(0, hash);
  const instance = hash === -1 ? undefined : Number(id.slice(hash + 1));
  const sep = core.lastIndexOf('-');
  const suit = core.slice(0, sep) as Suit;
  const rank = Number(core.slice(sep + 1)) as Rank;
  if (!SUITS.includes(suit) || !RANKS.includes(rank)) {
    throw new Error(`Ongeldige CardId: ${id}`);
  }
  return makeCard(suit, rank, instance);
}

/**
 * Bouw een spel. Standaard 52 kaarten (één deck, geen jokers) — identiek aan
 * vroeger. `opts.copies` herhaalt het hele deck (Jokeren: 2), `opts.jokers`
 * voegt N jokers toe (Pesten/Jokeren). `removed` schrapt kaarten op id
 * (bijv. ♠2 bij 3 spelers) uit elke kopie.
 */
export function createDeck(
  removed: readonly CardId[] = [],
  opts: { copies?: number; jokers?: number } = {},
): Card[] {
  const copies = Math.max(1, opts.copies ?? 1);
  const out: Card[] = [];
  for (let copy = 0; copy < copies; copy++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        if (!removed.includes(cardId(suit, rank, copy)) && !removed.includes(cardId(suit, rank))) {
          out.push(makeCard(suit, rank, copy));
        }
      }
    }
  }
  for (let j = 0; j < (opts.jokers ?? 0); j++) out.push(makeJoker(j));
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
  return hand.slice().sort((a, b) => {
    const ja = isJoker(a);
    const jb = isJoker(b);
    if (ja !== jb) return ja ? 1 : -1; // jokers achteraan
    if (ja && jb) return (a.instanceId ?? 0) - (b.instanceId ?? 0);
    return a.suit === b.suit ? a.rank - b.rank : order.indexOf(a.suit) - order.indexOf(b.suit);
  });
}

/**
 * Kaartkracht binnen een slag: hoe hoger, hoe sterker. De `trump`-parameter laat
 * spellen met afwijkende troefvolgorde (Klaverjas: B/9 hoog in troef) per kaart
 * beslissen. Default = rang (aas hoog), zoals Kingen/Hartenjagen.
 */
export type RankValue = (card: Card, trump: Suit | null) => number;

const defaultRankValue: RankValue = (card) => card.rank;

/**
 * Bepaal de winnaar van een complete slag.
 * Hoogste troef wint; anders de sterkste kaart in de gevraagde kleur. Met een
 * eigen `rankValue` injecteren spellen hun afwijkende kaartkracht (Toepen:
 * 10>9>8>7>A>H>V>B; Klaverjas: troefvolgorde B>9>A>10>H>V>8>7).
 */
export function trickWinner(
  plays: readonly { seat: Seat; card: Card }[],
  trump: Suit | null,
  rankValue: RankValue = defaultRankValue,
): Seat {
  if (plays.length === 0) throw new Error('Lege slag');
  const ledSuit = plays[0]!.card.suit;
  let best = plays[0]!;
  for (const p of plays.slice(1)) {
    const sterker = rankValue(p.card, trump) > rankValue(best.card, trump);
    const beatsAsTrump =
      trump !== null && p.card.suit === trump && (best.card.suit !== trump || sterker);
    const beatsInLed =
      p.card.suit === ledSuit && best.card.suit === ledSuit &&
      (trump === null || best.card.suit !== trump) && sterker;
    if (beatsAsTrump || beatsInLed) best = p;
  }
  return best.seat;
}
