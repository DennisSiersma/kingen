/**
 * src/games/toepen/ai.test-manual.ts
 * Meet de speelsterkte van ToepenAi tegen een baseline ("altijd de eerste legale
 * zet" = de generieke fallback: speelt kaarten, toept nooit, gaat altijd mee).
 * Stoel 0 = ToepenAi (moeilijk), stoelen 1-3 = baseline. Een eerlijke verdeling
 * zou 25% winst zijn; de AI moet daar duidelijk boven zitten. Draai met: npx tsx
 */

import type { PlayerConfig, Seat } from '../../core/types.ts';
import { createToepenDefinition } from './engine.ts';
import { ToepenAi } from './ai.ts';
import { TOEPEN_STANDAARD } from './types.ts';
import type { ToepenMove, ToepenState } from './types.ts';

const def = createToepenDefinition();

function players(n: number): PlayerConfig[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `P${i}`,
    kind: 'ai' as const,
    aiDifficulty: i === 0 ? ('moeilijk' as const) : ('gemiddeld' as const),
  }));
}

/** Baseline: altijd de eerste legale zet (= generieke fallback). */
function baselineMove(moves: ToepenMove[]): ToepenMove {
  return moves[0]!;
}

async function speel(seed: number): Promise<Seat> {
  const ps = players(4);
  const ai = new ToepenAi(0 as Seat, ps[0]!, { ...TOEPEN_STANDAARD, playerCount: 4 }, [0, 0]);
  let state = def.createInitialState(ps, { ...TOEPEN_STANDAARD, maxStrafpunten: 10, playerCount: 4 }, seed) as ToepenState;
  let stappen = 0;
  while (!def.isFinished(state) && stappen < 100000) {
    const actor = def.currentActor(state);
    if (actor === null) break;
    const legal = def.getLegalMoves(state, actor) as ToepenMove[];
    const view = def.getView(state, actor);
    const move = actor === 0 ? ((await ai.chooseMove(view, legal)) as ToepenMove) : baselineMove(legal);
    state = def.applyMove(state, actor, move).state as ToepenState;
    stappen++;
  }
  return def.getWinners(state)[0]!;
}

async function main(): Promise<void> {
  const N = 200;
  let wins = 0;
  for (let seed = 1; seed <= N; seed++) {
    if ((await speel(seed)) === 0) wins++;
  }
  const pct = (wins / N) * 100;
  console.log(`ToepenAi (stoel 0) won ${wins}/${N} = ${pct.toFixed(1)}% (eerlijke verdeling = 25%)`);
  if (pct <= 30) throw new Error(`FAAL: AI niet duidelijk beter dan baseline (${pct.toFixed(1)}%)`);
  console.log('OK — ToepenAi verslaat de baseline ruim');
}

await main();
