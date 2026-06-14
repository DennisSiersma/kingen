/**
 * src/games/rikken/ai.test-manual.ts
 * Meet de speelsterkte van RikkenAi met VIER RikkenAi's aan tafel (de allianties
 * in Rikken zijn dynamisch — de maat hangt van de gevraagde aas af, niet van de
 * stoel — dus een vast "team" meten is misleidend). Een conservatieve, competente
 * AI moet de contracten die hij biedt vaker halen dan missen. Draai met: npx tsx
 */

import type { GameEvent, PlayerConfig, Seat } from '../../core/types.ts';
import { createRikkenDefinition } from './engine.ts';
import { RikkenAi } from './ai.ts';
import { RIKKEN_STICHTING } from './types.ts';
import type { RikkenMove, RikkenState, RikkenVariantConfig } from './types.ts';

function players(): PlayerConfig[] {
  return Array.from({ length: 4 }, (_, i) => ({ name: `P${i + 1}`, kind: 'ai' as const }));
}

interface Stat {
  rondes: number;
  contracten: number;
  gehaald: number;
  passspel: number;
}

async function speel(config: RikkenVariantConfig, seed: number, stat: Stat): Promise<void> {
  const def = createRikkenDefinition();
  let state = def.createInitialState(players(), { ...config }, seed) as RikkenState;
  def.initialEvents(state);
  const ais = new Map<Seat, RikkenAi>();
  for (const s of [0, 1, 2, 3] as Seat[]) ais.set(s, new RikkenAi(s, players()[s]!, config, [0, 0]));

  let guard = 0;
  while (!def.isFinished(state) && guard++ < 1_000_000) {
    const actor = def.currentActor(state);
    if (actor === null) break;
    const legal = def.getLegalMoves(state, actor);
    if (legal.length === 0) break;
    const move = (await ais.get(actor)!.chooseMove(def.getView(state, actor), legal)) as RikkenMove;
    const res = def.applyMove(state, actor, move);
    for (const ev of res.events as GameEvent[]) {
      if (ev.type === 'custom' && ev.subtype === 'contractResolved') {
        const d = ev.data as { declarer: Seat; passGame?: string; deltas: number[] };
        stat.rondes++;
        if (d.passGame) {
          stat.passspel++;
        } else {
          stat.contracten++;
          if ((d.deltas[d.declarer] ?? 0) > 0) stat.gehaald++;
        }
      }
    }
    state = res.state as RikkenState;
  }
}

async function main(): Promise<void> {
  const config: RikkenVariantConfig = { ...RIKKEN_STICHTING, rondes: 8 };
  const stat: Stat = { rondes: 0, contracten: 0, gehaald: 0, passspel: 0 };
  const PARTIJEN = 60;
  for (let i = 0; i < PARTIJEN; i++) await speel(config, 1000 + i * 53, stat);

  const haalPct = stat.contracten > 0 ? (100 * stat.gehaald) / stat.contracten : 0;
  console.log(`ai.test-manual: ${PARTIJEN} partijen × 8 rondes (4× RikkenAi)`);
  console.log(`    ${stat.contracten} contracten geboden, ${stat.gehaald} gehaald (${haalPct.toFixed(0)}%), ${stat.passspel} passspellen`);

  if (stat.contracten < PARTIJEN) throw new Error(`Te weinig contracten geboden: ${stat.contracten}`);
  if (haalPct < 55) throw new Error(`Geboden contracten te vaak nat: ${haalPct.toFixed(0)}% gehaald`);
  console.log('OK  RikkenAi biedt conservatief en haalt de meeste contracten ✓');
}

await main();
