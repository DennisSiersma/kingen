/**
 * src/games/toepen/cards.test-manual.ts
 * Unit-test voor het Toepen-deck en de afwijkende kaartkracht. Draai met: npx tsx
 */

import type { Card, Rank, Suit } from '../../core/types.ts';
import { toepDeck, toepRankValue, toepTrickWinner } from './cards.ts';

let geslaagd = 0;
function check(naam: string, cond: boolean): void {
  if (!cond) throw new Error(`FAIL: ${naam}`);
  geslaagd++;
}

const k = (suit: Suit, rank: Rank): Card => ({ id: `${suit}-${rank}`, suit, rank });

// --- Deck ---
const deck = toepDeck();
check('deck 32 kaarten', deck.length === 32);
check('deck heeft geen 6', !deck.some((c) => c.rank === 6));
check('deck heeft geen 2', !deck.some((c) => c.rank === 2));
check('deck heeft 4 azen', deck.filter((c) => c.rank === 14).length === 4);
check('deck heeft 4 tienen', deck.filter((c) => c.rank === 10).length === 4);
check('deck heeft 4 boeren', deck.filter((c) => c.rank === 11).length === 4);
check('deck uniek', new Set(deck.map((c) => c.id)).size === 32);

// --- Kaartkracht: 10 > 9 > 8 > 7 > A > H > V > B ---
check('10 hoogste', toepRankValue(k('hearts', 10)) === 8);
check('9 < 10', toepRankValue(k('hearts', 9)) < toepRankValue(k('hearts', 10)));
check('8 < 9', toepRankValue(k('hearts', 8)) < toepRankValue(k('hearts', 9)));
check('7 < 8', toepRankValue(k('hearts', 7)) < toepRankValue(k('hearts', 8)));
check('A < 7', toepRankValue(k('hearts', 14)) < toepRankValue(k('hearts', 7)));
check('H(K) < A', toepRankValue(k('hearts', 13)) < toepRankValue(k('hearts', 14)));
check('V(Q) < H', toepRankValue(k('hearts', 12)) < toepRankValue(k('hearts', 13)));
check('B(J) laagste', toepRankValue(k('hearts', 11)) === 1);
check('B < V', toepRankValue(k('hearts', 11)) < toepRankValue(k('hearts', 12)));

// --- Slagwinnaar ---
// Aas geleid, 7 erbij van dezelfde kleur → 7 wint (7 > A in Toepen!).
check(
  '7 verslaat aas in gevraagde kleur',
  toepTrickWinner([
    { seat: 0, card: k('hearts', 14) }, // A♥ (geleid)
    { seat: 1, card: k('hearts', 7) }, // 7♥
    { seat: 2, card: k('diamonds', 10) }, // andere kleur, telt niet
  ]) === 1,
);
// 10 is absoluut de sterkste van de gevraagde kleur.
check(
  '10 wint van 9 in gevraagde kleur',
  toepTrickWinner([
    { seat: 0, card: k('clubs', 9) },
    { seat: 1, card: k('clubs', 10) },
  ]) === 1,
);
// Afgooien van andere kleur (geen troef) wint nooit.
check(
  'andere kleur wint nooit (geen troef)',
  toepTrickWinner([
    { seat: 0, card: k('spades', 11) }, // boer schoppen (geleid, zwakste)
    { seat: 1, card: k('hearts', 10) }, // 10 harten, andere kleur
  ]) === 0,
);
// Boer geleid, alleen plaatjes → aas wint.
check(
  'aas wint van plaatjes in kleur',
  toepTrickWinner([
    { seat: 0, card: k('diamonds', 12) }, // V
    { seat: 1, card: k('diamonds', 14) }, // A
    { seat: 2, card: k('diamonds', 13) }, // H
  ]) === 1,
);

console.log(`OK — ${geslaagd} checks geslaagd (cards)`);
