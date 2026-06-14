/**
 * src/games/klaverjassen/engine.ts
 * De Klaverjas-GameDefinition (NL 4-spelersvariant). UI-loos en deterministisch
 * (seedbare shuffle). applyMove muteert de input-state nooit (kloont eerst).
 *
 * Verloop per boom (ronde): delen 3-2-3 → troef bepalen (verplicht draaien /
 * Leids bieden / vast klaveren ronde 1) → 8 slagen (bekennen + Rotterdamse/
 * Amsterdamse troefplicht, troefkracht B>9>A>10>H>V>8>7) → tellen (kaartpunten
 * 162 + roem, nat/gehaald/pit per team). Partij eindigt na N bomen (default 16)
 * of bij een puntendoel; team met het hoogste totaal wint.
 */

import type { Card, GameEvent, PlayerConfig, PublicGameView, Seat, Suit } from '../../core/types.ts';
import { SUITS } from '../../core/types.ts';
import { createRng, shuffle, sortHand, trickWinner } from '../../core/deck.ts';
import { cardPoints, klaverjasDeck, klaverjasRankValue } from './cards.ts';
import { legalPlays } from './rules.ts';
import { computeRondeUitslag, detectRoem } from './scoring.ts';
import type {
  BidChoice,
  KlaverjasDefinition,
  KlaverjasMove,
  KlaverjasState,
  KlaverjasVariantConfig,
  Team,
} from './types.ts';
import { teamOf } from './types.ts';

const leftOf = (seat: Seat, n: number): Seat => ((seat + 1) % n) as Seat;
const nextSeat = (seat: Seat, n: number): Seat => ((seat + 1) % n) as Seat;

function toRecord(values: readonly number[]): Record<number, number> {
  const out: Record<number, number> = {};
  values.forEach((v, i) => (out[i] = v));
  return out;
}

/** Deel 3-2-3 (of 4-4) klokwijs vanaf links van de deler. */
function dealGrouped(deck: readonly Card[], n: number, dealer: Seat, pattern: '3-2-3' | '4-4'): Card[][] {
  const groups = pattern === '4-4' ? [4, 4] : [3, 2, 3];
  const hands: Card[][] = Array.from({ length: n }, () => []);
  let idx = 0;
  for (const size of groups) {
    for (let k = 0; k < n; k++) {
      const seat = ((dealer + 1 + k) % n) as Seat;
      for (let i = 0; i < size; i++) hands[seat]!.push(deck[idx++]!);
    }
  }
  return hands;
}

/** Troefkleur deterministisch aanwijzen (verplicht draaien / vast klaveren ronde 1). */
function autoTrump(state: KlaverjasState): Suit {
  if (state.config.trumpSelection === 'vastKlaverenRonde1' && state.roundIndex === 0) return 'clubs';
  const rng = createRng(state.seed + state.roundIndex * 104729 + 17);
  return SUITS[Math.floor(rng() * SUITS.length)]!;
}

// ---------------------------------------------------------------------------
// Legale zetten
// ---------------------------------------------------------------------------

function legalBids(): KlaverjasMove[] {
  const bids: KlaverjasMove[] = SUITS.map((s) => ({ type: 'bid', choice: { trump: s } }));
  bids.unshift({ type: 'bid', choice: 'pass' });
  return bids;
}

function klaverjasLegalMoves(state: KlaverjasState, seat: Seat): KlaverjasMove[] {
  if (state.phase === 'bidding' && state.bidding && state.bidding.current === seat) {
    const bids = legalBids();
    // In de verplichte tweede ronde mag de voorhand niet meer passen.
    return state.bidding.forced ? bids.filter((b) => !(b.type === 'bid' && b.choice === 'pass')) : bids;
  }
  if (state.phase === 'playing' && state.turn === seat) {
    return legalPlays(state, seat).map((card) => ({ type: 'playCard', card }));
  }
  return [];
}

// ---------------------------------------------------------------------------
// Rondeflow
// ---------------------------------------------------------------------------

function dealEventFromState(state: KlaverjasState): GameEvent {
  const hands: Partial<Record<Seat, Card[]>> = {};
  const handSizes: Record<number, number> = {};
  state.hands.forEach((h, seat) => {
    hands[seat as Seat] = h.map((c) => ({ ...c }));
    handSizes[seat] = h.length;
  });
  return { type: 'deal', roundIndex: state.roundIndex, dealer: state.dealer, hands, handSizes };
}

function dealCards(state: KlaverjasState): void {
  const n = state.seatCount;
  const deck = klaverjasDeck();
  const geschud = shuffle(deck, createRng(state.seed + state.roundIndex * 7919));
  const hands = dealGrouped(geschud, n, state.dealer, state.config.dealPattern);
  state.hands = hands.map((h) => sortHand(h));
  state.completedTricks = [];
  state.teamTricks = [0, 0];
  state.teamCardPoints = [0, 0];
  state.teamRoem = [0, 0];
  state.roemEvents = [];
  state.currentTrick = { index: 0, leader: state.voorhand, plays: [] };
  state.turn = null;
  state.trump = null;
  state.makingTeam = null;
  state.bidding = null;
}

/** Bereken de roem uit de gedeelde handen (auto-tally) en vul teamRoem + events. */
function tallyRoem(state: KlaverjasState): GameEvent[] {
  const events: GameEvent[] = [];
  const trump = state.trump;
  for (let s = 0; s < state.seatCount; s++) {
    const team = teamOf(s as Seat);
    for (const r of detectRoem(state.hands[s] ?? [], trump)) {
      state.teamRoem[team] += r.points;
      state.roemEvents.push({ team, seat: s as Seat, kind: r.kind, points: r.points, cards: r.cards.map((c) => ({ ...c })) });
      events.push({ type: 'custom', subtype: 'roemDeclared', data: { team, seat: s, kind: r.kind, points: r.points } });
    }
  }
  return events;
}

/** Start de speelfase: troef staat vast, de voorhand komt uit. */
function startPlaying(state: KlaverjasState): GameEvent[] {
  state.phase = 'playing';
  state.bidding = null;
  state.currentTrick = { index: 0, leader: state.voorhand, plays: [] };
  state.turn = state.voorhand;
  const events: GameEvent[] = [
    { type: 'trumpChosen', roundIndex: state.roundIndex, trump: state.trump!, chooser: state.voorhand },
  ];
  events.push(...tallyRoem(state));
  events.push({ type: 'turnStart', seat: state.voorhand, trickIndex: 0 });
  return events;
}

/** Begin een nieuwe boom: deal + troefbepaling (of biedfase). */
function beginRound(state: KlaverjasState): void {
  state.dealer = (state.roundIndex % state.seatCount) as Seat;
  state.voorhand = leftOf(state.dealer, state.seatCount);
  dealCards(state);
  if (state.config.trumpSelection === 'bieden') {
    state.phase = 'bidding';
    state.bidding = { current: state.voorhand, passes: [], forced: false };
  } else {
    state.phase = 'playing';
    state.trump = autoTrump(state);
    state.makingTeam = teamOf(state.voorhand);
  }
}

function roundOpeningEvents(state: KlaverjasState): GameEvent[] {
  const events: GameEvent[] = [
    {
      type: 'roundStart',
      roundIndex: state.roundIndex,
      roundKind: 'klaverjassen',
      roundLabel: state.config.gewest,
      dealer: state.dealer,
    },
    dealEventFromState(state),
  ];
  if (state.phase === 'bidding' && state.bidding) {
    events.push({ type: 'custom', subtype: 'bidRequest', data: { seat: state.bidding.current, forced: state.bidding.forced } });
  } else if (state.phase === 'playing') {
    events.push(...startPlaying(state));
  }
  return events;
}

function computeWinners(state: KlaverjasState): Seat[] {
  const [wij, zij] = state.teamTotals;
  const winTeam: Team | null = wij > zij ? 0 : zij > wij ? 1 : null;
  // Winnaars zijn de stoelen van het winnende team; bij gelijkspel alle stoelen.
  const winners: Seat[] = [];
  for (let s = 0; s < state.seatCount; s++) {
    if (winTeam === null || teamOf(s as Seat) === winTeam) winners.push(s as Seat);
  }
  return winners;
}

function isGameOver(state: KlaverjasState): boolean {
  const eind = state.config.eindvoorwaarde;
  if (eind.type === 'aantalBomen') return state.roundIndex + 1 >= eind.n;
  return Math.max(state.teamTotals[0], state.teamTotals[1]) >= eind.n;
}

/** Rond de boom af: tellen, totaliseren en door (of einde partij). */
function finishRound(state: KlaverjasState): GameEvent[] {
  const events: GameEvent[] = [];
  const making = state.makingTeam ?? 0;
  const uitslag = computeRondeUitslag(making, state.teamCardPoints, state.teamRoem, state.teamTricks);

  state.scoresPerRound.push(uitslag.roundScores.slice() as number[]);
  state.teamTotals[0] += uitslag.roundScores[0];
  state.teamTotals[1] += uitslag.roundScores[1];

  if (uitslag.pitTeam !== null) {
    events.push({ type: 'custom', subtype: 'pit', data: { team: uitslag.pitTeam, points: 100 } });
  }
  events.push({
    type: 'custom',
    subtype: 'natResult',
    data: {
      makingTeam: making,
      gehaald: uitslag.gehaald,
      makingTotal: uitslag.makingTotal,
      defendingTotal: uitslag.defTotal,
      roundScores: uitslag.roundScores,
    },
  });
  events.push({
    type: 'roundEnd',
    roundIndex: state.roundIndex,
    roundKind: 'klaverjassen',
    scores: { 0: uitslag.roundScores[0], 1: uitslag.roundScores[1] },
  });
  events.push({ type: 'scoreUpdate', totals: { 0: state.teamTotals[0], 1: state.teamTotals[1] } });

  if (isGameOver(state)) {
    state.phase = 'finished';
    state.turn = null;
    events.push({ type: 'gameEnd', winners: computeWinners(state), totals: { 0: state.teamTotals[0], 1: state.teamTotals[1] } });
  } else {
    state.roundIndex += 1;
    beginRound(state);
    events.push(...roundOpeningEvents(state));
  }
  return events;
}

// ---------------------------------------------------------------------------
// Zet-afhandeling
// ---------------------------------------------------------------------------

function applyBid(state: KlaverjasState, seat: Seat, choice: BidChoice): GameEvent[] {
  if (state.phase !== 'bidding' || !state.bidding || state.bidding.current !== seat) {
    throw new Error('Niet aan de beurt om te bieden');
  }
  const events: GameEvent[] = [];
  if (choice === 'pass') {
    if (state.bidding.forced) throw new Error('Passen mag niet meer (verplicht spelen)');
    state.bidding.passes.push(seat);
    events.push({ type: 'custom', subtype: 'bidMade', data: { seat, choice: 'pass' } });
    if (state.bidding.passes.length >= state.seatCount) {
      // Iedereen paste → voorhand moet verplicht troef kiezen.
      state.bidding = { current: state.voorhand, passes: state.bidding.passes, forced: true };
      events.push({ type: 'custom', subtype: 'bidRequest', data: { seat: state.voorhand, forced: true } });
    } else {
      state.bidding.current = leftOf(seat, state.seatCount);
      events.push({ type: 'custom', subtype: 'bidRequest', data: { seat: state.bidding.current, forced: false } });
    }
    return events;
  }
  // Troef gekozen: dit team wordt het spelende team.
  state.trump = choice.trump;
  state.makingTeam = teamOf(seat);
  events.push({ type: 'custom', subtype: 'bidMade', data: { seat, choice: { trump: choice.trump }, makingTeam: state.makingTeam } });
  events.push(...startPlaying(state));
  return events;
}

function applyPlayCard(state: KlaverjasState, seat: Seat, played: Card): GameEvent[] {
  if (state.phase !== 'playing' || state.turn !== seat) throw new Error('Niet aan de beurt');
  const legaal = legalPlays(state, seat);
  const card = legaal.find((c) => c.id === played.id);
  if (!card) throw new Error(`Kaart ${played.id} is hier niet toegestaan`);

  const n = state.seatCount;
  state.hands[seat] = (state.hands[seat] ?? []).filter((c) => c.id !== card.id);
  state.currentTrick.plays.push({ seat, card });
  const events: GameEvent[] = [{ type: 'playCard', seat, card, trickIndex: state.currentTrick.index }];

  if (state.currentTrick.plays.length === n) {
    const winner = trickWinner(state.currentTrick.plays, state.trump, klaverjasRankValue);
    state.currentTrick.winner = winner;
    const winTeam = teamOf(winner);
    state.teamTricks[winTeam] += 1;
    let punten = state.currentTrick.plays.reduce((s, p) => s + cardPoints(p.card, state.trump), 0);
    const laatsteSlag = state.completedTricks.length + 1 >= tricksPerRound(state);
    if (laatsteSlag) punten += 10; // laatste-slag-bonus
    state.teamCardPoints[winTeam] += punten;
    const voltooid = state.currentTrick;
    state.completedTricks.push(voltooid);
    events.push({ type: 'trickWon', trickIndex: voltooid.index, winner, trick: structuredClone(voltooid) });
    if (laatsteSlag) events.push({ type: 'custom', subtype: 'lastTrick', data: { team: winTeam, points: 10 } });
    state.currentTrick = { index: voltooid.index + 1, leader: winner, plays: [] };

    if (state.completedTricks.length >= tricksPerRound(state)) {
      events.push(...finishRound(state));
    } else {
      state.turn = winner;
      events.push({ type: 'turnStart', seat: winner, trickIndex: state.currentTrick.index });
    }
  } else {
    state.turn = nextSeat(seat, n);
    events.push({ type: 'turnStart', seat: state.turn, trickIndex: state.currentTrick.index });
  }
  return events;
}

const tricksPerRound = (state: KlaverjasState): number => Math.floor(32 / state.seatCount);

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

function buildView(state: KlaverjasState, seat: Seat): PublicGameView {
  const n = state.seatCount;
  const playedCards: Card[] = [];
  for (const trick of state.completedTricks) for (const p of trick.plays) playedCards.push({ ...p.card });
  for (const p of state.currentTrick.plays) playedCards.push({ ...p.card });

  // Per-stoel slagentelling afleiden (voor de generieke HUD).
  const trickCounts = new Array<number>(n).fill(0);
  for (const t of state.completedTricks) if (t.winner !== undefined) trickCounts[t.winner]! += 1;

  // Generieke per-stoel totalen = teamtotaal van die stoel (partners gelijk).
  const totals = Array.from({ length: n }, (_, s) => state.teamTotals[teamOf(s as Seat)]);
  const scoresPerRound = state.scoresPerRound.map((r) =>
    Array.from({ length: n }, (_, s) => r[teamOf(s as Seat)] ?? 0),
  );

  const legalCards =
    state.phase === 'playing' && state.turn === seat ? legalPlays(state, seat).map((c) => ({ ...c })) : [];

  return {
    seat,
    seatCount: n,
    hand: sortHand(state.hands[seat] ?? []),
    handSizes: state.hands.map((h) => h.length),
    currentTrick: structuredClone(state.currentTrick),
    completedTricks: structuredClone(state.completedTricks),
    playedCards,
    trickCounts,
    round: {
      index: state.roundIndex,
      kind: 'klaverjassen',
      label: state.config.gewest,
      dealer: state.dealer,
      trump: state.trump,
    },
    totalRounds: state.config.eindvoorwaarde.type === 'aantalBomen' ? state.config.eindvoorwaarde.n : 0,
    turn: state.phase === 'bidding' ? (state.bidding?.current ?? null) : state.turn,
    totals,
    scoresPerRound,
    playerNames: state.players.map((p) => p.name),
    legalCards,
    legalMoves: klaverjasLegalMoves(state, seat),
    viewExtras: {
      phase: state.phase,
      gewest: state.config.gewest,
      trumpSelection: state.config.trumpSelection,
      teams: { wij: [0, 2], zij: [1, 3] },
      viewerTeam: teamOf(seat),
      makingTeam: state.makingTeam,
      teamTricks: state.teamTricks.slice(),
      teamCardPoints: state.teamCardPoints.slice(),
      teamRoem: state.teamRoem.slice(),
      teamTotals: state.teamTotals.slice(),
      teamScoresPerRound: state.scoresPerRound.map((r) => r.slice()),
      roemEvents: state.roemEvents.map((e) => ({ team: e.team, seat: e.seat, kind: e.kind, points: e.points })),
      bidding: state.bidding
        ? { current: state.bidding.current, passes: state.bidding.passes.slice(), forced: state.bidding.forced }
        : null,
    },
  };
}

// ---------------------------------------------------------------------------
// GameDefinition
// ---------------------------------------------------------------------------

export function createKlaverjasDefinition(): KlaverjasDefinition {
  return {
    id: 'klaverjassen',
    naam: 'Klaverjassen',
    minPlayers: 4,
    maxPlayers: 4,

    createInitialState(players: PlayerConfig[], config: KlaverjasVariantConfig, seed?: number): KlaverjasState {
      if (players.length !== config.playerCount) {
        throw new Error(`Aantal spelers (${players.length}) komt niet overeen met de variant (${config.playerCount})`);
      }
      const n = config.playerCount;
      const state: KlaverjasState = {
        config: structuredClone(config),
        players: structuredClone(players),
        seatCount: n,
        seed: (seed ?? Math.floor(Math.random() * 0x7fffffff)) >>> 0,
        phase: 'playing',
        roundIndex: 0,
        dealer: 0 as Seat,
        voorhand: 1 as Seat,
        trump: null,
        makingTeam: null,
        hands: Array.from({ length: n }, () => []),
        bidding: null,
        currentTrick: { index: 0, leader: 1 as Seat, plays: [] },
        completedTricks: [],
        teamTricks: [0, 0],
        teamCardPoints: [0, 0],
        teamRoem: [0, 0],
        roemEvents: [],
        turn: null,
        teamTotals: [0, 0],
        scoresPerRound: [],
      };
      beginRound(state);
      return state;
    },

    initialEvents(state: KlaverjasState): GameEvent[] {
      const events: GameEvent[] = [
        { type: 'gameStart', gameId: `klaverjassen-${state.seed}`, players: structuredClone(state.players), seatCount: state.seatCount },
      ];
      events.push(...roundOpeningEvents(state));
      return events;
    },

    getView(state: KlaverjasState, seat: Seat): PublicGameView {
      return buildView(state, seat);
    },

    getLegalMoves(state: KlaverjasState, seat: Seat): KlaverjasMove[] {
      return klaverjasLegalMoves(state, seat);
    },

    applyMove(state: KlaverjasState, seat: Seat, move: KlaverjasMove) {
      const next = structuredClone(state);
      let events: GameEvent[];
      switch (move.type) {
        case 'bid':
          events = applyBid(next, seat, move.choice);
          break;
        case 'playCard':
          events = applyPlayCard(next, seat, move.card);
          break;
        default:
          throw new Error(`Onbekend zet-type: ${(move as { type: string }).type}`);
      }
      return { state: next, events };
    },

    currentActor(state: KlaverjasState): Seat | null {
      if (state.phase === 'bidding') return state.bidding?.current ?? null;
      if (state.phase === 'playing') return state.turn;
      return null;
    },

    isFinished(state: KlaverjasState): boolean {
      return state.phase === 'finished';
    },

    getWinners(state: KlaverjasState): Seat[] {
      if (state.phase !== 'finished') throw new Error('De partij is nog niet afgelopen');
      return computeWinners(state);
    },
  };
}
