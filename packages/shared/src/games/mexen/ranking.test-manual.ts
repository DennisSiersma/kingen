/**
 * src/games/mexen/ranking.test-manual.ts
 * Headless test van de Mexen-waarde-ordening. Draai met: npx tsx <ditbestand>
 */

import {
  RANK_ORDER, announceableCodes, beats, isMex, isPair, rankOf, rollToCode,
} from './ranking.ts';
import type { Roll } from '../dice/dice.ts';

const assert = {
  ok(cond: unknown, msg?: string): void {
    if (!cond) throw new Error(`Assertie mislukt${msg ? ': ' + msg : ''}`);
  },
  equal(a: unknown, b: unknown, msg?: string): void {
    if (a !== b) throw new Error(`Assertie mislukt${msg ? ': ' + msg : ''} (${String(a)} !== ${String(b)})`);
  },
};

// Volledige ordening telt 21 codes, oplopend.
assert.equal(RANK_ORDER.length, 21, '21 codes');
for (let i = 1; i < RANK_ORDER.length; i++) {
  assert.ok(rankOf(RANK_ORDER[i]!) > rankOf(RANK_ORDER[i - 1]!), 'strikt oplopend');
}

// Worp → code (hoogste steen eerst; Mex = 21).
assert.equal(rollToCode([6, 4] as Roll), 64, '6&4 → 64');
assert.equal(rollToCode([4, 6] as Roll), 64, '4&6 → 64');
assert.equal(rollToCode([2, 1] as Roll), 21, '2&1 → Mex 21');
assert.equal(rollToCode([1, 2] as Roll), 21, '1&2 → Mex 21');
assert.equal(rollToCode([3, 3] as Roll), 33, '3&3 → paar 33');

// 21 is hoogste, paren boven niet-paren.
assert.ok(rankOf(21) > rankOf(66), 'Mex verslaat paar zessen');
assert.ok(rankOf(11) > rankOf(65), 'laagste paar verslaat hoogste niet-paar');
assert.ok(rankOf(31) === 0, '31 is laagste');
assert.ok(rankOf(21) === 20, 'Mex is hoogste');

// classificatie
assert.ok(isMex(21) && !isMex(66), 'isMex');
assert.ok(isPair(66) && isPair(11) && !isPair(21) && !isPair(65), 'isPair (21 telt niet als paar)');

// beats: strict vs tie
assert.ok(beats(33, 32, 'strict'), 'paar verslaat niet-paar (strict)');
assert.ok(!beats(32, 33, 'strict'), 'niet-paar verslaat paar niet');
assert.ok(!beats(33, 33, 'strict'), 'gelijk verslaat niet in strict');
assert.ok(beats(33, 33, 'tie'), 'gelijk mag in tie');
assert.ok(beats(31, null, 'strict'), 'eerste aankondiging: alles mag');
assert.ok(!beats(99, 31, 'strict'), 'ongeldige code verslaat niets');

// announceableCodes
assert.equal(announceableCodes(null, 'strict').length, 21, 'null → alle 21');
assert.equal(announceableCodes(21, 'strict').length, 0, 'Mex onverslaanbaar in strict');
assert.equal(announceableCodes(21, 'tie').length, 1, 'in tie kun je Mex evenaren');
assert.equal(announceableCodes(66, 'strict').length, 1, 'boven paar zessen alleen Mex');
assert.ok(announceableCodes(65, 'strict').every((c) => rankOf(c) > rankOf(65)), 'alle resultaten verslaan 65');

console.log('✓ ranking.test-manual: alle asserties geslaagd');
