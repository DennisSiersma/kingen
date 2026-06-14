/**
 * src/games/toepen/cards.ts
 * Kaartmateriaal voor Toepen: het 32-kaarts deck (7..A) en de AFWIJKENDE
 * kaartkracht. In Toepen geldt per kleur de volgorde HOOG→LAAG:
 *   10 > 9 > 8 > 7 > A > H(K) > V(Q) > B(J).
 * Dat is NIET aas-hoog, dus de default trickWinner uit deck.ts wint de verkeerde
 * slag — we injecteren toepRankValue als comparator.
 */

import type { Card, CardId, Rank, Seat, Suit } from '../../core/types.ts';
import { SUITS } from '../../core/types.ts';
import { createDeck } from '../../core/deck.ts';

/**
 * Interne rangwaarde (hoger = sterker), volgens de Toepen-volgorde:
 *  B=1, V=2, H=3, A=4, 7=5, 8=6, 9=7, 10=8.
 */
const TOEP_RANK_VALUE: Readonly<Record<Rank, number>> = {
  11: 1, // Boer (J)
  12: 2, // Vrouw (Q)
  13: 3, // Heer (K)
  14: 4, // Aas (A)
  7: 5,
  8: 6,
  9: 7,
  10: 8,
  // De lage kaarten zitten niet in het Toepen-deck, maar het type Rank dekt ze;
  // geef ze de laagste waarden zodat de map totaal is.
  2: -5, 3: -4, 4: -3, 5: -2, 6: -1,
};

/** Toepen-kaartkracht voor trickWinner (geen troef → tweede param genegeerd). */
export function toepRankValue(card: Card): number {
  return TOEP_RANK_VALUE[card.rank];
}

/** Welke kaart-id's vallen buiten het Toepen-deck (ranks 2..6, alle kleuren)? */
function lageKaartIds(): CardId[] {
  const ids: CardId[] = [];
  for (const suit of SUITS) for (const r of [2, 3, 4, 5, 6] as Rank[]) ids.push(`${suit}-${r}`);
  return ids;
}

/** Het 32-kaarts Toepen-deck (7 t/m A in vier kleuren, geen troef, geen jokers). */
export function toepDeck(): Card[] {
  return createDeck(lageKaartIds());
}

/**
 * Winnaar van een (complete) slag volgens de Toepen-kaartkracht. Geen troef: de
 * hoogste kaart van de GEVRAAGDE kleur wint.
 *
 * `plays` mag al gefilterd zijn op nog-meedoende stoelen (gevouwen spelers
 * tellen niet mee voor de winst). De gevraagde kleur MOET daarom expliciet
 * worden meegegeven: hij ligt vast bij wie fysiek uitkwam, óók als die speler
 * later mid-slag vouwt (anders zou `plays[0]` na filteren een afgegooide kaart
 * van een andere kleur zijn en de gevraagde kleur verschuiven). Zonder `ledSuit`
 * valt hij terug op de eerste kaart in `plays` (geldig wanneer er niet gefilterd
 * is). Randgeval: volgde geen enkele nog-actieve speler de gevraagde kleur (de
 * enige volgers vouwden), dan wint de hoogste kaart onder de actieve spelers.
 */
export function toepTrickWinner(
  plays: readonly { seat: Seat; card: Card }[],
  ledSuit?: Suit,
): Seat {
  if (plays.length === 0) throw new Error('Lege slag');
  const led = ledSuit ?? plays[0]!.card.suit;
  const inKleur = plays.filter((p) => p.card.suit === led);
  const pool = inKleur.length > 0 ? inKleur : plays;
  return pool.reduce((best, p) => (toepRankValue(p.card) > toepRankValue(best.card) ? p : best), pool[0]!).seat;
}
