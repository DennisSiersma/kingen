/**
 * src/games/qwixx/engine.ts
 * Qwixx-achtige GameDefinition. UI-loos en deterministisch (seedbare worpen).
 * applyMove muteert de input-state nooit (kloont eerst).
 *
 * Fase-machine met een actieve speler die gooit en de gekleurde actie doet,
 * plus een simultane witte-worp-fase waarin elke speler om de beurt (via een
 * pendingWhite-queue) mag markeren — zelfde patroon als Toepen's respons-queue.
 * Alle dobbelwaarden zijn PUBLIEK (geen verborgen info), dus mogen ze in events.
 */

import type { GameEvent, PlayerConfig, PublicGameView, Seat } from '../../core/types.ts';
import { createRng } from '../../core/deck.ts';
import { rollDie } from '../dice/dice.ts';
import { sheetScore } from './scoring.ts';
import { canMark, qwixxLegalMoves, whiteSum } from './rules.ts';
import { QWIXX_COLORS, lockNumber } from './types.ts';
import type {
  QwixxColor, QwixxDefinition, QwixxDice, QwixxMove, QwixxSheet, QwixxState, QwixxVariantConfig,
} from './types.ts';

const ROLL_SALT = 7919;

function toRecord(values: readonly number[]): Record<number, number> {
  const out: Record<number, number> = {};
  values.forEach((v, i) => (out[i] = v));
  return out;
}

function emptySheet(): QwixxSheet {
  return {
    rows: {
      red: { marks: [], locked: false },
      yellow: { marks: [], locked: false },
      green: { marks: [], locked: false },
      blue: { marks: [], locked: false },
    },
    penalties: 0,
  };
}

/** Volgorde voor de witte-fase: actieve speler eerst, daarna met de klok mee. */
function whiteOrder(active: Seat, n: number): Seat[] {
  const order: Seat[] = [];
  for (let i = 0; i < n; i++) order.push(((active + i) % n) as Seat);
  return order;
}

function recomputeTotals(state: QwixxState): void {
  for (let s = 0; s < state.seatCount; s++) state.totals[s] = sheetScore(state.sheets[s]!);
}

/** Gooi alle zes stenen (2 wit + 4 gekleurd) deterministisch. */
function doRoll(state: QwixxState): void {
  const rng = createRng((state.seed + state.rollSeq * ROLL_SALT) >>> 0);
  state.rollSeq += 1;
  const dice: QwixxDice = {
    white: [rollDie(rng), rollDie(rng)],
    colored: { red: rollDie(rng), yellow: rollDie(rng), green: rollDie(rng), blue: rollDie(rng) },
  };
  state.dice = dice;
}

/** Kruis `value` in de rij van `color` op het blad van `seat`; sluit de kleur bij het slotgetal. */
function applyMark(state: QwixxState, seat: Seat, color: QwixxColor, value: number): boolean {
  const row = state.sheets[seat]!.rows[color];
  row.marks.push(value);
  if (value === lockNumber(color)) {
    row.locked = true;
    if (!state.lockedColors.includes(color)) state.lockedColors.push(color);
    return true;
  }
  return false;
}

function turnEvent(seat: Seat, phase: string): GameEvent {
  return { type: 'custom', subtype: 'turn', data: { seat, phase } };
}

/** Rond de beurt af: strafvak als de actieve speler niets kruiste, dan eindcheck / volgende beurt. */
function resolveTurnEnd(state: QwixxState): GameEvent[] {
  const events: GameEvent[] = [];
  const active = state.active;
  if (!state.activeMarked) {
    const sheet = state.sheets[active]!;
    sheet.penalties += 1;
    events.push({ type: 'custom', subtype: 'qwixxPenalty', data: { seat: active, penalties: sheet.penalties } });
  }
  recomputeTotals(state);
  events.push({ type: 'scoreUpdate', totals: toRecord(state.totals) });

  const klaar =
    state.lockedColors.length >= state.config.locksToEnd ||
    state.sheets.some((s) => s.penalties >= state.config.maxPenalties);
  if (klaar) {
    state.phase = 'finished';
    state.turn = null;
    state.dice = null;
    events.push({ type: 'gameEnd', winners: computeWinners(state), totals: toRecord(state.totals) });
    return events;
  }

  state.active = ((active + 1) % state.seatCount) as Seat;
  state.phase = 'rolling';
  state.dice = null;
  state.pendingWhite = [];
  state.activeMarked = false;
  state.turn = state.active;
  events.push(turnEvent(state.active, 'rolling'));
  return events;
}

function computeWinners(state: QwixxState): Seat[] {
  const max = Math.max(...state.totals);
  const winners: Seat[] = [];
  state.totals.forEach((t, s) => {
    if (t === max) winners.push(s as Seat);
  });
  return winners;
}

export function createQwixxDefinition(): QwixxDefinition {
  return {
    id: 'qwixx',
    naam: 'Qwixx',
    minPlayers: 2,
    maxPlayers: 5,

    createInitialState(players: PlayerConfig[], config: QwixxVariantConfig, seed?: number): QwixxState {
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
        dice: null,
        pendingWhite: [],
        activeMarked: false,
        lockedColors: [],
        sheets: Array.from({ length: n }, () => emptySheet()),
        turn: 0 as Seat,
        totals: new Array<number>(n).fill(0),
        scoresPerRound: [],
      };
    },

    initialEvents(state: QwixxState): GameEvent[] {
      return [
        { type: 'gameStart', gameId: `qwixx-${state.seed}`, players: structuredClone(state.players), seatCount: state.seatCount },
        { type: 'roundStart', roundIndex: 0, roundKind: 'qwixx', roundLabel: '', dealer: state.active },
        turnEvent(state.active, 'rolling'),
      ];
    },

    getView(state: QwixxState, seat: Seat): PublicGameView {
      return {
        seat,
        seatCount: state.seatCount,
        hand: [],
        handSizes: new Array<number>(state.seatCount).fill(0),
        round: { index: 0, kind: 'qwixx', label: '', dealer: state.active, trump: null },
        totalRounds: 0,
        turn: state.turn,
        totals: state.totals.slice(),
        scoresPerRound: [],
        playerNames: state.players.map((p) => p.name),
        legalCards: [],
        legalMoves: qwixxLegalMoves(state, seat),
        viewExtras: {
          phase: state.phase,
          active: state.active,
          dice: state.dice ? structuredClone(state.dice) : null,
          whiteSum: state.dice ? whiteSum(state) : 0,
          activeMarked: state.activeMarked,
          pendingWhite: state.pendingWhite.slice(),
          lockedColors: state.lockedColors.slice(),
          penalties: state.sheets.map((s) => s.penalties),
          sheets: structuredClone(state.sheets),
        },
      };
    },

    getLegalMoves(state: QwixxState, seat: Seat): QwixxMove[] {
      return qwixxLegalMoves(state, seat);
    },

    applyMove(state: QwixxState, seat: Seat, move: QwixxMove) {
      const next = structuredClone(state);
      if (next.phase === 'finished') throw new Error('De partij is afgelopen');

      let events: GameEvent[] = [];
      switch (move.type) {
        case 'roll': {
          if (next.phase !== 'rolling' || seat !== next.active) throw new Error('Er kan nu niet gegooid worden');
          doRoll(next);
          next.phase = 'white';
          next.pendingWhite = whiteOrder(next.active, next.seatCount);
          next.activeMarked = false;
          next.turn = next.pendingWhite[0]!;
          events.push({ type: 'custom', subtype: 'qwixxRolled', data: { active: next.active, dice: structuredClone(next.dice) } });
          events.push(turnEvent(next.turn, 'white'));
          break;
        }
        case 'markWhite': {
          if (next.phase !== 'white' || next.pendingWhite[0] !== seat) throw new Error('Niet aan de beurt voor de witte actie');
          if (!canMark(next, seat, move.color, move.value)) throw new Error('Deze witte markering mag niet');
          const locked = applyMark(next, seat, move.color, move.value);
          if (seat === next.active) next.activeMarked = true;
          events.push({ type: 'custom', subtype: 'qwixxMarked', data: { seat, color: move.color, value: move.value, white: true, locked } });
          if (locked) events.push({ type: 'custom', subtype: 'qwixxLocked', data: { color: move.color, seat } });
          events.push(...advanceWhite(next));
          break;
        }
        case 'markColor': {
          if (next.phase !== 'color' || seat !== next.active) throw new Error('Niet aan de beurt voor de gekleurde actie');
          if (!canMark(next, seat, move.color, move.value)) throw new Error('Deze gekleurde markering mag niet');
          const locked = applyMark(next, seat, move.color, move.value);
          next.activeMarked = true;
          events.push({ type: 'custom', subtype: 'qwixxMarked', data: { seat, color: move.color, value: move.value, white: false, locked } });
          if (locked) events.push({ type: 'custom', subtype: 'qwixxLocked', data: { color: move.color, seat } });
          events.push(...resolveTurnEnd(next));
          break;
        }
        case 'pass': {
          if (next.phase === 'white' && next.pendingWhite[0] === seat) {
            events.push(...advanceWhite(next));
          } else if (next.phase === 'color' && seat === next.active) {
            events.push(...resolveTurnEnd(next));
          } else {
            throw new Error('Passen kan hier niet');
          }
          break;
        }
        default:
          throw new Error(`Onbekend zet-type: ${(move as { type: string }).type}`);
      }
      return { state: next, events };
    },

    currentActor(state: QwixxState): Seat | null {
      switch (state.phase) {
        case 'rolling':
        case 'color':
          return state.active;
        case 'white':
          return state.pendingWhite[0] ?? null;
        default:
          return null;
      }
    },

    isFinished(state: QwixxState): boolean {
      return state.phase === 'finished';
    },

    getWinners(state: QwixxState): Seat[] {
      if (state.phase !== 'finished') throw new Error('De partij is nog niet afgelopen');
      return computeWinners(state);
    },
  };
}

/** Schuif de witte-fase door; bij een lege queue volgt de gekleurde actie van de actieve speler. */
function advanceWhite(state: QwixxState): GameEvent[] {
  state.pendingWhite.shift();
  if (state.pendingWhite.length > 0) {
    state.turn = state.pendingWhite[0]!;
    return [turnEvent(state.turn, 'white')];
  }
  state.phase = 'color';
  state.turn = state.active;
  return [turnEvent(state.active, 'color')];
}
