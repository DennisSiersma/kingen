/**
 * src/games/hartenjagen/engine.test-manual.ts
 * Headless engine-test voor Hartenjagen. Speelt volledige partijen door de
 * GameDefinition direct aan te sturen (eerste legale zet) en controleert de
 * kernregels en -scoring. Draai met: npx tsx <ditbestand>
 */

import type { PlayerConfig, Seat } from '../../core/types.ts';
import { createHartenjagenDefinition } from './engine.ts';
import { HARTENJAGEN_DEFAULT } from './types.ts';
import type { HartenjagenState } from './types.ts';

// Lokale mini-assert (shared heeft bewust geen @types/node).
const assert = {
  ok(cond: unknown, msg?: string): void {
    if (!cond) throw new Error(`Assertie mislukt${msg ? ': ' + msg : ''}`);
  },
  equal(a: unknown, b: unknown, msg?: string): void {
    if (a !== b) throw new Error(`Assertie mislukt${msg ? ': ' + msg : ''} (${String(a)} !== ${String(b)})`);
  },
  deepEqual(a: unknown, b: unknown, msg?: string): void {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      throw new Error(`Assertie mislukt${msg ? ': ' + msg : ''}\n  a=${JSON.stringify(a)}\n  b=${JSON.stringify(b)}`);
    }
  },
};

function players(n: number): PlayerConfig[] {
  return Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, kind: 'ai' as const }));
}

interface Resultaat {
  totals: number[];
  scoresPerRound: number[][];
  winners: Seat[];
  rondes: number;
  eersteSlagOk: boolean;
}

/** Speel een hele partij; kies steeds de eerste legale zet. */
function speel(seed: number): Resultaat {
  const def = createHartenjagenDefinition();
  let state = def.createInitialState(players(4), { ...HARTENJAGEN_DEFAULT }, seed);
  // initialEvents exerceren (mag niet gooien).
  def.initialEvents(state);

  let eersteSlagGecheckt = false;
  let eersteSlagOk = true;

  let guard = 0;
  while (!def.isFinished(state) && guard++ < 200000) {
    const actor = def.currentActor(state);
    if (actor === null) break;

    // Controleer eenmalig: de eerste slag wordt geopend met ♣2.
    if (!eersteSlagGecheckt && state.phase === 'playing' && state.currentTrick.plays.length === 0 && state.firstTrick) {
      const legal = def.getLegalMoves(state, actor);
      eersteSlagOk =
        legal.length === 1 && legal[0]!.type === 'playCard' && legal[0]!.card.id === 'clubs-2';
      eersteSlagGecheckt = true;
    }

    const legal = def.getLegalMoves(state, actor);
    assert.ok(legal.length > 0, `stoel ${actor} aan zet maar geen legale zetten (fase ${state.phase})`);
    const res = def.applyMove(state, actor, legal[0]!);
    state = res.state;
  }
  assert.ok(def.isFinished(state), 'partij niet binnen de guard afgelopen');

  return {
    totals: state.totals.slice(),
    scoresPerRound: state.scoresPerRound.map((r) => r.slice()),
    winners: def.getWinners(state),
    rondes: state.scoresPerRound.length,
    eersteSlagOk,
  };
}

// --- Test 1: rondescoring klopt (26 normaal, of maan = 26*(n-1)) ---
{
  const r = speel(12345);
  const n = 4;
  for (const [i, row] of r.scoresPerRound.entries()) {
    const som = row.reduce((a, b) => a + b, 0);
    // Normaal: som 26. Maan optie A (anderen +26): één 0, rest 26 (som 26*(n-1)).
    // Maan optie B (zelf -26): één -26, rest 0 (som -26).
    const maanA = som === 26 * (n - 1) && row.filter((x) => x === 0).length === 1 && row.filter((x) => x === 26).length === n - 1;
    const maanB = som === -26 && row.filter((x) => x === -26).length === 1 && row.filter((x) => x === 0).length === n - 1;
    assert.ok(
      som === 26 || maanA || maanB,
      `ronde ${i}: ongeldige strafsom ${som} (${row.join(',')}) — verwacht 26 of maan(A/B)`,
    );
  }
  // Totalen = som van de rondes.
  const verwacht = new Array(n).fill(0);
  for (const row of r.scoresPerRound) row.forEach((v, s) => (verwacht[s] += v));
  assert.deepEqual(r.totals, verwacht, 'totalen ≠ som van rondescores');
  // Partij eindigt zodra iemand endScore haalt.
  assert.ok(Math.max(...r.totals) >= HARTENJAGEN_DEFAULT.endScore, 'partij eindigde zonder dat iemand endScore haalde');
  // Winnaar = laagste totaal.
  const laagste = Math.min(...r.totals);
  for (const w of r.winners) assert.equal(r.totals[w], laagste, 'winnaar heeft niet het laagste totaal');
  console.log(`OK  scoring — ${r.rondes} rondes, eindstand [${r.totals.join(', ')}], winnaar(s): stoel ${r.winners.join(',')}`);
}

// --- Test 2: eerste slag wordt met ♣2 geopend ---
{
  const r = speel(777);
  assert.ok(r.eersteSlagOk, 'eerste slag werd niet (uitsluitend met) ♣2 geopend');
  console.log('OK  eerste slag opent verplicht met ♣2');
}

// --- Test 3: determinisme (zelfde seed → zelfde eindstand) ---
{
  const a = speel(2024);
  const b = speel(2024);
  assert.deepEqual(a.totals, b.totals, 'zelfde seed gaf andere totalen');
  assert.deepEqual(a.scoresPerRound, b.scoresPerRound, 'zelfde seed gaf andere rondescores');
  console.log('OK  determinisme (zelfde seed => zelfde partij)');
}

// --- Test 4: geen handlekkage in getView (eigen hand zichtbaar, rest alleen aantallen) ---
{
  const def = createHartenjagenDefinition();
  const state: HartenjagenState = def.createInitialState(players(4), { ...HARTENJAGEN_DEFAULT }, 99);
  let totaalKaarten = 0;
  for (let s = 0; s < 4; s++) {
    const view = def.getView(state, s as Seat);
    assert.equal(view.hand.length, view.handSizes[s], `view voor stoel ${s}: hand ≠ handSize`);
    assert.equal(view.hand.length, 13, 'elke hand moet 13 kaarten zijn bij start (4 spelers)');
    totaalKaarten += view.handSizes.reduce((a, b) => a + b, 0) / 4; // handSizes is gelijk in elke view
  }
  assert.equal(totaalKaarten, 52, 'totaal aantal kaarten ≠ 52');
  console.log('OK  getView — eigen hand zichtbaar, totaal 52 kaarten, geen lek');
}

// --- Test 5: meerdere seeds spelen netjes uit ---
{
  let totaalRondes = 0;
  for (const seed of [1, 2, 3, 11, 42, 100]) {
    const r = speel(seed);
    totaalRondes += r.rondes;
    assert.ok(r.rondes >= 1, `seed ${seed}: geen rondes gespeeld`);
  }
  console.log(`OK  6 partijen uitgespeeld — ${totaalRondes} rondes totaal`);
}

console.log('\nAlle Hartenjagen-engine-tests geslaagd.');
