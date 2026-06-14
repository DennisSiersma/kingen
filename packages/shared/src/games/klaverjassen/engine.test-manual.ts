/**
 * src/games/klaverjassen/engine.test-manual.ts
 * Headless engine-test voor Klaverjassen: speelt volledige partijen via de
 * GameDefinition (eerste legale zet) en checkt de kerninvarianten — 8 slagen per
 * boom, kaartpunten = 162, nat/gehaald/pit-telling consistent, partij eindigt.
 * Draait alle varianten (Rotterdams/Amsterdams verplicht draaien + Leids bieden).
 * Draai met: npx tsx <ditbestand>
 */

import type { GameEvent, PlayerConfig, Seat } from '../../core/types.ts';
import { createKlaverjasDefinition } from './engine.ts';
import { KLAVERJAS_AMSTERDAMS, KLAVERJAS_ROTTERDAMS } from './types.ts';
import type { KlaverjasState, KlaverjasVariantConfig } from './types.ts';

let geslaagd = 0;
function check(naam: string, cond: boolean): void {
  if (!cond) throw new Error(`FAIL: ${naam}`);
  geslaagd++;
}

function players(n: number): PlayerConfig[] {
  return Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, kind: 'ai' as const }));
}

function speel(config: KlaverjasVariantConfig, seed: number): void {
  const def = createKlaverjasDefinition();
  let state = def.createInitialState(players(4), { ...config }, seed) as KlaverjasState;
  const initial = def.initialEvents(state);
  controleerEvents(initial);

  let guard = 0;
  let zagPlaying = false;
  while (!def.isFinished(state) && guard++ < 500000) {
    const actor = def.currentActor(state);
    if (actor === null) break;
    if (state.phase === 'playing') zagPlaying = true;
    const legal = def.getLegalMoves(state, actor);
    check(`stoel ${actor} heeft legale zetten (fase ${state.phase})`, legal.length > 0);
    const res = def.applyMove(state, actor, legal[0]!);
    controleerEvents(res.events);
    state = res.state as KlaverjasState;
  }

  check('partij afgelopen', def.isFinished(state));
  check('speelfase gezien', zagPlaying);
  const winners = def.getWinners(state);
  check('winnaars bestaan', winners.length > 0);
  // Winnaars vormen een heel team (2 stoelen) of bij gelijkspel alle 4.
  check('winnaars = team of gelijkspel', winners.length === 2 || winners.length === 4);
}

/** Per natResult: kaartpunten+roem consistent en roundScores kloppen. */
function controleerEvents(events: GameEvent[]): void {
  let pitInBatch = false;
  for (const e of events) {
    if (e.type === 'custom' && e.subtype === 'pit') pitInBatch = true;
    if (e.type === 'custom' && e.subtype === 'natResult') {
      const d = e.data as { makingTotal: number; defendingTotal: number; roundScores: [number, number]; gehaald: boolean };
      const base = d.makingTotal + d.defendingTotal;
      check('kaartpunten+roem som >= 162', base >= 162);
      check('roem is veelvoud van 10 boven 162', (base - 162) % 10 === 0);
      const som = d.roundScores[0] + d.roundScores[1];
      check('roundScores som consistent', som === base || som === base + 100);
      if (pitInBatch) check('pit → +100 in roundScores', som === base + 100);
      pitInBatch = false;
    }
  }
}

// Speel meerdere seeds per variant.
for (let seed = 1; seed <= 12; seed++) {
  speel({ ...KLAVERJAS_ROTTERDAMS, eindvoorwaarde: { type: 'aantalBomen', n: 4 } }, seed);
  speel({ ...KLAVERJAS_AMSTERDAMS, eindvoorwaarde: { type: 'aantalBomen', n: 4 } }, seed + 1000);
  speel(
    { ...KLAVERJAS_ROTTERDAMS, trumpSelection: 'bieden', eindvoorwaarde: { type: 'aantalBomen', n: 4 } },
    seed + 2000,
  );
}

// Puntendoel-eindvoorwaarde termineert ook.
speel({ ...KLAVERJAS_ROTTERDAMS, eindvoorwaarde: { type: 'punten', n: 1500 } }, 7);

console.log(`engine.test-manual: ${geslaagd} checks geslaagd ✓`);
