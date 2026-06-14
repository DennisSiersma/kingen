/**
 * src/games/yahtzee/scoring.ts
 * Pure scorefuncties voor Yahtzee. Geen state, geen UI — alleen rekenen op een
 * worp (vijf stenen) en op een scorekaart. De jokervlag (`joker`) wordt door de
 * engine gezet bij een extra-Yahtzee: dan tellen Full House/Small/Large Straight
 * op vol tarief, ook al is het technisch geen straat/full house (Hasbro-joker).
 */

import {
  UPPER_BONUS, UPPER_BONUS_THRESHOLD, UPPER_CATEGORIES, YAHTZEE_BONUS, YAHTZEE_CATEGORIES,
} from './types.ts';
import type { YahtzeeCard, YahtzeeCategory } from './types.ts';

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

/** Tellingen per oog (index 1..6); index 0 ongebruikt. */
export function counts(dice: readonly number[]): number[] {
  const c = new Array<number>(7).fill(0);
  for (const d of dice) if (d >= 1 && d <= 6) c[d]! += 1;
  return c;
}

/** Vijf gelijke stenen? */
export function isYahtzee(dice: readonly number[]): boolean {
  return counts(dice).some((c) => c >= 5);
}

/** Precies een trio + een paar (strikt; vijfling telt hier niet als full house). */
export function isFullHouse(dice: readonly number[]): boolean {
  const grps = counts(dice).filter((x) => x > 0).sort((a, b) => a - b);
  return grps.length === 2 && grps[0] === 2 && grps[1] === 3;
}

/** Langste reeks opeenvolgende ogen die voorkomt. */
function maxRun(dice: readonly number[]): number {
  const present = counts(dice);
  let best = 0;
  let cur = 0;
  for (let v = 1; v <= 6; v++) {
    if (present[v]! > 0) { cur += 1; best = Math.max(best, cur); } else cur = 0;
  }
  return best;
}

/** Vier opeenvolgende stenen (1-2-3-4, 2-3-4-5 of 3-4-5-6)? */
export function hasSmallStraight(dice: readonly number[]): boolean {
  return maxRun(dice) >= 4;
}

/** Vijf opeenvolgende stenen (1-2-3-4-5 of 2-3-4-5-6)? */
export function hasLargeStraight(dice: readonly number[]): boolean {
  return maxRun(dice) >= 5;
}

/** Score van `category` voor de worp `dice`. `joker` forceert vol tarief bij de combinaties. */
export function scoreCategory(dice: readonly number[], category: YahtzeeCategory, joker = false): number {
  const c = counts(dice);
  const total = sum(dice);
  switch (category) {
    case 'ones': return c[1]! * 1;
    case 'twos': return c[2]! * 2;
    case 'threes': return c[3]! * 3;
    case 'fours': return c[4]! * 4;
    case 'fives': return c[5]! * 5;
    case 'sixes': return c[6]! * 6;
    case 'threeKind': return c.some((x) => x >= 3) ? total : 0;
    case 'fourKind': return c.some((x) => x >= 4) ? total : 0;
    case 'fullHouse': return joker || isFullHouse(dice) ? 25 : 0;
    case 'smallStraight': return joker || hasSmallStraight(dice) ? 30 : 0;
    case 'largeStraight': return joker || hasLargeStraight(dice) ? 40 : 0;
    case 'yahtzee': return isYahtzee(dice) ? 50 : 0;
    case 'chance': return total;
    default: return 0;
  }
}

/** Subtotaal van de bovensectie (voor de +35-bonus). */
export function upperSubtotal(card: YahtzeeCard): number {
  return UPPER_CATEGORIES.reduce((a, cat) => a + (card.scores[cat] ?? 0), 0);
}

/** Heeft deze kaart recht op de bovenbonus (+35)? */
export function hasUpperBonus(card: YahtzeeCard): boolean {
  return upperSubtotal(card) >= UPPER_BONUS_THRESHOLD;
}

/** Volledig eindtotaal van een kaart: ingevulde vakken + bovenbonus + Yahtzee-bonussen. */
export function cardGrandTotal(card: YahtzeeCard): number {
  const filled = YAHTZEE_CATEGORIES.reduce((a, cat) => a + (card.scores[cat] ?? 0), 0);
  const bonus = hasUpperBonus(card) ? UPPER_BONUS : 0;
  return filled + bonus + card.yahtzeeBonus * YAHTZEE_BONUS;
}

/** Zijn alle 13 categorieën ingevuld? */
export function isCardFull(card: YahtzeeCard): boolean {
  return YAHTZEE_CATEGORIES.every((cat) => card.scores[cat] !== null);
}
