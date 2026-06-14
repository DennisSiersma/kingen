/**
 * src/games/rikken/rules.test-manual.ts
 * Unit-test voor legalPlays: bekennen, vrij bij geen kleur, en de maat-aas-plicht.
 * Draai met: npx tsx <ditbestand>
 */

import type { Card, Seat } from '../../core/types.ts';
import { cardFromId } from '../../core/deck.ts';
import { legalPlays } from './rules.ts';
import { RIKKEN_STICHTING } from './types.ts';
import type { RikkenContract, RikkenState } from './types.ts';

let geslaagd = 0;
function check(naam: string, cond: boolean): void {
  if (!cond) throw new Error(`FAIL: ${naam}`);
  geslaagd++;
}
const c = (id: string) => cardFromId(id);
const ids = (cards: Card[]) => cards.map((x) => x.id).sort();
const setEq = (a: Card[], b: string[]) => JSON.stringify(ids(a)) === JSON.stringify([...b].sort());
const play = (seat: number, id: string) => ({ seat: seat as Seat, card: c(id) });

function st(opts: {
  seat: number;
  hand: string[];
  plays?: { seat: Seat; card: Card }[];
  contract?: RikkenContract | null;
  partnerRevealed?: boolean;
}): RikkenState {
  const hands: Card[][] = [[], [], [], []];
  hands[opts.seat] = opts.hand.map(c);
  return {
    config: { ...RIKKEN_STICHTING },
    players: [],
    seatCount: 4,
    seed: 1,
    phase: 'playing',
    roundIndex: 0,
    dealer: 0 as Seat,
    hands,
    bidding: null,
    contract: opts.contract ?? null,
    partnerRevealed: opts.partnerRevealed ?? false,
    currentTrick: { index: 0, leader: 0 as Seat, plays: opts.plays ?? [] },
    completedTricks: [],
    trickCounts: [0, 0, 0, 0],
    turn: opts.seat as Seat,
    totals: [0, 0, 0, 0],
    scoresPerRound: [],
  };
}

const rikContract: RikkenContract = {
  kind: 'rik', beter: false, declarer: 0 as Seat, trump: 'spades', target: 8,
  askedAceId: 'hearts-14', askedSuit: 'hearts', partner: 2 as Seat,
};

// 1. Uitkomen = vrije keuze.
check('uitkomen vrij', setEq(legalPlays(st({ seat: 1, hand: ['hearts-7', 'clubs-14', 'spades-11'] }), 1 as Seat), ['hearts-7', 'clubs-14', 'spades-11']));

// 2. Bekennen: alleen de gevraagde kleur.
check('bekennen verplicht', setEq(
  legalPlays(st({ seat: 1, hand: ['hearts-7', 'hearts-13', 'clubs-9'], plays: [play(0, 'hearts-10')] }), 1 as Seat),
  ['hearts-7', 'hearts-13'],
));

// 3. Geen kleur → vrij (troeven niet verplicht; ook met troef in hand).
check('geen kleur → vrij', setEq(
  legalPlays(st({ seat: 1, hand: ['spades-7', 'clubs-9', 'diamonds-2'], plays: [play(0, 'hearts-10')] }), 1 as Seat),
  ['spades-7', 'clubs-9', 'diamonds-2'],
));

// 4. Maat-aas-plicht: harten (gevraagde kleur) geleid, maat (stoel 2) houdt ♥A,
//    nog niet onthuld → MOET exact ♥A spelen ondanks andere harten.
check('maat moet gevraagde aas spelen', setEq(
  legalPlays(st({ seat: 2, hand: ['hearts-14', 'hearts-7', 'hearts-9'], plays: [play(0, 'hearts-10')], contract: rikContract }), 2 as Seat),
  ['hearts-14'],
));

// 5. Reeds onthuld → normale bekenning (alle harten).
check('na onthulling normaal bekennen', setEq(
  legalPlays(st({ seat: 2, hand: ['hearts-14', 'hearts-7'], plays: [play(0, 'hearts-10')], contract: rikContract, partnerRevealed: true }), 2 as Seat),
  ['hearts-14', 'hearts-7'],
));

// 6. Andere kleur geleid (niet de gevraagde-aas-kleur) → normale bekenning.
check('andere kleur → normaal', setEq(
  legalPlays(st({ seat: 2, hand: ['clubs-14', 'clubs-7', 'hearts-14'], plays: [play(0, 'clubs-10')], contract: rikContract }), 2 as Seat),
  ['clubs-14', 'clubs-7'],
));

console.log(`rules.test-manual: ${geslaagd} checks geslaagd ✓`);
