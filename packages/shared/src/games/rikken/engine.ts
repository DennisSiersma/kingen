/**
 * src/games/rikken/engine.ts
 * De Rikken-GameDefinition (Stichting Rikken 2025). UI-loos en deterministisch
 * (seedbare shuffle). applyMove muteert de input-state nooit (kloont eerst).
 *
 * Fasemachine per ronde: delen → bidding (opbieden tot 3 passen) → choosingTrump
 * (declarer, tenzij beter rik/alleen-beter = harten of troefloos) → askingAce
 * (rik: geheime maat meevragen) → playing (13 slagen, bekennen verplicht, troeven
 * niet) → afrekenen (Stichting-telling, nulsom). Iedereen past → de deler kiest
 * een passspel (Schoppen Mie / 1-of-5). De maat blijft verborgen tot de gevraagde
 * aas valt.
 */

import type { Card, GameEvent, PlayerConfig, PublicGameView, Seat, Suit } from '../../core/types.ts';
import { SUITS } from '../../core/types.ts';
import { createDeck, createRng, deal, shuffle, sortHand, trickWinner } from '../../core/deck.ts';
import {
  doelSlagen,
  forceertHarten,
  gebruiktTroef,
  heeftMaat,
  isClaimbaar,
  isMisereFamilie,
  isPiekFamilie,
} from './bids.ts';
import type { Bid } from './bids.ts';
import { legalBids } from './bidRules.ts';
import { legalPlays } from './rules.ts';
import { scorePassGame, scoreRonde } from './scoring.ts';
import type {
  BiddingState,
  PassGame,
  RikkenDefinition,
  RikkenMove,
  RikkenState,
  RikkenVariantConfig,
} from './types.ts';

const leftOf = (seat: Seat, n: number): Seat => ((seat + 1) % n) as Seat;
const nextSeat = (seat: Seat, n: number): Seat => ((seat + 1) % n) as Seat;

function toRecord(values: readonly number[]): Record<number, number> {
  const out: Record<number, number> = {};
  values.forEach((v, i) => (out[i] = v));
  return out;
}

const TRICKS_PER_ROUND = 13;

// ---------------------------------------------------------------------------
// Legale zetten per fase
// ---------------------------------------------------------------------------

/** Aanvraagbare azen/heren voor de declarer (maat meevragen). */
function legalAsks(state: RikkenState): string[] {
  const c = state.contract;
  if (!c) return [];
  const hand = state.hands[c.declarer] ?? [];
  const trump = c.trump;
  const heeftAas = (s: Suit): boolean => hand.some((k) => k.suit === s && k.rank === 14);
  const azen = SUITS.filter(heeftAas);

  // Alle 4 azen → vraag een niet-troef-heer die je zelf niet hebt.
  if (azen.length === 4) {
    return SUITS.filter((s) => s !== trump)
      .map((s) => `${s}-13`)
      .filter((id) => !hand.some((k) => k.id === id));
  }

  const out: string[] = [];
  for (const s of SUITS) {
    if (s === trump || heeftAas(s)) continue;
    if (hand.some((k) => k.suit === s)) out.push(`${s}-14`); // aas van niet-troefkleur waarvan je een kaart hebt
  }
  // Vereenvoudigde fallback (geen blind-vragen in v1): elke niet-troef-aas die je mist.
  if (out.length === 0) {
    for (const s of SUITS) if (s !== trump && !heeftAas(s)) out.push(`${s}-14`);
  }
  return out;
}

function rikkenLegalMoves(state: RikkenState, seat: Seat): RikkenMove[] {
  switch (state.phase) {
    case 'bidding':
      return state.bidding && state.bidding.current === seat ? legalBids(state.bidding, state.config) : [];
    case 'choosingTrump':
      return state.turn === seat ? SUITS.map((suit) => ({ type: 'chooseTrump', suit })) : [];
    case 'askingAce':
      return state.turn === seat ? legalAsks(state).map((cardId) => ({ type: 'askAce', cardId })) : [];
    case 'choosingPassGame':
      return state.turn === seat
        ? ([
            { type: 'choosePassGame', game: 'schoppenMie' },
            { type: 'choosePassGame', game: 'eenOfVijf' },
          ] as RikkenMove[])
        : [];
    case 'playing':
      return state.turn === seat ? legalPlays(state, seat).map((card) => ({ type: 'playCard', card })) : [];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Rondeflow
// ---------------------------------------------------------------------------

function dealEventFromState(state: RikkenState): GameEvent {
  const hands: Partial<Record<Seat, Card[]>> = {};
  const handSizes: Record<number, number> = {};
  state.hands.forEach((h, seat) => {
    hands[seat as Seat] = h.map((c) => ({ ...c }));
    handSizes[seat] = h.length;
  });
  return { type: 'deal', roundIndex: state.roundIndex, dealer: state.dealer, hands, handSizes };
}

function dealCards(state: RikkenState): void {
  const n = state.seatCount;
  const deck = createDeck();
  const geschud = shuffle(deck, createRng(state.seed + state.roundIndex * 7919));
  const hands = deal(geschud, n, state.dealer);
  state.hands = hands.map((h) => sortHand(h));
  state.contract = null;
  state.partnerRevealed = false;
  state.completedTricks = [];
  state.trickCounts = new Array<number>(n).fill(0);
  state.currentTrick = { index: 0, leader: leftOf(state.dealer, n), plays: [] };
  state.turn = null;
}

function beginRound(state: RikkenState): void {
  state.dealer = (state.roundIndex % state.seatCount) as Seat;
  dealCards(state);
  state.phase = 'bidding';
  state.bidding = {
    current: leftOf(state.dealer, state.seatCount),
    passed: new Array<boolean>(state.seatCount).fill(false),
    highest: null,
    highestBidder: null,
    rikGeboden: false,
    claimers: [],
  };
}

function roundOpeningEvents(state: RikkenState): GameEvent[] {
  const events: GameEvent[] = [
    { type: 'roundStart', roundIndex: state.roundIndex, roundKind: 'rikken', roundLabel: 'rikken', dealer: state.dealer },
    dealEventFromState(state),
  ];
  if (state.bidding) {
    events.push({ type: 'custom', subtype: 'bidTurn', data: { seat: state.bidding.current } });
  }
  return events;
}

/** Volgende nog-niet-gepaste stoel, met de klok mee. */
function volgendeBieder(b: BiddingState, n: number): Seat {
  let s = nextSeat(b.current, n);
  for (let i = 0; i < n; i++) {
    if (!b.passed[s]) return s;
    s = nextSeat(s, n);
  }
  return b.current;
}

function computeWinners(state: RikkenState): Seat[] {
  const hoogste = Math.max(...state.totals);
  const winners: Seat[] = [];
  state.totals.forEach((t, s) => {
    if (t === hoogste) winners.push(s as Seat);
  });
  return winners;
}

// ---------------------------------------------------------------------------
// Faseovergangen
// ---------------------------------------------------------------------------

function naTroef(state: RikkenState): GameEvent[] {
  const c = state.contract!;
  if (heeftMaat(c.kind)) {
    state.phase = 'askingAce';
    state.turn = c.declarer;
    return [{ type: 'custom', subtype: 'askAceTurn', data: { seat: c.declarer } }];
  }
  return startPlaying(state);
}

function startPlaying(state: RikkenState): GameEvent[] {
  const c = state.contract!;
  const n = state.seatCount;
  // Uitkomer: links van de deler; 13-alleen → de declarer komt zelf uit.
  const leider = c.kind === 'alleen13' ? c.declarer : leftOf(state.dealer, n);
  state.phase = 'playing';
  state.currentTrick = { index: 0, leader: leider, plays: [] };
  state.turn = leider;
  return [
    {
      type: 'custom',
      subtype: 'contractSet',
      data: { kind: c.kind, beter: c.beter, declarer: c.declarer, trump: c.trump, target: c.target, askedSuit: c.askedSuit, passGame: c.passGame },
    },
    { type: 'turnStart', seat: leider, trickIndex: 0 },
  ];
}

function endBidding(state: RikkenState): GameEvent[] {
  const b = state.bidding!;
  const bid = b.highest!;
  const declarer = b.highestBidder!;
  const events: GameEvent[] = [
    { type: 'custom', subtype: 'biddingEnded', data: { declarer, kind: bid.kind, beter: bid.beter ?? false } },
  ];
  state.contract = {
    kind: bid.kind,
    beter: bid.beter ?? false,
    declarer,
    trump: null,
    target: doelSlagen(bid.kind),
    partner: null,
    claimers: b.claimers.slice(),
  };
  state.bidding = null;

  if (gebruiktTroef(bid.kind)) {
    if (forceertHarten(bid.kind) || bid.beter) {
      state.contract.trump = 'hearts';
      events.push(...naTroef(state));
    } else {
      state.phase = 'choosingTrump';
      state.turn = declarer;
      events.push({ type: 'custom', subtype: 'chooseTrumpTurn', data: { seat: declarer } });
    }
  } else {
    state.contract.trump = null; // piek/misère/open: troefloos
    events.push(...naTroef(state));
  }
  return events;
}

function allenGepast(state: RikkenState): GameEvent[] {
  state.contract = {
    kind: 'rik', beter: false, declarer: state.dealer, trump: null, target: 0, partner: null,
  };
  if (state.config.passSpellen) {
    state.phase = 'choosingPassGame';
    state.turn = state.dealer;
    return [{ type: 'custom', subtype: 'choosePassGameTurn', data: { seat: state.dealer } }];
  }
  // Geen passspellen: opnieuw delen met de volgende deler.
  state.roundIndex += 0; // dezelfde gift telt niet door; gewoon herdelen
  beginRound(state);
  return roundOpeningEvents(state);
}

/** Vroeg-stop voor piek/misère: doel definitief gemist? */
function piekMisereGefaald(state: RikkenState): boolean {
  const c = state.contract;
  if (!c) return false;
  const eigen = state.trickCounts[c.declarer] ?? 0;
  if (isPiekFamilie(c.kind)) return eigen > 1; // piek = exact 1
  if (isMisereFamilie(c.kind)) return eigen >= 1; // misère = exact 0
  return false;
}

function finishRound(state: RikkenState): GameEvent[] {
  const events: GameEvent[] = [];
  const c = state.contract!;
  const deltas = c.passGame
    ? scorePassGame(c.passGame, state.trickCounts, state.completedTricks)
    : scoreRonde(c, state.trickCounts, state.config).deltas;

  state.scoresPerRound.push(deltas.slice());
  state.totals = state.totals.map((t, i) => t + (deltas[i] ?? 0));

  events.push({
    type: 'custom',
    subtype: 'contractResolved',
    data: {
      kind: c.kind,
      passGame: c.passGame,
      declarer: c.declarer,
      partner: c.partner,
      trickCounts: state.trickCounts.slice(),
      deltas,
    },
  });
  events.push({ type: 'roundEnd', roundIndex: state.roundIndex, roundKind: 'rikken', scores: toRecord(deltas) });
  events.push({ type: 'scoreUpdate', totals: toRecord(state.totals) });

  state.roundIndex += 1;
  if (state.roundIndex >= state.config.rondes) {
    state.phase = 'finished';
    state.turn = null;
    events.push({ type: 'gameEnd', winners: computeWinners(state), totals: toRecord(state.totals) });
  } else {
    beginRound(state);
    events.push(...roundOpeningEvents(state));
  }
  return events;
}

// ---------------------------------------------------------------------------
// Zet-afhandeling
// ---------------------------------------------------------------------------

function valideer(legal: RikkenMove[], move: RikkenMove): void {
  const wanted = JSON.stringify(move);
  if (!legal.some((m) => JSON.stringify(m) === wanted)) {
    throw new Error(`Zet niet toegestaan: ${wanted}`);
  }
}

function applyBid(state: RikkenState, seat: Seat, bid: Bid | 'pass'): GameEvent[] {
  const b = state.bidding;
  if (!b || b.current !== seat) throw new Error('Niet aan de beurt om te bieden');
  valideer(legalBids(b, state.config), { type: 'bid', bid });
  const n = state.seatCount;
  const events: GameEvent[] = [{ type: 'custom', subtype: 'bidPlaced', data: { seat, bid } }];

  if (bid === 'pass') {
    b.passed[seat] = true;
  } else {
    const claim = b.highest !== null && bid.kind === b.highest.kind && isClaimbaar(bid.kind);
    if (claim) {
      if (!b.claimers.includes(seat)) b.claimers.push(seat);
    } else {
      b.highest = bid;
      b.highestBidder = seat;
      b.claimers = [];
    }
    if (bid.kind === 'rik' || bid.kind === 'beterRik') b.rikGeboden = true;
  }

  const gepast = b.passed.filter(Boolean).length;
  if (b.highest !== null && gepast >= n - 1) {
    events.push(...endBidding(state));
  } else if (b.highest === null && gepast >= n) {
    events.push(...allenGepast(state));
  } else {
    b.current = volgendeBieder(b, n);
    events.push({ type: 'custom', subtype: 'bidTurn', data: { seat: b.current } });
  }
  return events;
}

function applyChooseTrump(state: RikkenState, seat: Seat, suit: Suit): GameEvent[] {
  if (state.phase !== 'choosingTrump' || state.turn !== seat) throw new Error('Niet aan de beurt voor troefkeuze');
  state.contract!.trump = suit;
  const events: GameEvent[] = [{ type: 'trumpChosen', roundIndex: state.roundIndex, trump: suit, chooser: seat }];
  events.push(...naTroef(state));
  return events;
}

function applyAskAce(state: RikkenState, seat: Seat, cardId: string): GameEvent[] {
  if (state.phase !== 'askingAce' || state.turn !== seat) throw new Error('Niet aan de beurt om een maat te vragen');
  valideer(legalAsks(state).map((id) => ({ type: 'askAce', cardId: id })), { type: 'askAce', cardId });
  const c = state.contract!;
  c.askedAceId = cardId;
  const sep = cardId.lastIndexOf('-');
  c.askedSuit = cardId.slice(0, sep) as Suit;
  // Vind de (verborgen) maat.
  for (let s = 0; s < state.seatCount; s++) {
    if ((state.hands[s] ?? []).some((k) => k.id === cardId)) {
      c.partner = s as Seat;
      break;
    }
  }
  const events: GameEvent[] = [{ type: 'custom', subtype: 'aceAsked', data: { declarer: seat, askedSuit: c.askedSuit } }];
  events.push(...startPlaying(state));
  return events;
}

function applyChoosePassGame(state: RikkenState, seat: Seat, game: PassGame): GameEvent[] {
  if (state.phase !== 'choosingPassGame' || state.turn !== seat) throw new Error('Niet aan de beurt voor passspelkeuze');
  state.contract!.passGame = game;
  const events: GameEvent[] = [{ type: 'custom', subtype: 'passGameChosen', data: { chooser: seat, passGame: game } }];
  events.push(...startPlaying(state));
  return events;
}

function applyPlayCard(state: RikkenState, seat: Seat, played: Card): GameEvent[] {
  if (state.phase !== 'playing' || state.turn !== seat) throw new Error('Niet aan de beurt');
  const legaal = legalPlays(state, seat);
  const card = legaal.find((c) => c.id === played.id);
  if (!card) throw new Error(`Kaart ${played.id} is hier niet toegestaan`);
  const n = state.seatCount;
  const c = state.contract!;

  state.hands[seat] = (state.hands[seat] ?? []).filter((k) => k.id !== card.id);
  state.currentTrick.plays.push({ seat, card });
  const events: GameEvent[] = [{ type: 'playCard', seat, card, trickIndex: state.currentTrick.index }];

  // Maat onthuld zodra de gevraagde aas valt.
  if (!state.partnerRevealed && c.askedAceId && card.id === c.askedAceId) {
    state.partnerRevealed = true;
    events.push({ type: 'custom', subtype: 'partnerRevealed', data: { partner: seat, card: { ...card } } });
  }

  if (state.currentTrick.plays.length === n) {
    const winner = trickWinner(state.currentTrick.plays, c.trump);
    state.currentTrick.winner = winner;
    state.trickCounts[winner] = (state.trickCounts[winner] ?? 0) + 1;
    const voltooid = state.currentTrick;
    state.completedTricks.push(voltooid);
    events.push({ type: 'trickWon', trickIndex: voltooid.index, winner, trick: structuredClone(voltooid) });
    state.currentTrick = { index: voltooid.index + 1, leader: winner, plays: [] };

    const klaar = state.completedTricks.length >= TRICKS_PER_ROUND || (!c.passGame && piekMisereGefaald(state));
    if (klaar) {
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

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

function buildView(state: RikkenState, seat: Seat): PublicGameView {
  const n = state.seatCount;
  const playedCards: Card[] = [];
  for (const t of state.completedTricks) for (const p of t.plays) playedCards.push({ ...p.card });
  for (const p of state.currentTrick.plays) playedCards.push({ ...p.card });

  const legalCards =
    state.phase === 'playing' && state.turn === seat ? legalPlays(state, seat).map((c) => ({ ...c })) : [];

  // Contract met VERBORGEN maat (pas onthuld na de gevraagde aas).
  const c = state.contract;
  const contractView = c
    ? {
        kind: c.kind,
        beter: c.beter,
        declarer: c.declarer,
        trump: c.trump,
        target: c.target,
        askedSuit: c.askedSuit,
        partner: state.partnerRevealed ? c.partner : null,
        passGame: c.passGame,
      }
    : null;

  const b = state.bidding;
  const biddingView = b
    ? {
        current: b.current,
        passed: b.passed.slice(),
        highest: b.highest,
        highestBidder: b.highestBidder,
        legalBids: b.current === seat ? legalBids(b, state.config) : [],
      }
    : null;

  return {
    seat,
    seatCount: n,
    hand: sortHand(state.hands[seat] ?? []),
    handSizes: state.hands.map((h) => h.length),
    currentTrick: structuredClone(state.currentTrick),
    completedTricks: structuredClone(state.completedTricks),
    playedCards,
    trickCounts: state.trickCounts.slice(),
    round: {
      index: state.roundIndex,
      kind: 'rikken',
      label: 'rikken',
      dealer: state.dealer,
      trump: c?.trump ?? null,
    },
    totalRounds: state.config.rondes,
    turn: state.phase === 'bidding' ? (b?.current ?? null) : state.turn,
    totals: state.totals.slice(),
    scoresPerRound: state.scoresPerRound.map((r) => r.slice()),
    playerNames: state.players.map((p) => p.name),
    legalCards,
    legalMoves: rikkenLegalMoves(state, seat),
    viewExtras: {
      phase: state.phase,
      contract: contractView,
      bidding: biddingView,
      partnerRevealed: state.partnerRevealed,
    },
  };
}

// ---------------------------------------------------------------------------
// GameDefinition
// ---------------------------------------------------------------------------

export function createRikkenDefinition(): RikkenDefinition {
  return {
    id: 'rikken',
    naam: 'Rikken',
    minPlayers: 4,
    maxPlayers: 4,

    createInitialState(players: PlayerConfig[], config: RikkenVariantConfig, seed?: number): RikkenState {
      if (players.length !== config.playerCount) {
        throw new Error(`Aantal spelers (${players.length}) komt niet overeen met de variant (${config.playerCount})`);
      }
      const n = config.playerCount;
      const state: RikkenState = {
        config: structuredClone(config),
        players: structuredClone(players),
        seatCount: n,
        seed: (seed ?? Math.floor(Math.random() * 0x7fffffff)) >>> 0,
        phase: 'bidding',
        roundIndex: 0,
        dealer: 0 as Seat,
        hands: Array.from({ length: n }, () => []),
        bidding: null,
        contract: null,
        partnerRevealed: false,
        currentTrick: { index: 0, leader: 1 as Seat, plays: [] },
        completedTricks: [],
        trickCounts: new Array<number>(n).fill(0),
        turn: null,
        totals: new Array<number>(n).fill(0),
        scoresPerRound: [],
      };
      beginRound(state);
      return state;
    },

    initialEvents(state: RikkenState): GameEvent[] {
      const events: GameEvent[] = [
        { type: 'gameStart', gameId: `rikken-${state.seed}`, players: structuredClone(state.players), seatCount: state.seatCount },
      ];
      events.push(...roundOpeningEvents(state));
      return events;
    },

    getView(state: RikkenState, seat: Seat): PublicGameView {
      return buildView(state, seat);
    },

    getLegalMoves(state: RikkenState, seat: Seat): RikkenMove[] {
      return rikkenLegalMoves(state, seat);
    },

    applyMove(state: RikkenState, seat: Seat, move: RikkenMove) {
      const next = structuredClone(state);
      let events: GameEvent[];
      switch (move.type) {
        case 'bid':
          events = applyBid(next, seat, move.bid);
          break;
        case 'chooseTrump':
          events = applyChooseTrump(next, seat, move.suit);
          break;
        case 'askAce':
          events = applyAskAce(next, seat, move.cardId);
          break;
        case 'choosePassGame':
          events = applyChoosePassGame(next, seat, move.game);
          break;
        case 'playCard':
          events = applyPlayCard(next, seat, move.card);
          break;
        default:
          throw new Error(`Onbekend zet-type: ${(move as { type: string }).type}`);
      }
      return { state: next, events };
    },

    currentActor(state: RikkenState): Seat | null {
      if (state.phase === 'bidding') return state.bidding?.current ?? null;
      if (state.phase === 'finished') return null;
      return state.turn;
    },

    isFinished(state: RikkenState): boolean {
      return state.phase === 'finished';
    },

    getWinners(state: RikkenState): Seat[] {
      if (state.phase !== 'finished') throw new Error('De partij is nog niet afgelopen');
      return computeWinners(state);
    },
  };
}
