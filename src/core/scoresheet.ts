/**
 * src/core/scoresheet.ts
 * Scoreadministratie ("de schrijver"): per-ronde scores en cumulatieve totalen.
 * Spel-onafhankelijk; Kingen gebruikt de nulsom-invariant als controle.
 */

import type { Seat } from './types.ts';

/** Eén rij op het scorebord. */
export interface ScoreRow {
  roundIndex: number;
  /** Game-specifiek soort (bijv. KingenRoundKind), voor styling/filtering. */
  roundKind: string;
  /** Nederlands label voor weergave, bijv. "Geen dames". */
  roundLabel: string;
  /** Delta-score per stoel in deze ronde (negatief = straf). Index = Seat. */
  scores: number[];
  /** Cumulatief totaal per stoel NA deze ronde. Index = Seat. */
  runningTotals: number[];
}

export class ScoreSheet {
  readonly seatCount: number;
  private rows: ScoreRow[] = [];

  constructor(seatCount: number) {
    this.seatCount = seatCount;
  }

  /** Voeg de uitslag van een ronde toe. `scores` moet seatCount lang zijn. */
  addRound(roundIndex: number, roundKind: string, roundLabel: string, scores: readonly number[]): ScoreRow {
    if (scores.length !== this.seatCount) {
      throw new Error(`Verwacht ${this.seatCount} scores, kreeg ${scores.length}`);
    }
    const prev = this.getTotals();
    const runningTotals = prev.map((t, i) => t + (scores[i] ?? 0));
    const row: ScoreRow = { roundIndex, roundKind, roundLabel, scores: scores.slice(), runningTotals };
    this.rows.push(row);
    return row;
  }

  /** Alle rijen, in speelvolgorde. */
  getRows(): readonly ScoreRow[] {
    return this.rows;
  }

  /** Cumulatieve totalen per stoel. Index = Seat. */
  getTotals(): number[] {
    const last = this.rows[this.rows.length - 1];
    return last ? last.runningTotals.slice() : new Array<number>(this.seatCount).fill(0);
  }

  /** Stoel(en) met de hoogste totaalscore. */
  getLeaders(): Seat[] {
    const totals = this.getTotals();
    const max = Math.max(...totals);
    return totals.flatMap((t, i) => (t === max ? [i as Seat] : []));
  }

  /** Som van alle totalen — bij standaard Kingen na afloop exact 0 (controle). */
  getGrandTotal(): number {
    return this.getTotals().reduce((a, b) => a + b, 0);
  }

  /** Reset voor een nieuwe partij. */
  reset(): void {
    this.rows = [];
  }
}
