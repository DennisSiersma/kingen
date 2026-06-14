/**
 * src/games/regenwormen/engine.test-manual.ts
 * Headless engine-test voor Regenwormen: ogen-/wormwaarden, tegel-wormen,
 * pakbare-tegel-bepaling, set-aside-regels, mislukken (bust → toptegel terug +
 * hoogste tegel eruit), stelen, einde (leeg midden) en determinisme.
 * Draai met: npx tsx <ditbestand>
 */

import type { GameEvent, PlayerConfig, Seat } from '../../core/types.ts';
import { createRegenwormenDefinition } from './engine.ts';
import { ALL_TILES, hasWorm, pips, sumPips, takeOptions, wormsOfTile, wormTotal } from './scoring.ts';
import { reservableValues } from './rules.ts';
import { REGENWORMEN_DEFAULT } from './types.ts';
import type { RegenwormenMove, RegenwormenState, RegenwormenVariantConfig } from './types.ts';

const assert = {
  ok(cond: unknown, msg?: string): void {
    if (!cond) throw new Error(`Assertie mislukt${msg ? ': ' + msg : ''}`);
  },
  equal(a: unknown, b: unknown, msg?: string): void {
    if (a !== b) throw new Error(`Assertie mislukt${msg ? ': ' + msg : ''} (${String(a)} !== ${String(b)})`);
  },
};

function players(n: number): PlayerConfig[] {
  return Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, kind: 'ai' as const }));
}
function cfg(over: Partial<RegenwormenVariantConfig> = {}): RegenwormenVariantConfig {
  return { ...REGENWORMEN_DEFAULT, ...over };
}

// --- waarden -----------------------------------------------------------------
assert.equal(pips(6), 5, 'worm telt als 5');
assert.equal(pips(3), 3, 'oog 3 = 3');
assert.equal(sumPips([6, 6, 5, 1]), 16, '5+5+5+1 = 16');
assert.ok(hasWorm([1, 2, 6]) && !hasWorm([1, 2, 3]), 'hasWorm');
assert.equal(wormsOfTile(21), 1, '21 → 1 worm');
assert.equal(wormsOfTile(24), 1, '24 → 1 worm');
assert.equal(wormsOfTile(25), 2, '25 → 2 wormen');
assert.equal(wormsOfTile(28), 2, '28 → 2 wormen');
assert.equal(wormsOfTile(29), 3, '29 → 3 wormen');
assert.equal(wormsOfTile(33), 4, '33 → 4 wormen');
assert.equal(wormsOfTile(36), 4, '36 → 4 wormen');
assert.equal(wormTotal([21, 25, 33]), 1 + 2 + 4, 'wormtotaal van een stapel');
assert.equal(ALL_TILES.length, 16, '16 tegels (21..36)');

// --- reservableValues + takeOptions ------------------------------------------
const eqArr = (a: number[], b: number[], msg: string): void => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
eqArr(reservableValues([1, 1, 5, 6], [5]), [1, 6], '5 al gebruikt → 1 en 6 over');
eqArr(reservableValues([2, 2, 3, 3], [3]), [2], '3 al gebruikt → alleen 2');
{
  const center = [21, 22, 23, 30];
  // som 25: hoogste centrum ≤ 25 = 23
  const o1 = takeOptions(25, center, [[], []], 0);
  assert.equal(o1.length, 1, 'één centrum-optie');
  assert.equal(o1[0]!.tile, 23, 'hoogste ≤ 25 = 23');
  // steal: tegenstander-top exact 30
  const o2 = takeOptions(30, center, [[], [30]], 0);
  assert.ok(o2.some((o) => o.from === 1 && o.tile === 30), 'steal exact 30');
  assert.ok(o2.some((o) => o.from === 'center' && o.tile === 30), 'centrum 30 ook (==som)');
}

// --- volledige partijen (take-zoekende policy) -------------------------------
function speel(config: RegenwormenVariantConfig, seed: number) {
  const def = createRegenwormenDefinition();
  let state = def.createInitialState(players(config.playerCount), { ...config }, seed);
  const events: GameEvent[] = [...def.initialEvents(state)];
  let guard = 0;
  while (!def.isFinished(state) && guard++ < 1000000) {
    const actor = def.currentActor(state);
    if (actor === null) break;
    const legal = def.getLegalMoves(state, actor);
    assert.ok(legal.length > 0, `geen legale zetten (fase ${state.phase})`);
    // Policy: pak een tegel zodra het mag; anders een waarde apart leggen of gooien.
    const take = legal.find((m) => m.type === 'take');
    const reserve = legal.find((m) => m.type === 'reserve');
    const move: RegenwormenMove = take ?? reserve ?? legal[0]!;
    const res = def.applyMove(state, actor, move);
    state = res.state;
    events.push(...res.events);
  }
  assert.ok(def.isFinished(state), 'partij liep niet af');
  return { def, state, events };
}

for (const seed of [1, 7, 42, 2024]) {
  for (const n of [1, 2, 3, 4]) {
    const { def, state } = speel(cfg({ playerCount: n }), seed);
    const winners = def.getWinners(state);
    assert.ok(winners.length >= 1, `${seed}/${n}: een winnaar`);
    const max = Math.max(...state.totals);
    for (const w of winners) assert.equal(state.totals[w], max, `${seed}/${n}: winnaar = hoogste wormtotaal`);
    assert.equal(state.center.length, 0, `${seed}/${n}: midden is leeg aan het eind`);
    // Wormen-totalen kloppen met de stapels.
    state.stacks.forEach((st, s) => assert.equal(state.totals[s], wormTotal(st), `${seed}/${n}: totaal stoel ${s}`));
  }
}

// --- bust: alle 8 vastgelegd, geen worm/te laag → toptegel terug + hoogste eruit ---
{
  const def = createRegenwormenDefinition();
  const state = def.createInitialState(players(2), cfg({ playerCount: 2 }), 3);
  state.phase = 'deciding';
  state.active = 0 as Seat;
  state.stacks[0] = [30];
  state.totals[0] = wormsOfTile(30); // 3
  state.center = [21, 22, 23, 36];
  state.reserved = [1, 1, 1, 1, 1, 1, 1]; // 7 stenen
  state.usedValues = [1];
  state.loose = [2]; // leg de 2 apart → 8 stenen, som 9, geen worm → kan niet pakken, geen stenen meer → bust
  const res = def.applyMove(state, 0 as Seat, { type: 'reserve', value: 2 });
  const bustEv = res.events.find((e) => e.type === 'custom' && (e as { subtype?: string }).subtype === 'rwBust');
  assert.ok(bustEv, 'bust-event geëmit');
  // Toptegel 30 terug naar midden, daarna hoogste (36) eruit.
  assert.ok(!res.state.stacks[0]!.includes(30), 'toptegel 30 teruggelegd');
  assert.ok(res.state.center.includes(30), '30 ligt weer in het midden');
  assert.ok(!res.state.center.includes(36), 'hoogste tegel 36 uit het spel');
  assert.equal(res.state.totals[0], 0, 'stoel 0 heeft geen tegels meer');
}

// --- determinisme ------------------------------------------------------------
{
  const a = speel(cfg({ playerCount: 3 }), 314);
  const b = speel(cfg({ playerCount: 3 }), 314);
  assert.equal(JSON.stringify(a.state.totals), JSON.stringify(b.state.totals), 'zelfde eindstand');
  assert.equal(a.events.length, b.events.length, 'zelfde aantal events');
}

console.log('✓ engine.test-manual: alle asserties geslaagd');
