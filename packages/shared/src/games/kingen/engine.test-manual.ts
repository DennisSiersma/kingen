/**
 * src/games/kingen/engine.test-manual.ts
 * Handmatig uitvoerbare engine-test: simuleert volledige partijen met random
 * spelers en asserteert de scoreconsistentie (som per ronde + nulsom totaal).
 *
 * Draaien:  npx -y tsx src/games/kingen/engine.test-manual.ts
 *      of:  node src/games/kingen/engine.test-manual.ts   (Node >= 23, type stripping)
 */

import type { Card, GameEvent, PlayerConfig, Seat, Suit } from '../../core/types.ts';
import { createRng } from '../../core/deck.ts';
import { createGameEventBus } from '../../core/events.ts';
import { ScoreSheet } from '../../core/scoresheet.ts';
import { TurnManager } from '../../core/turnManager.ts';
import type { PlayerController } from '../../core/player.ts';
import { createKingenDefinition } from './engine.ts';
import { getTableParams } from './params.ts';
import type { KingenRoundKind, KingenTableParams, KingenVariantConfig } from './types.ts';
import { DEFAULT_VARIANT, NEGATIVE_ROUND_KINDS, ROUND_LABELS_NL } from './types.ts';

// --- mini-assert (geen @types/node nodig; project is browser-getarget) ---
interface MiniAssert {
  ok(cond: unknown, msg: string): asserts cond;
  equal(actual: unknown, expected: unknown, msg?: string): void;
  notEqual(actual: unknown, expected: unknown, msg?: string): void;
  deepEqual(actual: unknown, expected: unknown, msg?: string): void;
}
const assert: MiniAssert = {
  ok(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
  },
  equal(actual: unknown, expected: unknown, msg?: string): void {
    if (actual !== expected) {
      throw new Error(`${msg ?? 'assert.equal'} — kreeg ${JSON.stringify(actual)}, verwachtte ${JSON.stringify(expected)}`);
    }
  },
  notEqual(actual: unknown, expected: unknown, msg?: string): void {
    if (actual === expected) {
      throw new Error(`${msg ?? 'assert.notEqual'} — beide ${JSON.stringify(actual)}`);
    }
  },
  deepEqual(actual: unknown, expected: unknown, msg?: string): void {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) throw new Error(`${msg ?? 'assert.deepEqual'} — kreeg ${a}, verwachtte ${b}`);
  },
};

const def = createKingenDefinition();

function makePlayers(n: number): PlayerConfig[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `Robot ${i + 1}`,
    kind: 'ai' as const,
    aiDifficulty: 'makkelijk' as const,
  }));
}

/** Verwachte som van de rondescores per rondesoort (natuurlijke tekens). */
function expectedRoundSum(kind: string, p: KingenTableParams, lowestWins: boolean): number {
  const pen = p.penalties;
  let sum: number;
  switch (kind as KingenRoundKind) {
    case 'geenSlagen':
      sum = -pen.perTrick * p.tricksPerRound;
      break;
    case 'geenHarten':
      sum = -pen.perHeart * 13; // gestripte kaarten zijn altijd zwart
      break;
    case 'geenHerenBoeren':
      sum = -pen.perKingOrJack * 8;
      break;
    case 'geenDames':
      sum = -pen.perQueen * 4;
      break;
    case 'hartenheer':
      sum = -pen.heartKing;
      break;
    case 'zevenLaatste':
      sum = -(pen.seventhTrick + pen.lastTrick);
      break;
    case 'troef':
      sum = p.tricksPerRound;
      break;
    default:
      throw new Error(`Onbekende rondesoort: ${kind}`);
  }
  return lowestWins ? -sum : sum;
}

interface SimResult {
  events: GameEvent[];
  totals: number[];
  sheet: ScoreSheet;
}

/** Speel één volledige partij met random (maar legale) zetten, deterministisch. */
function simulate(config: KingenVariantConfig, seed: number): SimResult {
  const rng = createRng(seed ^ 0xbeef);
  const players = makePlayers(config.playerCount);
  const params = getTableParams(config);
  const sheet = new ScoreSheet(config.playerCount);

  let state = def.createInitialState(players, config, seed);
  const events: GameEvent[] = [...def.initialEvents(state)];

  let guard = 0;
  while (!def.isFinished(state)) {
    if (++guard > 20000) throw new Error('Veiligheidslimiet bereikt: partij eindigt niet');
    const actor = def.currentActor(state);
    assert.notEqual(actor, null, 'Er moet altijd een actor zijn zolang de partij loopt');
    const moves = def.getLegalMoves(state, actor!);
    assert.ok(moves.length > 0, `Actor ${actor} heeft geen legale zetten`);

    // Sanity: getView.legalCards spiegelt de playCard-zetten.
    const view = def.getView(state, actor!);
    const cardMoves = moves.filter((m) => m.type === 'playCard');
    if (cardMoves.length > 0) {
      assert.deepEqual(
        view.legalCards.map((c) => c.id).sort(),
        cardMoves.map((m) => (m as { card: Card }).card.id).sort(),
        'view.legalCards moet overeenkomen met de playCard-zetten',
      );
    }

    const move = moves[Math.floor(rng() * moves.length)]!;
    const result = def.applyMove(state, actor!, move);
    state = result.state;
    events.push(...result.events);
  }

  // Verzamel rondescores en controleer de som per ronde.
  for (const e of events) {
    if (e.type === 'roundEnd') {
      const scores = Array.from({ length: config.playerCount }, (_, i) => e.scores[i] ?? 0);
      const sum = scores.reduce((a, b) => a + b, 0);
      const expected = expectedRoundSum(e.roundKind, params, config.lowestWins);
      assert.equal(
        sum,
        expected,
        `Ronde ${e.roundIndex} (${e.roundKind}): som ${sum} != verwacht ${expected}`,
      );
      sheet.addRound(
        e.roundIndex,
        e.roundKind,
        ROUND_LABELS_NL[e.roundKind as KingenRoundKind],
        scores,
      );
    }
  }

  const end = events.find((e) => e.type === 'gameEnd');
  if (!end || end.type !== 'gameEnd') throw new Error('gameEnd-event ontbreekt');
  const totals = Array.from({ length: config.playerCount }, (_, i) => end.totals[i] ?? 0);

  // Aantal rondes en nulsom-controle.
  const roundEnds = events.filter((e) => e.type === 'roundEnd').length;
  assert.equal(roundEnds, params.totalRounds, 'Aantal gespeelde rondes klopt niet');
  assert.equal(sheet.getGrandTotal(), 0, 'Partijtotaal moet 0 zijn (nulsom)');
  assert.deepEqual(sheet.getTotals(), totals, 'ScoreSheet-totalen != engine-totalen');

  // Winnaarscontrole.
  const best = config.lowestWins ? Math.min(...totals) : Math.max(...totals);
  const expectWinners = totals.flatMap((t, i) => (t === best ? [i] : []));
  assert.deepEqual([...end.winners].sort(), expectWinners, 'Winnaars kloppen niet met de totalen');

  return { events, totals, sheet };
}

/** Controleer kleur bekennen door de events na te spelen (handen uit deal-events). */
function verifyFollowSuit(events: GameEvent[], seatCount: number): void {
  let hands: Map<number, Set<string>> = new Map();
  let suitOf: Map<string, string> = new Map();
  let trickPlays: { seat: Seat; cardId: string }[] = [];

  for (const e of events) {
    if (e.type === 'deal') {
      hands = new Map();
      suitOf = new Map();
      trickPlays = [];
      for (let s = 0; s < seatCount; s++) {
        const hand = e.hands[s as Seat] ?? [];
        hands.set(s, new Set(hand.map((c) => c.id)));
        for (const c of hand) suitOf.set(c.id, c.suit);
      }
    } else if (e.type === 'playCard') {
      const hand = hands.get(e.seat)!;
      assert.ok(hand.has(e.card.id), `Stoel ${e.seat} speelde ${e.card.id} zonder die te hebben`);
      if (trickPlays.length > 0) {
        const ledSuit = suitOf.get(trickPlays[0]!.cardId)!;
        const hasLed = [...hand].some((id) => suitOf.get(id) === ledSuit);
        assert.ok(
          !hasLed || e.card.suit === ledSuit,
          `Stoel ${e.seat} bekende geen kleur (${ledSuit}) maar speelde ${e.card.id}`,
        );
      }
      hand.delete(e.card.id);
      trickPlays.push({ seat: e.seat, cardId: e.card.id });
    } else if (e.type === 'trickWon') {
      trickPlays = [];
    }
  }
}

async function main(): Promise<void> {
  // ------------------------------------------------------------------
  // 1. Standaard NL-spel, 4 spelers (DEFAULT_VARIANT) — het hoofdscenario
  // ------------------------------------------------------------------
  {
    const { events, totals } = simulate(DEFAULT_VARIANT, 42);
    verifyFollowSuit(events, 4);
    // 6 negatieve rondes in vaste volgorde, daarna 4x troef met roterende kiezer.
    const kinds = events.filter((e) => e.type === 'roundStart').map((e) => e.roundKind);
    assert.deepEqual(kinds.slice(0, 6), DEFAULT_VARIANT.roundOrder);
    assert.deepEqual(kinds.slice(6), ['troef', 'troef', 'troef', 'troef']);
    const choosers = events.filter((e) => e.type === 'trumpChosen').map((e) => e.chooser);
    assert.equal(new Set(choosers).size, 4, 'Elke speler kiest precies één keer troef');
    console.log(`OK  standaard 4 spelers — eindstand [${totals.join(', ')}], som 0`);
  }

  // Determinisme: zelfde seed => identieke eventstroom.
  {
    const a = simulate(DEFAULT_VARIANT, 7);
    const b = simulate(DEFAULT_VARIANT, 7);
    assert.equal(JSON.stringify(a.events), JSON.stringify(b.events), 'Engine is niet deterministisch');
    console.log('OK  determinisme (zelfde seed => zelfde events)');
  }

  // ------------------------------------------------------------------
  // 2. 3 en 5 spelers (gestript deck, aangepaste telling)
  // ------------------------------------------------------------------
  for (const n of [3, 5] as const) {
    const config: KingenVariantConfig = { ...DEFAULT_VARIANT, playerCount: n };
    const { events, totals } = simulate(config, 1234 + n);
    verifyFollowSuit(events, n);
    const params = getTableParams(config);
    assert.equal(params.totalRounds, 6 + n);
    // Gestripte kaarten mogen nooit opduiken.
    for (const e of events) {
      if (e.type === 'playCard') {
        assert.ok(!params.removedCards.includes(e.card.id), `Gestripte kaart ${e.card.id} gespeeld`);
      }
    }
    console.log(`OK  ${n} spelers — ${params.totalRounds} rondes, eindstand [${totals.join(', ')}], som 0`);
  }

  // ------------------------------------------------------------------
  // 3. Dubbelkingen (vrije keuze door de deler, schrijver-administratie)
  // ------------------------------------------------------------------
  {
    const config: KingenVariantConfig = {
      ...DEFAULT_VARIANT,
      mode: 'dubbel',
      derdeGiftTroefdwang: true,
    };
    const { events, totals } = simulate(config, 99);
    verifyFollowSuit(events, 4);
    const chosen = events.filter((e) => e.type === 'roundKindChosen');
    assert.equal(chosen.length, 20, 'Dubbelkingen telt 20 rondes');
    for (const kind of NEGATIVE_ROUND_KINDS) {
      assert.equal(
        chosen.filter((e) => e.roundKind === kind).length,
        2,
        `Negatief spel '${kind}' moet precies 2x gekozen worden`,
      );
    }
    const trumpPerSeat = [0, 0, 0, 0];
    for (const e of chosen) {
      if (e.roundKind === 'troef') trumpPerSeat[e.chooser] = (trumpPerSeat[e.chooser] ?? 0) + 1;
    }
    assert.deepEqual(trumpPerSeat, [2, 2, 2, 2], 'Elke speler kiest precies 2x troef');
    console.log(`OK  dubbelkingen 4 spelers — 20 rondes, eindstand [${totals.join(', ')}], som 0`);
  }

  // ------------------------------------------------------------------
  // 4. Varianten: laatsteKaart-troef, lowestWins, claimen, ♥H=4, vrij afgooien
  // ------------------------------------------------------------------
  {
    const config: KingenVariantConfig = { ...DEFAULT_VARIANT, trumpSelection: 'laatsteKaart' };
    const { events } = simulate(config, 555);
    const trumps = events.filter((e) => e.type === 'trumpChosen');
    assert.equal(trumps.length, 4, 'Bij laatsteKaart wordt troef automatisch bepaald (4x)');
    console.log('OK  variant laatsteKaart-troefbepaling');
  }
  {
    const config: KingenVariantConfig = { ...DEFAULT_VARIANT, lowestWins: true };
    const { sheet } = simulate(config, 808);
    assert.equal(sheet.getGrandTotal(), 0);
    console.log('OK  variant lowestWins (omgekeerd teken, laagste wint)');
  }
  {
    const config: KingenVariantConfig = { ...DEFAULT_VARIANT, claimingAllowed: true };
    const { events } = simulate(config, 321);
    const claims = events.filter((e) => e.type === 'handClaimed');
    console.log(`OK  variant claimen — ${claims.length} claim(s), nulsom blijft intact`);
  }
  {
    const config: KingenVariantConfig = {
      ...DEFAULT_VARIANT,
      hartenheerPoints: 4,
      stopWhenKingFalls: false,
      discardRules: { geenHarten: false, geenHerenBoeren: false, geenDames: false, hartenheer: false },
      heartLeadBan: { geenHarten: false, hartenheer: false },
      mustTrump: false,
      mustOvertrump: false,
    };
    // ♥H = 4 breekt de 52-puntennulsom bewust; controleer alleen de rondesommen.
    const players = makePlayers(4);
    const rng = createRng(777);
    let state = def.createInitialState(players, config, 777);
    const events: GameEvent[] = [];
    while (!def.isFinished(state)) {
      const actor = def.currentActor(state)!;
      const moves = def.getLegalMoves(state, actor);
      const result = def.applyMove(state, actor, moves[Math.floor(rng() * moves.length)]!);
      state = result.state;
      events.push(...result.events);
    }
    const params = getTableParams(config);
    for (const e of events) {
      if (e.type === 'roundEnd') {
        const sum = Object.values(e.scores).reduce((a, b) => a + b, 0);
        assert.equal(sum, expectedRoundSum(e.roundKind, params, false));
      }
    }
    console.log('OK  variant vrij afgooien + ♥H=4 (rondesommen kloppen)');
  }

  // ------------------------------------------------------------------
  // 5. TurnManager + EventBus met inline random controllers (volledige loop)
  // ------------------------------------------------------------------
  {
    const rng = createRng(2024);
    const players = makePlayers(4);
    const controllers: PlayerController[] = players.map((config, seat) => ({
      seat: seat as Seat,
      config,
      chooseCard: async (view) => view.legalCards[Math.floor(rng() * view.legalCards.length)]!,
      chooseTrump: async () => (['hearts', 'diamonds', 'clubs', 'spades'] as Suit[])[Math.floor(rng() * 4)]!,
      chooseRoundKind: async (_view, available) => available[Math.floor(rng() * available.length)]!,
    }));
    const bus = createGameEventBus();
    const seen: string[] = [];
    bus.onAny((e) => seen.push(e.type));
    const tm = new TurnManager({
      definition: def,
      players,
      config: DEFAULT_VARIANT,
      controllers,
      bus,
      seed: 2024,
      afterEvent: async () => {}, // animatie-gate (no-op in test)
    });
    await tm.run();
    assert.equal(seen[0], 'gameStart');
    assert.equal(seen[seen.length - 1], 'gameEnd');
    assert.equal(seen.filter((t) => t === 'roundEnd').length, 10);
    assert.equal(tm.getCurrentActor(), null);
    console.log(`OK  TurnManager-loop — ${seen.length} events via de EventBus`);
  }

  console.log('\nAlle Kingen-engine-tests geslaagd.');
}

main().catch((err: unknown) => {
  console.error('TEST GEFAALD:', err);
  // Unhandled rejection => exitcode != 0 in moderne Node-versies.
  throw err;
});
