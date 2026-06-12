/**
 * src/games/kingen/engine.ts
 * De Kingen-GameDefinition: implementatie van het generieke core-contract
 * (createInitialState, getView, getLegalMoves, applyMove, ...).
 *
 * De engine is UI-loos en deterministisch (seedbare shuffle): zelfde seed +
 * zelfde zetten => exact dezelfde events. applyMove muteert de input nooit.
 */

import type {
  Card,
  GameEvent,
  PlayerConfig,
  PublicGameView,
  Seat,
  Trick,
} from '../../core/types.ts';
import { createDeck, createRng, deal, shuffle, sortHand, trickWinner } from '../../core/deck.ts';
import { getTableParams } from './params.ts';
import { kingenRules, leftOf, trumpChooser } from './rules.ts';
import { remainingPenaltyForClaim, scoreRound, scoreRoundWithClaim } from './scoring.ts';
import type {
  ChoiceLedger,
  KingenDefinition,
  KingenMove,
  KingenRoundKind,
  KingenState,
  KingenVariantConfig,
} from './types.ts';
import { ALL_ROUND_KINDS, ROUND_LABELS_NL } from './types.ts';

const HEART_KING_ID = 'hearts-13';

// ---------------------------------------------------------------------------
// Interne helpers (muteren de doorgegeven state; applyMove kloont eerst)
// ---------------------------------------------------------------------------

function toRecord(values: readonly number[]): Record<number, number> {
  const out: Record<number, number> = {};
  values.forEach((v, i) => {
    out[i] = v;
  });
  return out;
}

function freshLedger(seatCount: number): ChoiceLedger {
  const negativeCounts = {} as Record<KingenRoundKind, number>;
  for (const kind of ALL_ROUND_KINDS) negativeCounts[kind] = 0;
  return {
    negativeCounts,
    trumpChoicesPerSeat: new Array<number>(seatCount).fill(0),
    choicesMadePerSeat: new Array<number>(seatCount).fill(0),
    forcedTrumpSeats: [],
  };
}

/** Welk spel hoort bij deze ronde in standaardmodus (vaste volgorde)? */
function scheduledKind(state: KingenState): KingenRoundKind {
  const order = state.config.roundOrder;
  return state.roundIndex < order.length ? order[state.roundIndex]! : 'troef';
}

/** Deterministische sub-seed per ronde. */
function roundSeed(state: KingenState): number {
  return (state.seed + (state.roundIndex + 1) * 7919) >>> 0;
}

function roundStartEvent(state: KingenState): GameEvent {
  const kind = state.roundKind!;
  return {
    type: 'roundStart',
    roundIndex: state.roundIndex,
    roundKind: kind,
    roundLabel: ROUND_LABELS_NL[kind],
    dealer: state.dealer,
  };
}

function dealEventFromState(state: KingenState): GameEvent {
  const hands: Partial<Record<Seat, Card[]>> = {};
  const handSizes: Record<number, number> = {};
  state.hands.forEach((hand, seat) => {
    hands[seat as Seat] = hand.map((c) => ({ ...c }));
    handSizes[seat] = hand.length;
  });
  return { type: 'deal', roundIndex: state.roundIndex, dealer: state.dealer, hands, handSizes };
}

/** Zet de fase op 'playing' en geef de uitkomer de beurt. */
function startPlaying(state: KingenState): GameEvent[] {
  state.phase = 'playing';
  state.turn = state.currentTrick.leader;
  return [{ type: 'turnStart', seat: state.turn, trickIndex: state.currentTrick.index }];
}

/** Het geschudde deck van deze ronde (deterministisch uit de rondeseed). */
function deckForRound(state: KingenState): ReturnType<typeof createDeck> {
  return shuffle(createDeck(state.params.removedCards), createRng(roundSeed(state)));
}

/** Schud en deel de kaarten voor deze ronde (zonder fase-overgang). */
function dealCards(state: KingenState): GameEvent[] {
  const n = state.params.playerCount;
  const hands = deal(deckForRound(state), n, state.dealer);
  state.hands = hands.map((h) => sortHand(h));
  state.completedTricks = [];
  state.trickCounts = new Array<number>(n).fill(0);
  state.heartKingFallen = false;
  state.currentTrick = { index: 0, leader: leftOf(state.dealer, n), plays: [] };
  state.trump = null;
  state.turn = null;
  return [dealEventFromState(state)];
}

/** Start de ronde ná het delen: troef bepalen/kiezen of direct gaan spelen. */
function startRoundAfterDeal(state: KingenState): GameEvent[] {
  const events: GameEvent[] = [];
  if (state.roundKind === 'troef') {
    if (state.config.trumpSelection === 'laatsteKaart') {
      // De laatst gedeelde kaart gaat altijd naar de deler en bepaalt troef
      // (het deck is deterministisch, dus hier reconstrueerbaar).
      const deck = deckForRound(state);
      state.trump = deck[deck.length - 1]!.suit;
      events.push({
        type: 'trumpChosen',
        roundIndex: state.roundIndex,
        trump: state.trump,
        chooser: state.dealer,
      });
      events.push(...startPlaying(state));
    } else {
      state.phase = 'choosingTrump';
    }
  } else {
    events.push(...startPlaying(state));
  }
  return events;
}

/** Begin de ronde met index state.roundIndex (deler doorschuiven, evt. spelkeuze). */
function beginRound(state: KingenState): GameEvent[] {
  const n = state.params.playerCount;
  state.dealer = (state.roundIndex % n) as Seat;
  state.trump = null;
  state.turn = null;
  state.heartKingFallen = false;
  state.completedTricks = [];
  state.currentTrick = { index: 0, leader: leftOf(state.dealer, n), plays: [] };

  if (state.config.mode === 'dubbel') {
    // Eerst delen, dán kiest de deler het spel — mét zicht op zijn hand
    // (zoals in het echte dubbelkingen). roundStart volgt na de keuze.
    state.roundKind = null;
    const events = dealCards(state);
    state.phase = 'choosingRoundKind';
    return events;
  }
  state.roundKind = scheduledKind(state);
  return [roundStartEvent(state), ...dealCards(state), ...startRoundAfterDeal(state)];
}

/** Winnaars op basis van de totalen (hoogste, of laagste bij lowestWins). */
function computeWinners(state: KingenState): Seat[] {
  const totals = state.totals;
  const best = state.config.lowestWins ? Math.min(...totals) : Math.max(...totals);
  const winners: Seat[] = [];
  totals.forEach((t, seat) => {
    if (t === best) winners.push(seat as Seat);
  });
  return winners;
}

/** Rond de ronde af: scoren, totaliseren en doorschakelen naar de volgende. */
function finishRound(
  state: KingenState,
  claim?: { seat: Seat; penalty: number },
): GameEvent[] {
  const kind = state.roundKind!;
  const scores = claim ? scoreRoundWithClaim(state, claim.seat, claim.penalty) : scoreRound(state);
  state.scoresPerRound.push(scores.slice());
  state.totals = state.totals.map((t, i) => t + (scores[i] ?? 0));
  state.phase = 'roundFinished';
  state.turn = null;

  const events: GameEvent[] = [
    { type: 'roundEnd', roundIndex: state.roundIndex, roundKind: kind, scores: toRecord(scores) },
    { type: 'scoreUpdate', totals: toRecord(state.totals) },
  ];

  state.roundIndex += 1;
  if (state.roundIndex >= state.params.totalRounds) {
    state.phase = 'gameFinished';
    state.roundKind = null;
    events.push({ type: 'gameEnd', winners: computeWinners(state), totals: toRecord(state.totals) });
  } else {
    events.push(...beginRound(state));
  }
  return events;
}

// ---------------------------------------------------------------------------
// Zet-afhandeling
// ---------------------------------------------------------------------------

function applyChooseRoundKind(state: KingenState, seat: Seat, kind: KingenRoundKind): GameEvent[] {
  if (state.phase !== 'choosingRoundKind') throw new Error('Er is nu geen spelkeuze aan de orde');
  if (state.dealer !== seat) throw new Error('Alleen de deler kiest het spel');
  const legal = kingenRules.legalRoundKinds(state, seat);
  if (!legal.includes(kind)) throw new Error(`Spelkeuze '${kind}' is niet (meer) toegestaan`);

  const ledger = state.choiceLedger!;
  const choicesBefore = ledger.choicesMadePerSeat[seat] ?? 0;
  ledger.choicesMadePerSeat[seat] = choicesBefore + 1;
  if (kind === 'troef') {
    ledger.trumpChoicesPerSeat[seat] = (ledger.trumpChoicesPerSeat[seat] ?? 0) + 1;
  } else {
    ledger.negativeCounts[kind] = (ledger.negativeCounts[kind] ?? 0) + 1;
  }

  const events: GameEvent[] = [
    { type: 'roundKindChosen', roundIndex: state.roundIndex, roundKind: kind, chooser: seat },
  ];

  // WK-regel derde-gift-troefdwang: wie ook op zijn 3e keuzebeurt geen troef
  // kiest, is zijn volgende twee keuzebeurten verplicht troef te kiezen.
  if (
    state.config.derdeGiftTroefdwang &&
    choicesBefore === 2 &&
    (ledger.trumpChoicesPerSeat[seat] ?? 0) === 0 &&
    !ledger.forcedTrumpSeats.includes(seat)
  ) {
    ledger.forcedTrumpSeats.push(seat);
    events.push({
      type: 'custom',
      subtype: 'troefdwang',
      data: { seat, melding: 'Derde keuzebeurt zonder troef: de volgende twee keuzes zijn verplicht troef.' },
    });
  }

  // De kaarten zijn al gedeeld (vóór de keuze); alleen nog de ronde starten.
  state.roundKind = kind;
  events.push(roundStartEvent(state), ...startRoundAfterDeal(state));
  return events;
}

function applyChooseTrump(state: KingenState, seat: Seat, suit: KingenState['trump']): GameEvent[] {
  if (state.phase !== 'choosingTrump') throw new Error('Er is nu geen troefkeuze aan de orde');
  if (trumpChooser(state) !== seat) throw new Error('Deze stoel mag de troef niet kiezen');
  const legal = kingenRules.legalTrumps(state, seat);
  if (!suit || !legal.includes(suit)) throw new Error(`Troefkeuze '${String(suit)}' is niet toegestaan`);
  state.trump = suit;
  const events: GameEvent[] = [
    { type: 'trumpChosen', roundIndex: state.roundIndex, trump: suit, chooser: seat },
  ];
  events.push(...startPlaying(state));
  return events;
}

function applyPlayCard(state: KingenState, seat: Seat, played: Card): GameEvent[] {
  if (state.phase !== 'playing' || state.turn !== seat) throw new Error('Niet aan de beurt');
  const legal = kingenRules.legalCards(state, seat);
  const card = legal.find((c) => c.id === played.id);
  if (!card) throw new Error(`Kaart ${played.id} is hier niet toegestaan`);

  const n = state.params.playerCount;
  state.hands[seat] = (state.hands[seat] ?? []).filter((c) => c.id !== card.id);
  state.currentTrick.plays.push({ seat, card });
  if (state.roundKind === 'hartenheer' && card.id === HEART_KING_ID) {
    state.heartKingFallen = true;
  }

  const events: GameEvent[] = [
    { type: 'playCard', seat, card, trickIndex: state.currentTrick.index },
  ];

  if (state.currentTrick.plays.length === n) {
    // Slag compleet: winnaar bepalen en innemen.
    const winner = trickWinner(state.currentTrick.plays, state.trump);
    state.currentTrick.winner = winner;
    state.trickCounts[winner] = (state.trickCounts[winner] ?? 0) + 1;
    const finished: Trick = state.currentTrick;
    state.completedTricks.push(finished);
    events.push({
      type: 'trickWon',
      trickIndex: finished.index,
      winner,
      trick: structuredClone(finished),
    });
    state.currentTrick = { index: finished.index + 1, leader: winner, plays: [] };

    if (kingenRules.isRoundFinished(state)) {
      events.push(...finishRound(state));
    } else {
      state.turn = winner;
      events.push({ type: 'turnStart', seat: winner, trickIndex: state.currentTrick.index });
    }
  } else {
    state.turn = leftOf(seat, n);
    events.push({ type: 'turnStart', seat: state.turn, trickIndex: state.currentTrick.index });
  }
  return events;
}

function applyClaimHand(state: KingenState, seat: Seat): GameEvent[] {
  if (!state.config.claimingAllowed) throw new Error('Hand afleggen (claimen) staat uit');
  if (state.phase !== 'playing' || state.turn !== seat) throw new Error('Niet aan de beurt');
  if (state.roundKind === 'troef') throw new Error('Claimen kan alleen in strafrondes');
  const penalty = remainingPenaltyForClaim(state, seat);
  const events: GameEvent[] = [{ type: 'handClaimed', seat, acceptedPenalty: penalty }];
  events.push(...finishRound(state, { seat, penalty }));
  return events;
}

// ---------------------------------------------------------------------------
// GameDefinition
// ---------------------------------------------------------------------------

/**
 * Fabrieksfunctie voor de Kingen-GameDefinition.
 * Gebruikt params.ts (tafelparameters), rules.ts (legale zetten) en
 * scoring.ts (rondescores); deck-logica uit src/core/deck.ts.
 */
export function createKingenDefinition(): KingenDefinition {
  return {
    id: 'kingen',
    naam: 'Kingen',
    minPlayers: 3,
    maxPlayers: 5,

    createInitialState(
      players: PlayerConfig[],
      config: KingenVariantConfig,
      seed?: number,
    ): KingenState {
      if (players.length !== config.playerCount) {
        throw new Error(
          `Aantal spelers (${players.length}) komt niet overeen met de variant (${config.playerCount})`,
        );
      }
      const params = getTableParams(config);
      const n = params.playerCount;
      const state: KingenState = {
        config: structuredClone(config),
        params,
        players: structuredClone(players),
        seed: (seed ?? Math.floor(Math.random() * 0x7fffffff)) >>> 0,
        phase: 'dealing',
        roundIndex: 0,
        roundKind: null,
        dealer: 0,
        trump: null,
        hands: Array.from({ length: n }, () => []),
        currentTrick: { index: 0, leader: 1 as Seat, plays: [] },
        completedTricks: [],
        trickCounts: new Array<number>(n).fill(0),
        heartKingFallen: false,
        turn: null,
        scoresPerRound: [],
        totals: new Array<number>(n).fill(0),
        choiceLedger: config.mode === 'dubbel' ? freshLedger(n) : null,
      };
      beginRound(state); // events worden gereconstrueerd in initialEvents()
      return state;
    },

    initialEvents(state: KingenState): GameEvent[] {
      const events: GameEvent[] = [
        {
          type: 'gameStart',
          gameId: `kingen-${state.seed}`,
          players: structuredClone(state.players),
          seatCount: state.params.playerCount,
        },
      ];
      if (state.phase === 'choosingRoundKind') {
        // Dubbel: er is al gedeeld; de deler kiest nu (met zijn hand) het spel.
        events.push(dealEventFromState(state));
        return events;
      }
      events.push(roundStartEvent(state), dealEventFromState(state));
      if (state.trump !== null) {
        events.push({
          type: 'trumpChosen',
          roundIndex: state.roundIndex,
          trump: state.trump,
          chooser: state.dealer,
        });
      }
      if (state.phase === 'playing' && state.turn !== null) {
        events.push({ type: 'turnStart', seat: state.turn, trickIndex: state.currentTrick.index });
      }
      return events;
    },

    getView(state: KingenState, seat: Seat): PublicGameView {
      const playedCards: Card[] = [];
      for (const trick of state.completedTricks) {
        for (const play of trick.plays) playedCards.push({ ...play.card });
      }
      for (const play of state.currentTrick.plays) playedCards.push({ ...play.card });

      const legalCards =
        state.phase === 'playing' && state.turn === seat
          ? kingenRules.legalCards(state, seat)
          : [];

      return {
        seat,
        seatCount: state.params.playerCount,
        hand: sortHand(state.hands[seat] ?? []),
        handSizes: state.hands.map((h) => h.length),
        currentTrick: structuredClone(state.currentTrick),
        completedTricks: structuredClone(state.completedTricks),
        playedCards,
        trickCounts: state.trickCounts.slice(),
        round: {
          index: state.roundIndex,
          kind: state.roundKind ?? '',
          label: state.roundKind ? ROUND_LABELS_NL[state.roundKind] : '',
          dealer: state.dealer,
          trump: state.trump,
        },
        totalRounds: state.params.totalRounds,
        turn: state.turn,
        totals: state.totals.slice(),
        scoresPerRound: state.scoresPerRound.map((row) => row.slice()),
        playerNames: state.players.map((p) => p.name),
        legalCards: legalCards.map((c) => ({ ...c })),
      };
    },

    getLegalMoves(state: KingenState, seat: Seat): KingenMove[] {
      switch (state.phase) {
        case 'choosingRoundKind':
          return kingenRules
            .legalRoundKinds(state, seat)
            .map((kind) => ({ type: 'chooseRoundKind', kind }) as KingenMove);
        case 'choosingTrump':
          return kingenRules
            .legalTrumps(state, seat)
            .map((suit) => ({ type: 'chooseTrump', suit }) as KingenMove);
        case 'playing': {
          if (state.turn !== seat) return [];
          const moves: KingenMove[] = kingenRules
            .legalCards(state, seat)
            .map((card) => ({ type: 'playCard', card }) as KingenMove);
          if (state.config.claimingAllowed && state.roundKind !== 'troef' && moves.length > 0) {
            moves.push({ type: 'claimHand' });
          }
          return moves;
        }
        default:
          return [];
      }
    },

    applyMove(state: KingenState, seat: Seat, move: KingenMove) {
      const next = structuredClone(state);
      let events: GameEvent[];
      switch (move.type) {
        case 'chooseRoundKind':
          events = applyChooseRoundKind(next, seat, move.kind);
          break;
        case 'chooseTrump':
          events = applyChooseTrump(next, seat, move.suit);
          break;
        case 'playCard':
          events = applyPlayCard(next, seat, move.card);
          break;
        case 'claimHand':
          events = applyClaimHand(next, seat);
          break;
        default:
          throw new Error(`Onbekend zet-type: ${(move as { type: string }).type}`);
      }
      return { state: next, events };
    },

    currentActor(state: KingenState): Seat | null {
      switch (state.phase) {
        case 'choosingRoundKind':
          return state.dealer;
        case 'choosingTrump':
          return trumpChooser(state);
        case 'playing':
          return state.turn;
        default:
          return null;
      }
    },

    isFinished(state: KingenState): boolean {
      return state.phase === 'gameFinished';
    },

    getWinners(state: KingenState): Seat[] {
      if (state.phase !== 'gameFinished') throw new Error('De partij is nog niet afgelopen');
      return computeWinners(state);
    },
  };
}
