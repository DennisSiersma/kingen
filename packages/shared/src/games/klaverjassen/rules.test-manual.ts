/**
 * src/games/klaverjassen/rules.test-manual.ts
 * Zware unit-test voor legalPlays — bekennen, troef-/overtroef-/ondertroefplicht
 * en het Rotterdams/Amsterdams-verschil. Draai met: npx tsx <ditbestand>
 */

import type { Card, Seat } from '../../core/types.ts';
import { cardFromId } from '../../core/deck.ts';
import { legalPlays } from './rules.ts';
import { KLAVERJAS_AMSTERDAMS, KLAVERJAS_ROTTERDAMS } from './types.ts';
import type { Gewest, KlaverjasState } from './types.ts';

let geslaagd = 0;
function check(naam: string, cond: boolean): void {
  if (!cond) throw new Error(`FAIL: ${naam}`);
  geslaagd++;
}

const c = (id: string) => cardFromId(id);
const play = (seat: number, id: string) => ({ seat: seat as Seat, card: c(id) });
const ids = (cards: Card[]) => cards.map((x) => x.id).sort();
const setEq = (a: Card[], b: string[]) => JSON.stringify(ids(a)) === JSON.stringify([...b].sort());

function st(opts: {
  seat: number;
  hand: string[];
  trump: 'clubs' | 'diamonds' | 'hearts' | 'spades' | null;
  plays?: { seat: Seat; card: Card }[];
  gewest?: Gewest;
}): KlaverjasState {
  const base = opts.gewest === 'amsterdams' ? KLAVERJAS_AMSTERDAMS : KLAVERJAS_ROTTERDAMS;
  const hands: Card[][] = [[], [], [], []];
  hands[opts.seat] = opts.hand.map(c);
  return {
    config: { ...base },
    players: [],
    seatCount: 4,
    seed: 1,
    phase: 'playing',
    roundIndex: 0,
    dealer: 0 as Seat,
    voorhand: 1 as Seat,
    trump: opts.trump,
    makingTeam: 0,
    hands,
    bidding: null,
    currentTrick: { index: 0, leader: 0 as Seat, plays: opts.plays ?? [] },
    completedTricks: [],
    teamTricks: [0, 0],
    teamCardPoints: [0, 0],
    teamRoem: [0, 0],
    roemEvents: [],
    turn: opts.seat as Seat,
    teamTotals: [0, 0],
    scoresPerRound: [],
  };
}

// 1. Uitkomen → alle handkaarten legaal.
check('uitkomen = vrije keuze', setEq(
  legalPlays(st({ seat: 1, hand: ['hearts-7', 'clubs-14', 'spades-11'], trump: 'clubs' }), 1 as Seat),
  ['hearts-7', 'clubs-14', 'spades-11'],
));

// 2. Bekennen niet-troef: alleen de gevraagde kleur, vrije rang.
check('bekennen niet-troef', setEq(
  legalPlays(st({ seat: 1, hand: ['hearts-7', 'hearts-14', 'clubs-9'], trump: 'clubs', plays: [play(0, 'hearts-13')] }), 1 as Seat),
  ['hearts-7', 'hearts-14'],
));

// 3. Troef gevraagd, kan overtroeven → alleen hogere troef.
//    Ligt 9♣ (kracht 7). Hand B♣(8)>9 en 7♣(1)<9. Alleen B♣ mag.
check('troef gevraagd, overtroeven verplicht', setEq(
  legalPlays(st({ seat: 1, hand: ['clubs-11', 'clubs-7'], trump: 'clubs', plays: [play(0, 'clubs-9')] }), 1 as Seat),
  ['clubs-11'],
));

// 4. Troef gevraagd, kan NIET hoger → alle eigen troef (ondertroeven mag, geen keus).
//    Ligt B♣ (hoogste). Hand 9♣, 7♣ — beide lager → beide legaal.
check('troef gevraagd, niet hoger → alle troef', setEq(
  legalPlays(st({ seat: 1, hand: ['clubs-9', 'clubs-7'], trump: 'clubs', plays: [play(0, 'clubs-11')] }), 1 as Seat),
  ['clubs-9', 'clubs-7'],
));

// 5. Niet bekennen, troef al in slag, kan overtroeven → alleen hogere troef.
//    ♥ geleid, 9♣ erop. Seat heeft geen ♥, troef B♣(8)>9 en 7♣(1). Alleen B♣.
check('overtroefplicht (Rotterdams)', setEq(
  legalPlays(st({ seat: 2, hand: ['clubs-11', 'clubs-7', 'spades-14'], trump: 'clubs', plays: [play(1, 'hearts-13'), play(3, 'clubs-9')] }), 2 as Seat),
  ['clubs-11'],
));

// 6. Niet bekennen, alleen LAGERE troef dan in slag → verplicht ondertroeven (alle troef), NIET afgooien.
check('ondertroefplicht verplicht (Rotterdams)', setEq(
  legalPlays(st({ seat: 2, hand: ['clubs-7', 'spades-14', 'diamonds-10'], trump: 'clubs', plays: [play(1, 'hearts-13'), play(3, 'clubs-11')] }), 2 as Seat),
  ['clubs-7'],
));

// 7. Niet bekennen, nog geen troef in slag, heeft troef → troeven verplicht.
check('troefplicht (kopen)', setEq(
  legalPlays(st({ seat: 2, hand: ['clubs-7', 'clubs-9', 'spades-14'], trump: 'clubs', plays: [play(1, 'hearts-13')] }), 2 as Seat),
  ['clubs-7', 'clubs-9'],
));

// 8. Niet bekennen, geen troef → vrij afgooien.
check('geen troef → vrij afgooien', setEq(
  legalPlays(st({ seat: 2, hand: ['spades-14', 'diamonds-10', 'diamonds-7'], trump: 'clubs', plays: [play(1, 'hearts-13')] }), 2 as Seat),
  ['spades-14', 'diamonds-10', 'diamonds-7'],
));

// 9. AMSTERDAMS: maat (stoel 0) staat hoog → troefplicht vervalt, alles mag.
//    Stoel 0 leidt A♥ (wint). Stoel 2 = partner van 0, heeft geen ♥ maar wel troef.
check('Amsterdams: maat hoog → vrij', setEq(
  legalPlays(st({ seat: 2, hand: ['clubs-11', 'spades-7'], trump: 'clubs', gewest: 'amsterdams', plays: [play(0, 'hearts-14')] }), 2 as Seat),
  ['clubs-11', 'spades-7'],
));

// 10. AMSTERDAMS: tegenstander staat hoog → troefplicht geldt weer (als Rotterdams).
//     Stoel 1 (tegenstander van 2) leidt A♥. Stoel 2 heeft geen ♥, wel troef → moet troeven.
check('Amsterdams: tegenstander hoog → troefplicht', setEq(
  legalPlays(st({ seat: 2, hand: ['clubs-11', 'spades-7'], trump: 'clubs', gewest: 'amsterdams', plays: [play(1, 'hearts-14')] }), 2 as Seat),
  ['clubs-11'],
));

// 11. Troef gevraagd maar geen troef in hand → vrij afgooien.
check('troef gevraagd, geen troef → afgooien', setEq(
  legalPlays(st({ seat: 1, hand: ['hearts-7', 'spades-14'], trump: 'clubs', plays: [play(0, 'clubs-9')] }), 1 as Seat),
  ['hearts-7', 'spades-14'],
));

// 12. Rotterdams (controle): zelfde situatie als 9 maar Rotterdams → troefplicht blijft.
check('Rotterdams: maat hoog → toch troefplicht', setEq(
  legalPlays(st({ seat: 2, hand: ['clubs-11', 'spades-7'], trump: 'clubs', gewest: 'rotterdams', plays: [play(0, 'hearts-14')] }), 2 as Seat),
  ['clubs-11'],
));

// 13. Troef GELEID + maat hoog. Stoel 0 (partner van 2) staat hoog met 9♣.
//     Amsterdams: bekennen verplicht maar NIET overtroeven → elke troef mag.
check('Amsterdams: troef geleid, maat hoog → niet overtroeven', setEq(
  legalPlays(st({ seat: 2, hand: ['clubs-11', 'clubs-8'], trump: 'clubs', gewest: 'amsterdams', plays: [play(1, 'clubs-7'), play(0, 'clubs-9')] }), 2 as Seat),
  ['clubs-11', 'clubs-8'],
));
// 14. Zelfde situatie Rotterdams → overtroeven verplicht (alleen de hogere troef).
check('Rotterdams: troef geleid, maat hoog → toch overtroeven', setEq(
  legalPlays(st({ seat: 2, hand: ['clubs-11', 'clubs-8'], trump: 'clubs', gewest: 'rotterdams', plays: [play(1, 'clubs-7'), play(0, 'clubs-9')] }), 2 as Seat),
  ['clubs-11'],
));

console.log(`rules.test-manual: ${geslaagd} checks geslaagd ✓`);
