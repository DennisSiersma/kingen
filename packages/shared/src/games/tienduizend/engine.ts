/**
 * src/games/tienduizend/engine.ts
 * Tienduizend-GameDefinition. UI-loos en deterministisch (seedbare worpen).
 * applyMove muteert de input-state nooit (kloont eerst). Eén actieve speler per
 * beurt gooit, legt scorende stenen apart en kiest banken of doorgooien; een
 * worp zonder score is een bust (pot kwijt). Eerste naar de doelscore start de
 * slotronde (iedereen nog één beurt); hoogste totaal wint.
 */

import type { GameEvent, PlayerConfig, PublicGameView, Seat } from '../../core/types.ts';
import { createRng } from '../../core/deck.ts';
import { rollDice } from '../dice/dice.ts';
import { hasAnyScore, scoreDice } from './scoring.ts';
import { tienduizendLegalMoves } from './rules.ts';
import type {
  TienduizendDefinition, TienduizendMove, TienduizendState, TienduizendVariantConfig,
} from './types.ts';

const ROLL_SALT = 7919;

function toRecord(values: readonly number[]): Record<number, number> {
  const out: Record<number, number> = {};
  values.forEach((v, i) => (out[i] = v));
  return out;
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

function rollN(state: TienduizendState, count: number): number[] {
  const rng = createRng((state.seed + state.rollSeq * ROLL_SALT) >>> 0);
  state.rollSeq += 1;
  return rollDice(rng, count).sort((a, b) => a - b);
}

function turnEvent(seat: Seat, phase: string): GameEvent {
  return { type: 'custom', subtype: 'turn', data: { seat, phase } };
}

function rolledEvent(state: TienduizendState, hotDice: boolean): GameEvent {
  return {
    type: 'custom',
    subtype: 'tdRolled',
    data: {
      seat: state.active,
      loose: state.loose.slice(),
      setAside: state.setAside.slice(),
      turnPot: state.turnPot,
      hotDice,
    },
  };
}

function computeWinners(state: TienduizendState): Seat[] {
  const max = Math.max(...state.totals);
  const winners: Seat[] = [];
  state.totals.forEach((t, s) => {
    if (t === max) winners.push(s as Seat);
  });
  return winners;
}

/** Begin een verse beurt voor de huidige actieve speler (fase 'rolling'). */
function beginTurn(state: TienduizendState): GameEvent[] {
  state.loose = [];
  state.setAside = [];
  state.turnPot = 0;
  state.phase = 'rolling';
  state.turn = state.active;
  return [turnEvent(state.active, 'rolling')];
}

/** Ga naar de volgende speler, of beëindig de partij als de slotronde rond is. */
function advanceTurn(state: TienduizendState): GameEvent[] {
  const events: GameEvent[] = [];
  state.active = ((state.active + 1) % state.seatCount) as Seat;
  // Slotronde: zodra het na de finisher weer diens beurt zou zijn, stopt het.
  if (state.finishingSeat !== null && state.active === state.finishingSeat) {
    state.phase = 'finished';
    state.turn = null;
    events.push({ type: 'gameEnd', winners: computeWinners(state), totals: toRecord(state.totals) });
    return events;
  }
  events.push(...beginTurn(state));
  return events;
}

/** Een worp leverde niets op: pot kwijt, beurt voorbij. */
function bust(state: TienduizendState, rolled: number[]): GameEvent[] {
  const events: GameEvent[] = [
    { type: 'custom', subtype: 'tdBust', data: { seat: state.active, rolled: rolled.slice(), lostPot: state.turnPot } },
  ];
  state.turnPot = 0;
  events.push(...advanceTurn(state));
  return events;
}

/** Bank de pot bij de huidige speler en rond de beurt af. */
function bank(state: TienduizendState): GameEvent[] {
  const seat = state.active;
  const pot = state.turnPot;
  state.totals[seat] = (state.totals[seat] ?? 0) + pot;
  if (pot >= state.config.openingThreshold) state.entered[seat] = true;

  const events: GameEvent[] = [
    { type: 'custom', subtype: 'tdBank', data: { seat, pot, total: state.totals[seat], entered: state.entered[seat] } },
    { type: 'scoreUpdate', totals: toRecord(state.totals) },
  ];

  if (state.finishingSeat === null && state.totals[seat]! >= state.config.targetScore) {
    state.finishingSeat = seat;
    events.push({ type: 'custom', subtype: 'tdFinishing', data: { seat, total: state.totals[seat] } });
  }
  events.push(...advanceTurn(state));
  return events;
}

/** Gooi `count` stenen en zet de fase op deciding, of bust als er niets scoort. */
function rollInto(state: TienduizendState, count: number, hotDice: boolean): GameEvent[] {
  const rolled = rollN(state, count);
  if (!hasAnyScore(rolled)) {
    state.loose = rolled;
    return [rolledEvent(state, hotDice), ...bust(state, rolled)];
  }
  state.loose = rolled;
  state.phase = 'deciding';
  return [rolledEvent(state, hotDice), turnEvent(state.active, 'deciding')];
}

export function createTienduizendDefinition(): TienduizendDefinition {
  return {
    id: 'tienduizend',
    naam: 'Tienduizend',
    minPlayers: 1,
    maxPlayers: 8,

    createInitialState(players: PlayerConfig[], config: TienduizendVariantConfig, seed?: number): TienduizendState {
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
        loose: [],
        setAside: [],
        turnPot: 0,
        totals: new Array<number>(n).fill(0),
        entered: new Array<boolean>(n).fill(false),
        finishingSeat: null,
        turn: 0 as Seat,
      };
    },

    initialEvents(state: TienduizendState): GameEvent[] {
      return [
        { type: 'gameStart', gameId: `tienduizend-${state.seed}`, players: structuredClone(state.players), seatCount: state.seatCount },
        { type: 'roundStart', roundIndex: 0, roundKind: 'tienduizend', roundLabel: '', dealer: state.active },
        turnEvent(state.active, 'rolling'),
      ];
    },

    getView(state: TienduizendState, seat: Seat): PublicGameView {
      return {
        seat,
        seatCount: state.seatCount,
        hand: [],
        handSizes: new Array<number>(state.seatCount).fill(0),
        round: { index: 0, kind: 'tienduizend', label: '', dealer: state.active, trump: null },
        totalRounds: 0,
        turn: state.turn,
        totals: state.totals.slice(),
        scoresPerRound: [],
        playerNames: state.players.map((p) => p.name),
        legalCards: [],
        legalMoves: tienduizendLegalMoves(state, seat),
        viewExtras: {
          phase: state.phase,
          active: state.active,
          loose: state.loose.slice(),
          setAside: state.setAside.slice(),
          turnPot: state.turnPot,
          total: state.totals[seat] ?? 0,
          entered: state.entered[seat] ?? false,
          threshold: state.config.openingThreshold,
          target: state.config.targetScore,
          totals: state.totals.slice(),
          finishingSeat: state.finishingSeat,
        },
      };
    },

    getLegalMoves(state: TienduizendState, seat: Seat): TienduizendMove[] {
      return tienduizendLegalMoves(state, seat);
    },

    applyMove(state: TienduizendState, seat: Seat, move: TienduizendMove) {
      const next = structuredClone(state);
      if (next.phase === 'finished') throw new Error('De partij is afgelopen');
      if (seat !== next.active) throw new Error(`Stoel ${seat} is niet aan de beurt`);

      let events: GameEvent[];
      switch (move.type) {
        case 'roll': {
          if (next.phase !== 'rolling') throw new Error('Er kan nu niet gegooid worden');
          events = rollInto(next, 6, false);
          break;
        }
        case 'setAside': {
          if (next.phase !== 'deciding') throw new Error('Er is nog niet gegooid');
          if (!isSubMultiset(move.keep, next.loose)) throw new Error('Die stenen liggen er niet');
          const score = scoreDice(move.keep);
          if (score === null) throw new Error('Die stenen vormen geen geldige score');

          next.setAside.push(...move.keep);
          next.turnPot += score;
          const rest = removeValues(next.loose, move.keep);

          if (move.bank) {
            if (!next.entered[seat] && next.turnPot < next.config.openingThreshold) {
              throw new Error(`Je moet eerst minstens ${next.config.openingThreshold} in één beurt scoren`);
            }
            next.loose = rest;
            events = bank(next);
          } else if (rest.length === 0) {
            // Volle bak ("hot dice"): alle zes opnieuw, pot blijft staan.
            next.setAside = [];
            events = rollInto(next, 6, true);
          } else {
            next.loose = rest;
            events = rollInto(next, rest.length, false);
          }
          break;
        }
        default:
          throw new Error(`Onbekend zet-type: ${(move as { type: string }).type}`);
      }
      return { state: next, events };
    },

    currentActor(state: TienduizendState): Seat | null {
      return state.phase === 'finished' ? null : state.active;
    },

    isFinished(state: TienduizendState): boolean {
      return state.phase === 'finished';
    },

    getWinners(state: TienduizendState): Seat[] {
      if (state.phase !== 'finished') throw new Error('De partij is nog niet afgelopen');
      return computeWinners(state);
    },
  };
}
