/**
 * src/games/regenwormen/engine.ts
 * Regenwormen-GameDefinition. UI-loos en deterministisch (seedbare worpen).
 * applyMove muteert de input-state nooit (kloont eerst). Eén actieve speler per
 * beurt gooit, legt per worp álle stenen van één nieuwe waarde apart en kiest
 * doorgooien of een tegel pakken (centrum ≤ som, of een tegenstander-top met
 * exact de som stelen). Mislukken = toptegel terug + hoogste centrumtegel eruit.
 * Het spel eindigt als het midden leeg is; de meeste wormen wint.
 */

import type { GameEvent, PlayerConfig, PublicGameView, Seat } from '../../core/types.ts';
import { createRng } from '../../core/deck.ts';
import { rollDice } from '../dice/dice.ts';
import { ALL_TILES, hasWorm, sumPips, takeOptions, wormTotal } from './scoring.ts';
import { regenwormenLegalMoves, reservableValues } from './rules.ts';
import type {
  RegenwormenDefinition, RegenwormenMove, RegenwormenState, RegenwormenVariantConfig,
} from './types.ts';

const ROLL_SALT = 7919;
const DICE_COUNT = 8;

function toRecord(values: readonly number[]): Record<number, number> {
  const out: Record<number, number> = {};
  values.forEach((v, i) => (out[i] = v));
  return out;
}

/** Gooi `count` stenen (oog 6 = worm), oplopend gesorteerd voor nette weergave. */
function rollN(state: RegenwormenState, count: number): number[] {
  const rng = createRng((state.seed + state.rollSeq * ROLL_SALT) >>> 0);
  state.rollSeq += 1;
  return rollDice(rng, count).sort((a, b) => a - b);
}

function turnEvent(seat: Seat, phase: string): GameEvent {
  return { type: 'custom', subtype: 'turn', data: { seat, phase } };
}

function diceEvent(state: RegenwormenState): GameEvent {
  return {
    type: 'custom',
    subtype: 'rwDice',
    data: {
      seat: state.active,
      reserved: state.reserved.slice(),
      loose: state.loose.slice(),
      sum: sumPips(state.reserved),
      hasWorm: hasWorm(state.reserved),
    },
  };
}

function computeWinners(state: RegenwormenState): Seat[] {
  const max = Math.max(...state.totals);
  const winners: Seat[] = [];
  state.totals.forEach((t, s) => {
    if (t === max) winners.push(s as Seat);
  });
  return winners;
}

/** Begin een verse beurt voor de huidige actieve speler ('rolling'). */
function beginTurn(state: RegenwormenState): GameEvent[] {
  state.reserved = [];
  state.loose = [];
  state.usedValues = [];
  state.phase = 'rolling';
  state.turn = state.active;
  return [turnEvent(state.active, 'rolling')];
}

/** Beëindig de beurt: leeg midden → partij voorbij, anders de volgende speler. */
function endTurnOrGame(state: RegenwormenState): GameEvent[] {
  if (state.center.length === 0) {
    state.phase = 'finished';
    state.turn = null;
    return [{ type: 'gameEnd', winners: computeWinners(state), totals: toRecord(state.totals) }];
  }
  state.active = ((state.active + 1) % state.seatCount) as Seat;
  return beginTurn(state);
}

/** Mislukken: toptegel terug naar het midden, hoogste centrumtegel uit het spel. */
function bust(state: RegenwormenState): GameEvent[] {
  const seat = state.active;
  const events: GameEvent[] = [
    { type: 'custom', subtype: 'rwBust', data: { seat, reserved: state.reserved.slice(), sum: sumPips(state.reserved) } },
  ];

  let returned: number | null = null;
  if (state.stacks[seat]!.length > 0) {
    returned = state.stacks[seat]!.pop()!;
    state.center.push(returned);
    state.center.sort((a, b) => a - b);
    state.totals[seat] = wormTotal(state.stacks[seat]!);
  }
  let flipped: number | null = null;
  if (state.center.length > 0) {
    flipped = Math.max(...state.center);
    state.center = state.center.filter((t) => t !== flipped);
  }

  events.push({ type: 'custom', subtype: 'rwTiles', data: { returned, flipped, center: state.center.slice() } });
  if (returned !== null) events.push({ type: 'scoreUpdate', totals: toRecord(state.totals) });
  events.push(...endTurnOrGame(state));
  return events;
}

/** Gooi de resterende stenen; geen nieuwe waarde mogelijk → bust, anders 'deciding'. */
function rollRemaining(state: RegenwormenState): GameEvent[] {
  const fresh = rollN(state, DICE_COUNT - state.reserved.length);
  state.loose = fresh;
  if (reservableValues(fresh, state.usedValues).length === 0) {
    return [diceEvent(state), ...bust(state)];
  }
  state.phase = 'deciding';
  return [diceEvent(state), turnEvent(state.active, 'deciding')];
}

export function createRegenwormenDefinition(): RegenwormenDefinition {
  return {
    id: 'regenwormen',
    naam: 'Regenwormen',
    minPlayers: 1,
    maxPlayers: 7,

    createInitialState(players: PlayerConfig[], config: RegenwormenVariantConfig, seed?: number): RegenwormenState {
      if (players.length !== config.playerCount) {
        throw new Error(`Aantal spelers (${players.length}) komt niet overeen met de variant (${config.playerCount})`);
      }
      const n = config.playerCount;
      return {
        config: structuredClone(config),
        players: structuredClone(players),
        seatCount: n,
        seed: (seed ?? Math.floor(Math.random() * 0x7fffffff)) >>> 0,
        phase: 'rolling',
        rollSeq: 0,
        active: 0 as Seat,
        reserved: [],
        loose: [],
        usedValues: [],
        center: ALL_TILES.slice(),
        stacks: Array.from({ length: n }, () => [] as number[]),
        turn: 0 as Seat,
        totals: new Array<number>(n).fill(0),
      };
    },

    initialEvents(state: RegenwormenState): GameEvent[] {
      return [
        { type: 'gameStart', gameId: `regenwormen-${state.seed}`, players: structuredClone(state.players), seatCount: state.seatCount },
        { type: 'roundStart', roundIndex: 0, roundKind: 'regenwormen', roundLabel: '', dealer: state.active },
        turnEvent(state.active, 'rolling'),
      ];
    },

    getView(state: RegenwormenState, seat: Seat): PublicGameView {
      const sum = sumPips(state.reserved);
      const remaining = DICE_COUNT - state.reserved.length;
      const tops = state.stacks.map((st) => (st.length > 0 ? st[st.length - 1]! : null));
      return {
        seat,
        seatCount: state.seatCount,
        hand: [],
        handSizes: state.stacks.map((st) => st.length),
        round: { index: 0, kind: 'regenwormen', label: '', dealer: state.active, trump: null },
        totalRounds: 0,
        turn: state.turn,
        totals: state.totals.slice(),
        scoresPerRound: [],
        playerNames: state.players.map((p) => p.name),
        legalCards: [],
        legalMoves: regenwormenLegalMoves(state, seat),
        viewExtras: {
          phase: state.phase,
          active: state.active,
          reserved: state.reserved.slice(),
          loose: state.loose.slice(),
          usedValues: state.usedValues.slice(),
          sum,
          remaining,
          hasWorm: hasWorm(state.reserved),
          center: state.center.slice(),
          tops,
          takeable: state.phase === 'choosing' && hasWorm(state.reserved) && sum >= 21
            ? takeOptions(sum, state.center, state.stacks, state.active)
            : [],
          totals: state.totals.slice(),
        },
      };
    },

    getLegalMoves(state: RegenwormenState, seat: Seat): RegenwormenMove[] {
      return regenwormenLegalMoves(state, seat);
    },

    applyMove(state: RegenwormenState, seat: Seat, move: RegenwormenMove) {
      const next = structuredClone(state);
      if (next.phase === 'finished') throw new Error('De partij is afgelopen');
      if (seat !== next.active) throw new Error(`Stoel ${seat} is niet aan de beurt`);

      let events: GameEvent[];
      switch (move.type) {
        case 'roll': {
          if (next.phase !== 'rolling' && next.phase !== 'choosing') throw new Error('Er kan nu niet gegooid worden');
          if (DICE_COUNT - next.reserved.length <= 0) throw new Error('Geen stenen meer om te gooien');
          events = rollRemaining(next);
          break;
        }
        case 'reserve': {
          if (next.phase !== 'deciding') throw new Error('Er is nog niet gegooid');
          if (!next.loose.includes(move.value)) throw new Error('Die waarde ligt er niet');
          if (next.usedValues.includes(move.value)) throw new Error('Die waarde is deze beurt al vastgelegd');
          const taken = next.loose.filter((d) => d === move.value);
          next.reserved.push(...taken);
          next.usedValues.push(move.value);
          next.loose = [];

          const sum = sumPips(next.reserved);
          const remaining = DICE_COUNT - next.reserved.length;
          const canTake = hasWorm(next.reserved) && sum >= 21 && takeOptions(sum, next.center, next.stacks, seat).length > 0;
          const canContinue = remaining > 0;
          if (!canTake && !canContinue) {
            events = [diceEvent(next), ...bust(next)];
          } else {
            next.phase = 'choosing';
            events = [diceEvent(next), turnEvent(next.active, 'choosing')];
          }
          break;
        }
        case 'take': {
          if (next.phase !== 'choosing') throw new Error('Je kunt nu geen tegel pakken');
          const sum = sumPips(next.reserved);
          if (!hasWorm(next.reserved)) throw new Error('Je hebt geen worm vastgelegd');
          if (sum < 21) throw new Error('Je som is lager dan 21');
          const ok = takeOptions(sum, next.center, next.stacks, seat).some((o) => o.tile === move.tile && o.from === move.from);
          if (!ok) throw new Error('Die tegel kun je niet pakken');

          if (move.from === 'center') {
            next.center = next.center.filter((t) => t !== move.tile);
          } else {
            const st = next.stacks[move.from as number]!;
            st.pop();
            next.totals[move.from as number] = wormTotal(st);
          }
          next.stacks[seat]!.push(move.tile);
          next.totals[seat] = wormTotal(next.stacks[seat]!);

          events = [
            { type: 'custom', subtype: 'rwTake', data: { seat, tile: move.tile, from: move.from, sum } },
            { type: 'scoreUpdate', totals: toRecord(next.totals) },
          ];
          events.push(...endTurnOrGame(next));
          break;
        }
        default:
          throw new Error(`Onbekend zet-type: ${(move as { type: string }).type}`);
      }
      return { state: next, events };
    },

    currentActor(state: RegenwormenState): Seat | null {
      return state.phase === 'finished' ? null : state.active;
    },

    isFinished(state: RegenwormenState): boolean {
      return state.phase === 'finished';
    },

    getWinners(state: RegenwormenState): Seat[] {
      if (state.phase !== 'finished') throw new Error('De partij is nog niet afgelopen');
      return computeWinners(state);
    },
  };
}
