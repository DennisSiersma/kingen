/**
 * src/games/qwixx/engine.test-manual.ts
 * Headless engine-test voor Qwixx: speelt volledige partijen via de
 * GameDefinition en checkt de kernregels (links→rechts, slotvereiste, strafvak,
 * eindcondities) en het determinisme. Draai met: npx tsx <ditbestand>
 */

import type { GameEvent, PlayerConfig, Seat } from '../../core/types.ts';
import { createQwixxDefinition } from './engine.ts';
import { canMark } from './rules.ts';
import { sheetScore } from './scoring.ts';
import { QWIXX_DEFAULT } from './types.ts';
import type { QwixxMove, QwixxState, QwixxVariantConfig } from './types.ts';

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
function cfg(over: Partial<QwixxVariantConfig> = {}): QwixxVariantConfig {
  return { ...QWIXX_DEFAULT, ...over };
}

type Policy = (state: QwixxState, moves: QwixxMove[]) => QwixxMove;
const eersteLegale: Policy = (_s, moves) => moves[0]!;

function speel(config: QwixxVariantConfig, seed: number, policy: Policy) {
  const def = createQwixxDefinition();
  let state = def.createInitialState(players(config.playerCount), { ...config }, seed);
  const events: GameEvent[] = [...def.initialEvents(state)];
  let guard = 0;
  while (!def.isFinished(state) && guard++ < 500000) {
    const actor = def.currentActor(state);
    if (actor === null) break;
    const legal = def.getLegalMoves(state, actor);
    assert.ok(legal.length > 0, `stoel ${actor} aan zet maar geen legale zetten (fase ${state.phase})`);
    const res = def.applyMove(state, actor, policy(state, legal));
    state = res.state;
    events.push(...res.events);
  }
  assert.ok(def.isFinished(state), 'partij liep niet af binnen de guard');
  return { def, state, events };
}

// --- 1. Volledige partijen lopen af met een geldige winnaar -----------------
for (const seed of [1, 7, 42, 2024]) {
  for (const n of [2, 3, 4, 5]) {
    const { def, state } = speel(cfg({ playerCount: n }), seed, eersteLegale);
    const winners = def.getWinners(state);
    assert.ok(winners.length >= 1, `${seed}/${n}: minstens één winnaar`);
    // Einde door 2 sloten of een 4e strafvak.
    const klaar = state.lockedColors.length >= 2 || state.sheets.some((s) => s.penalties >= 4);
    assert.ok(klaar, `${seed}/${n}: einde door slot of strafvak`);
    // Totalen kloppen met de score-telling.
    for (let s = 0; s < n; s++) assert.equal(state.totals[s], sheetScore(state.sheets[s]!), `${seed}/${n}: totaal stoel ${s}`);
    const max = Math.max(...state.totals);
    for (const w of winners) assert.equal(state.totals[w], max, `${seed}/${n}: winnaar = hoogste`);
  }
}

// --- 2. Slotgetal vereist ≥5 kruisjes; links→rechts afgedwongen -------------
{
  const def = createQwixxDefinition();
  const state = def.createInitialState(players(2), cfg({ playerCount: 2 }), 5);
  // Rood (oplopend): met <5 kruisjes mag de 12 (slot) niet.
  state.sheets[0]!.rows.red.marks = [2, 3, 4, 5];
  assert.ok(!canMark(state, 0 as Seat, 'red', 12), '12 mag niet met 4 kruisjes');
  state.sheets[0]!.rows.red.marks = [2, 3, 4, 5, 6];
  assert.ok(canMark(state, 0 as Seat, 'red', 12), '12 mag met 5 kruisjes');
  // Links→rechts: niet links van de laatste markering.
  assert.ok(!canMark(state, 0 as Seat, 'red', 6), 'niet terug naar 6 (al voorbij)');
  assert.ok(canMark(state, 0 as Seat, 'red', 9), 'verder naar rechts mag (overslaan ok)');
  // Aflopende kleur: blauw 12→2.
  state.sheets[0]!.rows.blue.marks = [12, 10];
  assert.ok(canMark(state, 0 as Seat, 'blue', 7), 'blauw verder omlaag mag');
  assert.ok(!canMark(state, 0 as Seat, 'blue', 11), 'blauw niet terug omhoog');
  // Globaal vergrendelde kleur kan niemand meer markeren.
  state.lockedColors.push('green');
  assert.ok(!canMark(state, 0 as Seat, 'green', 12), 'vergrendelde kleur kan niet');
}

// --- 3. Strafvak als de actieve speler niets kruist -------------------------
{
  const def = createQwixxDefinition();
  let state = def.createInitialState(players(2), cfg({ playerCount: 2 }), 11);
  state = def.applyMove(state, def.currentActor(state)!, { type: 'roll' }).state;
  // Iedereen passt in de witte fase, daarna passt de actieve speler de kleuractie.
  let guard = 0;
  while (state.phase !== 'rolling' && guard++ < 20) {
    const actor = def.currentActor(state)!;
    state = def.applyMove(state, actor, { type: 'pass' }).state;
  }
  // De vorige actieve speler (stoel 0) heeft nu een strafvak.
  assert.equal(state.sheets[0]!.penalties, 1, 'actieve speler kreeg een strafvak');
  assert.equal(state.totals[0], -5, 'strafvak = −5');
}

// --- 4. Determinisme --------------------------------------------------------
{
  const a = speel(cfg({ playerCount: 4 }), 999, eersteLegale);
  const b = speel(cfg({ playerCount: 4 }), 999, eersteLegale);
  assert.equal(JSON.stringify(a.state.totals), JSON.stringify(b.state.totals), 'zelfde eindstand');
  assert.equal(a.events.length, b.events.length, 'zelfde aantal events');
}

console.log('✓ engine.test-manual: alle asserties geslaagd');
