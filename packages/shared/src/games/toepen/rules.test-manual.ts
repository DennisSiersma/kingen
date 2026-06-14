/**
 * src/games/toepen/rules.test-manual.ts
 * Unit-test voor bekennen + speciale-hand-detectie. Draai met: npx tsx
 */

import type { Card, Rank, Seat, Suit } from '../../core/types.ts';
import { heeftVierGelijke, isVuileWas, legalPlays } from './rules.ts';
import type { ToepenState } from './types.ts';

let geslaagd = 0;
function check(naam: string, cond: boolean): void {
  if (!cond) throw new Error(`FAIL: ${naam}`);
  geslaagd++;
}

const k = (suit: Suit, rank: Rank): Card => ({ id: `${suit}-${rank}`, suit, rank });

/** Minimale state voor legalPlays met handen + lopende slag. */
function st(hands: Card[][], plays: { seat: Seat; card: Card }[]): ToepenState {
  const partial: Pick<ToepenState, 'hands' | 'currentTrick'> = {
    hands,
    currentTrick: { index: 0, leader: 0 as Seat, plays },
  };
  return partial as ToepenState;
}

// --- legalPlays ---
{
  const hand = [k('hearts', 10), k('hearts', 7), k('clubs', 14), k('spades', 11)];
  const s = st([hand], []);
  check('uitkomer: alles mag', legalPlays(s, 0).length === 4);
}
{
  const hand = [k('hearts', 10), k('hearts', 7), k('clubs', 14), k('spades', 11)];
  const plays = [{ seat: 1 as Seat, card: k('hearts', 9) }];
  const s = st([hand, []], plays);
  const legaal = legalPlays(s, 0);
  check('bekennen verplicht: alleen harten', legaal.length === 2 && legaal.every((c) => c.suit === 'hearts'));
}
{
  const hand = [k('clubs', 14), k('spades', 11), k('diamonds', 8)];
  const plays = [{ seat: 1 as Seat, card: k('hearts', 9) }];
  const s = st([hand, []], plays);
  check('geen gevraagde kleur: alles mag afgooien', legalPlays(s, 0).length === 3);
}

// --- vier gelijke ---
check('vier boeren = vier gelijke', heeftVierGelijke([k('hearts', 11), k('clubs', 11), k('spades', 11), k('diamonds', 11)]));
check('vier tienen = vier gelijke', heeftVierGelijke([k('hearts', 10), k('clubs', 10), k('spades', 10), k('diamonds', 10)]));
check('niet vier gelijke', !heeftVierGelijke([k('hearts', 11), k('clubs', 11), k('spades', 11), k('diamonds', 10)]));

// --- vuile was ---
check('vier plaatjes = vuile was', isVuileWas([k('hearts', 11), k('clubs', 12), k('spades', 13), k('diamonds', 14)]));
check('drie plaatjes + 7 = vuile was', isVuileWas([k('hearts', 11), k('clubs', 12), k('spades', 13), k('diamonds', 7)]));
check('plaatjes + 8 = geen vuile was', !isVuileWas([k('hearts', 11), k('clubs', 12), k('spades', 13), k('diamonds', 8)]));
check('twee plaatjes + twee 7 = geen vuile was', !isVuileWas([k('hearts', 11), k('clubs', 12), k('spades', 7), k('diamonds', 7)]));
check('met een 10 = geen vuile was', !isVuileWas([k('hearts', 11), k('clubs', 12), k('spades', 13), k('diamonds', 10)]));

console.log(`OK — ${geslaagd} checks geslaagd (rules)`);
