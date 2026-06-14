/**
 * src/games/mexen/engine.ts
 * De Mexen-GameDefinition. UI-loos en deterministisch (seedbare worpen via
 * core/deck mulberry32). applyMove muteert de input-state nooit (kloont eerst).
 *
 * Fase-machine met één actieve stoel (de bekerhouder):
 *   rolling    → houder gooit verdekt → announcing
 *   announcing → houder kondigt (eventueel gelogen) een hogere waarde aan → responding (beker door)
 *   responding → ontvanger: doubt (til de beker, reken af) | believe (zelf gooien)
 *                | passUnseen (ongezien doorgeven met hogere aankondiging)
 *
 * Verborgen info: de werkelijke worp staat in state.actualRoll en wordt in
 * getView UITSLUITEND in de viewExtras van de eigenaar gezet (en alleen tijdens
 * 'announcing'). Bij een doubt wordt hij bewust openbaar via 'revealed'.
 */

import type { GameEvent, PlayerConfig, PublicGameView, Seat } from '../../core/types.ts';
import { rollTwo } from '../dice/dice.ts';
import { rankOf, rollToCode } from './ranking.ts';
import { aliveCount, mexenLegalMoves, nextAliveSeat } from './rules.ts';
import type { MexenDefinition, MexenMove, MexenReveal, MexenState, MexenVariantConfig } from './types.ts';

const ROLL_SALT = 7919;

function toRecord(values: readonly number[]): Record<number, number> {
  const out: Record<number, number> = {};
  values.forEach((v, i) => (out[i] = v));
  return out;
}

/** Eerste levende stoel vanaf 0 (voor de allereerste beurt). */
function firstAlive(state: MexenState): Seat {
  for (let s = 0; s < state.seatCount; s++) if (state.alive[s]) return s as Seat;
  return 0 as Seat;
}

/** Open een ronde met `starter` aan de beker (verse worp, geen aankondiging). */
function openRound(state: MexenState, starter: Seat): GameEvent[] {
  state.phase = 'rolling';
  state.cupHolder = starter;
  state.turn = starter;
  state.actualRoll = null;
  state.currentAnnouncement = null;
  state.announcer = null;
  state.rollsThisTurn = 0;
  return [
    { type: 'roundStart', roundIndex: state.roundIndex, roundKind: 'mexen', roundLabel: '', dealer: starter },
    { type: 'custom', subtype: 'turn', data: { seat: starter, phase: 'rolling' } },
  ];
}

/** Voer een verdekte worp uit voor de huidige houder. */
function doRoll(state: MexenState): GameEvent[] {
  const seed = (state.seed + state.rollSeq * ROLL_SALT) >>> 0;
  state.rollSeq += 1;
  state.rollsThisTurn += 1;
  state.actualRoll = rollTwo(seed);
  state.phase = 'announcing';
  return [
    { type: 'custom', subtype: 'diceRolled', data: { seat: state.cupHolder, rollNr: state.rollsThisTurn, maxRolls: state.config.maxRolls } },
    { type: 'custom', subtype: 'turn', data: { seat: state.cupHolder, phase: 'announcing' } },
  ];
}

/** Gemeenschappelijke afhandeling van announce en passUnseen: aankondigen + beker doorgeven. */
function doAnnounce(state: MexenState, seat: Seat, value: number, unseen: boolean): GameEvent[] {
  state.currentAnnouncement = value;
  state.announcer = seat;
  const to = nextAliveSeat(state, seat);
  state.cupHolder = to;
  state.turn = to;
  state.phase = 'responding';
  return [
    { type: 'custom', subtype: 'announced', data: { seat, value, unseen } },
    { type: 'custom', subtype: 'cupPassed', data: { from: seat, to, unseen } },
    { type: 'custom', subtype: 'turn', data: { seat: to, phase: 'responding' } },
  ];
}

/** Reken een twijfel af: onthul, ken levensverlies toe, check eliminatie, open nieuwe ronde. */
function resolveDoubt(state: MexenState): GameEvent[] {
  const doubter = state.cupHolder;
  const announcer = state.announcer!;
  const roll = state.actualRoll!;
  const code = rollToCode(roll);
  const announced = state.currentAnnouncement!;
  // "Waar" = de werkelijke worp haalt of overstijgt de aankondiging.
  const truthful = rankOf(code) >= rankOf(announced);
  const primaryLoser = truthful ? doubter : announcer;
  const amount = announced === 21 ? state.config.mexPenalty : 1;

  // Levensverlies opbouwen (incl. optionele flat-Mex-straf voor de gooier).
  const loss = new Array<number>(state.seatCount).fill(0);
  loss[primaryLoser] = (loss[primaryLoser] ?? 0) + amount;
  if (state.config.flatMexOnRoll && code === 21) {
    loss[announcer] = (loss[announcer] ?? 0) + state.config.mexPenalty;
  }

  const reveal: MexenReveal = {
    announcer, doubter, roll, code, announced, truthful, loser: primaryLoser, amount,
  };
  state.lastReveal = reveal;

  const events: GameEvent[] = [
    { type: 'custom', subtype: 'doubted', data: { doubter, announcer } },
    { type: 'custom', subtype: 'revealed', data: { announcer, doubter, roll, code, announced, truthful } },
  ];

  const newlyDead: Seat[] = [];
  for (let s = 0; s < state.seatCount; s++) {
    if (loss[s]! <= 0) continue;
    const before = state.lives[s]!;
    const after = Math.max(0, before - loss[s]!);
    state.lives[s] = after;
    state.totals[s] = after;
    events.push({ type: 'custom', subtype: 'lifeLost', data: { seat: s, amount: before - after, livesLeft: after } });
    if (after === 0 && state.alive[s]) {
      state.alive[s] = false;
      newlyDead.push(s as Seat);
    }
  }
  for (const s of newlyDead) events.push({ type: 'custom', subtype: 'playerEliminated', data: { seat: s } });

  // Ronde-administratie: levens-delta deze ronde (negatief).
  state.scoresPerRound.push(loss.map((l) => -l));
  events.push({ type: 'roundEnd', roundIndex: state.roundIndex, roundKind: 'mexen', scores: toRecord(loss.map((l) => -l)) });
  events.push({ type: 'scoreUpdate', totals: toRecord(state.totals) });

  state.roundIndex += 1;

  if (aliveCount(state) <= 1) {
    state.phase = 'finished';
    state.turn = null;
    state.cupHolder = firstAlive(state);
    events.push({ type: 'gameEnd', winners: computeWinners(state), totals: toRecord(state.totals) });
    return events;
  }

  // De zojuist foute speler begint de nieuwe ronde; ligt hij eruit, dan de volgende levende.
  const starter = state.alive[primaryLoser] ? primaryLoser : nextAliveSeat(state, primaryLoser);
  events.push({ type: 'custom', subtype: 'roundReset', data: { starter } });
  events.push(...openRound(state, starter));
  return events;
}

function computeWinners(state: MexenState): Seat[] {
  const winners: Seat[] = [];
  for (let s = 0; s < state.seatCount; s++) if (state.alive[s]) winners.push(s as Seat);
  // Failsafe: als (theoretisch) niemand meer leeft, win wie de meeste levens had.
  if (winners.length === 0) {
    const max = Math.max(...state.totals);
    state.totals.forEach((t, s) => { if (t === max) winners.push(s as Seat); });
  }
  return winners;
}

export function createMexenDefinition(): MexenDefinition {
  return {
    id: 'mexen',
    naam: 'Mexen',
    minPlayers: 4,
    maxPlayers: 8,

    createInitialState(players: PlayerConfig[], config: MexenVariantConfig, seed?: number): MexenState {
      if (players.length !== config.playerCount) {
        throw new Error(`Aantal spelers (${players.length}) komt niet overeen met de variant (${config.playerCount})`);
      }
      const n = config.playerCount;
      const state: MexenState = {
        config: structuredClone(config),
        players: structuredClone(players),
        seatCount: n,
        seed: (seed ?? Math.floor(Math.random() * 0x7fffffff)) >>> 0,
        phase: 'rolling',
        roundIndex: 0,
        rollSeq: 0,
        rollsThisTurn: 0,
        lives: new Array<number>(n).fill(config.startLives),
        alive: new Array<boolean>(n).fill(true),
        cupHolder: 0 as Seat,
        direction: 1,
        actualRoll: null,
        currentAnnouncement: null,
        announcer: null,
        lastReveal: null,
        turn: 0 as Seat,
        totals: new Array<number>(n).fill(config.startLives),
        scoresPerRound: [],
      };
      state.cupHolder = firstAlive(state);
      state.turn = state.cupHolder;
      return state;
    },

    initialEvents(state: MexenState): GameEvent[] {
      const events: GameEvent[] = [
        { type: 'gameStart', gameId: `mexen-${state.seed}`, players: structuredClone(state.players), seatCount: state.seatCount },
        { type: 'roundStart', roundIndex: state.roundIndex, roundKind: 'mexen', roundLabel: '', dealer: state.cupHolder },
        { type: 'custom', subtype: 'turn', data: { seat: state.cupHolder, phase: 'rolling' } },
      ];
      return events;
    },

    getView(state: MexenState, seat: Seat): PublicGameView {
      // De eigen worp is alleen zichtbaar voor de houder terwijl hij aankondigt.
      const myRoll = state.phase === 'announcing' && seat === state.cupHolder ? state.actualRoll : null;
      return {
        seat,
        seatCount: state.seatCount,
        hand: [],
        handSizes: new Array<number>(state.seatCount).fill(0),
        round: { index: state.roundIndex, kind: 'mexen', label: '', dealer: state.cupHolder, trump: null },
        totalRounds: 0, // open einde: tot er één speler overblijft
        turn: state.turn,
        totals: state.totals.slice(),
        scoresPerRound: state.scoresPerRound.map((r) => r.slice()),
        playerNames: state.players.map((p) => p.name),
        legalCards: [],
        legalMoves: mexenLegalMoves(state, seat),
        viewExtras: {
          phase: state.phase,
          lives: state.lives.slice(),
          alive: state.alive.slice(),
          cupHolder: state.cupHolder,
          announcer: state.announcer,
          currentAnnouncement: state.currentAnnouncement,
          direction: state.direction,
          myRoll: myRoll ? [myRoll[0], myRoll[1]] : null,
          rollsThisTurn: state.rollsThisTurn,
          maxRolls: state.config.maxRolls,
          lastReveal: state.lastReveal ? structuredClone(state.lastReveal) : null,
        },
      };
    },

    getLegalMoves(state: MexenState, seat: Seat): MexenMove[] {
      return mexenLegalMoves(state, seat);
    },

    applyMove(state: MexenState, seat: Seat, move: MexenMove) {
      const next = structuredClone(state);
      if (next.phase === 'finished') throw new Error('De partij is afgelopen');
      if (seat !== next.cupHolder) throw new Error(`Stoel ${seat} is niet aan de beurt`);

      let events: GameEvent[];
      switch (move.type) {
        case 'roll': {
          // Eerste worp ('rolling') of nog eens gooien ('announcing', tot maxRolls).
          if (next.phase !== 'rolling' && next.phase !== 'announcing') {
            throw new Error('Er kan nu niet gegooid worden');
          }
          if (next.phase === 'announcing' && next.rollsThisTurn >= next.config.maxRolls) {
            throw new Error('Geen worpen meer deze beurt');
          }
          events = doRoll(next);
          break;
        }
        case 'announce': {
          if (next.phase !== 'announcing') throw new Error('Er kan nu niet aangekondigd worden');
          if (!mexenLegalMoves(next, seat).some((m) => m.type === 'announce' && m.value === move.value)) {
            throw new Error(`Aankondiging ${move.value} is hier niet toegestaan`);
          }
          events = doAnnounce(next, seat, move.value, false);
          break;
        }
        case 'passUnseen': {
          if (next.phase !== 'responding') throw new Error('Ongezien doorgeven kan hier niet');
          if (!mexenLegalMoves(next, seat).some((m) => m.type === 'passUnseen' && m.value === move.value)) {
            throw new Error(`Ongezien doorgeven met ${move.value} is hier niet toegestaan`);
          }
          events = doAnnounce(next, seat, move.value, true);
          break;
        }
        case 'believe': {
          if (next.phase !== 'responding') throw new Error('Geloven kan hier niet');
          next.phase = 'rolling';
          next.actualRoll = null; // de believer gooit zo zelf een verse worp
          next.rollsThisTurn = 0; // verse beurt: weer tot maxRolls worpen
          events = [
            { type: 'custom', subtype: 'believed', data: { seat } },
            { type: 'custom', subtype: 'turn', data: { seat, phase: 'rolling' } },
          ];
          break;
        }
        case 'doubt': {
          if (next.phase !== 'responding') throw new Error('Twijfelen kan hier niet');
          events = resolveDoubt(next);
          break;
        }
        default:
          throw new Error(`Onbekend zet-type: ${(move as { type: string }).type}`);
      }
      return { state: next, events };
    },

    currentActor(state: MexenState): Seat | null {
      if (state.phase === 'finished') return null;
      return state.cupHolder;
    },

    isFinished(state: MexenState): boolean {
      return state.phase === 'finished';
    },

    getWinners(state: MexenState): Seat[] {
      if (state.phase !== 'finished') throw new Error('De partij is nog niet afgelopen');
      return computeWinners(state);
    },
  };
}
