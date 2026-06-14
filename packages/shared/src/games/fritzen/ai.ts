/**
 * src/games/fritzen/ai.ts
 * Heuristische Fritzen-AI (push-your-luck). Implementeert PlayerController.chooseMove.
 *  - ROLLEN: gooien als enige zet.
 *  - BESLISSEN: al in een veilige zone (≥30 of ≤10)? Leg alles vast en stop.
 *    Anders kies een doel (hoog/laag) op basis van de huidige stenen, hou de
 *    stenen die bij dat doel passen vast en gooi de rest opnieuw zolang er
 *    worpen resten; geen worpen meer → stop met wat er ligt.
 */

import type { PlayerController } from '../../core/player.ts';
import type { PlayerConfig, PublicGameView, Seat } from '../../core/types.ts';
import { snelheidsFactor } from '../../core/speed.ts';
import { isSafe } from './scoring.ts';
import type { FritzenMove, FritzenVariantConfig } from './types.ts';

type Difficulty = 'makkelijk' | 'gemiddeld' | 'moeilijk';

interface FritzenViewExtras {
  locked?: number[];
  loose?: number[];
}

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

function sameMulti(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort((p, q) => p - q);
  const y = [...b].sort((p, q) => p - q);
  return x.every((v, i) => v === y[i]);
}

export class FritzenAi implements PlayerController {
  readonly seat: Seat;
  readonly config: PlayerConfig;
  private readonly thinkDelayMs: [number, number];
  private readonly difficulty: Difficulty;

  constructor(
    seat: Seat,
    player: PlayerConfig,
    _variant: FritzenVariantConfig,
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

  async chooseMove(view: PublicGameView, legalMoves: readonly unknown[]): Promise<unknown> {
    await this.think();
    const moves = legalMoves as FritzenMove[];
    if (moves.length === 0) return undefined;
    if (moves.length === 1) return moves[0];
    if (moves[0]!.type === 'roll') return moves[0];

    const extras = (view.viewExtras ?? {}) as FritzenViewExtras;
    const locked = extras.locked ?? [];
    const loose = extras.loose ?? [];
    const keeps = moves.filter((m): m is Extract<FritzenMove, { type: 'keep' }> => m.type === 'keep');
    const total = sum(locked) + sum(loose);

    const vind = (vals: number[], stop: boolean): FritzenMove | undefined =>
      keeps.find((m) => m.stop === stop && sameMulti(m.values, vals));

    // Al veilig → alles vastleggen en stoppen.
    if (isSafe(total)) {
      return vind(loose, true) ?? keeps.find((m) => m.stop) ?? moves[0];
    }

    // Doel VASTPINNEN: zodra er stenen vastliggen bepaalt DIE de richting (die kan
    // niet meer wijzigen). Zou je het doel elke worp uit het gemengde gemiddelde
    // herberekenen, dan kan het midden in de beurt omklappen en stuurt de AI zichzelf
    // de strafzone in. Pas bij de eerste beslis-worp (nog niets vast) baseren we op
    // de losse stenen.
    const richtingBron = locked.length > 0 ? locked : loose;
    const hoog = sum(richtingBron) / richtingBron.length >= 3.5;

    // Alleen stenen die het doel echt halen vasthouden: ≥30 vergt gem. 5 per steen,
    // ≤10 gem. ≤1,67 — dus hoog → 5/6, laag → 1/2 (een 4 of 3 vasthouden ondermijnt
    // het doel juist).
    const past = hoog ? loose.filter((v) => v >= 5) : loose.filter((v) => v <= 2);

    // Geen passende steen: leg geen tegengestelde steen vast (dat breekt het doel).
    // Hou de minst-schadelijke enkele steen aan en gooi de rest opnieuw.
    let keep = past;
    if (keep.length === 0) keep = [hoog ? Math.max(...loose) : Math.min(...loose)];

    // Mag/wil opnieuw gooien? (er moet iets te herwerpen zijn én een stop:false-zet bestaan)
    const herworp = keep.length < loose.length ? vind(keep, false) : undefined;
    // 'moeilijk' is het scherpst (laagste stopkans, maar NIET 0 → stopt wél als
    // doorgaan niet meer helpt); 'makkelijk' stopt eerder.
    const stopKans = this.difficulty === 'makkelijk' ? 0.4 : this.difficulty === 'moeilijk' ? 0.08 : 0.18;
    if (herworp && Math.random() >= stopKans) return herworp;

    return vind(loose, true) ?? keeps.find((m) => m.stop) ?? moves[0];
  }
}
