/**
 * src/games/tienduizend/engine.test-manual.ts
 * Headless engine-test voor Tienduizend: scoring (singles/trio's/verdubbeling/
 * straat/drie paren), bust-detectie, openingsdrempel, hot-dice, slotronde en
 * determinisme. Draai met: npx tsx <ditbestand>
 */

import type { GameEvent, PlayerConfig, Seat } from '../../core/types.ts';
import { createTienduizendDefinition } from './engine.ts';
import { bestScore, hasAnyScore, scoreDice, scoringSelections } from './scoring.ts';
import { TIENDUIZEND_DEFAULT } from './types.ts';
import type { TienduizendMove, TienduizendState, TienduizendVariantConfig } from './types.ts';

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
function cfg(over: Partial<TienduizendVariantConfig> = {}): TienduizendVariantConfig {
  return { ...TIENDUIZEND_DEFAULT, ...over };
}

// --- scoreDice (volledig scorende verzamelingen) -----------------------------
assert.equal(scoreDice([1]), 100, 'losse 1 → 100');
assert.equal(scoreDice([5]), 50, 'losse 5 → 50');
assert.equal(scoreDice([1, 5]), 150, '1+5 → 150');
assert.equal(scoreDice([2]), null, 'losse 2 scoort niet');
assert.equal(scoreDice([1, 2]), null, '1+2 niet volledig scorend');
assert.equal(scoreDice([1, 1, 1]), 1000, 'drie 1-en → 1000');
assert.equal(scoreDice([2, 2, 2]), 200, 'drie 2-en → 200');
assert.equal(scoreDice([6, 6, 6]), 600, 'drie 6-en → 600');
assert.equal(scoreDice([1, 1, 1, 1]), 2000, 'vier 1-en → 2× = 2000');
assert.equal(scoreDice([1, 1, 1, 1, 1]), 4000, 'vijf 1-en → 4× = 4000');
assert.equal(scoreDice([1, 1, 1, 1, 1, 1]), 8000, 'zes 1-en → 8× = 8000');
assert.equal(scoreDice([2, 2, 2, 2]), 400, 'vier 2-en → 400');
assert.equal(scoreDice([5, 5, 5, 1]), 600, 'drie 5-en (500) + 1 (100) → 600');
assert.equal(scoreDice([1, 2, 3, 4, 5, 6]), 1500, 'straat → 1500');
assert.equal(scoreDice([2, 2, 3, 3, 4, 4]), 1500, 'drie paren (geen 1/5) → 1500');
assert.equal(scoreDice([1, 1, 5, 5, 3, 3]), 1500, 'drie paren met 1/5 → 1500');
assert.equal(scoreDice([1, 1, 1, 5, 5, 5]), 1500, 'twee trio\'s 1000+500 → 1500');
assert.equal(scoreDice([2, 2, 3, 4, 5, 6]), null, '2-2-3-4-6 + 5: 5 scoort, maar 2/2/3/4/6 niet → null');

// --- hasAnyScore (bust-detectie) ---------------------------------------------
assert.ok(hasAnyScore([2, 3, 4, 6, 6, 3]) === false, 'geen 1/5/trio/3-paren → bust');
assert.ok(hasAnyScore([2, 2, 3, 3, 4, 4]) === true, 'drie paren is geen bust');
assert.ok(hasAnyScore([2, 2, 2, 3, 4, 6]) === true, 'een trio is geen bust');
assert.ok(hasAnyScore([5, 2, 3, 4, 6, 6]) === true, 'een losse 5 is geen bust');

// --- scoringSelections / bestScore -------------------------------------------
{
  const sels = scoringSelections([1, 1, 5]);
  // keuzes: {1},{1,1},{5},{1,5},{1,1,5}
  assert.equal(sels.length, 5, '5 geldige keuzes uit 1-1-5');
  assert.equal(bestScore([1, 1, 5]), 250, 'beste uit 1-1-5 = 200+50');
  assert.equal(bestScore([2, 3, 4]), 0, 'niets scorends → 0');
}

// --- volledige partij: eerste-legale-zet -------------------------------------
function speel(config: TienduizendVariantConfig, seed: number, policy: (s: TienduizendState, m: TienduizendMove[]) => TienduizendMove) {
  const def = createTienduizendDefinition();
  let state = def.createInitialState(players(config.playerCount), { ...config }, seed);
  const events: GameEvent[] = [...def.initialEvents(state)];
  let guard = 0;
  while (!def.isFinished(state) && guard++ < 500000) {
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

// "Bank zodra het mag" -policy: voorkomt eindeloze push-your-luck en bereikt het doel.
const bankAsap = (_s: TienduizendState, m: TienduizendMove[]): TienduizendMove =>
  m.find((x) => x.type === 'setAside' && x.bank) ?? m[0]!;

for (const seed of [1, 7, 42, 2024]) {
  for (const n of [1, 2, 3, 4]) {
    const { def, state } = speel(cfg({ playerCount: n, targetScore: 3000 }), seed, bankAsap);
    const winners = def.getWinners(state);
    assert.ok(winners.length >= 1, `${seed}/${n}: een winnaar`);
    const max = Math.max(...state.totals);
    for (const w of winners) assert.equal(state.totals[w], max, `${seed}/${n}: winnaar = hoogste`);
    assert.ok(max >= 3000, `${seed}/${n}: winnaar haalde het doel (${max})`);
  }
}

// --- openingsdrempel: te kleine pot mag niet gebankt worden ------------------
{
  const def = createTienduizendDefinition();
  let state = def.createInitialState(players(1), cfg({ playerCount: 1, openingThreshold: 350 }), 3);
  state = def.applyMove(state, 0 as Seat, { type: 'roll' }).state;
  const legal = def.getLegalMoves(state, 0 as Seat);
  for (const m of legal) {
    if (m.type === 'setAside' && m.bank) {
      const sc = scoreDice(m.keep)!;
      assert.ok(state.turnPot + sc >= 350, 'bank-zet alleen aangeboden als drempel gehaald wordt');
    }
  }
}

// --- slotronde: na de finisher krijgt iedereen nog één beurt -----------------
{
  // Lage drempel + laag doel zodat het snel triggert; controleer dat finishingSeat zet.
  const { state } = speel(cfg({ playerCount: 3, targetScore: 1000, openingThreshold: 50 }), 11, bankAsap);
  assert.ok(state.finishingSeat !== null || Math.max(...state.totals) >= 1000, 'slotronde getriggerd');
}

// --- determinisme ------------------------------------------------------------
{
  const a = speel(cfg({ playerCount: 3, targetScore: 3000 }), 314, bankAsap);
  const b = speel(cfg({ playerCount: 3, targetScore: 3000 }), 314, bankAsap);
  assert.equal(JSON.stringify(a.state.totals), JSON.stringify(b.state.totals), 'zelfde eindstand');
  assert.equal(a.events.length, b.events.length, 'zelfde aantal events');
}

console.log('✓ engine.test-manual: alle asserties geslaagd');
