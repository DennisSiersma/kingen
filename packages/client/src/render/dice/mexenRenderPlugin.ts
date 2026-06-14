/**
 * src/render/dice/mexenRenderPlugin.ts
 * Render-plugin die Mexen-GameEvents vertaalt naar dobbelbeker-animaties op de
 * DiceScene. Wordt aan createSceneManager meegegeven; `attach` levert scene +
 * layout. handleEvent draait binnen de scene-animatieketen, dus de spelloop
 * (afterEvent → waitForIdle) wacht netjes op de worp/onthulling.
 *
 * De plugin kent de werkelijke worp NIET tijdens het gooien/doorgeven (die is
 * verborgen); pas bij 'revealed' komt hij over de lijn en oriënteert de scene de
 * stenen. De eigen worp toont de mens-controller los via `scene.showOwnRoll`.
 */

import type { GameEvent, Seat } from '@shared/core/types.ts';
import type { Roll } from '@shared/games/dice/dice.ts';
import type { CardAnimator, RenderPluginContext, SceneRenderPlugin } from '../types.ts';
import { DiceScene } from './diceScene.ts';

const wacht = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

export class MexenRenderPlugin implements SceneRenderPlugin {
  private dice: DiceScene | null = null;

  /** Toegankelijk voor de mens-controller (eigen-worp-blik). */
  get scene(): DiceScene | null {
    return this.dice;
  }

  attach(ctx: RenderPluginContext): void {
    this.dice = new DiceScene(ctx.scene, ctx.layout);
  }

  async handleEvent(ev: GameEvent, _animator: CardAnimator): Promise<boolean> {
    const d = this.dice;
    if (!d) return false;

    if (ev.type === 'gameStart') {
      d.reset(ev.seatCount, 0 as Seat);
      return true;
    }

    if (ev.type !== 'custom') return false;
    const data = (ev.data ?? {}) as Record<string, unknown>;

    switch (ev.subtype) {
      case 'diceRolled':
        await d.animateRoll(Number(data['seat']) as Seat);
        return true;
      case 'cupPassed':
        await d.animatePass(Number(data['from']) as Seat, Number(data['to']) as Seat);
        return true;
      case 'revealed':
        await d.animateReveal(data['roll'] as Roll);
        await wacht(900); // de onthulde stenen even laten bezinken
        return true;
      case 'roundReset':
        await d.animateRoundReset(Number(data['starter']) as Seat);
        return true;
      default:
        return false; // announce/believe/lifeLost/turn → HUD handelt af
    }
  }

  dispose(): void {
    this.dice?.dispose();
    this.dice = null;
  }
}
