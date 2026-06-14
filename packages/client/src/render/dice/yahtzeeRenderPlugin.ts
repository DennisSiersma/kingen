/**
 * src/render/dice/yahtzeeRenderPlugin.ts
 * Render-plugin voor Yahtzee: toont de vijf open stenen op tafel in één rij —
 * vastgehouden stenen goudig getint, vers gegooide stenen natuurlijk (en met een
 * korte "val"). Bijgewerkt op elk 'yahtzeeRolled'-event; deterministisch op de
 * ogen. Gegate op gameId.
 */

import * as THREE from 'three';
import type { GameEvent } from '@shared/core/types.ts';
import type { DieValue } from '@shared/games/dice/dice.ts';
import type { CardAnimator, RenderPluginContext, SceneRenderPlugin, TableLayout } from '../types.ts';
import { startTween, easeOutCubic } from '../animations.ts';
import { DIE_SIZE, createDie, disposeDie, faceQuaternion } from './diceRenderer.ts';

const SPACING = DIE_SIZE * 1.55;
const KEPT_TINT = 0xe7c66a; // vastgehouden stenen goudig
const FRESH_TINT = 0xf3efe2;

export class YahtzeeRenderPlugin implements SceneRenderPlugin {
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
      this.active = ev.gameId.startsWith('yahtzee');
      this.clear();
      if (this.active) this.maakStenen();
      return this.active;
    }
    if (!this.active) return false;
    if (ev.type !== 'custom') return false;
    if (ev.subtype === 'yahtzeeRolled') {
      const data = (ev.data ?? {}) as { kept?: number[]; fresh?: number[] };
      await this.toon(data.kept ?? [], data.fresh ?? []);
      return true;
    }
    if (ev.subtype === 'turn') {
      const d = (ev.data ?? {}) as { phase?: string };
      if (d.phase === 'rolling') for (const die of this.dice) die.visible = false;
      return false;
    }
    return false;
  }

  private maakStenen(): void {
    if (!this.scene) return;
    this.dice = Array.from({ length: 5 }, () => {
      const d = createDie(FRESH_TINT);
      d.scale.setScalar(0.92);
      d.visible = false;
      this.scene!.add(d);
      return d;
    });
  }

  private surfaceY(): number {
    return this.layout ? this.layout.getSurfaceY() : 0;
  }

  /** Toon kept (goud) gevolgd door fresh (natuurlijk) in één gecentreerde rij. */
  private async toon(kept: number[], fresh: number[]): Promise<void> {
    if (!this.layout) return;
    const values = [...kept, ...fresh];
    const y = this.surfaceY() + DIE_SIZE * 0.46;
    const cz = this.layout.getRadius() * 0.08;
    const breedte = (values.length - 1) * SPACING;
    const spins = [0.4, -0.6, 1.1, -1.4, 0.8];
    for (let i = 0; i < values.length; i++) {
      const die = this.dice[i];
      if (!die) continue;
      const tint = i < kept.length ? KEPT_TINT : FRESH_TINT;
      const mats = Array.isArray(die.material) ? die.material : [die.material];
      for (const m of mats) (m as THREE.MeshStandardMaterial).color.setHex(tint);
      die.position.set(i * SPACING - breedte / 2, y, cz);
      die.quaternion.copy(faceQuaternion(values[i]! as DieValue, spins[i % spins.length]!));
      die.visible = true;
    }
    for (let i = values.length; i < this.dice.length; i++) this.dice[i]!.visible = false;

    // Korte "val" voor de vers gegooide stenen.
    const dice = this.dice;
    await startTween({
      duur: 320,
      ease: easeOutCubic,
      onUpdate: (t) => {
        const lift = (1 - t) * DIE_SIZE * 1.3;
        for (let i = kept.length; i < values.length; i++) if (dice[i]) dice[i]!.position.y = y + lift;
      },
    }).promise;
    for (let i = kept.length; i < values.length; i++) if (dice[i]) dice[i]!.position.y = y;
  }

  private clear(): void {
    if (this.scene) for (const d of this.dice) { this.scene.remove(d); disposeDie(d); }
    this.dice = [];
  }

  dispose(): void {
    this.clear();
  }
}
