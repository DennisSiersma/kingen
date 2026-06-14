/**
 * src/games/yahtzee/engine.test-manual.ts
 * Headless engine-test voor Yahtzee: scoring (incl. joker + bonussen), legale
 * zetten, herworp-mechaniek, volledige partijen en determinisme.
 * Draai met: npx tsx <ditbestand>
 */

import type { GameEvent, PlayerConfig, Seat } from '../../core/types.ts';
import { createYahtzeeDefinition } from './engine.ts';
import {
  cardGrandTotal, hasLargeStraight, hasSmallStraight, isFullHouse, isYahtzee, scoreCategory,
} from './scoring.ts';
import { keepSubsets, scorableCategories } from './rules.ts';
import { emptyCard, YAHTZEE_CATEGORIES, YAHTZEE_DEFAULT } from './types.ts';
import type { YahtzeeMove, YahtzeeState, YahtzeeVariantConfig } from './types.ts';

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
function cfg(over: Partial<YahtzeeVariantConfig> = {}): YahtzeeVariantConfig {
  return { ...YAHTZEE_DEFAULT, ...over };
}

// --- scoring -----------------------------------------------------------------
assert.equal(scoreCategory([3, 3, 3, 5, 2], 'threes'), 9, 'drie drieën → 9');
assert.equal(scoreCategory([6, 6, 6, 6, 1], 'sixes'), 24, 'vier zessen → 24');
assert.equal(scoreCategory([5, 5, 5, 2, 1], 'threeKind'), 18, 'three of a kind → som 18');
assert.equal(scoreCategory([5, 5, 5, 2, 1], 'fourKind'), 0, 'geen vier gelijk → 0');
assert.equal(scoreCategory([4, 4, 4, 4, 1], 'fourKind'), 17, 'four of a kind → som 17');
assert.equal(scoreCategory([2, 2, 5, 5, 5], 'fullHouse'), 25, 'full house → 25');
assert.equal(scoreCategory([2, 2, 2, 5, 5], 'fullHouse'), 25, 'full house (2+3) → 25');
assert.equal(scoreCategory([2, 2, 5, 5, 1], 'fullHouse'), 0, 'twee paren ≠ full house');
assert.equal(scoreCategory([1, 2, 3, 4, 6], 'smallStraight'), 30, 'small straight 1-2-3-4 → 30');
assert.equal(scoreCategory([3, 4, 5, 6, 6], 'smallStraight'), 30, 'small straight 3-4-5-6 → 30');
assert.equal(scoreCategory([1, 2, 4, 5, 6], 'smallStraight'), 0, 'gat → geen small straight');
assert.equal(scoreCategory([2, 3, 4, 5, 6], 'largeStraight'), 40, 'large straight → 40');
assert.equal(scoreCategory([1, 2, 3, 4, 5], 'largeStraight'), 40, 'large straight 1-5 → 40');
assert.equal(scoreCategory([1, 1, 1, 1, 1], 'yahtzee'), 50, 'yahtzee → 50');
assert.equal(scoreCategory([1, 2, 3, 4, 5], 'chance'), 15, 'chance → som 15');
// Joker forceert vol tarief op de combinaties:
assert.equal(scoreCategory([4, 4, 4, 4, 4], 'fullHouse', true), 25, 'joker full house → 25');
assert.equal(scoreCategory([4, 4, 4, 4, 4], 'largeStraight', true), 40, 'joker large straight → 40');
assert.ok(isYahtzee([2, 2, 2, 2, 2]) && !isYahtzee([2, 2, 2, 2, 3]), 'isYahtzee');
assert.ok(isFullHouse([3, 3, 6, 6, 6]) && !isFullHouse([3, 3, 3, 6, 1]), 'isFullHouse');
assert.ok(hasSmallStraight([2, 3, 4, 5, 5]) && !hasSmallStraight([1, 1, 3, 4, 6]), 'hasSmallStraight');
assert.ok(hasLargeStraight([1, 2, 3, 4, 5]) && !hasLargeStraight([1, 2, 3, 4, 6]), 'hasLargeStraight');

// --- bovenbonus + Yahtzee-bonus ----------------------------------------------
{
  const card = emptyCard();
  for (const cat of ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'] as const) {
    card.scores[cat] = (['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'].indexOf(cat) + 1) * 3; // 3 van elk
  }
  // 3+6+9+12+15+18 = 63 → bonus.
  assert.equal(cardGrandTotal(card), 63 + 35, 'bovensectie 63 → +35 bonus');
  card.scores.ones = 2; // 2 → subtotaal 62, geen bonus
  assert.equal(cardGrandTotal(card), 62, 'subtotaal 62 → geen bonus');
}
{
  const card = emptyCard();
  card.scores.yahtzee = 50;
  card.yahtzeeBonus = 2;
  card.scores.chance = 30;
  assert.equal(cardGrandTotal(card), 50 + 30 + 200, 'twee extra-Yahtzees → +200');
}

// --- keepSubsets / scorable --------------------------------------------------
assert.equal(keepSubsets([1, 1, 1, 1, 1]).length, 5, '{1×5} → houd 0..4 = 5 opties');
assert.ok(keepSubsets([1, 2, 3, 4, 5]).some((s) => s.length === 0), 'lege keep (alles opnieuw) bestaat');
assert.ok(!keepSubsets([1, 2, 3, 4, 5]).some((s) => s.length === 5), 'volledige keep is geen herworp');
{
  // Joker: Yahtzee-vak vol (50), nogmaals vijf vieren → verplicht het open bovenvak 'fours'.
  const card = emptyCard();
  card.scores.yahtzee = 50;
  const cats = scorableCategories(card, [4, 4, 4, 4, 4]);
  assert.equal(cats.length, 1, 'joker met open bovenvak → 1 keuze');
  assert.equal(cats[0], 'fours', 'verplicht bovenvak fours');
  // Bovenvak 'fours' óók vol → elk open ondervak mag.
  card.scores.fours = 20;
  const cats2 = scorableCategories(card, [4, 4, 4, 4, 4]);
  assert.ok(cats2.includes('fullHouse') && !cats2.includes('ones'), 'joker → ondervakken, geen bovenvakken');
}

// --- volledige partij: eerste-legale-zet -------------------------------------
function speel(config: YahtzeeVariantConfig, seed: number, policy: (s: YahtzeeState, m: YahtzeeMove[]) => YahtzeeMove) {
  const def = createYahtzeeDefinition();
  let state = def.createInitialState(players(config.playerCount), { ...config }, seed);
  const events: GameEvent[] = [...def.initialEvents(state)];
  let guard = 0;
  while (!def.isFinished(state) && guard++ < 200000) {
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
  for (const n of [1, 2, 3, 4]) {
    const { def, state } = speel(cfg({ playerCount: n }), seed, (_s, m) => m[0]!);
    const winners = def.getWinners(state);
    assert.ok(winners.length >= 1, `${seed}/${n}: een winnaar`);
    const max = Math.max(...state.totals);
    for (const w of winners) assert.equal(state.totals[w], max, `${seed}/${n}: winnaar = hoogste`);
    assert.equal(state.scoresPerRound.length, 13, `${seed}/${n}: 13 rondes`);
    // Elke kaart is volledig ingevuld.
    for (const card of state.cards) {
      assert.ok(YAHTZEE_CATEGORIES.every((c) => card.scores[c] !== null), `${seed}/${n}: kaart vol`);
    }
  }
}

// --- reroll legt geen stenen vast buiten keep & telt worpen ------------------
{
  const def = createYahtzeeDefinition();
  let state = def.createInitialState(players(1), cfg({ playerCount: 1 }), 5);
  state = def.applyMove(state, 0 as Seat, { type: 'roll' }).state;
  assert.equal(state.phase, 'deciding', 'na roll → deciding');
  assert.equal(state.dice.length, 5, '5 stenen na de worp');
  assert.equal(state.rollsUsed, 1, 'worp 1 geteld');
  const houd = [state.dice[0]!];
  state = def.applyMove(state, 0 as Seat, { type: 'reroll', keep: houd }).state;
  assert.equal(state.dice.length, 5, 'nog steeds 5 stenen');
  assert.equal(state.rollsUsed, 2, 'worp 2 geteld');
  assert.ok(state.dice.includes(houd[0]!), 'de vastgehouden steen zit er nog in');
}

// --- max. 3 worpen: na de derde geen reroll meer ----------------------------
{
  const def = createYahtzeeDefinition();
  let state = def.createInitialState(players(1), cfg({ playerCount: 1 }), 8);
  state = def.applyMove(state, 0 as Seat, { type: 'roll' }).state;
  state = def.applyMove(state, 0 as Seat, { type: 'reroll', keep: [] }).state; // worp 2
  state = def.applyMove(state, 0 as Seat, { type: 'reroll', keep: [] }).state; // worp 3
  assert.equal(state.rollsUsed, 3, '3 worpen gebruikt');
  const legal = def.getLegalMoves(state, 0 as Seat);
  assert.ok(legal.every((m) => m.type === 'score'), 'na 3 worpen alleen nog scoren');
}

// --- determinisme ------------------------------------------------------------
{
  const a = speel(cfg({ playerCount: 3 }), 314, (_s, m) => m[0]!);
  const b = speel(cfg({ playerCount: 3 }), 314, (_s, m) => m[0]!);
  assert.equal(JSON.stringify(a.state.totals), JSON.stringify(b.state.totals), 'zelfde eindstand');
  assert.equal(a.events.length, b.events.length, 'zelfde aantal events');
}

console.log('✓ engine.test-manual: alle asserties geslaagd');
