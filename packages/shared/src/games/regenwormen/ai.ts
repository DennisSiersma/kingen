/**
 * src/games/regenwormen/ai.ts
 * Heuristische Regenwormen-AI. Implementeert chooseMove.
 *  - ROLLEN: gooien als enige zet.
 *  - DECIDING: leg de waarde apart die de meeste punten oplevert; heb je nog geen
 *    worm en ligt er een worm, leg die dan vast (een tegel pakken kan niet zonder).
 *  - CHOOSING: schat het bust-risico van nog eens gooien ((#gebruikte/6)^resterend).
 *    Pak een tegel als het risico te hoog is of de tegel veel wormen geeft; pak
 *    altijd een 4-worm-tegel. Moeilijkheid schuift de risicodrempel.
 */

import type { PlayerController } from '../../core/player.ts';
import type { PlayerConfig, PublicGameView, Seat } from '../../core/types.ts';
import { snelheidsFactor } from '../../core/speed.ts';
import { isWorm, pips, wormsOfTile } from './scoring.ts';
import type { RegenwormenMove, RegenwormenVariantConfig } from './types.ts';

type Difficulty = 'makkelijk' | 'gemiddeld' | 'moeilijk';

interface RwViewExtras {
  reserved?: number[];
  loose?: number[];
  usedValues?: number[];
  remaining?: number;
}

export class RegenwormenAi implements PlayerController {
  readonly seat: Seat;
  readonly config: PlayerConfig;
  private readonly thinkDelayMs: [number, number];
  private readonly difficulty: Difficulty;

  constructor(
    seat: Seat,
    player: PlayerConfig,
    _variant: RegenwormenVariantConfig,
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
    const moves = legalMoves as RegenwormenMove[];
    if (moves.length === 0) return undefined;
    if (moves.length === 1) return moves[0];

    const extras = (view.viewExtras ?? {}) as RwViewExtras;
    const loose = extras.loose ?? [];
    const reserved = extras.reserved ?? [];

    // DECIDING: welke waarde apart leggen.
    if (moves.every((m) => m.type === 'reserve')) {
      const reserves = moves as Extract<RegenwormenMove, { type: 'reserve' }>[];
      const hasWormYet = reserved.some(isWorm);
      const count = (v: number): number => loose.filter((d) => d === v).length;
      let best = reserves[0]!;
      let bestVal = -1;
      for (const m of reserves) {
        let val = count(m.value) * pips(m.value);
        if (isWorm(m.value) && !hasWormYet) val += 1000; // eerst een worm zeker stellen
        if (val > bestVal) { bestVal = val; best = m; }
      }
      return best;
    }

    // CHOOSING: doorgooien of een tegel pakken.
    const rollMove = moves.find((m) => m.type === 'roll');
    const takes = moves.filter((m): m is Extract<RegenwormenMove, { type: 'take' }> => m.type === 'take');
    if (takes.length === 0) return rollMove ?? moves[0];

    // Beste tegel: meeste wormen; bij gelijkspel een steal verkiezen (ontneemt tegenstander).
    takes.sort((a, b) => {
      const dw = wormsOfTile(b.tile) - wormsOfTile(a.tile);
      if (dw !== 0) return dw;
      const as = a.from === 'center' ? 0 : 1;
      const bs = b.from === 'center' ? 0 : 1;
      return bs - as;
    });
    const beste = takes[0]!;
    if (!rollMove) return beste;

    const wormen = wormsOfTile(beste.tile);
    if (wormen >= 4) return beste; // topbuit altijd pakken

    const used = extras.usedValues?.length ?? 0;
    const remaining = extras.remaining ?? (8 - reserved.length);
    const bustKans = remaining > 0 ? Math.pow(used / 6, remaining) : 1;
    const basis = this.difficulty === 'makkelijk' ? 0.20 : this.difficulty === 'moeilijk' ? 0.45 : 0.32;
    // §5A.6 (borg wormen vroeg): hoe meer wormen de tegel waard is, hoe eerder we 'm
    // zeker stellen i.p.v. weggokken. Een 1-worm-tegel vergt nog de volle risico-
    // drempel; een 2/3-worm-tegel pakken we al bij de helft/derde van dat risico.
    const drempel = basis / Math.max(1, wormen);
    if (bustKans >= drempel) return beste;
    return rollMove;
  }
}
