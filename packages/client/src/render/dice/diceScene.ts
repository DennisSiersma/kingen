/**
 * src/render/dice/diceScene.ts
 * Beheert de 3D-objecten voor Mexen: één dobbelbeker en twee stenen die samen
 * rondgaan. Levert de animaties (schudden, doorgeven, optillen/onthullen) als
 * Promises, zodat de render-plugin ze kan awaiten en de spelloop netjes wacht.
 *
 * Eén-beker-model: in Mexen gaat dezelfde beker met dezelfde stenen de tafel
 * rond. De werkelijke worp is onder de (ondoorzichtige) beker verborgen; bij een
 * onthulling tilt de beker op en staan de stenen al deterministisch op de juiste
 * ogen (faceQuaternion), passend bij de seedbare engine-waarde.
 */

import * as THREE from 'three';
import type { Seat } from '@shared/core/types.ts';
import type { Roll } from '@shared/games/dice/dice.ts';
import type { TableLayout } from '../types.ts';
import { startTween, easeInOutCubic, easeOutCubic } from '../animations.ts';
import {
  CUP_HEIGHT, DIE_SIZE, createCup, createDie, disposeCup, disposeDie, faceQuaternion,
} from './diceRenderer.ts';

/** Hoe ver de beker boven het tafelblad uittilt bij een onthulling. */
const LIFT = CUP_HEIGHT * 1.15;
/** Bekerafstand vanaf het tafelmidden (tussen speler en midden in). */
const CUP_RADIUS_FACTOR = 0.52;

export class DiceScene {
  private readonly scene: THREE.Scene;
  private readonly layout: TableLayout;
  private seatCount = 4;

  private cup: THREE.Group | null = null;
  private dice: [THREE.Mesh, THREE.Mesh] | null = null;
  private holder: Seat = 0 as Seat;
  /** Of de beker momenteel opgetild is (onthuld). */
  private opgetild = false;

  constructor(scene: THREE.Scene, layout: TableLayout) {
    this.scene = scene;
    this.layout = layout;
  }

  /** (Her)initialiseer beker + stenen voor een nieuwe partij. */
  reset(seatCount: number, starter: Seat): void {
    this.seatCount = seatCount;
    this.clear();
    this.cup = createCup();
    this.dice = [createDie(), createDie()];
    this.scene.add(this.cup, this.dice[0], this.dice[1]);
    this.holder = starter;
    this.opgetild = false;
    this.plaatsBeker(starter);
    this.verbergStenen();
  }

  /** Verwijder alle dobbel-objecten uit de scene. */
  clear(): void {
    if (this.cup) {
      this.scene.remove(this.cup);
      disposeCup(this.cup);
      this.cup = null;
    }
    if (this.dice) {
      for (const d of this.dice) {
        this.scene.remove(d);
        disposeDie(d);
      }
      this.dice = null;
    }
  }

  // --- positionering -------------------------------------------------------

  private surfaceY(): number {
    return this.layout.getSurfaceY();
  }

  /** Wereldpositie van de beker(bodem) voor een stoel. */
  private cupSpot(seat: Seat): THREE.Vector3 {
    const a = this.layout.seatAngle(seat, this.seatCount);
    const r = this.layout.getRadius() * CUP_RADIUS_FACTOR;
    return new THREE.Vector3(Math.cos(a) * r, this.surfaceY(), Math.sin(a) * r);
  }

  /** De twee rustplekken voor de stenen onder de beker op `seat`. */
  private dieSpots(seat: Seat): [THREE.Vector3, THREE.Vector3] {
    const c = this.cupSpot(seat);
    const a = this.layout.seatAngle(seat, this.seatCount);
    // Verschuif de stenen langs de tangens, half binnen de beker.
    const tx = -Math.sin(a) * DIE_SIZE * 0.8;
    const tz = Math.cos(a) * DIE_SIZE * 0.8;
    const y = this.surfaceY() + DIE_SIZE / 2;
    return [
      new THREE.Vector3(c.x + tx, y, c.z + tz),
      new THREE.Vector3(c.x - tx, y, c.z - tz),
    ];
  }

  private plaatsBeker(seat: Seat): void {
    if (!this.cup) return;
    const spot = this.cupSpot(seat);
    this.cup.position.set(spot.x, this.surfaceY(), spot.z);
  }

  /** Leg de stenen op hun rustplek onder de beker op `seat`, hidden by the cup. */
  private legStenen(seat: Seat, roll: Roll): void {
    if (!this.dice) return;
    const spots = this.dieSpots(seat);
    const spins = [Math.PI * 0.3, -Math.PI * 0.4];
    for (let i = 0; i < 2; i++) {
      const die = this.dice[i]!;
      die.position.copy(spots[i]!);
      die.quaternion.copy(faceQuaternion(roll[i]!, spins[i]!));
      die.visible = false; // onder de (gesloten) beker
    }
  }

  private verbergStenen(): void {
    if (!this.dice) return;
    for (const d of this.dice) d.visible = false;
  }

  // --- animaties -----------------------------------------------------------

  /**
   * Schud-worp op `seat`: schud de beker even. De werkelijke worp blijft
   * verborgen onder de beker tot een onthulling (de plugin kent hem nog niet).
   */
  async animateRoll(seat: Seat): Promise<void> {
    if (!this.cup) return;
    this.holder = seat;
    this.opgetild = false;
    this.plaatsBeker(seat);
    this.verbergStenen();
    const baseY = this.surfaceY();
    const cup = this.cup;
    await startTween({
      duur: 620,
      ease: easeInOutCubic,
      onUpdate: (t) => {
        // Een paar schud-slagen: lichte verticale stoot + kanteling.
        const golf = Math.sin(t * Math.PI * 6);
        cup.position.y = baseY + Math.abs(golf) * 0.025;
        cup.rotation.z = golf * 0.18;
        cup.rotation.x = Math.cos(t * Math.PI * 5) * 0.12;
      },
    }).promise;
    cup.position.y = baseY;
    cup.rotation.set(0, 0, 0);
  }

  /** Schuif de beker (met de verborgen stenen eronder) van `from` naar `to`. */
  async animatePass(from: Seat, to: Seat): Promise<void> {
    if (!this.cup) return;
    const cup = this.cup;
    const a = this.cupSpot(from);
    const b = this.cupSpot(to);
    const baseY = this.surfaceY();
    await startTween({
      duur: 520,
      ease: easeInOutCubic,
      onUpdate: (t) => {
        cup.position.lerpVectors(a, b, t);
        cup.position.y = baseY + Math.sin(Math.PI * t) * 0.05; // boogje
      },
    }).promise;
    cup.position.set(b.x, baseY, b.z);
    this.holder = to;
  }

  /**
   * Onthul: til de beker op de huidige plek op en laat de stenen (al op de
   * juiste ogen) zien.
   */
  async animateReveal(roll: Roll): Promise<void> {
    if (!this.cup || !this.dice) return;
    this.legStenen(this.holder, roll);
    for (const d of this.dice) d.visible = true;
    const cup = this.cup;
    const baseY = this.surfaceY();
    await startTween({
      duur: 460,
      ease: easeOutCubic,
      onUpdate: (t) => {
        cup.position.y = baseY + LIFT * t;
      },
    }).promise;
    cup.position.y = baseY + LIFT;
    this.opgetild = true;
  }

  /**
   * Toon de eigen worp aan de kijker (alleen lokaal aangeroepen door de
   * mens-controller): til de beker kort op zodat alleen jij je stenen ziet.
   */
  showOwnRoll(seat: Seat, roll: Roll): void {
    if (!this.cup || !this.dice) return;
    this.holder = seat;
    this.plaatsBeker(seat);
    this.legStenen(seat, roll);
    for (const d of this.dice) d.visible = true;
    this.cup.position.y = this.surfaceY() + LIFT;
    this.opgetild = true;
  }

  /** Laat de beker weer zakken en verberg de stenen (bijv. na de eigen blik). */
  hideRoll(): void {
    if (!this.cup) return;
    this.cup.position.y = this.surfaceY();
    this.verbergStenen();
    this.opgetild = false;
  }

  /** Nieuwe ronde: beker laten zakken, stenen verbergen, naar de starter. */
  async animateRoundReset(starter: Seat): Promise<void> {
    if (!this.cup) return;
    const cup = this.cup;
    const baseY = this.surfaceY();
    if (this.opgetild) {
      await startTween({
        duur: 320,
        ease: easeInOutCubic,
        onUpdate: (t) => {
          cup.position.y = baseY + LIFT * (1 - t);
        },
      }).promise;
    }
    this.verbergStenen();
    this.opgetild = false;
    this.plaatsBeker(starter);
    this.holder = starter;
  }

  dispose(): void {
    this.clear();
  }
}
