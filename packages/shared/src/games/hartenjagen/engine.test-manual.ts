/**
 * src/games/hartenjagen/engine.test-manual.ts
 * Headless engine-test voor Hartenjagen, beide profielen:
 *  - A = internationaal Hearts (52 kaarten, ♣2, doorgeven, maan, tot 100).
 *  - B = Nederlands Hartenjagen (32 kaarten, ♣7, geen doorgeven, twee-fasen-einde).
 * Speelt volledige partijen via de GameDefinition (eerste legale zet) en checkt
 * de kernregels en -scoring. Draai met: npx tsx <ditbestand>
 */

import type { PlayerConfig, Seat } from '../../core/types.ts';
import { createHartenjagenDefinition } from './engine.ts';
import { HARTENJAGEN_A, HARTENJAGEN_B } from './types.ts';
import type { HartenjagenState, HartenjagenVariantConfig } from './types.ts';

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
  openingId: string | null;
  descendingGezien: boolean;
}

function speel(config: HartenjagenVariantConfig, seed: number): Resultaat {
  const def = createHartenjagenDefinition();
  let state = def.createInitialState(players(4), { ...config }, seed);
  def.initialEvents(state);

  let openingId: string | null = null;
  let descendingGezien = false;
  let guard = 0;
  while (!def.isFinished(state) && guard++ < 400000) {
    const actor = def.currentActor(state);
    if (actor === null) break;
    if (state.phase === 'playing' && state.currentTrick.plays.length === 0 && state.firstTrick && openingId === null) {
      const legal = def.getLegalMoves(state, actor);
      openingId = legal[0]!.type === 'playCard' ? legal[0]!.card.id : null;
    }
    if (state.descending) descendingGezien = true;
    const legal = def.getLegalMoves(state, actor);
    assert.ok(legal.length > 0, `stoel ${actor} aan zet maar geen legale zetten (fase ${state.phase})`);
    state = def.applyMove(state, actor, legal[0]!).state;
  }
  assert.ok(def.isFinished(state), 'partij niet binnen de guard afgelopen');

  return {
    totals: state.totals.slice(),
    scoresPerRound: state.scoresPerRound.map((r) => r.slice()),
    winners: def.getWinners(state),
    rondes: state.scoresPerRound.length,
    openingId,
    descendingGezien,
  };
}

// === PROFIEL A (internationaal Hearts) ===
{
  const r = speel(HARTENJAGEN_A, 12345);
  assert.equal(r.openingId, 'clubs-2', 'profiel A: eerste slag moet met ♣2 openen');
  for (const [i, row] of r.scoresPerRound.entries()) {
    const som = row.reduce((a, b) => a + b, 0);
    const maanA = som === 78 && row.filter((x) => x === 0).length === 1 && row.filter((x) => x === 26).length === 3;
    const maanB = som === -26 && row.filter((x) => x === -26).length === 1 && row.filter((x) => x === 0).length === 3;
    assert.ok(som === 26 || maanA || maanB, `A ronde ${i}: ongeldige strafsom ${som} (${row.join(',')})`);
  }
  assert.ok(Math.max(...r.totals) >= HARTENJAGEN_A.endScore, 'A: partij eindigde zonder endScore');
  const laagste = Math.min(...r.totals);
  for (const w of r.winners) assert.equal(r.totals[w], laagste, 'A: winnaar niet de laagste');
  console.log(`OK  profiel A — ♣2-opening, ${r.rondes} rondes, eindstand [${r.totals.join(', ')}], winnaar stoel ${r.winners.join(',')}`);
}

// === PROFIEL B (Nederlands Hartenjagen) ===
{
  const r = speel(HARTENJAGEN_B, 12345);
  assert.equal(r.openingId, 'clubs-7', 'profiel B: eerste slag moet met ♣7 openen');
  // Elke ronde verdeelt precies 15 strafpunten (8 harten + ♠V 5 + ♣B 2).
  for (const [i, row] of r.scoresPerRound.entries()) {
    const som = row.reduce((a, b) => a + b, 0);
    assert.equal(som, 15, `B ronde ${i}: strafsom moet 15 zijn (${row.join(',')})`);
  }
  // Twee-fasen-einde: er is een daalfase geweest en de partij eindigt met min ≤ 0.
  assert.ok(r.descendingGezien, 'B: de daalfase (twee-fasen-einde) is nooit bereikt');
  assert.ok(Math.min(...r.totals) <= 0, `B: partij eindigde zonder dat iemand ≤0 bereikte (${r.totals.join(',')})`);
  const laagste = Math.min(...r.totals);
  for (const w of r.winners) assert.equal(r.totals[w], laagste, 'B: winnaar niet de laagste');
  console.log(`OK  profiel B — ♣7-opening, twee-fasen, ${r.rondes} rondes, eindstand [${r.totals.join(', ')}], winnaar stoel ${r.winners.join(',')}`);
}

// === Determinisme (beide profielen) ===
{
  for (const [naam, cfg] of [['A', HARTENJAGEN_A], ['B', HARTENJAGEN_B]] as const) {
    const a = speel(cfg, 2024);
    const b = speel(cfg, 2024);
    assert.deepEqual(a.totals, b.totals, `${naam}: zelfde seed gaf andere totalen`);
  }
  console.log('OK  determinisme (A en B)');
}

// === Geen handlekkage (B, 32 kaarten) ===
{
  const def = createHartenjagenDefinition();
  const state: HartenjagenState = def.createInitialState(players(4), { ...HARTENJAGEN_B }, 99);
  for (let s = 0; s < 4; s++) {
    const view = def.getView(state, s as Seat);
    assert.equal(view.hand.length, view.handSizes[s], `B view stoel ${s}: hand ≠ handSize`);
    assert.equal(view.hand.length, 8, 'B: elke hand 8 kaarten (32/4)');
  }
  console.log('OK  getView profiel B — 8 kaarten per hand, geen lek');
}

// === Meerdere seeds, beide profielen ===
{
  let totaal = 0;
  for (const cfg of [HARTENJAGEN_A, HARTENJAGEN_B]) {
    for (const seed of [1, 7, 42, 100]) totaal += speel(cfg, seed).rondes;
  }
  console.log(`OK  8 partijen uitgespeeld (A+B) — ${totaal} rondes totaal`);
}

console.log('\nAlle Hartenjagen-engine-tests geslaagd (profiel A + B).');
