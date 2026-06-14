/**
 * src/render/dice/diceRenderer.test-manual.ts
 * Headless test van de DETERMINISTISCHE dobbelsteen-oriëntatie (pure wiskunde,
 * geen WebGL/canvas nodig). Draai met: npx tsx <ditbestand>
 */

import * as THREE from 'three';
import { DIE_FACE_NORMALS, faceQuaternion, oppositeFace } from './diceRenderer.ts';
import type { DieValue } from '@shared/games/dice/dice.ts';

const assert = {
  ok(cond: unknown, msg?: string): void {
    if (!cond) throw new Error(`Assertie mislukt${msg ? ': ' + msg : ''}`);
  },
  close(a: number, b: number, msg?: string): void {
    if (Math.abs(a - b) > 1e-6) throw new Error(`Assertie mislukt${msg ? ': ' + msg : ''} (${a} ≉ ${b})`);
  },
};

const UP = new THREE.Vector3(0, 1, 0);
const values: DieValue[] = [1, 2, 3, 4, 5, 6];

// 1. Tegenoverliggende vlakken zijn samen 7 en hebben tegengestelde normalen.
for (const v of values) {
  assert.ok(oppositeFace(v) === ((7 - v) as DieValue), `tegenover ${v} is ${7 - v}`);
  const n = DIE_FACE_NORMALS[v].clone();
  const tegen = DIE_FACE_NORMALS[oppositeFace(v)].clone();
  assert.close(n.dot(tegen), -1, `normalen ${v}/${oppositeFace(v)} tegengesteld`);
}

// 2. faceQuaternion(v) draait het gevraagde vlak exact naar +Y...
for (const v of values) {
  const q = faceQuaternion(v);
  const omhoog = DIE_FACE_NORMALS[v].clone().applyQuaternion(q);
  assert.close(omhoog.x, 0, `vlak ${v} → x`);
  assert.close(omhoog.y, 1, `vlak ${v} → y (omhoog)`);
  assert.close(omhoog.z, 0, `vlak ${v} → z`);
  // ...en het tegenoverliggende vlak wijst dan recht naar beneden.
  const omlaag = DIE_FACE_NORMALS[oppositeFace(v)].clone().applyQuaternion(q);
  assert.close(omlaag.y, -1, `tegenvlak van ${v} wijst omlaag`);
}

// 3. spinY houdt de bovenkant omhoog (alleen horizontale rotatie).
for (const v of values) {
  for (const spin of [0.3, 1.1, 2.7, -0.8]) {
    const q = faceQuaternion(v, spin);
    const omhoog = DIE_FACE_NORMALS[v].clone().applyQuaternion(q);
    assert.close(omhoog.y, 1, `vlak ${v} blijft omhoog bij spin ${spin}`);
  }
}

console.log('✓ diceRenderer.test-manual: alle asserties geslaagd');
