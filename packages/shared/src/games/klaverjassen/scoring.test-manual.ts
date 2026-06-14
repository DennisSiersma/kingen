/**
 * src/games/klaverjassen/scoring.test-manual.ts
 * Unit-test voor roem-detectie en rondetelling. Draai met: npx tsx <ditbestand>
 */

import { cardFromId } from '../../core/deck.ts';
import { computeRondeUitslag, detectRoem } from './scoring.ts';
import type { RoemKind, Team } from './types.ts';

let geslaagd = 0;
function check(naam: string, cond: boolean): void {
  if (!cond) throw new Error(`FAIL: ${naam}`);
  geslaagd++;
}
const hand = (...ids: string[]) => ids.map(cardFromId);
const kinds = (rs: { kind: RoemKind }[]) => rs.map((r) => r.kind).sort();
const punten = (rs: { points: number }[]) => rs.reduce((s, r) => s + r.points, 0);

// --- Reeksen ---------------------------------------------------------------
// H-V-B harten (posities 1,2,3) = reeks20.
check('reeks van 3 = 20', (() => {
  const r = detectRoem(hand('hearts-13', 'hearts-12', 'hearts-11', 'clubs-7'), 'clubs');
  return punten(r) === 20 && kinds(r).join() === 'reeks20';
})());

// A-H-V-B harten (posities 0,1,2,3) = reeks50.
check('reeks van 4 = 50', (() => {
  const r = detectRoem(hand('hearts-14', 'hearts-13', 'hearts-12', 'hearts-11'), 'clubs');
  return punten(r) === 50;
})());

// A-10 niet aaneengesloten (B ontbreekt) → geen reeks.
check('A-10 geen reeks', detectRoem(hand('hearts-14', 'hearts-10', 'clubs-7'), 'clubs').length === 0);

// Twee losse reeksen in één kleur: A-H-V (3) + 10-9-8 (3) = 40.
check('twee reeksen zelfde kleur = 40', (() => {
  const r = detectRoem(hand('hearts-14', 'hearts-13', 'hearts-12', 'hearts-10', 'hearts-9', 'hearts-8'), 'clubs');
  return punten(r) === 40;
})());

// --- Stuk ------------------------------------------------------------------
// H+V troef = stuk20.
check('stuk (H+V troef) = 20', (() => {
  const r = detectRoem(hand('clubs-13', 'clubs-12', 'hearts-7'), 'clubs');
  return punten(r) === 20 && kinds(r).join() === 'stuk20';
})());

// H+V NIET-troef → geen stuk.
check('H+V niet-troef → geen stuk', detectRoem(hand('hearts-13', 'hearts-12', 'spades-7'), 'clubs').length === 0);

// Stuk binnen reeks: H-V-B troef = reeks20 + stuk20 = 40.
check('stuk binnen reeks van 3 = 40', punten(detectRoem(hand('clubs-13', 'clubs-12', 'clubs-11'), 'clubs')) === 40);

// Stuk binnen reeks van 4: A-H-V-B troef = 50 + 20 = 70.
check('stuk binnen reeks van 4 = 70', punten(detectRoem(hand('clubs-14', 'clubs-13', 'clubs-12', 'clubs-11'), 'clubs')) === 70);

// --- Vier gelijke ----------------------------------------------------------
check('vier boeren = 200', punten(detectRoem(hand('clubs-11', 'diamonds-11', 'hearts-11', 'spades-11'), 'clubs')) === 200);
check('vier azen = 100', punten(detectRoem(hand('clubs-14', 'diamonds-14', 'hearts-14', 'spades-14'), 'clubs')) === 100);
check('vier negens = geen roem', detectRoem(hand('clubs-9', 'diamonds-9', 'hearts-9', 'spades-9'), 'clubs').length === 0);

// --- Rondetelling ----------------------------------------------------------
// Gehaald: making 90 kaart + 20 roem = 110 > def 72. Beide houden eigen.
check('gehaald: beide houden eigen', (() => {
  const u = computeRondeUitslag(0 as Team, [90, 72], [20, 0], [5, 3]);
  return u.gehaald && u.roundScores[0] === 110 && u.roundScores[1] === 72;
})());

// Nat: making 80 < def 82 → tegenpartij krijgt alles (162 + roem).
check('nat: tegenpartij alles', (() => {
  const u = computeRondeUitslag(0 as Team, [80, 82], [0, 0], [4, 4]);
  return !u.gehaald && u.roundScores[0] === 0 && u.roundScores[1] === 162;
})());

// Gelijkstand → nat (spelend niet strikt boven).
check('gelijkstand = nat', (() => {
  const u = computeRondeUitslag(0 as Team, [81, 81], [0, 0], [4, 4]);
  return !u.gehaald && u.roundScores[1] === 162;
})());

// Nat met roem: roem telt mee en gaat bij nat naar de tegenpartij.
check('nat met roem naar tegenpartij', (() => {
  const u = computeRondeUitslag(0 as Team, [100, 62], [0, 40], [5, 3]);
  // making 100 < def 62+40=102 → nat. Tegenpartij: 162 + 40 = 202.
  return !u.gehaald && u.roundScores[1] === 202 && u.roundScores[0] === 0;
})());

// Pit door spelend team: 162 + roem + 100.
check('pit spelend team', (() => {
  const u = computeRondeUitslag(0 as Team, [162, 0], [20, 0], [8, 0]);
  return u.pitTeam === 0 && u.gehaald && u.roundScores[0] === 282 && u.roundScores[1] === 0;
})());

// Tegenpit: verdedigers winnen alles → spelend team nat.
check('tegenpit → spelend nat', (() => {
  const u = computeRondeUitslag(0 as Team, [0, 162], [0, 0], [0, 8]);
  return u.pitTeam === 1 && !u.gehaald && u.roundScores[1] === 262 && u.roundScores[0] === 0;
})());

console.log(`scoring.test-manual: ${geslaagd} checks geslaagd ✓`);
