/**
 * src/games/rikken/bids.ts
 * Het geordende biedrangmodel van Rikken (Stichting Rikken 2025). De biedrangorde
 * is vastgelegd door de kolomvolgorde van het officiële Puntenblad 2025; elk opbod
 * is precies één trede hoger. "Beter alleen" (harten troef) deelt dezelfde rang
 * als het gewone "alleen"-bod (zelfde kolom, meer punten, NIET hoger).
 *
 * Rang (laag→hoog): rik · beterRik · 8-alleen · piek · 9-alleen · misère ·
 * 10-alleen · open piek · 11-alleen · open misère · 12-alleen · open piek+praatje ·
 * open misère+praatje · 13-alleen.
 */

import type { Suit } from '../../core/types.ts';

export type BidKind =
  | 'rik'
  | 'beterRik'
  | 'alleen8'
  | 'alleen9'
  | 'alleen10'
  | 'alleen11'
  | 'alleen12'
  | 'alleen13'
  | 'piek'
  | 'misere'
  | 'openPiek'
  | 'openMisere'
  | 'openPiekPraatje'
  | 'openMiserePraatje';

/** Een concreet bod: een soort + optioneel de "beter"-variant (harten troef). */
export interface Bid {
  kind: BidKind;
  /** Alleen relevant bij 'alleenN': de beter-variant (harten verplicht troef). */
  beter?: boolean;
}

/** Rangwaarde 1..14 (hoger = sterker bod). Beter-variant verandert de rang NIET. */
const BID_RANK: Record<BidKind, number> = {
  rik: 1,
  beterRik: 2,
  alleen8: 3,
  piek: 4,
  alleen9: 5,
  misere: 6,
  alleen10: 7,
  openPiek: 8,
  alleen11: 9,
  openMisere: 10,
  alleen12: 11,
  openPiekPraatje: 12,
  openMiserePraatje: 13,
  alleen13: 14,
};

/** Alle soorten in rangorde laag→hoog. */
export const BID_LADDER: BidKind[] = (Object.keys(BID_RANK) as BidKind[]).sort(
  (a, b) => BID_RANK[a] - BID_RANK[b],
);

export const bidRank = (kind: BidKind): number => BID_RANK[kind];

const ALLEEN: ReadonlySet<BidKind> = new Set<BidKind>([
  'alleen8', 'alleen9', 'alleen10', 'alleen11', 'alleen12', 'alleen13',
]);
const PIEK_FAMILIE: ReadonlySet<BidKind> = new Set<BidKind>(['piek', 'openPiek', 'openPiekPraatje']);
const MISERE_FAMILIE: ReadonlySet<BidKind> = new Set<BidKind>(['misere', 'openMisere', 'openMiserePraatje']);
const OPEN: ReadonlySet<BidKind> = new Set<BidKind>([
  'openPiek', 'openMisere', 'openPiekPraatje', 'openMiserePraatje',
]);
const PRAATJE: ReadonlySet<BidKind> = new Set<BidKind>(['openPiekPraatje', 'openMiserePraatje']);

export const isAlleen = (kind: BidKind): boolean => ALLEEN.has(kind);
export const isPiekFamilie = (kind: BidKind): boolean => PIEK_FAMILIE.has(kind);
export const isMisereFamilie = (kind: BidKind): boolean => MISERE_FAMILIE.has(kind);
export const isOpen = (kind: BidKind): boolean => OPEN.has(kind);
export const isPraatje = (kind: BidKind): boolean => PRAATJE.has(kind);

/** Heeft dit bod een meegevraagde maat? (alleen gewone/beter rik.) */
export const heeftMaat = (kind: BidKind): boolean => kind === 'rik' || kind === 'beterRik';

/** Mag dit bod meegeclaimd worden (meepieken/meemisèren) i.p.v. opbieden? */
export const isClaimbaar = (kind: BidKind): boolean => isPiekFamilie(kind) || isMisereFamilie(kind);

/** Speelt dit bod met een troefkleur? (piek/misère/open zijn troefloos.) */
export const gebruiktTroef = (kind: BidKind): boolean =>
  kind === 'rik' || kind === 'beterRik' || isAlleen(kind);

/** Beloofd aantal slagen voor de bieder(spartij). */
export function doelSlagen(kind: BidKind): number {
  if (kind === 'rik' || kind === 'beterRik' || kind === 'alleen8') return 8;
  if (kind === 'alleen9') return 9;
  if (kind === 'alleen10') return 10;
  if (kind === 'alleen11') return 11;
  if (kind === 'alleen12') return 12;
  if (kind === 'alleen13') return 13;
  if (isPiekFamilie(kind)) return 1; // piek = exact 1
  return 0; // misère-familie = exact 0
}

/** Is de troefkleur vast harten? (beter rik; alleen-beter regelt de engine via de bid-flag.) */
export const forceertHarten = (kind: BidKind): boolean => kind === 'beterRik';

/** Welke soorten zijn aanzetbaar gegeven de variantconfig (open/praatje achter een vlag). */
export function soortToegestaan(kind: BidKind, openSpellen: boolean): boolean {
  if (isOpen(kind)) return openSpellen;
  return true;
}
