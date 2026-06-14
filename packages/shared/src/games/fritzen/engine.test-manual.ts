/**
 * src/games/fritzen/engine.test-manual.ts
 * Headless engine-test voor Fritzen: volledige partijen, keep-/herworp-regels,
 * scoring en determinisme. Draai met: npx tsx <ditbestand>
 */

import type { GameEvent, PlayerConfig, Seat } from '../../core/types.ts';
import { createFritzenDefinition } from './engine.ts';
import { fritzenPoints } from './scoring.ts';
import { keepSubsets } from './rules.ts';
import { FRITZEN_DEFAULT } from './types.ts';
import type { FritzenMove, FritzenState, FritzenVariantConfig } from './types.ts';

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
function cfg(over: Partial<FritzenVariantConfig> = {}): FritzenVariantConfig {
  return { ...FRITZEN_DEFAULT, ...over };
}

// --- scoring -----------------------------------------------------------------
assert.equal(fritzenPoints(36), 6, '36 → +6');
assert.equal(fritzenPoints(30), 0, '30 → 0');
assert.equal(fritzenPoints(6), 4, '6 → +4');
assert.equal(fritzenPoints(10), 0, '10 → 0');
assert.equal(fritzenPoints(20), -10, '20 → −10 (diep in de foutzone)');
assert.equal(fritzenPoints(11), -1, '11 → −1');
assert.equal(fritzenPoints(29), -1, '29 → −1');

// --- keepSubsets -------------------------------------------------------------
assert.equal(keepSubsets([3, 3]).length, 2, '{3,3} → [3],[3,3]');
assert.equal(keepSubsets([1, 2, 3]).length, 7, '3 distinct → 2^3-1 = 7');

// --- volledige partij: eerste-legale-zet -------------------------------------
function speel(config: FritzenVariantConfig, seed: number, policy: (s: FritzenState, m: FritzenMove[]) => FritzenMove) {
  const def = createFritzenDefinition();
  let state = def.createInitialState(players(config.playerCount), { ...config }, seed);
  const events: GameEvent[] = [...def.initialEvents(state)];
  let guard = 0;
  while (!def.isFinished(state) && guard++ < 100000) {
    const actor = def.currentActor(state);
    if (actor === null) break;
    const legal = def.getLegalMoves(state, actor);
    assert.ok(legal.length > 0, `geen legale zetten (fase ${state.phase})`);
    const res = def.applyMove(state, actor, policy(state, legal));
    state = res.state;
    events.push(...res.events);
  }
  assert.ok(def.isFinished(state), 'partij liep niet af');
  return { def, state, events };
}

for (const seed of [1, 7, 42, 2024]) {
  for (const n of [2, 3, 4]) {
    const { def, state } = speel(cfg({ playerCount: n, rounds: 3 }), seed, (_s, m) => m[0]!);
    const winners = def.getWinners(state);
    assert.ok(winners.length >= 1, `${seed}/${n}: een winnaar`);
    const max = Math.max(...state.totals);
    for (const w of winners) assert.equal(state.totals[w], max, `${seed}/${n}: winnaar = hoogste`);
    // Elke speler speelde precies `rounds` beurten (scoresPerRound is rounds×n gevuld).
    assert.equal(state.scoresPerRound.length, 3, `${seed}/${n}: 3 rondes`);
  }
}

// --- keep legt vast, herworp verandert alleen de losse stenen ----------------
{
  const def = createFritzenDefinition();
  let state = def.createInitialState(players(2), cfg({ playerCount: 2 }), 5);
  state = def.applyMove(state, 0 as Seat, { type: 'roll' }).state;
  assert.equal(state.phase, 'deciding', 'na roll → deciding');
  assert.equal(state.loose.length, 6, '6 losse stenen na de eerste worp');
  const teHouden = state.loose[0]!;
  state = def.applyMove(state, 0 as Seat, { type: 'keep', values: [teHouden], stop: false }).state;
  assert.equal(state.locked.length, 1, '1 steen vastgelegd');
  assert.equal(state.locked[0], teHouden, 'de juiste steen vastgelegd');
  assert.equal(state.loose.length, 5, '5 stenen opnieuw gegooid');
  assert.equal(state.rollsUsed, 2, 'tweede worp geteld');
}

// --- max. 5 worpen: na 5 worpen kan niet meer herworpen worden ---------------
{
  const def = createFritzenDefinition();
  let state = def.createInitialState(players(2), cfg({ playerCount: 2, maxRolls: 5 }), 8);
  state = def.applyMove(state, 0 as Seat, { type: 'roll' }).state; // worp 1
  // Houd telkens 1 steen, gooi de rest opnieuw → worpen 2..5.
  for (let r = 0; r < 4; r++) {
    const v = state.loose[0]!;
    const stop = state.rollsUsed >= 5; // bij de 5e worp niet meer herwerpen
    state = def.applyMove(state, 0 as Seat, { type: 'keep', values: [v], stop }).state;
  }
  assert.equal(state.rollsUsed, 5, '5 worpen gebruikt');
  // Nu mag er geen stop:false-zet meer zijn.
  const legal = def.getLegalMoves(state, 0 as Seat);
  assert.ok(legal.every((m) => m.type === 'keep' && m.stop === true), 'na 5 worpen alleen nog stoppen');
}

// --- determinisme ------------------------------------------------------------
{
  const a = speel(cfg({ playerCount: 4 }), 314, (_s, m) => m[0]!);
  const b = speel(cfg({ playerCount: 4 }), 314, (_s, m) => m[0]!);
  assert.equal(JSON.stringify(a.state.totals), JSON.stringify(b.state.totals), 'zelfde eindstand');
  assert.equal(a.events.length, b.events.length, 'zelfde aantal events');
}

console.log('✓ engine.test-manual: alle asserties geslaagd');
