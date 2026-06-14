/**
 * src/render/dice/diceScene.ts
 * Beheert de 3D-objecten voor Mexen: een dobbelbeker, twee stenen en een
 * bierviltje. Levert de animaties (schudden, doorgeven, optillen/onthullen) als
 * Promises, zodat de render-plugin ze kan awaiten en de spelloop netjes wacht.
 *
 * Echt-Mexen-model: de beker staat OMGEKEERD (gesloten bodem boven, monding op
 * het viltje) over de verborgen stenen. Bij je eigen worp of een onthulling tilt
 * de beker op en komen de stenen — al deterministisch op de juiste ogen
 * (faceQuaternion), passend bij de seedbare engine-waarde — eronder vandaan.
 * Eén beker met dezelfde stenen reist de tafel rond.
 */

import * as THREE from 'three';
import type { Seat } from '@shared/core/types.ts';
import type { DieValue, Roll } from '@shared/games/dice/dice.ts';
import type { TableLayout } from '../types.ts';
import { startTween, easeInOutCubic, easeOutCubic } from '../animations.ts';
import {
  CUP_HEIGHT, DIE_SIZE, createCoaster, createCup, createDie, disposeCoaster, disposeCup, disposeDie,
  faceQuaternion,
} from './diceRenderer.ts';

/** Hoe ver de bekermonding boven het tafelblad uittilt bij een onthulling. */
const LIFT = CUP_HEIGHT * 1.1;
/** Bekerafstand vanaf het tafelmidden (tussen speler en midden in). */
const CUP_RADIUS_FACTOR = 0.52;
/** Omgekeerde beker: 180° gekanteld zodat de monding naar beneden wijst. */
const INVERT = Math.PI;
/** Schaal en plek (vanaf het midden) van de levensdobbelstenen per stoel. */
const LIFE_SCALE = 0.82;
const LIFE_R_FACTOR = 0.82;

export class DiceScene {
  private readonly scene: THREE.Scene;
  private readonly layout: TableLayout;
  private seatCount = 4;

  private cup: THREE.Group | null = null;
  private coaster: THREE.Group | null = null;
  private dice: [THREE.Mesh, THREE.Mesh] | null = null;
  /** Eén levensdobbelsteen per stoel: het bovenvlak toont de resterende levens. */
  private lifeDice: THREE.Mesh[] = [];
  private holder: Seat = 0 as Seat;
  /** Of de beker momenteel opgetild is (onthuld). */
  private opgetild = false;

  constructor(scene: THREE.Scene, layout: TableLayout) {
    this.scene = scene;
    this.layout = layout;
  }

  /** (Her)initialiseer beker + stenen + viltje voor een nieuwe partij. */
  reset(seatCount: number, starter: Seat): void {
    this.seatCount = seatCount;
    this.clear();
    this.cup = createCup();
    this.cup.rotation.x = INVERT; // omgekeerd: monding omlaag
    this.coaster = createCoaster();
    this.dice = [createDie(), createDie()];
    this.scene.add(this.cup, this.coaster, this.dice[0], this.dice[1]);
    // Eén levensdobbelsteen vóór elke stoel (start op 6 tot het levens-event komt).
    this.lifeDice = [];
    for (let s = 0; s < seatCount; s++) {
      const die = createDie();
      die.scale.setScalar(LIFE_SCALE);
      this.scene.add(die);
      this.lifeDice.push(die);
      this.plaatsLevensDobbelsteen(s as Seat);
    }
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
    if (this.coaster) {
      this.scene.remove(this.coaster);
      disposeCoaster(this.coaster);
      this.coaster = null;
    }
    if (this.dice) {
      for (const d of this.dice) {
        this.scene.remove(d);
        disposeDie(d);
      }
      this.dice = null;
    }
    for (const d of this.lifeDice) {
      this.scene.remove(d);
      disposeDie(d);
    }
    this.lifeDice = [];
  }

  /** Plaats de levensdobbelsteen van een stoel vóór die speler op tafel. */
  private plaatsLevensDobbelsteen(seat: Seat): void {
    const die = this.lifeDice[seat];
    if (!die) return;
    const a = this.layout.seatAngle(seat, this.seatCount);
    const r = this.layout.getRadius() * LIFE_R_FACTOR;
    const sc = DIE_SIZE * LIFE_SCALE;
    die.position.set(Math.cos(a) * r, this.surfaceY() + sc / 2, Math.sin(a) * r);
    die.quaternion.copy(faceQuaternion(6, a)); // 6 = startlevens; lichte draai per stoel
  }

  /** Werk de levensdobbelstenen bij: bovenvlak = resterende levens (af = verborgen). */
  setLives(lives: readonly number[]): void {
    for (let s = 0; s < this.lifeDice.length; s++) {
      const die = this.lifeDice[s]!;
      const l = lives[s] ?? 0;
      if (l <= 0) {
        die.visible = false;
        continue;
      }
      die.visible = true;
      const face = Math.max(1, Math.min(6, l)) as DieValue;
      const a = this.layout.seatAngle(s as Seat, this.seatCount);
      die.quaternion.copy(faceQuaternion(face, a));
    }
  }

  // --- positionering -------------------------------------------------------

  private surfaceY(): number {
    return this.layout.getSurfaceY();
  }

  /** Y van het beker-nulpunt zodat de (omgekeerde) monding net op tafel rust. */
  private cupHomeY(): number {
    return this.surfaceY() + CUP_HEIGHT;
  }

  /** Wereldpositie (tafelvlak) van de beker voor een stoel. */
  private cupSpot(seat: Seat): THREE.Vector3 {
    const a = this.layout.seatAngle(seat, this.seatCount);
    const r = this.layout.getRadius() * CUP_RADIUS_FACTOR;
    return new THREE.Vector3(Math.cos(a) * r, this.cupHomeY(), Math.sin(a) * r);
  }

  /** Centrale presentatie-z (iets naar de camera, boven het actiepaneel). */
  private presentatieZ(): number {
    return this.layout.getRadius() * 0.16;
  }

  /** Beker-pose recht boven de centrale presentatieplek, `hoog` opgetild. */
  private centerCupPose(hoog: number): THREE.Vector3 {
    return new THREE.Vector3(0, this.cupHomeY() + hoog, this.presentatieZ());
  }

  /** Houd het viltje recht onder de beker op het tafelblad. */
  private syncViltje(): void {
    if (!this.coaster || !this.cup) return;
    this.coaster.position.set(this.cup.position.x, this.surfaceY() + 0.004, this.cup.position.z);
  }

  private plaatsBeker(seat: Seat): void {
    if (!this.cup) return;
    const spot = this.cupSpot(seat);
    this.cup.position.copy(spot);
    this.cup.rotation.set(INVERT, 0, 0);
    this.syncViltje();
  }

  /** Leg de twee stenen centraal op tafel op de juiste ogen, zichtbaar. */
  private presenteerStenen(roll: Roll): void {
    if (!this.dice) return;
    const cz = this.presentatieZ();
    const y = this.surfaceY() + DIE_SIZE / 2;
    const offs = [-DIE_SIZE * 0.78, DIE_SIZE * 0.78];
    const spins = [Math.PI * 0.3, -Math.PI * 0.4];
    for (let i = 0; i < 2; i++) {
      const die = this.dice[i]!;
      die.position.set(offs[i]!, y, cz);
      die.quaternion.copy(faceQuaternion(roll[i]!, spins[i]!));
      die.visible = true;
    }
  }

  private verbergStenen(): void {
    if (!this.dice) return;
    for (const d of this.dice) d.visible = false;
  }

  // --- animaties -----------------------------------------------------------

  /**
   * Schud-worp op `seat`: schud de omgekeerde beker even op het viltje. De
   * werkelijke worp blijft verborgen tot een onthulling (de plugin kent hem nog niet).
   */
  async animateRoll(seat: Seat): Promise<void> {
    if (!this.cup) return;
    this.holder = seat;
    this.opgetild = false;
    this.plaatsBeker(seat);
    this.verbergStenen();
    const baseY = this.cupHomeY();
    const cup = this.cup;
    await startTween({
      duur: 620,
      ease: easeInOutCubic,
      onUpdate: (t) => {
        // Een paar schud-slagen: lichte verticale stoot + wiebel rond de omgekeerde stand.
        const golf = Math.sin(t * Math.PI * 6);
        cup.position.y = baseY + Math.abs(golf) * 0.03;
        cup.rotation.x = INVERT + Math.cos(t * Math.PI * 5) * 0.12;
        cup.rotation.z = golf * 0.16;
      },
    }).promise;
    cup.position.y = baseY;
    cup.rotation.set(INVERT, 0, 0);
  }

  /** Schuif de beker (met de verborgen stenen eronder) van `from` naar `to`. */
  async animatePass(from: Seat, to: Seat): Promise<void> {
    if (!this.cup) return;
    const cup = this.cup;
    const a = this.cupSpot(from);
    const b = this.cupSpot(to);
    const baseY = this.cupHomeY();
    await startTween({
      duur: 520,
      ease: easeInOutCubic,
      onUpdate: (t) => {
        cup.position.lerpVectors(a, b, t);
        cup.position.y = baseY + Math.sin(Math.PI * t) * 0.05; // boogje
        this.syncViltje();
      },
    }).promise;
    cup.position.set(b.x, baseY, b.z);
    this.syncViltje();
    this.holder = to;
  }

  /** Onthul (publiek): presenteer de worp centraal en til de beker er met een boogje vandaan. */
  async animateReveal(roll: Roll): Promise<void> {
    if (!this.cup || !this.dice) return;
    this.presenteerStenen(roll);
    const cup = this.cup;
    const start = cup.position.clone();
    const doel = this.centerCupPose(LIFT);
    await startTween({
      duur: 480,
      ease: easeOutCubic,
      onUpdate: (t) => {
        cup.position.lerpVectors(start, doel, t);
        cup.position.y = start.y + (doel.y - start.y) * t + Math.sin(Math.PI * t) * 0.03;
        this.syncViltje();
      },
    }).promise;
    cup.position.copy(doel);
    this.syncViltje();
    this.opgetild = true;
  }

  /**
   * Toon de eigen worp aan de kijker (alleen lokaal aangeroepen door de
   * mens-controller): til de beker op zodat ALLEEN jij je stenen ziet.
   */
  showOwnRoll(seat: Seat, roll: Roll): void {
    if (!this.cup || !this.dice) return;
    this.holder = seat;
    this.presenteerStenen(roll);
    this.cup.position.copy(this.centerCupPose(LIFT * 1.2));
    this.cup.rotation.set(INVERT, 0, 0);
    this.syncViltje();
    this.opgetild = true;
  }

  /** Laat de beker weer zakken op de eigen plek en verberg de stenen (na de eigen blik). */
  hideRoll(): void {
    if (!this.cup) return;
    this.verbergStenen();
    this.opgetild = false;
    this.plaatsBeker(this.holder);
  }

  /** Nieuwe ronde: beker terug naar de starter, stenen verbergen. */
  async animateRoundReset(starter: Seat): Promise<void> {
    if (!this.cup) return;
    const cup = this.cup;
    const start = cup.position.clone();
    const doel = this.cupSpot(starter);
    await startTween({
      duur: 380,
      ease: easeInOutCubic,
      onUpdate: (t) => {
        cup.position.lerpVectors(start, doel, t);
        this.syncViltje();
      },
    }).promise;
    cup.position.copy(doel);
    cup.rotation.set(INVERT, 0, 0);
    this.syncViltje();
    this.verbergStenen();
    this.opgetild = false;
    this.holder = starter;
  }

  dispose(): void {
    this.clear();
  }
}
