/**
 * src/games/yahtzee/ai.ts
 * Heuristische Yahtzee-AI. Implementeert PlayerController.chooseMove.
 *  - ROLLEN: gooien als enige zet.
 *  - BESLISSEN: heeft de worp al een premium-combo (Yahtzee/grote straat/full
 *    house) voor een open vak? Dan scoren. Anders, zolang er worpen resten,
 *    de meest kansrijke stenen vasthouden (grootste groep, of bijna-straat) en
 *    de rest opnieuw gooien. Geen worpen meer → de beste/minst schadelijke
 *    categorie invullen.
 */

import type { PlayerController } from '../../core/player.ts';
import type { PlayerConfig, PublicGameView, Seat } from '../../core/types.ts';
import { snelheidsFactor } from '../../core/speed.ts';
import { counts, hasLargeStraight, hasSmallStraight, isFullHouse, isYahtzee, scoreCategory } from './scoring.ts';
import type { YahtzeeCategory, YahtzeeMove, YahtzeeVariantConfig } from './types.ts';

type Difficulty = 'makkelijk' | 'gemiddeld' | 'moeilijk';

interface YahtzeeViewExtras {
  dice?: number[];
  rollsUsed?: number;
  cards?: { scores: Record<string, number | null> }[];
}

/** Wanneer we gedwongen een 0 (of zwakke score) moeten dumpen: van laag-risico naar hoog. */
const SCRATCH_ORDER: readonly YahtzeeCategory[] = [
  'ones', 'twos', 'threes', 'fours', 'fives', 'sixes',
  'fourKind', 'threeKind', 'fullHouse', 'smallStraight', 'largeStraight', 'chance', 'yahtzee',
];

function sameMulti(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort((p, q) => p - q);
  const y = [...b].sort((p, q) => p - q);
  return x.every((v, i) => v === y[i]);
}

export class YahtzeeAi implements PlayerController {
  readonly seat: Seat;
  readonly config: PlayerConfig;
  private readonly thinkDelayMs: [number, number];
  private readonly difficulty: Difficulty;

  constructor(
    seat: Seat,
    player: PlayerConfig,
    _variant: YahtzeeVariantConfig,
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
    const moves = legalMoves as YahtzeeMove[];
    if (moves.length === 0) return undefined;
    if (moves.length === 1) return moves[0];
    if (moves[0]!.type === 'roll') return moves[0];

    const extras = (view.viewExtras ?? {}) as YahtzeeViewExtras;
    const dice = extras.dice ?? [];
    const scores = extras.cards?.[this.seat]?.scores ?? {};
    const rerolls = moves.filter((m): m is Extract<YahtzeeMove, { type: 'reroll' }> => m.type === 'reroll');
    const scoreMoves = moves.filter((m): m is Extract<YahtzeeMove, { type: 'score' }> => m.type === 'score');

    const joker = isYahtzee(dice) && scores.yahtzee != null;
    const bestScore = this.chooseScore(dice, scoreMoves, joker);

    // Geen herworp mogelijk → verplicht scoren.
    if (rerolls.length === 0) return bestScore ?? scoreMoves[0] ?? moves[0];

    // Premium-combo nu al binnen voor een open vak → pakken (niet weggooien).
    if (this.heeftPremium(dice, scores)) return bestScore ?? scoreMoves[0] ?? moves[0];

    // Anders: kansrijke stenen vasthouden en opnieuw gooien.
    const keep = this.chooseKeep(dice, scores);
    const rerollMove = rerolls.find((m) => sameMulti(m.keep, keep)) ?? rerolls.find((m) => m.keep.length === 0);
    // Makkelijk stopt soms vroeg; moeilijk gooit door zolang het zin heeft.
    const stopKans = this.difficulty === 'makkelijk' ? 0.3 : this.difficulty === 'moeilijk' ? 0.0 : 0.1;
    if (rerollMove && Math.random() >= stopKans) return rerollMove;
    return bestScore ?? scoreMoves[0] ?? moves[0];
  }

  /** Is er een sterke, af-te-ronden combinatie voor een nog-open vak? */
  private heeftPremium(dice: number[], scores: Record<string, number | null>): boolean {
    // Een vijfling is ALTIJD de moeite waard om te houden — ook als het Yahtzee-vak
    // al gescratcht (0) is, want via de joker-regel/four-of-a-kind/chance/bovensectie
    // scoort hij nog hoog. Anders zou de AI een gegarandeerde vijfling weggooien.
    if (isYahtzee(dice)) return true;
    if (hasLargeStraight(dice) && scores.largeStraight == null) return true;
    if (hasSmallStraight(dice) && scores.smallStraight == null) return true;
    if (isFullHouse(dice) && scores.fullHouse == null) return true;
    return false;
  }

  /** Welke stenen vasthouden voor de herworp. */
  private chooseKeep(dice: number[], scores: Record<string, number | null>): number[] {
    const c = counts(dice);
    // Beste groep gelijke stenen (bij gelijkspel: hoogste oog).
    let bestVal = 0;
    let bestCount = 0;
    for (let v = 1; v <= 6; v++) {
      if (c[v]! > bestCount || (c[v]! === bestCount && v > bestVal)) { bestCount = c[v]!; bestVal = v; }
    }
    if (bestCount >= 2) return dice.filter((d) => d === bestVal);

    // Alles los → bijna-straat? Houd de langste opeenvolgende reeks vast (≥3).
    const straightOpen = scores.smallStraight == null || scores.largeStraight == null;
    if (straightOpen) {
      const present = [...new Set(dice)].sort((a, b) => a - b);
      let run: number[] = [];
      let best: number[] = [];
      for (let i = 0; i < present.length; i++) {
        if (i === 0 || present[i] === present[i - 1]! + 1) run.push(present[i]!);
        else run = [present[i]!];
        if (run.length > best.length) best = [...run];
      }
      if (best.length >= 3) return best;
    }
    // Anders de hoge stenen aanhouden (richting bovensectie/chance).
    const hoog = dice.filter((d) => d >= 4);
    return hoog.length > 0 ? hoog : [Math.max(...dice)];
  }

  /** Kies de te scoren categorie: hoogste score, met zinnige tie-break / 0-dump. */
  private chooseScore(
    dice: number[],
    scoreMoves: Extract<YahtzeeMove, { type: 'score' }>[],
    joker: boolean,
  ): YahtzeeMove | undefined {
    if (scoreMoves.length === 0) return undefined;
    let best: { move: YahtzeeMove; value: number } | null = null;
    for (const m of scoreMoves) {
      const value = scoreCategory(dice, m.category, joker);
      if (!best || value > best.value) best = { move: m, value };
    }
    if (best && best.value > 0) {
      // Bij gelijke topscore: liever een laag-plafond-vak invullen (spaar Yahtzee/straten).
      const top = best.value;
      const ties = scoreMoves.filter((m) => scoreCategory(dice, m.category, joker) === top);
      ties.sort((a, b) => SCRATCH_ORDER.indexOf(a.category) - SCRATCH_ORDER.indexOf(b.category));
      return ties[0];
    }
    // Alleen nog 0's mogelijk → dump volgens de scratch-volgorde.
    const open = new Set(scoreMoves.map((m) => m.category));
    for (const cat of SCRATCH_ORDER) {
      if (open.has(cat)) return scoreMoves.find((m) => m.category === cat);
    }
    return scoreMoves[0];
  }
}
