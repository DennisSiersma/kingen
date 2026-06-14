/**
 * src/games/rikken/scoring.test-manual.ts
 * Unit-test voor de Stichting-puntentelling + nulsom-verdeling. Draai met: npx tsx
 */

import type { Seat } from '../../core/types.ts';
import { perOpponent, scoreRonde } from './scoring.ts';
import { RIKKEN_STICHTING } from './types.ts';
import type { RikkenContract } from './types.ts';
import type { BidKind } from './bids.ts';

let geslaagd = 0;
function check(naam: string, cond: boolean): void {
  if (!cond) throw new Error(`FAIL: ${naam}`);
  geslaagd++;
}

const cfg = { ...RIKKEN_STICHTING };
function contract(kind: BidKind, declarer: number, partner: number | null, beter = false): RikkenContract {
  return { kind, beter, declarer: declarer as Seat, trump: null, target: 8, partner: partner as Seat | null };
}
/** trickCounts uit een map {seat: tricks}. */
function tc(map: Record<number, number>): number[] {
  const out = [0, 0, 0, 0];
  for (const [k, v] of Object.entries(map)) out[Number(k)] = v;
  return out;
}
const nulsom = (d: number[]) => d.reduce((a, b) => a + b, 0) === 0;

// --- perOpponent-waarden (geverifieerd) ---
check('rik 8 = 10', perOpponent('rik', false, 8) === 10);
check('rik 13 = 70', perOpponent('rik', false, 13) === 70);
check('rik verlies 7 = -10', perOpponent('rik', false, 7) === -10);
check('rik verlies 0 = -45', perOpponent('rik', false, 0) === -45);
check('beterRik 8 = 30', perOpponent('beterRik', false, 8) === 30);
check('beterRik 13 = 105', perOpponent('beterRik', false, 13) === 105);
check('alleen9 9 = 60', perOpponent('alleen9', false, 9) === 60);
check('alleen9 13 = 120', perOpponent('alleen9', false, 13) === 120);
check('alleen9 verlies = -25', perOpponent('alleen9', false, 8) === -25);
check('alleen10 = 90', perOpponent('alleen10', false, 10) === 90);
check('alleen11 = 120', perOpponent('alleen11', false, 11) === 120);
check('alleen12 = 150', perOpponent('alleen12', false, 12) === 150);
check('alleen12 verlies = -55', perOpponent('alleen12', false, 11) === -55);
check('alleen13 = 210', perOpponent('alleen13', false, 13) === 210);
check('alleen13 verlies 12 = -70', perOpponent('alleen13', false, 12) === -70);
check('alleen13 verlies 0 = -130', perOpponent('alleen13', false, 0) === -130);
check('piek = 15 p.o.', perOpponent('piek', false, 1) === 15);
check('misère = 25 p.o.', perOpponent('misere', false, 0) === 25);

// --- Verdeling (nulsom) ---
// Rik geslaagd (8): declarer 0 + maat 2 elk +20; opps 1,3 elk -20.
{
  const u = scoreRonde(contract('rik', 0, 2), tc({ 0: 5, 2: 3, 1: 3, 3: 2 }), cfg);
  check('rik 8 gehaald', u.gehaald && nulsom(u.deltas));
  check('rik 8 deltas', u.deltas[0] === 20 && u.deltas[2] === 20 && u.deltas[1] === -20 && u.deltas[3] === -20);
}
// Rik verloren (7): alleen rikker (0) betaalt, maat (2) = 0.
{
  const u = scoreRonde(contract('rik', 0, 2), tc({ 0: 4, 2: 3, 1: 4, 3: 2 }), cfg);
  check('rik 7 nat', !u.gehaald && nulsom(u.deltas));
  check('rik 7 deltas (maat 0)', u.deltas[0] === -20 && u.deltas[2] === 0 && u.deltas[1] === 10 && u.deltas[3] === 10);
}
// Solo 9-alleen geslaagd: declarer +180, opps -60 elk.
{
  const u = scoreRonde({ ...contract('alleen9', 1, null), target: 9 }, tc({ 1: 9, 0: 2, 2: 1, 3: 1 }), cfg);
  check('9-alleen gehaald', u.gehaald && nulsom(u.deltas));
  check('9-alleen deltas', u.deltas[1] === 180 && u.deltas[0] === -60 && u.deltas[2] === -60 && u.deltas[3] === -60);
}
// 9-alleen nat (8): declarer -75, opps +25.
{
  const u = scoreRonde({ ...contract('alleen9', 1, null), target: 9 }, tc({ 1: 8, 0: 2, 2: 2, 3: 1 }), cfg);
  check('9-alleen nat', !u.gehaald && nulsom(u.deltas) && u.deltas[1] === -75);
}
// Piek geslaagd (1): declarer +45, opps -15.
{
  const u = scoreRonde({ ...contract('piek', 3, null), target: 1 }, tc({ 3: 1, 0: 5, 1: 4, 2: 3 }), cfg);
  check('piek gehaald', u.gehaald && nulsom(u.deltas) && u.deltas[3] === 45 && u.deltas[0] === -15);
}
// Piek nat (2): declarer -45, opps +15.
{
  const u = scoreRonde({ ...contract('piek', 3, null), target: 1 }, tc({ 3: 2, 0: 5, 1: 3, 2: 3 }), cfg);
  check('piek nat', !u.gehaald && nulsom(u.deltas) && u.deltas[3] === -45);
}
// Misère geslaagd (0): declarer +75, opps -25.
{
  const u = scoreRonde({ ...contract('misere', 0, null), target: 0 }, tc({ 0: 0, 1: 5, 2: 4, 3: 4 }), cfg);
  check('misère gehaald', u.gehaald && nulsom(u.deltas) && u.deltas[0] === 75);
}

console.log(`scoring.test-manual: ${geslaagd} checks geslaagd ✓`);
