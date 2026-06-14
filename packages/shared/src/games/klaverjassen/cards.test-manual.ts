/**
 * src/games/klaverjassen/cards.test-manual.ts
 * Headless unit-test voor de kaartwaarden/-kracht. Lockt de afwijkende
 * Klaverjas-volgordes vast. Draai met: npx tsx <ditbestand>
 */

import type { Seat } from '../../core/types.ts';
import { cardFromId, trickWinner } from '../../core/deck.ts';
import { cardPoints, klaverjasDeck, klaverjasRankValue, naturalPos } from './cards.ts';

let geslaagd = 0;
function check(naam: string, cond: boolean): void {
  if (!cond) throw new Error(`FAIL: ${naam}`);
  geslaagd++;
}

const c = (id: string) => cardFromId(id);
const play = (seat: number, id: string) => ({ seat: seat as Seat, card: c(id) });

// --- Kaartpunten: som van het hele dek = 152 (excl. laatste-slag-bonus) ------
{
  const trump = 'clubs';
  let som = 0;
  for (const card of klaverjasDeck()) som += cardPoints(card, trump);
  check('som kaartpunten = 152', som === 152);

  // Troefklaveren: B=20, 9=14, A=11, 10=10, H=4, V=3, 8=0, 7=0 → 62.
  let troefSom = 0;
  for (const card of klaverjasDeck()) if (card.suit === 'clubs') troefSom += cardPoints(card, trump);
  check('troefkleur som = 62', troefSom === 62);

  check('troefboer = 20', cardPoints(c('clubs-11'), 'clubs') === 20);
  check('troefnegen = 14', cardPoints(c('clubs-9'), 'clubs') === 14);
  check('niet-troef boer = 2', cardPoints(c('hearts-11'), 'clubs') === 2);
  check('niet-troef aas = 11', cardPoints(c('hearts-14'), 'clubs') === 11);
  check('niet-troef tien = 10', cardPoints(c('hearts-10'), 'clubs') === 10);
}

// --- Slagkracht troef: B > 9 > A > 10 > H > V > 8 > 7 ------------------------
{
  // Troefboer slaat troefnegen en troefaas.
  check('B♣ wint van 9♣ (troef)', trickWinner([play(0, 'clubs-9'), play(1, 'clubs-11')], 'clubs', klaverjasRankValue) === 1);
  check('9♣ wint van A♣ (troef)', trickWinner([play(0, 'clubs-14'), play(1, 'clubs-9')], 'clubs', klaverjasRankValue) === 1);
  check('A♣ wint van 10♣ (troef)', trickWinner([play(0, 'clubs-10'), play(1, 'clubs-14')], 'clubs', klaverjasRankValue) === 1);
  check('10♣ wint van H♣ (troef)', trickWinner([play(0, 'clubs-13'), play(1, 'clubs-10')], 'clubs', klaverjasRankValue) === 1);
}

// --- Slagkracht niet-troef: A > 10 > H > V > B > 9 > 8 > 7 -------------------
{
  check('A♥ wint van 10♥', trickWinner([play(0, 'hearts-10'), play(1, 'hearts-14')], 'clubs', klaverjasRankValue) === 1);
  check('10♥ wint van H♥', trickWinner([play(0, 'hearts-13'), play(1, 'hearts-10')], 'clubs', klaverjasRankValue) === 1);
  check('H♥ wint van B♥', trickWinner([play(0, 'hearts-11'), play(1, 'hearts-13')], 'clubs', klaverjasRankValue) === 1);
  check('B♥ wint van 9♥', trickWinner([play(0, 'hearts-9'), play(1, 'hearts-11')], 'clubs', klaverjasRankValue) === 1);
}

// --- Troef slaat de gevraagde kleur -----------------------------------------
{
  // ♥A geleid, daarna laagste troef 7♣ → troef wint.
  check('7♣ (troef) wint van A♥ (gevraagd)', trickWinner([play(0, 'hearts-14'), play(1, 'clubs-7')], 'clubs', klaverjasRankValue) === 1);
  // Niet-troef die niet bekent en niet troeft, wint niet.
  check('A♦ wint niet van geleid A♥', trickWinner([play(0, 'hearts-14'), play(1, 'diamonds-14')], 'clubs', klaverjasRankValue) === 0);
}

// --- Natuurlijke volgorde voor reeksen: A-H-V-B-10-9-8-7 --------------------
{
  check('A vóór H', naturalPos(14) < naturalPos(13));
  check('B vóór 10', naturalPos(11) < naturalPos(10));
  check('10 vóór 9', naturalPos(10) < naturalPos(9));
  // H-V-B aaneengesloten (posities 1,2,3).
  check('H-V-B aaneengesloten', naturalPos(13) + 1 === naturalPos(12) && naturalPos(12) + 1 === naturalPos(11));
  // A-10 NIET aaneengesloten (0 en 4).
  check('A-10 niet aaneengesloten', naturalPos(14) + 1 !== naturalPos(10));
}

console.log(`cards.test-manual: ${geslaagd} checks geslaagd ✓`);
