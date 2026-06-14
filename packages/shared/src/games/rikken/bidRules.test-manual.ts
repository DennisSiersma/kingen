/**
 * src/games/rikken/bidRules.test-manual.ts
 * Lockt de legale-boden-logica vast (opening, opbod +1 trede met overslaan van
 * uitgeschakelde open-treden, alleen-vereist-rik, meepieken). Draai met: npx tsx
 */

import { legalBids } from './bidRules.ts';
import { RIKKEN_STICHTING } from './types.ts';
import type { BiddingState, RikkenMove, RikkenVariantConfig } from './types.ts';
import type { Bid, BidKind } from './bids.ts';

type BidMove = Extract<RikkenMove, { type: 'bid' }>;

let geslaagd = 0;
function check(naam: string, cond: boolean): void {
  if (!cond) throw new Error(`FAIL: ${naam}`);
  geslaagd++;
}

function bidding(opts: Partial<BiddingState>): BiddingState {
  return {
    current: 0,
    passed: [false, false, false, false],
    highest: null,
    highestBidder: null,
    rikGeboden: false,
    claimers: [],
    ...opts,
  };
}

/** De geboden bod-soorten (excl. pass), als set van strings 'kind' of 'kind+beter'. */
function bodenIds(moves: RikkenMove[]): string[] {
  return (moves as BidMove[])
    .filter((m) => m.bid !== 'pass')
    .map((m) => {
      const b = m.bid as Bid;
      return b.beter ? `${b.kind}+beter` : b.kind;
    })
    .sort();
}
const heeftPass = (moves: RikkenMove[]) => (moves as BidMove[]).some((m) => m.bid === 'pass');
const cfg = (o: Partial<RikkenVariantConfig> = {}): RikkenVariantConfig => ({ ...RIKKEN_STICHTING, ...o });
const bod = (kind: BidKind, beter = false): Bid => (beter ? { kind, beter } : { kind });

// 1. Opening: pass + rik/piek/misère.
{
  const m = legalBids(bidding({}), cfg());
  check('opening heeft pass', heeftPass(m));
  check('opening = rik/piek/misere', JSON.stringify(bodenIds(m)) === JSON.stringify(['misere', 'piek', 'rik']));
}

// 2. Na rik → opbod beterRik.
{
  const m = legalBids(bidding({ highest: bod('rik'), highestBidder: 1, rikGeboden: true }), cfg());
  check('na rik → beterRik', JSON.stringify(bodenIds(m)) === JSON.stringify(['beterRik']));
}

// 3. Na beterRik → 8-alleen (gewoon + beter).
{
  const m = legalBids(bidding({ highest: bod('beterRik'), highestBidder: 1, rikGeboden: true }), cfg());
  check('na beterRik → alleen8 +beter', JSON.stringify(bodenIds(m)) === JSON.stringify(['alleen8', 'alleen8+beter']));
}

// 4. Na alleen8 → piek (opbod, niet claim).
{
  const m = legalBids(bidding({ highest: bod('alleen8'), highestBidder: 1, rikGeboden: true }), cfg());
  check('na alleen8 → piek', JSON.stringify(bodenIds(m)) === JSON.stringify(['piek']));
}

// 5. Na piek mét eerdere rik → alleen9 (+beter). Geen claim (meepieken uit).
{
  const m = legalBids(bidding({ highest: bod('piek'), highestBidder: 1, rikGeboden: true }), cfg());
  check('na piek (gerikt) → alleen9 +beter', JSON.stringify(bodenIds(m)) === JSON.stringify(['alleen9', 'alleen9+beter']));
}

// 6. Na een OPENING piek (geen rik): alleen9 geblokkeerd, geen claim → alleen pass.
{
  const m = legalBids(bidding({ highest: bod('piek'), highestBidder: 1, rikGeboden: false }), cfg());
  check('na opening-piek geen opbod', bodenIds(m).length === 0 && heeftPass(m));
}

// 7. Meepieken AAN: na opening-piek mag een ander meeclaimen (+ pass), alleen9 nog geblokkeerd.
{
  const m = legalBids(bidding({ current: 2, highest: bod('piek'), highestBidder: 1, rikGeboden: false }), cfg({ meepieken: true }));
  check('meepieken: claim piek', JSON.stringify(bodenIds(m)) === JSON.stringify(['piek']));
}

// 8. Open spellen UIT: na alleen10 wordt openPiek(8) overgeslagen → alleen11 (+beter).
{
  const m = legalBids(bidding({ highest: bod('alleen10'), highestBidder: 1, rikGeboden: true }), cfg());
  check('open uit: alleen10 → alleen11 +beter', JSON.stringify(bodenIds(m)) === JSON.stringify(['alleen11', 'alleen11+beter']));
}

// 9. Open spellen AAN: na alleen10 → openPiek.
{
  const m = legalBids(bidding({ highest: bod('alleen10'), highestBidder: 1, rikGeboden: true }), cfg({ openSpellen: true }));
  check('open aan: alleen10 → openPiek', JSON.stringify(bodenIds(m)) === JSON.stringify(['openPiek']));
}

// 10. Na misère → alleen10 (+beter).
{
  const m = legalBids(bidding({ highest: bod('misere'), highestBidder: 1, rikGeboden: true }), cfg());
  check('na misère → alleen10 +beter', JSON.stringify(bodenIds(m)) === JSON.stringify(['alleen10', 'alleen10+beter']));
}

// 11. Hoogste = 13-alleen → geen opbod, niet claimbaar → alleen pass.
{
  const m = legalBids(bidding({ highest: bod('alleen13'), highestBidder: 1, rikGeboden: true }), cfg());
  check('na alleen13 alleen pass', bodenIds(m).length === 0 && heeftPass(m));
}

// 12. Gepaste stoel → geen zetten.
{
  const m = legalBids(bidding({ current: 0, passed: [true, false, false, false] }), cfg());
  check('gepaste stoel → []', m.length === 0);
}

console.log(`bidRules.test-manual: ${geslaagd} checks geslaagd ✓`);
