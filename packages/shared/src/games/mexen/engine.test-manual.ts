/**
 * src/games/mexen/engine.test-manual.ts
 * Headless engine-test voor Mexen. Speelt volledige partijen via de
 * GameDefinition met verschillende beleidskeuzes en checkt de kernregels,
 * de verborgen-worp-invariant en het determinisme. Draai met: npx tsx <ditbestand>
 */

import type { GameEvent, PlayerConfig, Seat } from '../../core/types.ts';
import { createMexenDefinition } from './engine.ts';
import { MEXEN_DEFAULT } from './types.ts';
import type { MexenMove, MexenState, MexenVariantConfig } from './types.ts';
import { rankOf, rollToCode } from './ranking.ts';
import type { Roll } from '../dice/dice.ts';

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

function cfg(over: Partial<MexenVariantConfig> = {}): MexenVariantConfig {
  return { ...MEXEN_DEFAULT, ...over };
}

type Policy = (state: MexenState, moves: MexenMove[]) => MexenMove;

/** Speelt een volledige partij en verzamelt alle events. */
function speel(config: MexenVariantConfig, seed: number, policy: Policy) {
  const def = createMexenDefinition();
  let state = def.createInitialState(players(config.playerCount), { ...config }, seed);
  const events: GameEvent[] = [...def.initialEvents(state)];
  let guard = 0;
  while (!def.isFinished(state) && guard++ < 200000) {
    const actor = def.currentActor(state);
    if (actor === null) break;
    const legal = def.getLegalMoves(state, actor);
    assert.ok(legal.length > 0, `stoel ${actor} aan zet maar geen legale zetten (fase ${state.phase})`);
    const move = policy(state, legal);
    const res = def.applyMove(state, actor, move);
    state = res.state;
    events.push(...res.events);
  }
  assert.ok(def.isFinished(state), 'partij liep niet af binnen de guard');
  return { def, state, events };
}

// Beleid 1: altijd de eerste legale zet (responding → doubt). Korte rondes.
const altijdEerste: Policy = (_s, moves) => moves[0]!;
// Beleid 2: liefst geloven/escaleren (lange ketens roll→announce→believe→...).
const liefstGeloven: Policy = (_s, moves) => {
  const believe = moves.find((m) => m.type === 'believe');
  return believe ?? moves[0]!;
};

// --- 1. Volledige partijen lopen af met precies één winnaar ----------------
for (const [naam, policy] of [['eerste', altijdEerste], ['geloven', liefstGeloven]] as const) {
  for (const seed of [1, 42, 12345, 999]) {
    const { def, state, events } = speel(cfg({ playerCount: 4 }), seed, policy);
    const winners = def.getWinners(state);
    assert.equal(winners.length, 1, `${naam}/${seed}: precies één winnaar`);
    assert.ok(state.lives[winners[0]!]! > 0, `${naam}/${seed}: winnaar heeft levens over`);
    const doodCount = state.alive.filter((a) => !a).length;
    assert.equal(doodCount, 3, `${naam}/${seed}: 3 spelers uitgeschakeld`);
    assert.ok(events.some((e) => e.type === 'gameEnd'), `${naam}/${seed}: gameEnd geëmit`);
  }
}

// --- 2. Verborgen-worp-invariant -------------------------------------------
{
  const def = createMexenDefinition();
  let state = def.createInitialState(players(3), cfg({ playerCount: 3 }), 7);
  def.initialEvents(state);
  // Gooi met de houder → fase 'announcing'.
  const holder = def.currentActor(state)!;
  state = def.applyMove(state, holder, { type: 'roll' }).state;
  assert.equal(state.phase, 'announcing', 'na roll → announcing');
  const ownView = def.getView(state, holder);
  const otherView = def.getView(state, ((holder + 1) % 3) as Seat);
  const ownExtras = ownView.viewExtras as { myRoll: unknown };
  const otherExtras = otherView.viewExtras as { myRoll: unknown };
  assert.ok(ownExtras.myRoll !== null, 'houder ziet zijn eigen worp');
  assert.equal(otherExtras.myRoll, null, 'andere stoel ziet de worp NIET');
}

// --- 3. Geen enkel event lekt de worp vóór de onthulling --------------------
{
  const { events } = speel(cfg({ playerCount: 4 }), 314, altijdEerste);
  for (const e of events) {
    if (e.type !== 'custom') continue;
    if (e.subtype === 'revealed') continue; // onthulling mág de worp bevatten
    const json = JSON.stringify(e.data ?? {});
    assert.ok(!/"roll"/.test(json), `event ${e.subtype} lekt een worp: ${json}`);
  }
}

// --- 4. Twijfel-resolutie: waarheid → twijfelaar verliest -------------------
{
  const def = createMexenDefinition();
  let state = def.createInitialState(players(3), cfg({ playerCount: 3 }), 5);
  const holder = def.currentActor(state)!;
  state = def.applyMove(state, holder, { type: 'roll' }).state;
  const code = rollToCode(state.actualRoll as Roll);
  // Eerlijk de werkelijke waarde aankondigen (waarheid).
  state = def.applyMove(state, holder, { type: 'announce', value: code }).state;
  const doubter = def.currentActor(state)!;
  assert.ok(doubter !== holder, 'beker is doorgegeven');
  const res = def.applyMove(state, doubter, { type: 'doubt' });
  state = res.state;
  assert.equal(state.lives[doubter]!, MEXEN_DEFAULT.startLives - 1, 'twijfelaar verliest 1 (claim was waar)');
  assert.equal(state.lives[holder]!, MEXEN_DEFAULT.startLives, 'eerlijke aankondiger behoudt levens');
}

// --- 5. Twijfel-resolutie: leugen → aankondiger verliest --------------------
{
  const def = createMexenDefinition();
  let state = def.createInitialState(players(3), cfg({ playerCount: 3 }), 8);
  const holder = def.currentActor(state)!;
  state = def.applyMove(state, holder, { type: 'roll' }).state;
  const code = rollToCode(state.actualRoll as Roll);
  // Zoek een legale aankondiging die strikt hoger is dan de echte worp (een leugen).
  const legal = def.getLegalMoves(state, holder).filter((m) => m.type === 'announce') as Extract<MexenMove, { type: 'announce' }>[];
  const leugen = legal.find((m) => rankOf(m.value) > rankOf(code) && m.value !== 21);
  assert.ok(leugen, 'er bestaat een hogere niet-Mex aankondiging om mee te liegen');
  state = def.applyMove(state, holder, leugen!).state;
  const doubter = def.currentActor(state)!;
  state = def.applyMove(state, doubter, { type: 'doubt' }).state;
  assert.equal(state.lives[holder]!, MEXEN_DEFAULT.startLives - 1, 'leugenaar verliest 1');
  assert.equal(state.lives[doubter]!, MEXEN_DEFAULT.startLives, 'terechte twijfelaar behoudt levens');
}

// --- 6. Mäxchen-resolutie kost 2 levens -------------------------------------
{
  const def = createMexenDefinition();
  let state = def.createInitialState(players(3), cfg({ playerCount: 3 }), 11);
  const holder = def.currentActor(state)!;
  state = def.applyMove(state, holder, { type: 'roll' }).state;
  const code = rollToCode(state.actualRoll as Roll);
  // Mex aankondigen; als de echte worp geen Mex is, is dit een leugen → aankondiger -2.
  state = def.applyMove(state, holder, { type: 'announce', value: 21 }).state;
  const doubter = def.currentActor(state)!;
  state = def.applyMove(state, doubter, { type: 'doubt' }).state;
  if (code === 21) {
    assert.equal(state.lives[doubter]!, MEXEN_DEFAULT.startLives - 2, 'twijfel aan échte Mex kost de twijfelaar 2');
  } else {
    assert.equal(state.lives[holder]!, MEXEN_DEFAULT.startLives - 2, 'betrapte Mex-leugen kost de aankondiger 2');
  }
}

// --- 7. Determinisme: gelijke seed ⇒ identieke partij -----------------------
{
  const a = speel(cfg({ playerCount: 4 }), 2024, altijdEerste);
  const b = speel(cfg({ playerCount: 4 }), 2024, altijdEerste);
  assert.equal(JSON.stringify(a.state.totals), JSON.stringify(b.state.totals), 'zelfde eindstand');
  assert.equal(JSON.stringify(a.state.scoresPerRound), JSON.stringify(b.state.scoresPerRound), 'zelfde rondeverloop');
  assert.equal(a.events.length, b.events.length, 'zelfde aantal events');
}

console.log('✓ engine.test-manual: alle asserties geslaagd');
