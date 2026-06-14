/**
 * src/games/klaverjassen/ai.test-manual.ts
 * Meet de speelsterkte van KlaverjasAi: team Wij (stoelen 0+2 = KlaverjasAi)
 * tegen team Zij (stoelen 1+3 = first-legal baseline) over veel partijen. Het
 * deelrecht roteert, dus beide teams zijn even vaak het spelende team — eerlijk.
 * Verwacht dat de AI duidelijk vaker wint en gemiddeld meer punt scoort.
 * Draai met: npx tsx <ditbestand>
 */

import type { PlayerConfig, PublicGameView, Seat } from '../../core/types.ts';
import { createKlaverjasDefinition } from './engine.ts';
import { KlaverjasAi } from './ai.ts';
import { KLAVERJAS_ROTTERDAMS } from './types.ts';
import type { KlaverjasState, KlaverjasVariantConfig } from './types.ts';

function players(): PlayerConfig[] {
  return Array.from({ length: 4 }, (_, i) => ({ name: `P${i + 1}`, kind: 'ai' as const }));
}

async function speelPartij(config: KlaverjasVariantConfig, seed: number): Promise<[number, number]> {
  const def = createKlaverjasDefinition();
  let state = def.createInitialState(players(), { ...config }, seed) as KlaverjasState;
  def.initialEvents(state);
  // KlaverjasAi op stoel 0 en 2 (team Wij). Stoelen 1/3 = first-legal baseline.
  const ais = new Map<Seat, KlaverjasAi>();
  for (const s of [0, 2] as Seat[]) ais.set(s, new KlaverjasAi(s, players()[s]!, config, [0, 0]));

  let guard = 0;
  while (!def.isFinished(state) && guard++ < 1_000_000) {
    const actor = def.currentActor(state);
    if (actor === null) break;
    const legal = def.getLegalMoves(state, actor);
    if (legal.length === 0) break;
    let move = legal[0]!;
    const ai = ais.get(actor);
    if (ai) {
      const view: PublicGameView = def.getView(state, actor);
      move = (await ai.chooseMove(view, legal)) as typeof move;
    }
    state = def.applyMove(state, actor, move).state as KlaverjasState;
  }
  return [state.teamTotals[0], state.teamTotals[1]];
}

async function main(): Promise<void> {
  const config: KlaverjasVariantConfig = { ...KLAVERJAS_ROTTERDAMS, eindvoorwaarde: { type: 'aantalBomen', n: 8 } };
  const PARTIJEN = 120;
  let wijWint = 0;
  let zijWint = 0;
  let gelijk = 0;
  let somWij = 0;
  let somZij = 0;
  for (let i = 0; i < PARTIJEN; i++) {
    const [wij, zij] = await speelPartij(config, 1000 + i * 31);
    somWij += wij;
    somZij += zij;
    if (wij > zij) wijWint++;
    else if (zij > wij) zijWint++;
    else gelijk++;
  }
  const winPct = (100 * wijWint) / PARTIJEN;
  console.log(`ai.test-manual: ${PARTIJEN} partijen (8 bomen elk)`);
  console.log(`    AI (Wij) wint ${wijWint} (${winPct.toFixed(1)}%), baseline (Zij) ${zijWint}, gelijk ${gelijk}`);
  console.log(`    gem. score Wij ${(somWij / PARTIJEN).toFixed(0)} vs Zij ${(somZij / PARTIJEN).toFixed(0)}`);

  if (winPct < 70) throw new Error(`AI te zwak: wint maar ${winPct.toFixed(1)}% (verwacht >=70%)`);
  if (somWij <= somZij) throw new Error('AI scoort gemiddeld niet hoger dan de baseline');
  console.log('OK  AI duidelijk sterker dan de baseline ✓');
}

await main();
