/**
 * src/games/toepen/engine.test-manual.ts
 * Engine-test: seeded self-play (eindigt met één winnaar, monotone strafpunten)
 * plus gerichte scenario's (toep/pas-boekhouding, last standing, vier gelijke,
 * vuile-was-controle). Draai met: npx tsx
 */

import type { Card, PlayerConfig, Rank, Seat, Suit } from '../../core/types.ts';
import { createToepenDefinition } from './engine.ts';
import { isVuileWas as isVuileWasHand } from './rules.ts';
import { TOEPEN_STANDAARD } from './types.ts';
import type { SeatStatus, ToepenMove, ToepenState } from './types.ts';

let geslaagd = 0;
function check(naam: string, cond: boolean): void {
  if (!cond) throw new Error(`FAIL: ${naam}`);
  geslaagd++;
}

const def = createToepenDefinition();
const k = (suit: Suit, rank: Rank): Card => ({ id: `${suit}-${rank}`, suit, rank });
function players(n: number): PlayerConfig[] {
  return Array.from({ length: n }, (_, i) => ({ name: `P${i}`, kind: 'ai' as const }));
}

// ---------------------------------------------------------------------------
// A) Seeded self-play: terminatie + invarianten
// ---------------------------------------------------------------------------

/** Deterministische pseudo-keuze op basis van een teller (geen Math.random). */
function speelPartij(n: number, seed: number, beleid: 'tam' | 'wild'): ToepenState {
  let state = def.createInitialState(players(n), { ...TOEPEN_STANDAARD }, seed) as ToepenState;
  let prevTotals = state.totals.slice();
  let stappen = 0;
  let teller = seed;
  while (!def.isFinished(state) && stappen < 20000) {
    const actor = def.currentActor(state);
    if (actor === null) throw new Error('Geen actor maar niet klaar');
    const legal = def.getLegalMoves(state, actor) as ToepenMove[];
    check('actor heeft legale zet', legal.length > 0);
    teller = (teller * 1103515245 + 12345) & 0x7fffffff;
    let move: ToepenMove;
    if (beleid === 'tam') {
      // Speel altijd een kaart / ga mee / pass claims → rustige partij.
      move = legal.find((m) => m.type === 'playCard') ?? legal.find((m) => m.type === 'respondMeegaan') ?? legal[0]!;
    } else {
      // Wild: af en toe toepen, soms passen/uitdagen.
      const r = teller % 5;
      const toep = legal.find((m) => m.type === 'callToep');
      const card = legal.find((m) => m.type === 'playCard');
      if (toep && r === 0) move = toep;
      else if (card) move = card;
      else if (r < 2 && legal.find((m) => m.type === 'respondPas')) move = legal.find((m) => m.type === 'respondPas')!;
      else move = legal[0]!;
    }
    const res = def.applyMove(state, actor, move);
    state = res.state as ToepenState;
    // Invariant: strafpunten alleen omhoog.
    for (let s = 0; s < n; s++) check('totals monotoon', state.totals[s]! >= prevTotals[s]!);
    prevTotals = state.totals.slice();
    stappen++;
  }
  check('partij eindigt', def.isFinished(state));
  return state;
}

for (const n of [2, 3, 4, 5]) {
  for (let seed = 1; seed <= 8; seed++) {
    const eind = speelPartij(n, seed, seed % 2 === 0 ? 'tam' : 'wild');
    const winners = def.getWinners(eind);
    check(`n=${n} seed=${seed}: precies 1 winnaar`, winners.length === 1);
    const over = eind.status.filter((s) => s !== 'eliminated').length;
    check(`n=${n} seed=${seed}: 1 speler over`, over === 1);
    check(`n=${n} seed=${seed}: winnaar niet af`, eind.status[winners[0]!] !== 'eliminated');
    // Iedereen behalve de winnaar heeft het max bereikt.
    for (let s = 0; s < n; s++) {
      if (s !== winners[0]) check(`n=${n} seed=${seed}: verliezer >= max`, eind.totals[s]! >= TOEPEN_STANDAARD.maxStrafpunten);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers voor gerichte scenario's: bouw een state direct.
// ---------------------------------------------------------------------------

function baseState(n: number, hands: Card[][]): ToepenState {
  return {
    config: { ...TOEPEN_STANDAARD, playerCount: n },
    players: players(n),
    seatCount: n,
    seed: 1,
    phase: 'playing',
    roundIndex: 0,
    dealer: 0 as Seat,
    hands: hands.map((h) => h.slice()),
    stock: [],
    status: new Array<SeatStatus>(n).fill('active'),
    openHand: new Array<boolean>(n).fill(false),
    currentTrick: { index: 0, leader: 1 as Seat, plays: [] },
    completedTricks: [],
    trickCounts: new Array<number>(n).fill(0),
    turn: 1 as Seat,
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
}

// ---------------------------------------------------------------------------
// B) Toep + pas: passer betaalt de inzet VÓÓR de toep
// ---------------------------------------------------------------------------
{
  // 3 spelers, stoel 1 aan de beurt (leader), toept; stoelen 2 en 0 reageren.
  const hands = [
    [k('clubs', 10), k('clubs', 9), k('clubs', 8), k('clubs', 7)],
    [k('hearts', 10), k('hearts', 9), k('hearts', 8), k('hearts', 7)],
    [k('spades', 10), k('spades', 9), k('spades', 8), k('spades', 7)],
  ];
  let s = baseState(3, hands);
  // Stoel 1 toept (inzet 1 → 2).
  s = def.applyMove(s, 1, { type: 'callToep' }).state as ToepenState;
  check('na toep stake=2', s.stake === 2);
  check('lastToeper=1', s.lastToeper === 1);
  check('fase toepResponse', s.phase === 'toepResponse');
  check('responders = [2,0]', JSON.stringify(s.pendingResponders) === JSON.stringify([2, 0]));
  // Stoel 2 past → betaalt de inzet vóór de toep (=1).
  s = def.applyMove(s, 2, { type: 'respondPas' }).state as ToepenState;
  check('stoel 2 betaalt 1 (pre-toep inzet)', s.totals[2] === 1);
  check('stoel 2 gevouwen', s.status[2] === 'folded');
  // Stoel 0 gaat mee → spel hervat bij de toeper (1).
  s = def.applyMove(s, 0, { type: 'respondMeegaan' }).state as ToepenState;
  check('na respons fase playing', s.phase === 'playing');
  check('beurt terug bij toeper 1', s.turn === 1);
  check('stoel 0 nog actief', s.status[0] === 'active');
}

// ---------------------------------------------------------------------------
// C) Last standing: iedereen past op de toep
// ---------------------------------------------------------------------------
{
  const hands = [
    [k('clubs', 10), k('clubs', 9), k('clubs', 8), k('clubs', 7)],
    [k('hearts', 10), k('hearts', 9), k('hearts', 8), k('hearts', 7)],
    [k('spades', 10), k('spades', 9), k('spades', 8), k('spades', 7)],
  ];
  let s = baseState(3, hands);
  s = def.applyMove(s, 1, { type: 'callToep' }).state as ToepenState; // stoel 1 toept
  s = def.applyMove(s, 2, { type: 'respondPas' }).state as ToepenState;
  s = def.applyMove(s, 0, { type: 'respondPas' }).state as ToepenState; // iedereen weg
  // Stoel 1 wint de ronde zonder slagen; 0 straf; nieuwe ronde begonnen.
  check('toeper 1 kreeg 0 straf deze ronde', s.scoresPerRound[0]![1] === 0);
  check('passers kregen 1', s.scoresPerRound[0]![0] === 1 && s.scoresPerRound[0]![2] === 1);
  check('nieuwe ronde: deler = winnaar 1', s.dealer === 1);
  check('roundIndex 1', s.roundIndex === 1);
}

// ---------------------------------------------------------------------------
// D) Vier gelijke: directe winst, anderen +3
// ---------------------------------------------------------------------------
{
  const hands = [
    [k('clubs', 11), k('clubs', 9), k('clubs', 8), k('clubs', 7)],
    [k('hearts', 11), k('spades', 11), k('diamonds', 11), k('clubs', 10)], // niet vier gelijke
    [k('spades', 10), k('spades', 9), k('spades', 8), k('spades', 7)],
  ];
  // Geef stoel 2 vier boeren door te herschikken: vervang.
  hands[2] = [k('spades', 11), k('hearts', 11), k('diamonds', 11), k('clubs', 11)];
  hands[1] = [k('hearts', 10), k('hearts', 9), k('hearts', 8), k('hearts', 7)];
  hands[0] = [k('clubs', 10), k('clubs', 9), k('clubs', 8), k('clubs', 7)];
  let s = baseState(3, hands);
  s.phase = 'specialClaims';
  s.pendingClaimers = [2 as Seat];
  s.turn = null;
  s.stock = [k('diamonds', 10), k('diamonds', 9), k('diamonds', 8), k('diamonds', 7)];
  const legal = def.getLegalMoves(s, 2) as ToepenMove[];
  check('vier gelijke is legaal', legal.some((m) => m.type === 'declareVierGelijke'));
  s = def.applyMove(s, 2, { type: 'declareVierGelijke' }).state as ToepenState;
  check('vier gelijke: anderen +3', s.scoresPerRound[0]![0] === 3 && s.scoresPerRound[0]![1] === 3);
  check('vier gelijke: declarer 0', s.scoresPerRound[0]![2] === 0);
  check('vier gelijke: deler wordt winnaar 2', s.dealer === 2);
}

// ---------------------------------------------------------------------------
// E) Vuile was: terecht (challenger +1) vs bluf (claimer +1 + open)
// ---------------------------------------------------------------------------
{
  // Terecht: stoel 1 heeft écht vuile was (vier plaatjes). Stoel 2 controleert.
  const echteWas = [k('hearts', 11), k('spades', 12), k('diamonds', 13), k('clubs', 14)];
  const hands = [
    [k('clubs', 10), k('clubs', 9), k('clubs', 8), k('clubs', 7)],
    echteWas,
    [k('spades', 10), k('spades', 9), k('spades', 8), k('spades', 7)],
  ];
  let s = baseState(3, hands);
  s.phase = 'specialClaims';
  s.pendingClaimers = [1 as Seat];
  s.turn = null;
  s.stock = [k('diamonds', 10), k('diamonds', 9), k('diamonds', 8), k('diamonds', 7)];
  s = def.applyMove(s, 1, { type: 'claimVuileWas' }).state as ToepenState;
  check('na claim fase vuileWasChallenge', s.phase === 'vuileWasChallenge');
  check('challenger = stoel 2', s.vuileWasClaim?.challenger === 2);
  s = def.applyMove(s, 2, { type: 'challengeVuileWas' }).state as ToepenState;
  check('terecht: challenger 2 krijgt +1', s.totals[2] === 1);
  check('terecht: claimer 1 geruild (nieuwe hand uit stock)', s.hands[1]!.every((c) => c.suit === 'diamonds'));
  check('terecht: claimer geen open hand', s.openHand[1] === false);
}
{
  // Bluf: stoel 1 heeft een 8 in de hand (géén vuile was). De engine biedt zo'n
  // claim in v1 niet aan, dus we testen de bluf-resolutie via een opgezette
  // challenge-state direct.
  const blufHand = [k('hearts', 11), k('spades', 12), k('diamonds', 13), k('clubs', 8)];
  const hands = [
    [k('clubs', 10), k('clubs', 9), k('clubs', 7), k('hearts', 7)],
    blufHand,
    [k('spades', 10), k('spades', 9), k('spades', 8), k('spades', 7)],
  ];
  let s = baseState(3, hands);
  s.phase = 'vuileWasChallenge';
  s.pendingClaimers = [1 as Seat];
  s.turn = null;
  s.stock = [k('diamonds', 10), k('diamonds', 9), k('diamonds', 8), k('diamonds', 7)];
  s.vuileWasClaim = { claimer: 1 as Seat, challenger: 2 as Seat };
  // v1 biedt een bluf-claim niet aan, maar de engine moet de bluf wél correct afrekenen.
  check('bluf is geen vuile was (helper)', !isVuileWasHand(blufHand));
  s = def.applyMove(s, 2, { type: 'challengeVuileWas' }).state as ToepenState;
  check('bluf: claimer 1 krijgt +1', s.totals[1] === 1);
  check('bluf: claimer hand open op tafel', s.openHand[1] === true);
  check('bluf: hand ongewijzigd (geen ruil)', s.hands[1]!.some((c) => c.id === 'clubs-8'));
}

console.log(`OK — ${geslaagd} checks geslaagd (engine)`);
