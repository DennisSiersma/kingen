/**
 * src/games/qwixx/scoring.ts
 * Score-telling: per kleurrij een driehoeksgetal op basis van het aantal
 * kruisjes (het slot telt als een extra kruisje), minus 5 per strafvak.
 */

import type { QwixxSheet } from './types.ts';
import { QWIXX_COLORS } from './types.ts';

/** Driehoeksgetal n·(n+1)/2: 1→1, 2→3, 3→6, … 7→28, … 12→78. */
export function triangle(n: number): number {
  return (n * (n + 1)) / 2;
}

/** Aantal kruisjes in een rij (slot telt mee). */
export function rowCrosses(marks: number, locked: boolean): number {
  return marks + (locked ? 1 : 0);
}

/** Score van één scoreblad: som van de rijen − 5 per strafvak. */
export function sheetScore(sheet: QwixxSheet): number {
  let total = 0;
  for (const color of QWIXX_COLORS) {
    const row = sheet.rows[color];
    total += triangle(rowCrosses(row.marks.length, row.locked));
  }
  return total - sheet.penalties * 5;
}
