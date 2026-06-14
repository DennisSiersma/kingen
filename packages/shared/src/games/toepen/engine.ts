/**
 * src/games/toepen/engine.ts
 * De Toepen-GameDefinition. UI-loos en deterministisch (seedbare shuffle).
 * applyMove muteert de input-state nooit (kloont eerst).
 *
 * Fasemachine per ronde:
 *   delen → specialClaims (vier gelijke / vuile was, alleen bij een speciale hand)
 *         → [vuileWasChallenge] → playing (4 slagen; op je beurt mag je toepen)
 *         → [toepResponse: anderen gaan mee of passen] → afrekenen.
 *
 * Inzet start op 1 en stijgt +1 per toep; verliezers van de 4e slag betalen de
 * actuele inzet, een passer betaalt de inzet vóór de toep waarop hij paste.
 * Wie het strafpuntenmaximum bereikt is af; de laatste speler over wint de partij
 * (eliminatie over meerdere rondes).
 *
 * Twee-sporen-turn: de slagbeurt (kaart spelen / toepen) en de toep-respons
 * (meegaan / passen) reizen allebei via currentActor + getLegalMoves, zodat de
 * TurnManager geen Toepen-regelkennis nodig heeft.
 *
 * Toep-timing (v1-model): toepen kan op je eigen beurt, vlak vóór je je kaart
 * speelt. Dit is de gangbare, tractabele digitale interpretatie van "op elk
 * moment toepen" en houdt de twee-sporen-turn enkelvoudig.
 */

import type { Card, GameEvent, PlayerConfig, PublicGameView, Seat } from '../../core/types.ts';
import { createRng, shuffle, sortHand } from '../../core/deck.ts';
import { toepDeck, toepTrickWinner } from './cards.ts';
import { heeftVierGelijke, isVuileWas, legalPlays } from './rules.ts';
import type {
  SeatStatus,
  ToepEntry,
  ToepenDefinition,
  ToepenMove,
  ToepenPhase,
  ToepenState,
  ToepenVariantConfig,
  ToepenViewExtras,
} from './types.ts';

const HAND_SIZE = 4;
const TRICKS_PER_ROUND = 4;
const VIER_GELIJKE_STRAF = 3;

function toRecord(values: readonly number[]): Record<number, number> {
  const out: Record<number, number> = {};
  values.forEach((v, i) => (out[i] = v));
  return out;
}

// ---------------------------------------------------------------------------
// Stoel-navigatie (met status)
// ---------------------------------------------------------------------------

const isActive = (state: ToepenState, seat: Seat): boolean => state.status[seat] === 'active';
const notEliminated = (state: ToepenState, seat: Seat): boolean => state.status[seat] !== 'eliminated';

function activeSeats(state: ToepenState): Seat[] {
  const out: Seat[] = [];
  for (let s = 0; s < state.seatCount; s++) if (isActive(state, s)) out.push(s as Seat);
  return out;
}

/** Eerstvolgende stoel met de klok mee na `from` die aan `pred` voldoet, of null. */
function nextSeatWhere(state: ToepenState, from: Seat, pred: (s: Seat) => boolean): Seat | null {
  const n = state.seatCount;
  for (let i = 1; i <= n; i++) {
    const s = ((from + i) % n) as Seat;
    if (pred(s)) return s;
  }
  return null;
}

/** Actieve stoelen met de klok mee vanaf `start` (incl.), in volgorde. */
function activeOrderFrom(state: ToepenState, start: Seat, includeStart: boolean): Seat[] {
  const n = state.seatCount;
  const out: Seat[] = [];
  for (let i = includeStart ? 0 : 1; i < n + (includeStart ? 0 : 1); i++) {
    const s = ((start + i) % n) as Seat;
    if (s === start && i !== 0) break;
    if (isActive(state, s)) out.push(s);
  }
  return out;
}

/** Niet-afgevallen stoelen met de klok mee vanaf links van `dealer`, in deelvolgorde. */
function dealOrder(state: ToepenState, dealer: Seat): Seat[] {
  const n = state.seatCount;
  const out: Seat[] = [];
  for (let i = 1; i <= n; i++) {
    const s = ((dealer + i) % n) as Seat;
    if (notEliminated(state, s)) out.push(s);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Speciale-hand-opties
// ---------------------------------------------------------------------------

function magVierGelijke(state: ToepenState, seat: Seat): boolean {
  return state.config.vierGelijkeRegel && heeftVierGelijke(state.hands[seat] ?? []);
}

function magVuileWas(state: ToepenState, seat: Seat): boolean {
  return state.config.vuileWasRegel && state.stock.length >= HAND_SIZE && isVuileWas(state.hands[seat] ?? []);
}

function heeftSpecialeOptie(state: ToepenState, seat: Seat): boolean {
  return magVierGelijke(state, seat) || magVuileWas(state, seat);
}

// ---------------------------------------------------------------------------
// Legale zetten per fase
// ---------------------------------------------------------------------------

function canCallToep(state: ToepenState, seat: Seat): boolean {
  const cfg = state.config;
  if (!isActive(state, seat)) return false;
  if (state.lastToeper === seat) return false; // mag niet zelf overtoepen
  if (state.stake >= cfg.maxStrafpunten) return false; // begrensd (niemand over max in één ronde)
  if (cfg.peltRegel && state.totals[seat]! >= cfg.maxStrafpunten - 1) return false; // op pelt: niet toepen
  return activeSeats(state).length > 1;
}

function toepenLegalMoves(state: ToepenState, seat: Seat): ToepenMove[] {
  switch (state.phase) {
    case 'specialClaims': {
      if (state.pendingClaimers[0] !== seat) return [];
      const out: ToepenMove[] = [];
      if (magVierGelijke(state, seat)) out.push({ type: 'declareVierGelijke' });
      if (magVuileWas(state, seat)) out.push({ type: 'claimVuileWas' });
      out.push({ type: 'passClaim' });
      return out;
    }
    case 'vuileWasChallenge':
      return state.vuileWasClaim?.challenger === seat
        ? [{ type: 'passChallenge' }, { type: 'challengeVuileWas' }]
        : [];
    case 'toepResponse':
      return state.pendingResponders[0] === seat
        ? [{ type: 'respondMeegaan' }, { type: 'respondPas' }]
        : [];
    case 'playing': {
      if (state.turn !== seat) return [];
      const out: ToepenMove[] = legalPlays(state, seat).map((card) => ({ type: 'playCard', card }));
      if (canCallToep(state, seat)) out.push({ type: 'callToep' });
      return out;
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Rondeflow
// ---------------------------------------------------------------------------

function dealEventFromState(state: ToepenState): GameEvent {
  const hands: Partial<Record<Seat, Card[]>> = {};
  const handSizes: Record<number, number> = {};
  state.hands.forEach((h, seat) => {
    hands[seat as Seat] = h.map((c) => ({ ...c }));
    handSizes[seat] = h.length;
  });
  return { type: 'deal', roundIndex: state.roundIndex, dealer: state.dealer, hands, handSizes };
}

function beginRound(state: ToepenState, dealer: Seat): void {
  const n = state.seatCount;
  state.dealer = dealer;
  // Status resetten: niet-afgevallen → actief.
  state.status = state.status.map((s): SeatStatus => (s === 'eliminated' ? 'eliminated' : 'active'));

  const deck = shuffle(toepDeck(), createRng(state.seed + state.roundIndex * 7919));
  const hands: Card[][] = Array.from({ length: n }, () => []);
  const order = dealOrder(state, dealer);
  let idx = 0;
  for (let r = 0; r < HAND_SIZE; r++) {
    for (const seat of order) hands[seat]!.push(deck[idx++]!);
  }
  state.stock = deck.slice(idx);
  state.hands = hands.map((h) => sortHand(h));

  state.openHand = new Array<boolean>(n).fill(false);
  state.completedTricks = [];
  state.trickCounts = new Array<number>(n).fill(0);
  state.stake = 1;
  state.toepHistory = [];
  state.lastToeper = null;
  state.pendingResponders = [];
  state.stakeBeforeToep = 1;
  state.resumePhase = null;
  state.resumeTurn = null;
  state.vuileWasClaim = null;
  state.roundDeltas = new Array<number>(n).fill(0);

  const leider = order[0]!; // links van de deler komt uit
  state.currentTrick = { index: 0, leader: leider, plays: [] };

  // Alleen stoelen met een echte speciale hand krijgen een claim-beurt; zonder
  // claims start de slagfase meteen (state moet zonder events actionable zijn,
  // want createInitialState roept roundOpeningEvents niet aan).
  state.pendingClaimers = order.filter((s) => heeftSpecialeOptie(state, s));
  if (state.pendingClaimers.length > 0) {
    state.phase = 'specialClaims';
    state.turn = null;
  } else {
    state.phase = 'playing';
    state.turn = leider;
  }
}

function roundOpeningEvents(state: ToepenState): GameEvent[] {
  const events: GameEvent[] = [
    { type: 'roundStart', roundIndex: state.roundIndex, roundKind: 'toepen', roundLabel: 'toepen', dealer: state.dealer },
    dealEventFromState(state),
    { type: 'custom', subtype: 'stakeChanged', data: { stake: state.stake } },
  ];
  if (state.phase === 'specialClaims') {
    events.push({ type: 'custom', subtype: 'specialClaimTurn', data: { seat: state.pendingClaimers[0] } });
  } else {
    events.push({ type: 'turnStart', seat: state.currentTrick.leader, trickIndex: state.currentTrick.index });
  }
  return events;
}

/** Slagfase starten (vanuit de claim-fase): zet de beurt op de uitkomer. */
function startPlaying(state: ToepenState): GameEvent[] {
  state.phase = 'playing';
  const leider = state.currentTrick.leader;
  state.turn = leider;
  return [{ type: 'turnStart', seat: leider, trickIndex: state.currentTrick.index }];
}

// ---------------------------------------------------------------------------
// Afrekenen / eliminatie
// ---------------------------------------------------------------------------

function lowestTotalSeats(state: ToepenState): Seat[] {
  const min = Math.min(...state.totals);
  const out: Seat[] = [];
  state.totals.forEach((t, s) => {
    if (t === min) out.push(s as Seat);
  });
  return out;
}

function computeWinners(state: ToepenState): Seat[] {
  const over: Seat[] = [];
  for (let s = 0; s < state.seatCount; s++) if (notEliminated(state, s)) over.push(s as Seat);
  return over.length > 0 ? over : lowestTotalSeats(state);
}

/**
 * Sluit de ronde af: deltas wegschrijven, eliminaties bepalen, en óf de partij
 * beëindigen óf een nieuwe ronde opzetten (winnaar = nieuwe deler).
 */
function concludeRound(state: ToepenState, winner: Seat): GameEvent[] {
  const events: GameEvent[] = [];
  state.scoresPerRound.push(state.roundDeltas.slice());

  events.push({
    type: 'custom',
    subtype: 'roundResult',
    data: { winner, stake: state.stake, deltas: state.roundDeltas.slice(), trickCounts: state.trickCounts.slice() },
  });
  events.push({ type: 'roundEnd', roundIndex: state.roundIndex, roundKind: 'toepen', scores: toRecord(state.roundDeltas) });
  events.push({ type: 'scoreUpdate', totals: toRecord(state.totals) });

  // Eliminaties.
  for (let s = 0; s < state.seatCount; s++) {
    if (state.status[s] !== 'eliminated' && state.totals[s]! >= state.config.maxStrafpunten) {
      state.status[s] = 'eliminated';
      events.push({ type: 'custom', subtype: 'playerEliminated', data: { seat: s, total: state.totals[s] } });
    }
  }

  const over: Seat[] = [];
  for (let s = 0; s < state.seatCount; s++) if (notEliminated(state, s)) over.push(s as Seat);

  if (over.length <= 1) {
    state.phase = 'finished';
    state.turn = null;
    state.pendingClaimers = [];
    state.pendingResponders = [];
    events.push({ type: 'gameEnd', winners: computeWinners(state), totals: toRecord(state.totals) });
    return events;
  }

  state.roundIndex += 1;
  // De winnaar van de ronde wordt deler; links van hem komt uit.
  beginRound(state, winner);
  events.push(...roundOpeningEvents(state));
  return events;
}

/** 4e slag gespeeld: verliezers (actief, niet de winnaar) betalen de inzet. */
function finishAfterTricks(state: ToepenState, winner: Seat): GameEvent[] {
  for (const s of activeSeats(state)) {
    if (s !== winner) {
      state.totals[s] = (state.totals[s] ?? 0) + state.stake;
      state.roundDeltas[s] = (state.roundDeltas[s] ?? 0) + state.stake;
    }
  }
  return concludeRound(state, winner);
}

// ---------------------------------------------------------------------------
// Zet-afhandeling
// ---------------------------------------------------------------------------

function valideer(legal: ToepenMove[], move: ToepenMove): void {
  const wanted = JSON.stringify(move);
  if (!legal.some((m) => JSON.stringify(m) === wanted)) {
    throw new Error(`Zet niet toegestaan: ${wanted}`);
  }
}

// --- Speciale handen -------------------------------------------------------

function nextClaimer(state: ToepenState): GameEvent[] {
  state.pendingClaimers.shift();
  if (state.pendingClaimers.length > 0) {
    return [{ type: 'custom', subtype: 'specialClaimTurn', data: { seat: state.pendingClaimers[0] } }];
  }
  return startPlaying(state);
}

function applyDeclareVierGelijke(state: ToepenState, seat: Seat): GameEvent[] {
  if (state.phase !== 'specialClaims' || state.pendingClaimers[0] !== seat) {
    throw new Error('Niet aan de beurt voor een speciale-hand-claim');
  }
  valideer(toepenLegalMoves(state, seat), { type: 'declareVierGelijke' });
  const rank = state.hands[seat]![0]!.rank;
  const events: GameEvent[] = [{ type: 'custom', subtype: 'vierGelijke', data: { seat, rank } }];
  for (const s of activeSeats(state)) {
    if (s !== seat) {
      state.totals[s] = (state.totals[s] ?? 0) + VIER_GELIJKE_STRAF;
      state.roundDeltas[s] = (state.roundDeltas[s] ?? 0) + VIER_GELIJKE_STRAF;
    }
  }
  events.push(...concludeRound(state, seat));
  return events;
}

function ruilVuileWas(state: ToepenState, seat: Seat): void {
  const oud = state.hands[seat] ?? [];
  const nieuw = state.stock.slice(0, HAND_SIZE);
  state.stock = state.stock.slice(HAND_SIZE).concat(oud);
  state.hands[seat] = sortHand(nieuw);
}

function applyClaimVuileWas(state: ToepenState, seat: Seat): GameEvent[] {
  if (state.phase !== 'specialClaims' || state.pendingClaimers[0] !== seat) {
    throw new Error('Niet aan de beurt voor een speciale-hand-claim');
  }
  valideer(toepenLegalMoves(state, seat), { type: 'claimVuileWas' });
  const challenger = nextSeatWhere(state, seat, (s) => isActive(state, s) && s !== seat);
  const events: GameEvent[] = [{ type: 'custom', subtype: 'vuileWasClaimed', data: { seat } }];
  if (challenger === null) {
    // Niemand kan controleren → claim staat, ruil meteen.
    ruilVuileWas(state, seat);
    events.push({ type: 'custom', subtype: 'vuileWasExchanged', data: { seat, openOnTable: false } });
    events.push(...nextClaimer(state));
    return events;
  }
  state.phase = 'vuileWasChallenge';
  state.vuileWasClaim = { claimer: seat, challenger };
  events.push({ type: 'custom', subtype: 'vuileWasChallengeTurn', data: { challenger, claimer: seat } });
  return events;
}

function applyPassClaim(state: ToepenState, seat: Seat): GameEvent[] {
  if (state.phase !== 'specialClaims' || state.pendingClaimers[0] !== seat) {
    throw new Error('Niet aan de beurt voor een speciale-hand-claim');
  }
  valideer(toepenLegalMoves(state, seat), { type: 'passClaim' });
  return nextClaimer(state);
}

function resolveVuileWas(state: ToepenState, challenged: boolean): GameEvent[] {
  const claim = state.vuileWasClaim!;
  const claimer = claim.claimer;
  state.phase = 'specialClaims';
  state.vuileWasClaim = null;
  const events: GameEvent[] = [];

  if (!challenged) {
    // Niet gecontroleerd → claim aangenomen, ruil.
    ruilVuileWas(state, claimer);
    events.push({ type: 'custom', subtype: 'vuileWasExchanged', data: { seat: claimer, openOnTable: false } });
    events.push(...nextClaimer(state));
    return events;
  }

  const terecht = isVuileWas(state.hands[claimer] ?? []);
  if (terecht) {
    // Controleur zat fout → +1 voor de uitdager; claimer mag ruilen.
    const ch = claim.challenger;
    state.totals[ch] = (state.totals[ch] ?? 0) + 1;
    state.roundDeltas[ch] = (state.roundDeltas[ch] ?? 0) + 1;
    ruilVuileWas(state, claimer);
    events.push({ type: 'custom', subtype: 'vuileWasResolved', data: { claimer, challenger: ch, terecht: true, penaltySeat: ch } });
    events.push({ type: 'custom', subtype: 'vuileWasExchanged', data: { seat: claimer, openOnTable: false } });
  } else {
    // Bluf → +1 voor de claimer, hand open op tafel, geen ruil.
    state.totals[claimer] = (state.totals[claimer] ?? 0) + 1;
    state.roundDeltas[claimer] = (state.roundDeltas[claimer] ?? 0) + 1;
    state.openHand[claimer] = true;
    events.push({ type: 'custom', subtype: 'vuileWasResolved', data: { claimer, challenger: claim.challenger, terecht: false, penaltySeat: claimer } });
    events.push({ type: 'custom', subtype: 'handOpened', data: { seat: claimer, cards: (state.hands[claimer] ?? []).map((c) => ({ ...c })) } });
  }
  events.push(...nextClaimer(state));
  return events;
}

function applyChallengeVuileWas(state: ToepenState, seat: Seat): GameEvent[] {
  if (state.phase !== 'vuileWasChallenge' || state.vuileWasClaim?.challenger !== seat) {
    throw new Error('Niet aan de beurt om een vuile-was-claim te controleren');
  }
  return resolveVuileWas(state, true);
}

function applyPassChallenge(state: ToepenState, seat: Seat): GameEvent[] {
  if (state.phase !== 'vuileWasChallenge' || state.vuileWasClaim?.challenger !== seat) {
    throw new Error('Niet aan de beurt om een vuile-was-claim te controleren');
  }
  return resolveVuileWas(state, false);
}

// --- Toepen / respons ------------------------------------------------------

function applyCallToep(state: ToepenState, seat: Seat): GameEvent[] {
  if (state.phase !== 'playing' || state.turn !== seat) throw new Error('Niet aan de beurt om te toepen');
  if (!canCallToep(state, seat)) throw new Error('Toepen is hier niet toegestaan');

  state.stakeBeforeToep = state.stake;
  state.stake += 1;
  state.lastToeper = seat;
  state.toepHistory.push({ seat, stakeAfter: state.stake } satisfies ToepEntry);

  state.resumePhase = 'playing';
  state.resumeTurn = seat;
  state.pendingResponders = activeOrderFrom(state, seat, false); // anderen, met de klok mee
  state.phase = 'toepResponse';
  state.turn = null;

  const events: GameEvent[] = [
    { type: 'custom', subtype: 'toepCalled', data: { seat, stake: state.stake } },
    { type: 'custom', subtype: 'stakeChanged', data: { stake: state.stake } },
  ];
  if (state.pendingResponders.length > 0) {
    events.push({ type: 'custom', subtype: 'toepResponseTurn', data: { seat: state.pendingResponders[0], stake: state.stake } });
  } else {
    events.push(...resolveToepEnd(state));
  }
  return events;
}

function resolveToepEnd(state: ToepenState): GameEvent[] {
  const actief = activeSeats(state);
  if (actief.length <= 1) {
    // Alle tegenstanders gepast → de laatste speler over wint de ronde (0 straf).
    const winner = actief[0]!;
    const events: GameEvent[] = [{ type: 'custom', subtype: 'roundWonByLastStanding', data: { seat: winner } }];
    events.push(...concludeRound(state, winner));
    return events;
  }
  // Hervat het spel: de toeper speelt nu zijn kaart.
  state.phase = state.resumePhase ?? 'playing';
  state.turn = state.resumeTurn;
  state.pendingResponders = [];
  return [{ type: 'turnStart', seat: state.turn!, trickIndex: state.currentTrick.index }];
}

function applyRespond(state: ToepenState, seat: Seat, meegaan: boolean): GameEvent[] {
  if (state.phase !== 'toepResponse' || state.pendingResponders[0] !== seat) {
    throw new Error('Niet aan de beurt om op de toep te reageren');
  }
  const events: GameEvent[] = [];
  if (meegaan) {
    events.push({ type: 'custom', subtype: 'meegaanAccepted', data: { seat, stake: state.stake } });
  } else {
    state.status[seat] = 'folded';
    const penalty = state.stakeBeforeToep;
    state.totals[seat] = (state.totals[seat] ?? 0) + penalty;
    state.roundDeltas[seat] = (state.roundDeltas[seat] ?? 0) + penalty;
    events.push({ type: 'custom', subtype: 'playerFolded', data: { seat, penalty, stake: state.stake } });
  }
  state.pendingResponders.shift();
  if (state.pendingResponders.length > 0) {
    events.push({ type: 'custom', subtype: 'toepResponseTurn', data: { seat: state.pendingResponders[0], stake: state.stake } });
  } else {
    events.push(...resolveToepEnd(state));
  }
  return events;
}

// --- Kaart spelen ----------------------------------------------------------

/** Volgende stoel die nog moet spelen in de lopende slag, of null (slag compleet). */
function nextToPlay(state: ToepenState, after: Seat): Seat | null {
  const gespeeld = new Set(state.currentTrick.plays.map((p) => p.seat));
  return nextSeatWhere(state, after, (s) => isActive(state, s) && !gespeeld.has(s));
}

function applyPlayCard(state: ToepenState, seat: Seat, played: Card): GameEvent[] {
  if (state.phase !== 'playing' || state.turn !== seat) throw new Error('Niet aan de beurt');
  const legaal = legalPlays(state, seat);
  const card = legaal.find((c) => c.id === played.id);
  if (!card) throw new Error(`Kaart ${played.id} is hier niet toegestaan`);

  state.hands[seat] = (state.hands[seat] ?? []).filter((k) => k.id !== card.id);
  state.currentTrick.plays.push({ seat, card });
  const events: GameEvent[] = [{ type: 'playCard', seat, card, trickIndex: state.currentTrick.index }];

  const volgende = nextToPlay(state, seat);
  if (volgende !== null) {
    state.turn = volgende;
    events.push({ type: 'turnStart', seat: volgende, trickIndex: state.currentTrick.index });
    return events;
  }

  // Slag compleet: winnaar onder de nog-actieve spelers (gevouwen kaarten tellen niet).
  const actievePlays = state.currentTrick.plays.filter((p) => isActive(state, p.seat));
  const winner = toepTrickWinner(actievePlays);
  state.currentTrick.winner = winner;
  state.trickCounts[winner] = (state.trickCounts[winner] ?? 0) + 1;
  const voltooid = state.currentTrick;
  state.completedTricks.push(voltooid);
  events.push({ type: 'trickWon', trickIndex: voltooid.index, winner, trick: structuredClone(voltooid) });

  if (state.completedTricks.length >= TRICKS_PER_ROUND) {
    events.push(...finishAfterTricks(state, winner));
  } else {
    state.currentTrick = { index: voltooid.index + 1, leader: winner, plays: [] };
    state.turn = winner;
    events.push({ type: 'turnStart', seat: winner, trickIndex: state.currentTrick.index });
  }
  return events;
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

function currentActor(state: ToepenState): Seat | null {
  switch (state.phase) {
    case 'specialClaims':
      return state.pendingClaimers[0] ?? null;
    case 'vuileWasChallenge':
      return state.vuileWasClaim?.challenger ?? null;
    case 'toepResponse':
      return state.pendingResponders[0] ?? null;
    case 'playing':
      return state.turn;
    default:
      return null;
  }
}

function buildView(state: ToepenState, seat: Seat): PublicGameView {
  const n = state.seatCount;
  const playedCards: Card[] = [];
  for (const t of state.completedTricks) for (const p of t.plays) playedCards.push({ ...p.card });
  for (const p of state.currentTrick.plays) playedCards.push({ ...p.card });

  const legalCards =
    state.phase === 'playing' && state.turn === seat ? legalPlays(state, seat).map((c) => ({ ...c })) : [];

  // Open handen (vuile-was-bluf) zijn voor iedereen zichtbaar.
  const openHands: Record<number, Card[]> = {};
  for (let s = 0; s < n; s++) {
    if (state.openHand[s]) openHands[s] = (state.hands[s] ?? []).map((c) => ({ ...c }));
  }

  const actor = currentActor(state);
  const extras: ToepenViewExtras = {
    phase: state.phase,
    stake: state.stake,
    status: state.status.slice(),
    openHand: state.openHand.slice(),
    openHands,
    toepHistory: state.toepHistory.slice(),
    lastToeper: state.lastToeper,
    canCallToep: state.phase === 'playing' && state.turn === seat && canCallToep(state, seat),
    pendingResponders: state.pendingResponders.slice(),
    penaltyIfIFoldNow: state.stakeBeforeToep,
    pendingClaimers: state.pendingClaimers.slice(),
    vuileWasClaim: state.vuileWasClaim,
    maxStrafpunten: state.config.maxStrafpunten,
  };

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
      kind: 'toepen',
      label: 'toepen',
      dealer: state.dealer,
      trump: null, // Toepen kent geen troef
    },
    totalRounds: 0, // eliminatie-partij: geen vast aantal rondes
    turn: actor,
    totals: state.totals.slice(),
    scoresPerRound: state.scoresPerRound.map((r) => r.slice()),
    playerNames: state.players.map((p) => p.name),
    legalCards,
    legalMoves: toepenLegalMoves(state, seat),
    viewExtras: extras,
  };
}

// ---------------------------------------------------------------------------
// GameDefinition
// ---------------------------------------------------------------------------

export function createToepenDefinition(): ToepenDefinition {
  return {
    id: 'toepen',
    naam: 'Toepen',
    minPlayers: 2,
    maxPlayers: 8,

    createInitialState(players: PlayerConfig[], config: ToepenVariantConfig, seed?: number): ToepenState {
      const n = players.length;
      if (n < 2 || n > 8) throw new Error(`Toepen ondersteunt 2..8 spelers, niet ${n}`);
      const state: ToepenState = {
        config: { ...structuredClone(config), playerCount: n },
        players: structuredClone(players),
        seatCount: n,
        seed: (seed ?? Math.floor(Math.random() * 0x7fffffff)) >>> 0,
        phase: 'specialClaims',
        roundIndex: 0,
        dealer: 0 as Seat,
        hands: Array.from({ length: n }, () => []),
        stock: [],
        status: new Array<SeatStatus>(n).fill('active'),
        openHand: new Array<boolean>(n).fill(false),
        currentTrick: { index: 0, leader: 1 as Seat, plays: [] },
        completedTricks: [],
        trickCounts: new Array<number>(n).fill(0),
        turn: null,
        stake: 1,
        toepHistory: [],
        lastToeper: null,
        pendingResponders: [],
        stakeBeforeToep: 1,
        resumePhase: null,
        resumeTurn: null,
        pendingClaimers: [],
        vuileWasClaim: null,
        totals: new Array<number>(n).fill(0),
        scoresPerRound: [],
        roundDeltas: new Array<number>(n).fill(0),
      };
      beginRound(state, 0 as Seat);
      return state;
    },

    initialEvents(state: ToepenState): GameEvent[] {
      const events: GameEvent[] = [
        { type: 'gameStart', gameId: `toepen-${state.seed}`, players: structuredClone(state.players), seatCount: state.seatCount },
      ];
      events.push(...roundOpeningEvents(state));
      return events;
    },

    getView(state: ToepenState, seat: Seat): PublicGameView {
      return buildView(state, seat);
    },

    getLegalMoves(state: ToepenState, seat: Seat): ToepenMove[] {
      return toepenLegalMoves(state, seat);
    },

    applyMove(state: ToepenState, seat: Seat, move: ToepenMove) {
      const next = structuredClone(state);
      let events: GameEvent[];
      switch (move.type) {
        case 'playCard':
          events = applyPlayCard(next, seat, move.card);
          break;
        case 'callToep':
          events = applyCallToep(next, seat);
          break;
        case 'respondMeegaan':
          events = applyRespond(next, seat, true);
          break;
        case 'respondPas':
          events = applyRespond(next, seat, false);
          break;
        case 'declareVierGelijke':
          events = applyDeclareVierGelijke(next, seat);
          break;
        case 'claimVuileWas':
          events = applyClaimVuileWas(next, seat);
          break;
        case 'passClaim':
          events = applyPassClaim(next, seat);
          break;
        case 'challengeVuileWas':
          events = applyChallengeVuileWas(next, seat);
          break;
        case 'passChallenge':
          events = applyPassChallenge(next, seat);
          break;
        default:
          throw new Error(`Onbekend zet-type: ${(move as { type: string }).type}`);
      }
      return { state: next, events };
    },

    currentActor(state: ToepenState): Seat | null {
      return currentActor(state);
    },

    isFinished(state: ToepenState): boolean {
      return state.phase === 'finished';
    },

    getWinners(state: ToepenState): Seat[] {
      if (state.phase !== 'finished') throw new Error('De partij is nog niet afgelopen');
      return computeWinners(state);
    },
  };
}
