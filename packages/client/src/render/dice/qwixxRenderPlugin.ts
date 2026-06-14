/**
 * src/render/dice/qwixxRenderPlugin.ts
 * Render-plugin voor Qwixx: toont de zes open dobbelstenen (2 wit + 4 gekleurd)
 * op tafel bij elke worp, deterministisch op de door de engine bepaalde ogen
 * (faceQuaternion). Alle waarden zijn publiek — geen beker, geen verborgen info.
 * Gegate op gameId; de plugin hangt altijd aan de scene.
 */

import * as THREE from 'three';
import type { GameEvent, Seat } from '@shared/core/types.ts';
import type { DieValue } from '@shared/games/dice/dice.ts';
import type { QwixxColor } from '@shared/games/qwixx/types.ts';
import type { CardAnimator, RenderPluginContext, SceneRenderPlugin, TableLayout } from '../types.ts';
import { startTween, easeOutCubic } from '../animations.ts';
import { DIE_SIZE, createDie, disposeDie, faceQuaternion } from './diceRenderer.ts';

const TINT: Record<'white' | QwixxColor, number> = {
  white: 0xf3efe2,
  red: 0xc0392b,
  yellow: 0xe1b12c,
  green: 0x27ae60,
  blue: 0x2e6fb0,
};

const SPACING = DIE_SIZE * 1.55;

interface RolledDice {
  white: [number, number];
  colored: Record<QwixxColor, number>;
}

export class QwixxRenderPlugin implements SceneRenderPlugin {
  private scene: THREE.Scene | null = null;
  private layout: TableLayout | null = null;
  private dice: THREE.Mesh[] = [];
  private active = false;

  attach(ctx: RenderPluginContext): void {
    this.scene = ctx.scene;
    this.layout = ctx.layout;
  }

  async handleEvent(ev: GameEvent, _animator: CardAnimator): Promise<boolean> {
    if (ev.type === 'gameStart') {
      this.active = ev.gameId.startsWith('qwixx');
      this.clear();
      if (this.active) this.maakStenen();
      return this.active;
    }
    if (!this.active) return false;
    if (ev.type !== 'custom') return false;
    if (ev.subtype === 'qwixxRolled') {
      const data = (ev.data ?? {}) as { dice?: RolledDice };
      if (data.dice) await this.toonWorp(data.dice);
      return true;
    }
    return false;
  }

  private maakStenen(): void {
    if (!this.scene) return;
    // 0,1 = wit; 2-5 = rood/geel/groen/blauw.
    const tints = [TINT.white, TINT.white, TINT.red, TINT.yellow, TINT.green, TINT.blue];
    this.dice = tints.map((t) => {
      const d = createDie(t);
      d.scale.setScalar(0.9);
      d.visible = false;
      this.scene!.add(d);
      return d;
    });
  }

  private surfaceY(): number {
    return this.layout ? this.layout.getSurfaceY() : 0;
  }

  /** Leg de zes stenen in een rij iets naar de camera; laat ze "vallen" op de ogen. */
  private async toonWorp(roll: RolledDice): Promise<void> {
    if (!this.layout || this.dice.length < 6) return;
    const values: DieValue[] = [
      roll.white[0] as DieValue, roll.white[1] as DieValue,
      roll.colored.red as DieValue, roll.colored.yellow as DieValue,
      roll.colored.green as DieValue, roll.colored.blue as DieValue,
    ];
    const cz = this.layout.getRadius() * 0.1;
    const y = this.surfaceY() + DIE_SIZE * 0.45;
    const spins = [0.4, -0.6, 1.1, -1.4, 0.8, -0.3];
    for (let i = 0; i < 6; i++) {
      const die = this.dice[i]!;
      const x = (i - 2.5) * SPACING;
      die.position.set(x, y, cz);
      die.quaternion.copy(faceQuaternion(values[i]!, spins[i]!));
      die.visible = true;
    }
    // Korte "val" voor wat leven (alle stenen tegelijk).
    const dice = this.dice;
    await startTween({
      duur: 360,
      ease: easeOutCubic,
      onUpdate: (t) => {
        const lift = (1 - t) * DIE_SIZE * 1.4;
        for (let i = 0; i < 6; i++) dice[i]!.position.y = y + lift;
      },
    }).promise;
    for (let i = 0; i < 6; i++) dice[i]!.position.y = y;
  }

  private clear(): void {
    if (this.scene) for (const d of this.dice) { this.scene.remove(d); disposeDie(d); }
    this.dice = [];
  }

  dispose(): void {
    this.clear();
  }
}
