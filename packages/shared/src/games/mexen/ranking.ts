/**
 * src/games/mexen/ranking.ts
 * Eén bron van waarheid voor de Mexen-waarde-ordening, gebruikt door de engine,
 * de AI en (later) de UI.
 *
 * Canonieke ordening (laag → hoog), sterke bronconsensus (zie DICEGAME_RULES_RESEARCH.md):
 *   niet-paren oplopend  31<32<41<42<43<51<52<53<54<61<62<63<64<65
 *   dan paren            11<22<33<44<55<66      (boven álle niet-paren)
 *   dan Mex (21)         hoogste, onverslaanbaar
 *
 * Een "code" is het tweecijferige getal met de hoogste steen als tiental
 * (bijv. worp 6&4 → 64). 21 (Mex) is de uitzondering: zowel [2,1] als [1,2]
 * geven code 21, en die staat bovenaan i.p.v. als laag niet-paar — vandaar een
 * expliciete tabel i.p.v. puur rekenen.
 */

import type { Roll } from '../dice/dice.ts';

/** De 21 geldige codes, van laag (index 0) naar hoog (index 20). */
export const RANK_ORDER: readonly number[] = [
  31, 32, 41, 42, 43, 51, 52, 53, 54, 61, 62, 63, 64, 65, // 0..13  niet-paren
  11, 22, 33, 44, 55, 66, //                                  14..19  paren
  21, //                                                       20      Mex
];

/** Worp → code (hoogste steen eerst; [2,1]/[1,2] → 21). */
export function rollToCode(roll: Roll): number {
  const [a, b] = roll;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (hi === 2 && lo === 1) return 21; // Mex
  return hi * 10 + lo;
}

/** Rang-index 0..20 van een code, of -1 als de code ongeldig is. */
export function rankOf(code: number): number {
  return RANK_ORDER.indexOf(code);
}

/** Is dit de Mex (21)? */
export function isMex(code: number): boolean {
  return code === 21;
}

/** Is dit een paar (11..66)? (21 telt NIET als paar.) */
export function isPair(code: number): boolean {
  return code !== 21 && code % 11 === 0 && code >= 11 && code <= 66;
}

/**
 * Verslaat code `a` de huidige aankondiging `b`?
 *  - 'strict': strikt hoger (NL/Mia-standaard, default).
 *  - 'tie': gelijk mag ook ("mit"/Duitse stijl).
 * `b === null` (eerste aankondiging van de ronde) ⇒ alles mag.
 */
export function beats(a: number, b: number | null, mode: 'strict' | 'tie'): boolean {
  if (b === null) return rankOf(a) >= 0;
  const ra = rankOf(a);
  const rb = rankOf(b);
  if (ra < 0 || rb < 0) return false;
  return mode === 'strict' ? ra > rb : ra >= rb;
}

/**
 * Alle codes die `prev` verslaan onder `mode`, van laag naar hoog. Leeg als
 * niets `prev` kan verslaan (bijv. prev = 21 in 'strict' → Mex is onverslaanbaar).
 */
export function announceableCodes(prev: number | null, mode: 'strict' | 'tie'): number[] {
  return RANK_ORDER.filter((c) => beats(c, prev, mode));
}

/** Label voor UI/log: "65", "Paar zessen (66)", "Mex (21)". */
export function codeLabel(code: number): string {
  if (code === 21) return 'Mex (21)';
  if (isPair(code)) return `Paar ${code % 10}-en (${code})`;
  return String(code);
}
