/**
 * src/games/fritzen/engine.ts
 * Fritzen-GameDefinition. UI-loos en deterministisch (seedbare worpen).
 * applyMove muteert de input-state nooit (kloont eerst). Eén actieve speler per
 * beurt: gooit, legt telkens ≥1 steen vast en gooit de rest opnieuw (max. 5x),
 * stopt zelf. Punten via scoring.ts; na N rondes wint het hoogste totaal.
 */

import type { GameEvent, PlayerConfig, PublicGameView, Seat } from '../../core/types.ts';
import { createRng } from '../../core/deck.ts';
import { rollDice } from '../dice/dice.ts';
import { fritzenPoints } from './scoring.ts';
import { fritzenLegalMoves } from './rules.ts';
import type { FritzenDefinition, FritzenMove, FritzenState, FritzenVariantConfig } from './types.ts';

const ROLL_SALT = 7919;

function toRecord(values: readonly number[]): Record<number, number> {
  const out: Record<number, number> = {};
  values.forEach((v, i) => (out[i] = v));
  return out;
}

function sum(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

/** Verwijder elke waarde uit `vals` één keer uit `arr` (kopie terug). */
function removeValues(arr: readonly number[], vals: readonly number[]): number[] {
  const out = arr.slice();
  for (const v of vals) {
    const i = out.indexOf(v);
    if (i >= 0) out.splice(i, 1);
  }
  return out;
}

/** Is `vals` een deel-multiset van `pool`? */
function isSubMultiset(vals: readonly number[], pool: readonly number[]): boolean {
  const tmp = pool.slice();
  for (const v of vals) {
    const i = tmp.indexOf(v);
    if (i < 0) return false;
    tmp.splice(i, 1);
  }
  return true;
}

function rollN(state: FritzenState, count: number): number[] {
  const rng = createRng((state.seed + state.rollSeq * ROLL_SALT) >>> 0);
  state.rollSeq += 1;
  return rollDice(rng, count);
}

function turnEvent(seat: Seat, phase: string): GameEvent {
  return { type: 'custom', subtype: 'turn', data: { seat, phase } };
}

function rolledEvent(state: FritzenState): GameEvent {
  return {
    type: 'custom',
    subtype: 'fritzenRolled',
    data: { seat: state.active, locked: state.locked.slice(), loose: state.loose.slice(), rollsUsed: state.rollsUsed },
  };
}

function computeWinners(state: FritzenState): Seat[] {
  const max = Math.max(...state.totals);
  const winners: Seat[] = [];
  state.totals.forEach((t, s) => {
    if (t === max) winners.push(s as Seat);
  });
  return winners;
}

/** Rond de beurt af: tel punten, werk totalen bij, ga naar de volgende speler/ronde. */
function endTurn(state: FritzenState): GameEvent[] {
  const events: GameEvent[] = [];
  const seat = state.active;
  const total = sum(state.locked) + sum(state.loose);
  const punten = fritzenPoints(total);
  state.totals[seat] = (state.totals[seat] ?? 0) + punten;
  if (!state.scoresPerRound[state.roundIndex]) state.scoresPerRound[state.roundIndex] = new Array<number>(state.seatCount).fill(0);
  state.scoresPerRound[state.roundIndex]![seat] = punten;

  events.push({
    type: 'custom',
    subtype: 'fritzenResult',
    data: { seat, total, points: punten, dice: [...state.locked, ...state.loose] },
  });
  events.push({ type: 'scoreUpdate', totals: toRecord(state.totals) });

  state.turnsThisRound += 1;
  if (state.turnsThisRound >= state.seatCount) {
    events.push({ type: 'roundEnd', roundIndex: state.roundIndex, roundKind: 'fritzen', scores: toRecord(state.scoresPerRound[state.roundIndex]!) });
    state.roundIndex += 1;
    state.turnsThisRound = 0;
  }

  if (state.roundIndex >= state.config.rounds) {
    state.phase = 'finished';
    state.turn = null;
    events.push({ type: 'gameEnd', winners: computeWinners(state), totals: toRecord(state.totals) });
    return events;
  }

  state.active = ((seat + 1) % state.seatCount) as Seat;
  state.locked = [];
  state.loose = [];
  state.rollsUsed = 0;
  state.phase = 'rolling';
  state.turn = state.active;
  if (state.turnsThisRound === 0 && state.scoresPerRound[state.roundIndex] === undefined) {
    events.push({ type: 'roundStart', roundIndex: state.roundIndex, roundKind: 'fritzen', roundLabel: '', dealer: state.active });
  }
  events.push(turnEvent(state.active, 'rolling'));
  return events;
}

export function createFritzenDefinition(): FritzenDefinition {
  return {
    id: 'fritzen',
    naam: 'Fritzen',
    minPlayers: 2,
    maxPlayers: 8,

    createInitialState(players: PlayerConfig[], config: FritzenVariantConfig, seed?: number): FritzenState {
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
        roundIndex: 0,
        turnsThisRound: 0,
        active: 0 as Seat,
        locked: [],
        loose: [],
        rollsUsed: 0,
        turn: 0 as Seat,
        totals: new Array<number>(n).fill(0),
        scoresPerRound: [],
      };
    },

    initialEvents(state: FritzenState): GameEvent[] {
      return [
        { type: 'gameStart', gameId: `fritzen-${state.seed}`, players: structuredClone(state.players), seatCount: state.seatCount },
        { type: 'roundStart', roundIndex: 0, roundKind: 'fritzen', roundLabel: '', dealer: state.active },
        turnEvent(state.active, 'rolling'),
      ];
    },

    getView(state: FritzenState, seat: Seat): PublicGameView {
      return {
        seat,
        seatCount: state.seatCount,
        hand: [],
        handSizes: new Array<number>(state.seatCount).fill(0),
        round: { index: state.roundIndex, kind: 'fritzen', label: '', dealer: state.active, trump: null },
        totalRounds: state.config.rounds,
        turn: state.turn,
        totals: state.totals.slice(),
        scoresPerRound: state.scoresPerRound.map((r) => r.slice()),
        playerNames: state.players.map((p) => p.name),
        legalCards: [],
        legalMoves: fritzenLegalMoves(state, seat),
        viewExtras: {
          phase: state.phase,
          active: state.active,
          locked: state.locked.slice(),
          loose: state.loose.slice(),
          rollsUsed: state.rollsUsed,
          maxRolls: state.config.maxRolls,
          total: sum(state.locked) + sum(state.loose),
        },
      };
    },

    getLegalMoves(state: FritzenState, seat: Seat): FritzenMove[] {
      return fritzenLegalMoves(state, seat);
    },

    applyMove(state: FritzenState, seat: Seat, move: FritzenMove) {
      const next = structuredClone(state);
      if (next.phase === 'finished') throw new Error('De partij is afgelopen');
      if (seat !== next.active) throw new Error(`Stoel ${seat} is niet aan de beurt`);

      let events: GameEvent[];
      switch (move.type) {
        case 'roll': {
          if (next.phase !== 'rolling') throw new Error('Er kan nu niet gegooid worden');
          next.loose = rollN(next, 6);
          next.rollsUsed = 1;
          next.phase = 'deciding';
          events = [rolledEvent(next), turnEvent(next.active, 'deciding')];
          break;
        }
        case 'keep': {
          if (next.phase !== 'deciding') throw new Error('Er kan nu niets vastgelegd worden');
          if (move.values.length === 0) throw new Error('Leg minstens één steen vast');
          if (!isSubMultiset(move.values, next.loose)) throw new Error('Die stenen liggen niet los');
          next.locked.push(...move.values);
          next.loose = removeValues(next.loose, move.values);
          const kanHerwerpen = next.rollsUsed < next.config.maxRolls && next.loose.length > 0;
          if (move.stop || !kanHerwerpen) {
            events = endTurn(next);
          } else {
            next.loose = rollN(next, next.loose.length);
            next.rollsUsed += 1;
            events = [rolledEvent(next), turnEvent(next.active, 'deciding')];
          }
          break;
        }
        default:
          throw new Error(`Onbekend zet-type: ${(move as { type: string }).type}`);
      }
      return { state: next, events };
    },

    currentActor(state: FritzenState): Seat | null {
      return state.phase === 'finished' ? null : state.active;
    },

    isFinished(state: FritzenState): boolean {
      return state.phase === 'finished';
    },

    getWinners(state: FritzenState): Seat[] {
      if (state.phase !== 'finished') throw new Error('De partij is nog niet afgelopen');
      return computeWinners(state);
    },
  };
}
