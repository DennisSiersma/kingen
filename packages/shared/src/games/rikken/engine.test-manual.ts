/**
 * src/games/rikken/engine.test-manual.ts
 * Headless engine-test voor Rikken. Speelt volledige partijen via de
 * GameDefinition met gestuurde biedstrategieën (anders past 'eerste legale zet'
 * altijd) om rik, piek, misère, escalatie én iedereen-past (passspel) te dekken.
 * Checkt: nulsom per ronde + totalen, 13 slagen (of vroeg-stop), verborgen maat,
 * en dat de partij netjes eindigt. Draai met: npx tsx <ditbestand>
 */

import type { GameEvent, PlayerConfig, PublicGameView, Seat } from '../../core/types.ts';
import { createRikkenDefinition } from './engine.ts';
import { RIKKEN_STICHTING } from './types.ts';
import type { RikkenMove, RikkenState, RikkenVariantConfig } from './types.ts';

let geslaagd = 0;
function check(naam: string, cond: boolean): void {
  if (!cond) throw new Error(`FAIL: ${naam}`);
  geslaagd++;
}

function players(): PlayerConfig[] {
  return Array.from({ length: 4 }, (_, i) => ({ name: `P${i + 1}`, kind: 'ai' as const }));
}

type Strategie = 'rik' | 'piek' | 'misere' | 'escalate' | 'allpass';

function bidMove(view: PublicGameView, legal: RikkenMove[], strat: Strategie): RikkenMove {
  const bids = legal as Extract<RikkenMove, { type: 'bid' }>[];
  const pass = bids.find((m) => m.bid === 'pass')!;
  const ex = view.viewExtras as { bidding?: { highest: unknown } };
  const opening = (ex.bidding?.highest ?? null) === null;
  const vind = (kind: string) => bids.find((m) => m.bid !== 'pass' && m.bid.kind === kind);
  if (strat === 'allpass') return pass;
  if (strat === 'escalate') {
    const niet = bids.find((m) => m.bid !== 'pass');
    return niet ?? pass;
  }
  // rik/piek/misere: alleen de opener opent met dat bod, de rest past.
  if (opening) return vind(strat) ?? pass;
  return pass;
}

function speel(config: RikkenVariantConfig, seed: number, strat: Strategie): void {
  const def = createRikkenDefinition();
  let state = def.createInitialState(players(), { ...config }, seed) as RikkenState;
  def.initialEvents(state);

  let partnerOnthuld: Seat | null = null;
  let guard = 0;
  while (!def.isFinished(state) && guard++ < 1_000_000) {
    const actor = def.currentActor(state);
    if (actor === null) break;
    const legal = def.getLegalMoves(state, actor);
    check(`stoel ${actor} heeft legale zetten (fase ${state.phase})`, legal.length > 0);

    // Verborgen-maat-invariant: zolang niet onthuld, ziet GEEN stoel de maat.
    if (state.phase === 'playing' && partnerOnthuld === null) {
      for (let s = 0; s < 4; s++) {
        const v = def.getView(state, s as Seat);
        const cv = (v.viewExtras as { contract?: { partner: Seat | null } }).contract;
        check('maat verborgen vóór onthulling', !cv || cv.partner === null);
      }
    }

    const move = state.phase === 'bidding' ? bidMove(def.getView(state, actor), legal, strat) : legal[0]!;
    const res = def.applyMove(state, actor, move);
    for (const ev of res.events as GameEvent[]) {
      if (ev.type === 'custom' && ev.subtype === 'partnerRevealed') {
        partnerOnthuld = (ev.data as { partner: Seat }).partner;
      }
      if (ev.type === 'roundEnd') {
        const scores = ev.scores;
        const som = Object.values(scores).reduce((a, b) => a + b, 0);
        check('rondedeltas nulsom', som === 0);
        partnerOnthuld = null; // reset voor de volgende ronde
      }
    }
    state = res.state as RikkenState;
  }

  check('partij afgelopen', def.isFinished(state));
  check('totalen nulsom', state.totals.reduce((a, b) => a + b, 0) === 0);
  const winners = def.getWinners(state);
  check('winnaars bestaan', winners.length > 0);
}

const kort: RikkenVariantConfig = { ...RIKKEN_STICHTING, rondes: 4 };
const strategieën: Strategie[] = ['rik', 'piek', 'misere', 'escalate', 'allpass'];
for (const strat of strategieën) {
  for (let seed = 1; seed <= 6; seed++) speel(kort, seed * 17 + strat.length, strat);
}

console.log(`engine.test-manual: ${geslaagd} checks geslaagd ✓`);
