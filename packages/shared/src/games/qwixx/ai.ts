/**
 * src/games/qwixx/ai.ts
 * Heuristische Qwixx-AI (v1). Implementeert de generieke PlayerController.chooseMove.
 *  - ROLLEN: gooien als het de enige zet is.
 *  - WITTE actie: markeer de optie die het minst overslaat; sla over als elke
 *    optie te veel cellen verspilt (disciplinair, schaalt met moeilijkheid).
 *  - GEKLEURDE actie (actieve speler): kruis de goedkoopste optie; heb je deze
 *    beurt nog NIETS gekruist, dan markeer je ruimer om een strafvak te ontlopen.
 * Geen zoekboom; "kosten" = aantal overgeslagen cellen.
 */

import type { PlayerController } from '../../core/player.ts';
import type { PlayerConfig, PublicGameView, Seat } from '../../core/types.ts';
import { snelheidsFactor } from '../../core/speed.ts';
import { lockNumber, rowNumbers } from './types.ts';
import type { QwixxColor, QwixxMove, QwixxVariantConfig } from './types.ts';

type Difficulty = 'makkelijk' | 'gemiddeld' | 'moeilijk';

interface SheetView {
  rows: Record<QwixxColor, { marks: number[]; locked: boolean }>;
  penalties: number;
}
interface QwixxViewExtras {
  activeMarked?: boolean;
  sheets?: SheetView[];
}

export class QwixxAi implements PlayerController {
  readonly seat: Seat;
  readonly config: PlayerConfig;
  private readonly thinkDelayMs: [number, number];
  private readonly difficulty: Difficulty;

  constructor(
    seat: Seat,
    player: PlayerConfig,
    _variant: QwixxVariantConfig,
    thinkDelayMs: [number, number] = [350, 900],
  ) {
    this.seat = seat;
    this.config = player;
    this.thinkDelayMs = thinkDelayMs;
    this.difficulty = player.aiDifficulty ?? 'gemiddeld';
  }

  private async think(): Promise<void> {
    const [min, max] = this.thinkDelayMs;
    const ms = (min + Math.random() * Math.max(0, max - min)) * snelheidsFactor();
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  }

  /** Hoeveel cellen slaat een markering in deze rij over (lager = beter)? */
  private kosten(marks: number[], color: QwixxColor, value: number): number {
    const nums = rowNumbers(color);
    const start = marks.length > 0 ? nums.indexOf(marks[marks.length - 1]!) + 1 : 0;
    return nums.indexOf(value) - start;
  }

  /** Markeer-drempel (max. overgeslagen cellen) per moeilijkheid. */
  private drempel(): number {
    switch (this.difficulty) {
      case 'makkelijk': return 4;
      case 'moeilijk': return 2;
      default: return 3;
    }
  }

  async chooseMove(view: PublicGameView, legalMoves: readonly unknown[]): Promise<unknown> {
    await this.think();
    const moves = legalMoves as QwixxMove[];
    if (moves.length === 0) return undefined;
    if (moves.length === 1) return moves[0];

    const extras = (view.viewExtras ?? {}) as QwixxViewExtras;
    const sheet = extras.sheets?.[view.seat];

    const marks = moves.filter(
      (m): m is Extract<QwixxMove, { type: 'markWhite' | 'markColor' }> =>
        m.type === 'markWhite' || m.type === 'markColor',
    );
    const pass = moves.find((m) => m.type === 'pass');
    if (marks.length === 0) return pass ?? moves[0];

    // Beste (goedkoopste) markering; een slotgetal is voorwaardelijk waardevol.
    const totals = view.totals ?? [];
    const mijnTotaal = totals[view.seat] ?? 0;
    const besteAnder = totals.length > 1 ? Math.max(...totals.filter((_, i) => i !== view.seat)) : 0;
    const reedsDicht = sheet ? Object.values(sheet.rows).filter((r) => r.locked).length : 0;
    const score = (m: typeof marks[number]): number => {
      const rij = sheet?.rows[m.color].marks ?? [];
      const k = this.kosten(rij, m.color, m.value);
      if (m.value !== lockNumber(m.color)) return k;
      // Een slot levert de eindcel + een bonuskruisje, maar kan het spel beëindigen
      // (2e slot = einde). Lig je achter én is er al een kleur dicht, beloon het slot
      // dan NIET — anders bevries je een verlies. Anders belonen naar rijlengte
      // (langere rij = meer waard om te sluiten).
      if (mijnTotaal < besteAnder && reedsDicht >= 1) return k;
      return k - Math.min(6, rij.length); // slot belonen, geschaald op rijlengte
    };
    const beste = [...marks].sort((a, b) => score(a) - score(b))[0]!;
    const besteKosten = score(beste);

    const isColor = beste.type === 'markColor';
    const moetScoren = isColor && extras.activeMarked === false; // anders strafvak
    const limiet = moetScoren ? 6 : this.drempel();

    if (besteKosten <= limiet) return beste;
    return pass ?? beste;
  }
}
