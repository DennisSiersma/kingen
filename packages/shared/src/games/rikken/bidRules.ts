/**
 * src/games/rikken/bidRules.ts
 * Pure biedregels: welke boden mag de huidige bieder doen? Implementeert de
 * canonieke Stichting-regels:
 *  - openingsboden zijn rik, piek, misère (beterRik/alleen zijn opboden);
 *  - een opbod is de eerstvolgende AANGEZETTE trede boven het hoogste bod
 *    (uitgeschakelde open-treden worden overgeslagen zodat 11/12/13-alleen
 *    bereikbaar blijven);
 *  - "alleen"-boden vereisen dat er al ten minste één keer gerikt is;
 *  - piek/misère mogen meegeclaimd worden (meepieken/meemisèren) i.p.v. opbieden
 *    (alleen als config.meepieken aan staat).
 */

import {
  bidRank,
  isAlleen,
  isClaimbaar,
  kindAtRank,
  soortToegestaan,
  type BidKind,
} from './bids.ts';
import type { BiddingState, RikkenMove, RikkenVariantConfig } from './types.ts';

const PASS: RikkenMove = { type: 'bid', bid: 'pass' };

/** Eerstvolgende aangezette opbod-rang boven `rang`, of null. */
function volgendeOpbodRang(rang: number, config: RikkenVariantConfig): number | null {
  for (let r = rang + 1; r <= 14; r++) {
    const kind = kindAtRank(r);
    if (kind && soortToegestaan(kind, config.openSpellen)) return r;
  }
  return null;
}

/** De bod-zetten voor een soort op opbod-rang (alleen-treden bieden gewoon + beter). */
function bodenVoorSoort(kind: BidKind): RikkenMove[] {
  if (isAlleen(kind)) {
    return [
      { type: 'bid', bid: { kind } },
      { type: 'bid', bid: { kind, beter: true } },
    ];
  }
  return [{ type: 'bid', bid: { kind } }];
}

/** Legale bied-zetten voor de stoel die nu aan de beurt is in de biedfase. */
export function legalBids(bidding: BiddingState, config: RikkenVariantConfig): RikkenMove[] {
  const seat = bidding.current;
  if (bidding.passed[seat]) return [];

  const out: RikkenMove[] = [PASS];

  // Opening: rik, piek, misère (beterRik/alleen zijn opboden, geen openingsbod).
  if (bidding.highest === null) {
    for (const kind of ['rik', 'piek', 'misere'] as BidKind[]) {
      out.push({ type: 'bid', bid: { kind } });
    }
    return out;
  }

  const hoogsteRang = bidRank(bidding.highest.kind);

  // Meeclaimen (meepieken/meemisèren): zelfde bod, geen opbod.
  if (
    config.meepieken &&
    isClaimbaar(bidding.highest.kind) &&
    bidding.highestBidder !== seat &&
    !bidding.claimers.includes(seat)
  ) {
    out.push({ type: 'bid', bid: { kind: bidding.highest.kind, beter: bidding.highest.beter } });
  }

  // Opbod naar de eerstvolgende aangezette trede.
  const opbodRang = volgendeOpbodRang(hoogsteRang, config);
  if (opbodRang !== null) {
    const kind = kindAtRank(opbodRang)!;
    const geblokkeerd = isAlleen(kind) && !bidding.rikGeboden; // alleen vereist eerdere rik
    if (!geblokkeerd) out.push(...bodenVoorSoort(kind));
  }

  return out;
}
