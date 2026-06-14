/**
 * src/games/yahtzee/engine.ts
 * Yahtzee-GameDefinition. UI-loos en deterministisch (seedbare worpen).
 * applyMove muteert de input-state nooit (kloont eerst). Eén actieve speler per
 * beurt: gooit, houdt vrij stenen vast en gooit de rest opnieuw (max. 3 worpen),
 * en legt de worp daarna vast in één ongebruikte categorie. Na 13 rondes zijn
 * alle kaarten vol; het hoogste eindtotaal wint.
 */

import type { GameEvent, PlayerConfig, PublicGameView, Seat } from '../../core/types.ts';
import { createRng } from '../../core/deck.ts';
import { rollDice } from '../dice/dice.ts';
import {
  cardGrandTotal, hasUpperBonus, isYahtzee, scoreCategory, upperSubtotal,
} from './scoring.ts';
import { yahtzeeLegalMoves } from './rules.ts';
import { emptyCard, YAHTZEE_CATEGORIES } from './types.ts';
import type {
  YahtzeeCard, YahtzeeCategory, YahtzeeDefinition, YahtzeeMove, YahtzeeState, YahtzeeVariantConfig,
} from './types.ts';

const ROLL_SALT = 7919;
const ROUNDS = YAHTZEE_CATEGORIES.length; // 13 beurten per speler

function toRecord(values: readonly number[]): Record<number, number> {
  const out: Record<number, number> = {};
  values.forEach((v, i) => (out[i] = v));
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

function rollN(state: YahtzeeState, count: number): number[] {
  const rng = createRng((state.seed + state.rollSeq * ROLL_SALT) >>> 0);
  state.rollSeq += 1;
  return rollDice(rng, count);
}

function turnEvent(seat: Seat, phase: string): GameEvent {
  return { type: 'custom', subtype: 'turn', data: { seat, phase } };
}

function cardSummary(card: YahtzeeCard): {
  scores: Record<string, number | null>;
  yahtzeeBonus: number;
  upper: number;
  bonus: boolean;
  total: number;
} {
  return {
    scores: { ...card.scores },
    yahtzeeBonus: card.yahtzeeBonus,
    upper: upperSubtotal(card),
    bonus: hasUpperBonus(card),
    total: cardGrandTotal(card),
  };
}

function rolledEvent(state: YahtzeeState, kept: number[], fresh: number[]): GameEvent {
  return {
    type: 'custom',
    subtype: 'yahtzeeRolled',
    data: { seat: state.active, kept: kept.slice(), fresh: fresh.slice(), dice: state.dice.slice(), rollsUsed: state.rollsUsed },
  };
}

function computeWinners(state: YahtzeeState): Seat[] {
  const max = Math.max(...state.totals);
  const winners: Seat[] = [];
  state.totals.forEach((t, s) => {
    if (t === max) winners.push(s as Seat);
  });
  return winners;
}

/** Leg de huidige worp vast in `category` en rond de beurt af. */
function scoreAndEndTurn(state: YahtzeeState, category: YahtzeeCategory): GameEvent[] {
  const events: GameEvent[] = [];
  const seat = state.active;
  const card = state.cards[seat]!;
  const before = cardGrandTotal(card);

  const joker = isYahtzee(state.dice) && card.scores.yahtzee !== null;
  const punten = scoreCategory(state.dice, category, joker);
  card.scores[category] = punten;
  // Extra-Yahtzee-bonus: +100 mits het Yahtzee-vak een 50 bevat.
  const bonusGained = isYahtzee(state.dice) && card.scores.yahtzee === 50 && category !== 'yahtzee';
  if (bonusGained) card.yahtzeeBonus += 1;

  const after = cardGrandTotal(card);
  state.totals[seat] = after;
  const gained = after - before;
  if (!state.scoresPerRound[state.roundIndex]) state.scoresPerRound[state.roundIndex] = new Array<number>(state.seatCount).fill(0);
  state.scoresPerRound[state.roundIndex]![seat] = gained;

  events.push({
    type: 'custom',
    subtype: 'yahtzeeScored',
    data: { seat, category, points: punten, gained, dice: state.dice.slice(), yahtzeeBonus: bonusGained, card: cardSummary(card) },
  });
  events.push({ type: 'scoreUpdate', totals: toRecord(state.totals) });

  state.turnsThisRound += 1;
  if (state.turnsThisRound >= state.seatCount) {
    events.push({ type: 'roundEnd', roundIndex: state.roundIndex, roundKind: 'yahtzee', scores: toRecord(state.scoresPerRound[state.roundIndex]!) });
    state.roundIndex += 1;
    state.turnsThisRound = 0;
  }

  if (state.roundIndex >= ROUNDS) {
    state.phase = 'finished';
    state.turn = null;
    state.dice = [];
    events.push({ type: 'gameEnd', winners: computeWinners(state), totals: toRecord(state.totals) });
    return events;
  }

  state.active = ((seat + 1) % state.seatCount) as Seat;
  state.dice = [];
  state.rollsUsed = 0;
  state.phase = 'rolling';
  state.turn = state.active;
  if (state.turnsThisRound === 0) {
    events.push({ type: 'roundStart', roundIndex: state.roundIndex, roundKind: 'yahtzee', roundLabel: '', dealer: state.active });
  }
  events.push(turnEvent(state.active, 'rolling'));
  return events;
}

export function createYahtzeeDefinition(): YahtzeeDefinition {
  return {
    id: 'yahtzee',
    naam: 'Yahtzee',
    minPlayers: 1,
    maxPlayers: 8,

    createInitialState(players: PlayerConfig[], config: YahtzeeVariantConfig, seed?: number): YahtzeeState {
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
        dice: [],
        rollsUsed: 0,
        cards: Array.from({ length: n }, () => emptyCard()),
        turn: 0 as Seat,
        totals: new Array<number>(n).fill(0),
        scoresPerRound: [],
      };
    },

    initialEvents(state: YahtzeeState): GameEvent[] {
      return [
        { type: 'gameStart', gameId: `yahtzee-${state.seed}`, players: structuredClone(state.players), seatCount: state.seatCount },
        { type: 'roundStart', roundIndex: 0, roundKind: 'yahtzee', roundLabel: '', dealer: state.active },
        turnEvent(state.active, 'rolling'),
      ];
    },

    getView(state: YahtzeeState, seat: Seat): PublicGameView {
      return {
        seat,
        seatCount: state.seatCount,
        hand: [],
        handSizes: new Array<number>(state.seatCount).fill(0),
        round: { index: state.roundIndex, kind: 'yahtzee', label: '', dealer: state.active, trump: null },
        totalRounds: ROUNDS,
        turn: state.turn,
        totals: state.totals.slice(),
        scoresPerRound: state.scoresPerRound.map((r) => r.slice()),
        playerNames: state.players.map((p) => p.name),
        legalCards: [],
        legalMoves: yahtzeeLegalMoves(state, seat),
        viewExtras: {
          phase: state.phase,
          active: state.active,
          dice: state.dice.slice(),
          rollsUsed: state.rollsUsed,
          maxRolls: state.config.maxRolls,
          cards: state.cards.map((c) => cardSummary(c)),
        },
      };
    },

    getLegalMoves(state: YahtzeeState, seat: Seat): YahtzeeMove[] {
      return yahtzeeLegalMoves(state, seat);
    },

    applyMove(state: YahtzeeState, seat: Seat, move: YahtzeeMove) {
      const next = structuredClone(state);
      if (next.phase === 'finished') throw new Error('De partij is afgelopen');
      if (seat !== next.active) throw new Error(`Stoel ${seat} is niet aan de beurt`);

      let events: GameEvent[];
      switch (move.type) {
        case 'roll': {
          if (next.phase !== 'rolling') throw new Error('Er kan nu niet gegooid worden');
          const fresh = rollN(next, 5);
          next.dice = fresh;
          next.rollsUsed = 1;
          next.phase = 'deciding';
          events = [rolledEvent(next, [], fresh), turnEvent(next.active, 'deciding')];
          break;
        }
        case 'reroll': {
          if (next.phase !== 'deciding') throw new Error('Er kan nu niet herworpen worden');
          if (next.rollsUsed >= next.config.maxRolls) throw new Error('Geen worpen meer over');
          if (!isSubMultiset(move.keep, next.dice)) throw new Error('Die stenen liggen er niet');
          if (move.keep.length >= next.dice.length) throw new Error('Houd ten hoogste vier stenen vast');
          const fresh = rollN(next, next.dice.length - move.keep.length);
          next.dice = [...move.keep, ...fresh].sort((a, b) => a - b);
          next.rollsUsed += 1;
          events = [rolledEvent(next, move.keep.slice().sort((a, b) => a - b), fresh), turnEvent(next.active, 'deciding')];
          break;
        }
        case 'score': {
          if (next.phase !== 'deciding') throw new Error('Er is nog niet gegooid');
          const card = next.cards[seat]!;
          if (card.scores[move.category] !== null) throw new Error('Die categorie is al ingevuld');
          // Bij een joker mag niet zomaar elke categorie — controleer via de legale zetten.
          const allowed = yahtzeeLegalMoves(next, seat).some((m) => m.type === 'score' && m.category === move.category);
          if (!allowed) throw new Error('Die categorie mag nu niet (jokerregel)');
          events = scoreAndEndTurn(next, move.category);
          break;
        }
        default:
          throw new Error(`Onbekend zet-type: ${(move as { type: string }).type}`);
      }
      return { state: next, events };
    },

    currentActor(state: YahtzeeState): Seat | null {
      return state.phase === 'finished' ? null : state.active;
    },

    isFinished(state: YahtzeeState): boolean {
      return state.phase === 'finished';
    },

    getWinners(state: YahtzeeState): Seat[] {
      if (state.phase !== 'finished') throw new Error('De partij is nog niet afgelopen');
      return computeWinners(state);
    },
  };
}
