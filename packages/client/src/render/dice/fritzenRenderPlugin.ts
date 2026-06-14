/**
 * src/render/dice/fritzenRenderPlugin.ts
 * Render-plugin voor Fritzen: toont de zes open stenen op tafel — vastgelegde
 * stenen op een achterste rij (goudig getint), losse stenen vooraan. Bijgewerkt
 * op elk 'fritzenRolled'-event; deterministisch op de ogen. Gegate op gameId.
 */

import * as THREE from 'three';
import type { GameEvent } from '@shared/core/types.ts';
import type { DieValue } from '@shared/games/dice/dice.ts';
import type { CardAnimator, RenderPluginContext, SceneRenderPlugin, TableLayout } from '../types.ts';
import { startTween, easeOutCubic } from '../animations.ts';
import { DIE_SIZE, createDie, disposeDie, faceQuaternion } from './diceRenderer.ts';

const SPACING = DIE_SIZE * 1.5;
const LOCKED_TINT = 0xe7c66a; // vastgelegde stenen goudig
const LOOSE_TINT = 0xf3efe2;

export class FritzenRenderPlugin implements SceneRenderPlugin {
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
      this.active = ev.gameId.startsWith('fritzen');
      this.clear();
      if (this.active) this.maakStenen();
      return this.active;
    }
    if (!this.active) return false;
    if (ev.type !== 'custom') return false;
    if (ev.subtype === 'fritzenRolled') {
      const data = (ev.data ?? {}) as { locked?: number[]; loose?: number[] };
      await this.toon(data.locked ?? [], data.loose ?? []);
      return true;
    }
    if (ev.subtype === 'turn') {
      // Nieuwe beurt (rolling, nog niets gegooid): tafel leeg.
      const d = (ev.data ?? {}) as { phase?: string };
      if (d.phase === 'rolling') for (const die of this.dice) die.visible = false;
      return false;
    }
    return false;
  }

  private maakStenen(): void {
    if (!this.scene) return;
    this.dice = Array.from({ length: 6 }, () => {
      const d = createDie(LOOSE_TINT);
      d.scale.setScalar(0.92);
      d.visible = false;
      this.scene!.add(d);
      return d;
    });
  }

  private surfaceY(): number {
    return this.layout ? this.layout.getSurfaceY() : 0;
  }

  private async toon(locked: number[], loose: number[]): Promise<void> {
    if (!this.layout) return;
    const y = this.surfaceY() + DIE_SIZE * 0.46;
    const r = this.layout.getRadius();
    const plaats = (vals: number[], startIdx: number, z: number, tint: number, spins: number): void => {
      const breedte = (vals.length - 1) * SPACING;
      for (let i = 0; i < vals.length; i++) {
        const die = this.dice[startIdx + i];
        if (!die) continue;
        const mats = Array.isArray(die.material) ? die.material : [die.material];
        for (const m of mats) (m as THREE.MeshStandardMaterial).color.setHex(tint);
        die.position.set(i * SPACING - breedte / 2, y, z);
        die.quaternion.copy(faceQuaternion(vals[i]! as DieValue, spins + i * 0.5));
        die.visible = true;
      }
    };
    // Vastgelegde stenen achteraan (verder van de camera), losse stenen vooraan.
    plaats(locked, 0, -r * 0.06, LOCKED_TINT, 0.3);
    plaats(loose, locked.length, r * 0.16, LOOSE_TINT, 1.1);
    for (let i = locked.length + loose.length; i < 6; i++) this.dice[i]!.visible = false;

    const dice = this.dice;
    await startTween({
      duur: 300,
      ease: easeOutCubic,
      onUpdate: (t) => {
        const lift = (1 - t) * DIE_SIZE * 1.2;
        for (let i = locked.length; i < locked.length + loose.length; i++) {
          if (dice[i]) dice[i]!.position.y = y + lift;
        }
      },
    }).promise;
    for (let i = locked.length; i < locked.length + loose.length; i++) if (dice[i]) dice[i]!.position.y = y;
  }

  private clear(): void {
    if (this.scene) for (const d of this.dice) { this.scene.remove(d); disposeDie(d); }
    this.dice = [];
  }

  dispose(): void {
    this.clear();
  }
}
