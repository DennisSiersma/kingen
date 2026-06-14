/**
 * src/games/qwixx/scoring.test-manual.ts
 * Headless test van de Qwixx-score-telling. Draai met: npx tsx <ditbestand>
 */

import { sheetScore, triangle } from './scoring.ts';
import type { QwixxSheet } from './types.ts';

const assert = {
  equal(a: unknown, b: unknown, msg?: string): void {
    if (a !== b) throw new Error(`Assertie mislukt${msg ? ': ' + msg : ''} (${String(a)} !== ${String(b)})`);
  },
};

// Driehoeksgetallen.
assert.equal(triangle(1), 1, '1');
assert.equal(triangle(5), 15, '5');
assert.equal(triangle(6), 21, '6');
assert.equal(triangle(7), 28, '7 (slot)');
assert.equal(triangle(12), 78, '12 vol');

function sheet(over: Partial<Record<'red' | 'yellow' | 'green' | 'blue', { marks: number[]; locked: boolean }>>, pen = 0): QwixxSheet {
  const leeg = () => ({ marks: [] as number[], locked: false });
  return {
    rows: { red: over.red ?? leeg(), yellow: over.yellow ?? leeg(), green: over.green ?? leeg(), blue: over.blue ?? leeg() },
    penalties: pen,
  };
}

// Lege kaart = 0.
assert.equal(sheetScore(sheet({})), 0, 'leeg');

// 5 kruisjes in rood = 15.
assert.equal(sheetScore(sheet({ red: { marks: [2, 3, 4, 5, 6], locked: false } })), 15, '5 rood');

// Vergrendelde rij: 6 getallen + slot = 7 kruisjes = 28.
assert.equal(
  sheetScore(sheet({ red: { marks: [2, 3, 4, 5, 6, 12], locked: true } })),
  28,
  'rood vergrendeld (7) = 28',
);

// Strafvakken: −5 elk.
assert.equal(sheetScore(sheet({ red: { marks: [2, 3, 4, 5, 6], locked: false } }, 2)), 15 - 10, '2 strafvakken');

// Meerdere rijen sommeren.
assert.equal(
  sheetScore(sheet({ red: { marks: [2, 3, 4], locked: false }, blue: { marks: [12, 11], locked: false } })),
  triangle(3) + triangle(2),
  'rood(3)+blauw(2) = 6+3 = 9',
);

console.log('✓ scoring.test-manual: alle asserties geslaagd');
