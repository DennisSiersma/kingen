/**
 * src/games/rikken/bids.test-manual.ts
 * Lockt het biedrangmodel vast (rangorde, doelslagen, eigenschappen).
 * Draai met: npx tsx <ditbestand>
 */

import {
  BID_LADDER,
  bidRank,
  doelSlagen,
  forceertHarten,
  gebruiktTroef,
  heeftMaat,
  isAlleen,
  isClaimbaar,
  soortToegestaan,
  type BidKind,
} from './bids.ts';

let geslaagd = 0;
function check(naam: string, cond: boolean): void {
  if (!cond) throw new Error(`FAIL: ${naam}`);
  geslaagd++;
}

// --- Rangorde laag→hoog exact zoals het Puntenblad 2025 ---
const verwacht: BidKind[] = [
  'rik', 'beterRik', 'alleen8', 'piek', 'alleen9', 'misere', 'alleen10',
  'openPiek', 'alleen11', 'openMisere', 'alleen12', 'openPiekPraatje',
  'openMiserePraatje', 'alleen13',
];
check('ladder bevat 14 treden', BID_LADDER.length === 14);
check('ladder in exacte rangorde', JSON.stringify(BID_LADDER) === JSON.stringify(verwacht));

// Rang strikt oplopend in die volgorde.
for (let i = 1; i < verwacht.length; i++) {
  check(`${verwacht[i]} > ${verwacht[i - 1]}`, bidRank(verwacht[i]!) > bidRank(verwacht[i - 1]!));
}

// Sleutelvoorbeelden uit de regels.
check('8-alleen boven beter rik', bidRank('alleen8') > bidRank('beterRik'));
check('9-alleen boven piek', bidRank('alleen9') > bidRank('piek'));
check('10-alleen boven misère', bidRank('alleen10') > bidRank('misere'));
check('13-alleen is hoogste', bidRank('alleen13') === 14);

// --- Doelslagen ---
check('rik = 8', doelSlagen('rik') === 8);
check('beterRik = 8', doelSlagen('beterRik') === 8);
check('alleen8 = 8', doelSlagen('alleen8') === 8);
check('alleen9 = 9', doelSlagen('alleen9') === 9);
check('alleen13 = 13', doelSlagen('alleen13') === 13);
check('piek = 1', doelSlagen('piek') === 1);
check('misere = 0', doelSlagen('misere') === 0);
check('openPiek = 1', doelSlagen('openPiek') === 1);
check('openMisere = 0', doelSlagen('openMisere') === 0);

// --- Eigenschappen ---
check('rik heeft maat', heeftMaat('rik') && heeftMaat('beterRik'));
check('alleen heeft geen maat', !heeftMaat('alleen9') && !heeftMaat('alleen8'));
check('piek heeft geen maat', !heeftMaat('piek'));

check('rik gebruikt troef', gebruiktTroef('rik') && gebruiktTroef('alleen10'));
check('piek/misère troefloos', !gebruiktTroef('piek') && !gebruiktTroef('misere') && !gebruiktTroef('openMisere'));

check('piek/misère claimbaar', isClaimbaar('piek') && isClaimbaar('misere') && isClaimbaar('openPiek'));
check('rik/alleen niet claimbaar', !isClaimbaar('rik') && !isClaimbaar('alleen9'));

check('beterRik forceert harten', forceertHarten('beterRik') && !forceertHarten('rik'));

check('alleen8..13 zijn alleen', ['alleen8', 'alleen9', 'alleen10', 'alleen11', 'alleen12', 'alleen13'].every((k) => isAlleen(k as BidKind)));
check('rik is geen alleen', !isAlleen('rik'));

// --- Variant-poort ---
check('open piek uit zonder openSpellen', !soortToegestaan('openPiek', false));
check('open piek aan met openSpellen', soortToegestaan('openPiek', true));
check('rik altijd toegestaan', soortToegestaan('rik', false) && soortToegestaan('piek', false));

console.log(`bids.test-manual: ${geslaagd} checks geslaagd ✓`);
