/**
 * src/games/hartenjagen/engine.ts
 * De Hartenjagen-GameDefinition (Engels: Hearts). UI-loos en deterministisch
 * (seedbare shuffle). applyMove muteert de input-state nooit (kloont eerst).
 *
 * Verloop per ronde: delen → (optioneel) 3 kaarten doorgeven in een roterende
 * richting → slagen spelen (♣2 komt uit, bekennen verplicht, harten pas leiden
 * na "breken", geen strafkaarten in de eerste slag) → scoren (harten 1, ♠V 13;
 * "schiet de maan" = alle 26 → 0 voor jou, 26 voor de rest). Partij eindigt
 * zodra iemand endScore haalt; laagste totaal wint.
 */

import type { Card, GameEvent, PlayerConfig, PublicGameView, Seat } from '../../core/types.ts';
import { createDeck, deal, sortHand, trickWinner } from '../../core/deck.ts';
import type {
  HartenjagenDefinition,
  HartenjagenMove,
  HartenjagenState,
  HartenjagenVariantConfig,
  PassDirection,
} from './types.ts';

const CLUB_TWO_ID = 'clubs-2';
const QUEEN_SPADES_ID = 'spades-12';

// ---------------------------------------------------------------------------
// Hulpfuncties
// ---------------------------------------------------------------------------

const nextSeat = (seat: Seat, n: number): Seat => ((seat + 1) % n) as Seat;

function passTarget(seat: Seat, dir: PassDirection, n: number): Seat {
  switch (dir) {
    case 'left': return ((seat + 1) % n) as Seat;
    case 'right': return ((seat - 1 + n) % n) as Seat;
    case 'across': return ((seat + Math.floor(n / 2)) % n) as Seat;
    default: return seat;
  }
}

function passDirForRound(roundIndex: number, config: HartenjagenVariantConfig): PassDirection {
  if (!config.passing) return 'none';
  const cyclus: PassDirection[] = ['left', 'right', 'across', 'none'];
  return cyclus[roundIndex % cyclus.length]!;
}

function cardPenalty(card: Card, config: HartenjagenVariantConfig): number {
  if (card.id === QUEEN_SPADES_ID) return config.queenPenalty;
  if (card.suit === 'hearts') return config.heartPenalty;
  return 0;
}

const tricksPerRound = (n: number): number => Math.floor(52 / n);

function holderOfClubTwo(hands: Card[][]): Seat {
  for (let s = 0; s < hands.length; s++) {
    if (hands[s]!.some((c) => c.id === CLUB_TWO_ID)) return s as Seat;
  }
  return 0 as Seat;
}

function toRecord(values: readonly number[]): Record<number, number> {
  const out: Record<number, number> = {};
  values.forEach((v, i) => (out[i] = v));
  return out;
}

/** Alle combinaties van 3 kaarten uit `cards` (in handvolgorde → canoniek). */
function combos3(cards: Card[]): Card[][] {
  const out: Card[][] = [];
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      for (let k = j + 1; k < cards.length; k++) {
        out.push([cards[i]!, cards[j]!, cards[k]!]);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Regels: legale zetten
// ---------------------------------------------------------------------------

/** Legale te spelen kaarten voor `seat` (alleen tijdens 'playing' en aan de beurt). */
function legalPlays(state: HartenjagenState, seat: Seat): Card[] {
  const hand = state.hands[seat] ?? [];
  const trick = state.currentTrick;
  const leading = trick.plays.length === 0;

  if (leading) {
    // Eerste slag: de ♣2-houder komt verplicht met ♣2 uit.
    if (state.firstTrick) return hand.filter((c) => c.id === CLUB_TWO_ID);
    // Harten mag pas geleid worden nadat ze gebroken zijn (tenzij alleen harten).
    if (!state.heartsBroken) {
      const nonHarten = hand.filter((c) => c.suit !== 'hearts');
      return nonHarten.length > 0 ? nonHarten : hand;
    }
    return hand;
  }

  const led = trick.plays[0]!.card.suit;
  const bekennen = hand.filter((c) => c.suit === led);
  if (bekennen.length > 0) return bekennen;

  // Niet kunnen bekennen → afgooien. In de eerste slag geen strafkaarten
  // (harten/♠V), tenzij je niets anders hebt.
  if (state.firstTrick) {
    const veilig = hand.filter((c) => c.suit !== 'hearts' && c.id !== QUEEN_SPADES_ID);
    return veilig.length > 0 ? veilig : hand;
  }
  return hand;
}

/** Legale zetten voor een stoel (gedeeld door getLegalMoves en getView.legalMoves). */
function hartenjagenLegalMoves(state: HartenjagenState, seat: Seat): HartenjagenMove[] {
  if (state.phase === 'passing') {
    if (state.passed[seat] !== null) return [];
    if (currentPassSeat(state) !== seat) return [];
    return combos3(state.hands[seat] ?? []).map((cards) => ({ type: 'passCards', cards }));
  }
  if (state.phase === 'playing' && state.turn === seat) {
    return legalPlays(state, seat).map((card) => ({ type: 'playCard', card }));
  }
  return [];
}

/** Laagste stoel die nog moet doorgeven, of null. */
function currentPassSeat(state: HartenjagenState): Seat | null {
  for (let s = 0; s < state.seatCount; s++) {
    if (state.passed[s] === null) return s as Seat;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rondeflow
// ---------------------------------------------------------------------------

function dealEventFromState(state: HartenjagenState): GameEvent {
  const hands: Partial<Record<Seat, Card[]>> = {};
  const handSizes: Record<number, number> = {};
  state.hands.forEach((h, seat) => {
    hands[seat as Seat] = h.map((c) => ({ ...c }));
    handSizes[seat] = h.length;
  });
  return { type: 'deal', roundIndex: state.roundIndex, dealer: nominalDealer(state), hands, handSizes };
}

const nominalDealer = (state: HartenjagenState): Seat =>
  (state.roundIndex % state.seatCount) as Seat;

/** Deel de kaarten voor deze ronde en reset de rondestate. */
function dealCards(state: HartenjagenState): void {
  const n = state.seatCount;
  const removed = removedFor(n);
  const deck = createDeck(removed);
  const rng = mulberry(state.seed + state.roundIndex * 7919);
  const geschud = shuffleWith(deck, rng);
  const hands = deal(geschud, n, nominalDealer(state));
  state.hands = hands.map((h) => sortHand(h));
  state.passed = new Array<Card[] | null>(n).fill(null);
  state.completedTricks = [];
  state.trickCounts = new Array<number>(n).fill(0);
  state.pointsTaken = new Array<number>(n).fill(0);
  state.heartsBroken = false;
  state.firstTrick = true;
  state.currentTrick = { index: 0, leader: 0 as Seat, plays: [] };
  state.turn = null;
}

/** Welke kaarten worden uit het deck verwijderd om 52 deelbaar te maken door n. */
function removedFor(n: number): string[] {
  // Standaardvariant = 4 spelers (geen verwijdering). Andere aantallen volgen
  // als variant; hier minimaal: 3 → ♦2 weg (51), 5 → ♦2+♣2 weg (50), 6 → 4 weg.
  if (n === 3) return ['diamonds-2'];
  if (n === 5) return ['diamonds-2', 'clubs-2'];
  if (n === 6) return ['diamonds-2', 'diamonds-3', 'clubs-2', 'clubs-3'];
  return [];
}

// Lokale deterministische shuffle (zelfde mulberry32 als core/deck, maar met
// een ronde-afhankelijke seed zodat elke ronde anders deelt en toch replaybaar is).
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffleWith(items: readonly Card[], rng: () => number): Card[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

/** Begin de ronde: deal + bepaal of er doorgegeven wordt of direct gespeeld. */
function beginRound(state: HartenjagenState): void {
  state.passDir = passDirForRound(state.roundIndex, state.config);
  dealCards(state);
  if (state.passDir === 'none') {
    startPlaying(state);
  } else {
    state.phase = 'passing';
  }
}

/** Voer het doorgeven uit: elke stoel geeft zijn 3 gekozen kaarten aan zijn doel. */
function performPass(state: HartenjagenState): void {
  const n = state.seatCount;
  for (let s = 0; s < n; s++) {
    const kaarten = state.passed[s] ?? [];
    const doel = passTarget(s as Seat, state.passDir, n);
    state.hands[doel]!.push(...kaarten.map((c) => ({ ...c })));
  }
  state.hands = state.hands.map((h) => sortHand(h));
}

/** Start de speelfase: de ♣2-houder komt uit. */
function startPlaying(state: HartenjagenState): void {
  const leider = holderOfClubTwo(state.hands);
  state.phase = 'playing';
  state.firstTrick = true;
  state.currentTrick = { index: 0, leader: leider, plays: [] };
  state.turn = leider;
}

function computeWinners(state: HartenjagenState): Seat[] {
  const laagste = Math.min(...state.totals);
  const winners: Seat[] = [];
  state.totals.forEach((t, s) => {
    if (t === laagste) winners.push(s as Seat);
  });
  return winners;
}

/** Rond de ronde af: scoren (incl. maan), totaliseren, en door naar de volgende of einde. */
function finishRound(state: HartenjagenState): GameEvent[] {
  const n = state.seatCount;
  const events: GameEvent[] = [];
  const maxStraf = state.config.heartPenalty * 13 + state.config.queenPenalty; // 26 standaard

  let scores = state.pointsTaken.slice();
  let maanSchutter = -1;
  if (state.config.shootMoon) {
    for (let s = 0; s < n; s++) if (state.pointsTaken[s] === maxStraf) maanSchutter = s;
  }
  if (maanSchutter >= 0) {
    scores = state.pointsTaken.map((_, s) => (s === maanSchutter ? 0 : maxStraf));
    events.push({ type: 'custom', subtype: 'shootMoon', data: { seat: maanSchutter } });
  }

  state.scoresPerRound.push(scores.slice());
  state.totals = state.totals.map((t, i) => t + (scores[i] ?? 0));
  events.push({ type: 'roundEnd', roundIndex: state.roundIndex, roundKind: 'hartenjagen', scores: toRecord(scores) });
  events.push({ type: 'scoreUpdate', totals: toRecord(state.totals) });

  state.roundIndex += 1;
  if (Math.max(...state.totals) >= state.config.endScore) {
    state.phase = 'finished';
    state.turn = null;
    events.push({ type: 'gameEnd', winners: computeWinners(state), totals: toRecord(state.totals) });
  } else {
    beginRound(state);
    events.push(...roundOpeningEvents(state));
  }
  return events;
}

/** Events die het begin van een ronde beschrijven (roundStart, deal, pass/turn). */
function roundOpeningEvents(state: HartenjagenState): GameEvent[] {
  const events: GameEvent[] = [
    {
      type: 'roundStart',
      roundIndex: state.roundIndex,
      roundKind: 'hartenjagen',
      roundLabel: state.passDir,
      dealer: nominalDealer(state),
    },
    dealEventFromState(state),
  ];
  if (state.phase === 'passing') {
    events.push({ type: 'custom', subtype: 'passRequest', data: { direction: state.passDir, count: 3 } });
  } else if (state.phase === 'playing' && state.turn !== null) {
    events.push({ type: 'turnStart', seat: state.turn, trickIndex: state.currentTrick.index });
  }
  return events;
}

// ---------------------------------------------------------------------------
// Zet-afhandeling
// ---------------------------------------------------------------------------

function applyPassCards(state: HartenjagenState, seat: Seat, cards: Card[]): GameEvent[] {
  if (state.phase !== 'passing') throw new Error('Er wordt nu niet doorgegeven');
  if (currentPassSeat(state) !== seat) throw new Error('Niet aan de beurt om door te geven');
  if (cards.length !== 3) throw new Error('Geef precies 3 kaarten door');
  const hand = state.hands[seat] ?? [];
  const gekozen: Card[] = [];
  for (const c of cards) {
    const inHand = hand.find((h) => h.id === c.id);
    if (!inHand) throw new Error(`Kaart ${c.id} zit niet in de hand`);
    if (gekozen.some((g) => g.id === c.id)) throw new Error('Dubbele kaart in doorgeefkeuze');
    gekozen.push(inHand);
  }
  state.hands[seat] = hand.filter((c) => !gekozen.some((g) => g.id === c.id));
  state.passed[seat] = gekozen;

  const events: GameEvent[] = [{ type: 'custom', subtype: 'cardsPassed', data: { seat } }];

  if (currentPassSeat(state) === null) {
    // Iedereen heeft doorgegeven: ruilen + nieuwe (gepersonaliseerde) handen + spelen.
    performPass(state);
    startPlaying(state);
    events.push({ type: 'custom', subtype: 'passComplete', data: {} });
    events.push(dealEventFromState(state));
    if (state.turn !== null) {
      events.push({ type: 'turnStart', seat: state.turn, trickIndex: state.currentTrick.index });
    }
  }
  return events;
}

function applyPlayCard(state: HartenjagenState, seat: Seat, played: Card): GameEvent[] {
  if (state.phase !== 'playing' || state.turn !== seat) throw new Error('Niet aan de beurt');
  const legaal = legalPlays(state, seat);
  const card = legaal.find((c) => c.id === played.id);
  if (!card) throw new Error(`Kaart ${played.id} is hier niet toegestaan`);

  const n = state.seatCount;
  state.hands[seat] = (state.hands[seat] ?? []).filter((c) => c.id !== card.id);
  state.currentTrick.plays.push({ seat, card });
  if (card.suit === 'hearts' && !state.heartsBroken) {
    state.heartsBroken = true;
  }

  const events: GameEvent[] = [{ type: 'playCard', seat, card, trickIndex: state.currentTrick.index }];

  if (state.currentTrick.plays.length === n) {
    const winner = trickWinner(state.currentTrick.plays, null);
    state.currentTrick.winner = winner;
    state.trickCounts[winner] = (state.trickCounts[winner] ?? 0) + 1;
    const straf = state.currentTrick.plays.reduce((sum, p) => sum + cardPenalty(p.card, state.config), 0);
    state.pointsTaken[winner] = (state.pointsTaken[winner] ?? 0) + straf;
    const voltooid = state.currentTrick;
    state.completedTricks.push(voltooid);
    events.push({ type: 'trickWon', trickIndex: voltooid.index, winner, trick: structuredClone(voltooid) });
    state.firstTrick = false;
    state.currentTrick = { index: voltooid.index + 1, leader: winner, plays: [] };

    if (state.completedTricks.length >= tricksPerRound(n)) {
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
// GameDefinition
// ---------------------------------------------------------------------------

export function createHartenjagenDefinition(): HartenjagenDefinition {
  return {
    id: 'hartenjagen',
    naam: 'Hartenjagen',
    minPlayers: 4,
    maxPlayers: 4,

    createInitialState(players: PlayerConfig[], config: HartenjagenVariantConfig, seed?: number): HartenjagenState {
      if (players.length !== config.playerCount) {
        throw new Error(`Aantal spelers (${players.length}) komt niet overeen met de variant (${config.playerCount})`);
      }
      const n = config.playerCount;
      const state: HartenjagenState = {
        config: structuredClone(config),
        players: structuredClone(players),
        seatCount: n,
        seed: (seed ?? Math.floor(Math.random() * 0x7fffffff)) >>> 0,
        phase: 'passing',
        roundIndex: 0,
        passDir: 'left',
        hands: Array.from({ length: n }, () => []),
        passed: new Array<Card[] | null>(n).fill(null),
        currentTrick: { index: 0, leader: 0 as Seat, plays: [] },
        completedTricks: [],
        trickCounts: new Array<number>(n).fill(0),
        pointsTaken: new Array<number>(n).fill(0),
        heartsBroken: false,
        firstTrick: true,
        turn: null,
        totals: new Array<number>(n).fill(0),
        scoresPerRound: [],
      };
      beginRound(state);
      return state;
    },

    initialEvents(state: HartenjagenState): GameEvent[] {
      const events: GameEvent[] = [
        { type: 'gameStart', gameId: `hartenjagen-${state.seed}`, players: structuredClone(state.players), seatCount: state.seatCount },
      ];
      events.push(...roundOpeningEvents(state));
      return events;
    },

    getView(state: HartenjagenState, seat: Seat): PublicGameView {
      const playedCards: Card[] = [];
      for (const trick of state.completedTricks) for (const p of trick.plays) playedCards.push({ ...p.card });
      for (const p of state.currentTrick.plays) playedCards.push({ ...p.card });

      const legalCards =
        state.phase === 'playing' && state.turn === seat ? legalPlays(state, seat).map((c) => ({ ...c })) : [];

      return {
        seat,
        seatCount: state.seatCount,
        hand: sortHand(state.hands[seat] ?? []),
        handSizes: state.hands.map((h) => h.length),
        currentTrick: structuredClone(state.currentTrick),
        completedTricks: structuredClone(state.completedTricks),
        playedCards,
        trickCounts: state.trickCounts.slice(),
        round: {
          index: state.roundIndex,
          kind: 'hartenjagen',
          label: state.passDir,
          dealer: nominalDealer(state),
          trump: null,
        },
        totalRounds: 0, // open einde: tot iemand endScore haalt
        turn: state.turn,
        totals: state.totals.slice(),
        scoresPerRound: state.scoresPerRound.map((r) => r.slice()),
        playerNames: state.players.map((p) => p.name),
        legalCards,
        legalMoves: hartenjagenLegalMoves(state, seat),
        viewExtras: {
          phase: state.phase,
          passDir: state.passDir,
          heartsBroken: state.heartsBroken,
          pointsTaken: state.pointsTaken.slice(),
        },
      };
    },

    getLegalMoves(state: HartenjagenState, seat: Seat): HartenjagenMove[] {
      return hartenjagenLegalMoves(state, seat);
    },

    applyMove(state: HartenjagenState, seat: Seat, move: HartenjagenMove) {
      const next = structuredClone(state);
      let events: GameEvent[];
      switch (move.type) {
        case 'passCards':
          events = applyPassCards(next, seat, move.cards);
          break;
        case 'playCard':
          events = applyPlayCard(next, seat, move.card);
          break;
        default:
          throw new Error(`Onbekend zet-type: ${(move as { type: string }).type}`);
      }
      return { state: next, events };
    },

    currentActor(state: HartenjagenState): Seat | null {
      if (state.phase === 'passing') return currentPassSeat(state);
      if (state.phase === 'playing') return state.turn;
      return null;
    },

    isFinished(state: HartenjagenState): boolean {
      return state.phase === 'finished';
    },

    getWinners(state: HartenjagenState): Seat[] {
      if (state.phase !== 'finished') throw new Error('De partij is nog niet afgelopen');
      return computeWinners(state);
    },
  };
}
