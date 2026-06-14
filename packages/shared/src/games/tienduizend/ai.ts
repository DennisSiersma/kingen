/**
 * src/games/tienduizend/ai.ts
 * Heuristische Tienduizend-AI (push-your-luck). Implementeert chooseMove.
 *  - ROLLEN: gooien als enige zet.
 *  - BESLISSEN: leg alle scorende stenen apart (maximale worp-score) en bepaal
 *    dan banken of doorgooien. Hoe minder stenen er nog te gooien zijn, hoe
 *    eerder er gebankt wordt (bust-risico). Niet binnen → doorgooien tot de
 *    drempel; de doelscore in zicht → meteen banken. Moeilijkheid schuift de
 *    bank-drempels op (makkelijk bankt vroeg, moeilijk pusht door).
 */

import type { PlayerController } from '../../core/player.ts';
import type { PlayerConfig, PublicGameView, Seat } from '../../core/types.ts';
import { snelheidsFactor } from '../../core/speed.ts';
import { scoreDice } from './scoring.ts';
import type { TienduizendMove, TienduizendVariantConfig } from './types.ts';

type Difficulty = 'makkelijk' | 'gemiddeld' | 'moeilijk';

interface TdViewExtras {
  loose?: number[];
  turnPot?: number;
  total?: number;
  entered?: boolean;
  threshold?: number;
  target?: number;
}

/**
 * Bank-drempel (≈ optimale break-even) per aantal nog te gooien stenen. Met WEINIG
 * stenen is doorgooien sterk −EV (bij 1 steen ~2/3 bust), dus de drempel DAALT naar
 * weinig stenen toe — eerder de oude tabel die juist op 1-2 stenen veel te lang
 * doorgooide. (teGooien is altijd 1..6; volle bak → 6 verse stenen.)
 */
const BANK_FLOOR: Record<number, number> = { 1: 50, 2: 100, 3: 200, 4: 400, 5: 650, 6: 900 };

function sameMulti(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort((p, q) => p - q);
  const y = [...b].sort((p, q) => p - q);
  return x.every((v, i) => v === y[i]);
}

export class TienduizendAi implements PlayerController {
  readonly seat: Seat;
  readonly config: PlayerConfig;
  private readonly thinkDelayMs: [number, number];
  private readonly difficulty: Difficulty;

  constructor(
    seat: Seat,
    player: PlayerConfig,
    _variant: TienduizendVariantConfig,
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
    const moves = legalMoves as TienduizendMove[];
    if (moves.length === 0) return undefined;
    if (moves.length === 1) return moves[0];
    if (moves[0]!.type === 'roll') return moves[0];

    const extras = (view.viewExtras ?? {}) as TdViewExtras;
    const loose = extras.loose ?? [];
    const turnPot = extras.turnPot ?? 0;
    const total = extras.total ?? 0;
    const entered = extras.entered ?? false;
    const threshold = extras.threshold ?? 350;
    const target = extras.target ?? 10000;

    const setAside = moves.filter((m): m is Extract<TienduizendMove, { type: 'setAside' }> => m.type === 'setAside');
    // Beste apart-leg-keuze: hoogste worp-score (bij gelijkspel: meeste stenen).
    let best: { keep: number[]; score: number } | null = null;
    for (const m of setAside) {
      const s = scoreDice(m.keep) ?? 0;
      if (!best || s > best.score || (s === best.score && m.keep.length > best.keep.length)) {
        best = { keep: m.keep, score: s };
      }
    }
    if (!best) return moves[0];

    const potNa = turnPot + best.score;
    const resterend = loose.length - best.keep.length; // 0 = volle bak (→ 6 verse stenen)
    const teGooien = resterend === 0 ? 6 : resterend;

    const vind = (bank: boolean): TienduizendMove | undefined =>
      setAside.find((m) => m.bank === bank && sameMulti(m.keep, best!.keep));

    const wilBanken = (): boolean => {
      // Nog niet binnen: zodra de drempel gehaald is meteen vastzetten (entry is
      // kostbaar; doorgooien leidt vaak tot een bust en 0 punten).
      if (!entered) return potNa >= threshold;
      // Doelscore in zicht → vastzetten.
      if (total + potNa >= target) return true;
      // 'moeilijk' speelt rond de optimale break-even (factor 1.0); makkelijk/gemiddeld
      // banken CONSERVATIEVER (lagere drempel = eerder vastzetten). Géén inversie meer:
      // de oude factor 1.6 liet 'moeilijk' juist het langst doorgooien (meeste busts).
      const factor = this.difficulty === 'makkelijk' ? 0.6 : this.difficulty === 'moeilijk' ? 1.0 : 0.8;
      return potNa >= BANK_FLOOR[teGooien]! * factor;
    };

    if (wilBanken()) return vind(true) ?? vind(false) ?? moves[0];
    return vind(false) ?? vind(true) ?? moves[0];
  }
}
