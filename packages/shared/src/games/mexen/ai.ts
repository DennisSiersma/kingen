/**
 * src/games/mexen/ai.ts
 * Heuristische Mexen-AI (v1). Implementeert de generieke PlayerController.chooseMove.
 *  - ROLLEN: altijd gooien als dat de enige zet is.
 *  - AANKONDIGEN: eerlijk de laagste geldige waarde ≥ de eigen worp (zo min mogelijk
 *    weggeven); kan dat niet (worp te laag), dan de kleinst mogelijke leugen.
 *  - REAGEREN: schat hoe onwaarschijnlijk de aankondiging is (hoe hoger/dichter bij
 *    Mex, hoe vaker bluf) en twijfel naar rato; anders geloven. Bluf-/twijfel-
 *    agressie schaalt met de moeilijkheidsgraad. Geen zoekboom.
 */

import type { PlayerController } from '../../core/player.ts';
import type { PlayerConfig, PublicGameView, Seat } from '../../core/types.ts';
import { snelheidsFactor } from '../../core/speed.ts';
import { rankOf, rollToCode } from './ranking.ts';
import type { MexenMove, MexenVariantConfig } from './types.ts';

type Difficulty = 'makkelijk' | 'gemiddeld' | 'moeilijk';

interface MexenViewExtras {
  phase: string;
  currentAnnouncement: number | null;
  myRoll: [number, number] | null;
  rollsThisTurn?: number;
  maxRolls?: number;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export class MexenAi implements PlayerController {
  readonly seat: Seat;
  readonly config: PlayerConfig;
  private readonly variant: MexenVariantConfig;
  private readonly thinkDelayMs: [number, number];
  private readonly difficulty: Difficulty;

  constructor(
    seat: Seat,
    player: PlayerConfig,
    variant: MexenVariantConfig,
    thinkDelayMs: [number, number] = [400, 1100],
  ) {
    this.seat = seat;
    this.config = player;
    this.variant = variant;
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
    const moves = legalMoves as MexenMove[];
    if (moves.length === 0) return undefined;
    if (moves.length === 1) return moves[0];

    const extras = (view.viewExtras ?? {}) as MexenViewExtras;

    // Aankondigen (eventueel met de optie om nog eens te gooien).
    const announceMoves = moves.filter((m): m is Extract<MexenMove, { type: 'announce' }> => m.type === 'announce');
    if (announceMoves.length > 0) {
      const herworp = moves.find((m) => m.type === 'roll');
      return this.kiesAankondiging(announceMoves, herworp, extras);
    }

    // Reageren: twijfelen of geloven.
    const doubt = moves.find((m) => m.type === 'doubt');
    const believe = moves.find((m) => m.type === 'believe');
    if (!believe) return doubt ?? moves[0]; // Mex onverslaanbaar → alleen twijfelen
    return this.wilTwijfelen(extras) ? (doubt ?? believe) : believe;
  }

  /**
   * Kies een aankondiging — of gooi nog eens als dat mag en de eigen worp de
   * vorige aankondiging (nog) niet eerlijk kan verslaan.
   *  - kan eerlijk: kondig de láágste geldige waarde aan (geeft het minst weg, en
   *    is waar want de eigen worp is minstens zo hoog);
   *  - kan niet eerlijk + mag nog gooien: gooi opnieuw (kans op een echte worp);
   *  - kan niet eerlijk + geen worpen meer: de kleinste leugen.
   */
  private kiesAankondiging(
    moves: Extract<MexenMove, { type: 'announce' }>[],
    herworp: MexenMove | undefined,
    extras: MexenViewExtras,
  ): MexenMove {
    const sorted = [...moves].sort((a, b) => rankOf(a.value) - rankOf(b.value));
    const laagste = sorted[0]!;
    const myRoll = extras.myRoll;
    if (myRoll) {
      const ownRank = rankOf(rollToCode([myRoll[0] as 1, myRoll[1] as 1]));
      // Eerlijk mogelijk = eigen worp haalt minstens de laagste geldige waarde.
      if (ownRank >= rankOf(laagste.value)) return laagste;
      // Anders: nog eens gooien als het mag (kans-afhankelijk van de moeilijkheid).
      if (herworp && Math.random() < this.herworpKans()) return herworp;
    } else if (herworp && Math.random() < this.herworpKans()) {
      return herworp;
    }
    return laagste; // moet bluffen → kleinste leugen
  }

  /** Hoe gretig de AI nog eens gooit als de huidige worp te laag is. */
  private herworpKans(): number {
    switch (this.difficulty) {
      case 'makkelijk': return 0.55;
      case 'moeilijk': return 1.0;
      default: return 0.85;
    }
  }

  /** Twijfelkans op basis van hoe hoog/onwaarschijnlijk de aankondiging is. */
  private wilTwijfelen(extras: MexenViewExtras): boolean {
    const ann = extras.currentAnnouncement;
    if (ann === null) return false;
    const high = clamp(rankOf(ann) / 20, 0, 1); // 0 (31) .. 1 (Mex)
    let prob: number;
    switch (this.difficulty) {
      case 'makkelijk': prob = (high - 0.7) * 1.6; break;  // twijfelt alleen bij heel hoge claims
      case 'moeilijk': prob = (high - 0.45) * 1.5; break;  // beter gekalibreerd
      default: prob = (high - 0.55) * 1.4; break;          // gemiddeld
    }
    return Math.random() < clamp(prob, 0, 0.95);
  }
}
