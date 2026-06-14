/**
 * src/games/rikken/scoring.ts
 * Tabelgedreven puntentelling (Stichting Rikken 2025). Bedragen zijn PER
 * TEGENSPELER; de uitkomst is nulsom over de 4 spelers.
 *
 * Verdeling:
 *  - rik/beter rik (team): geslaagd → elk partijlid krijgt het bedrag van elke
 *    tegenstander; verlies → de RIKKER betaalt alleen (maat = 0).
 *  - N-alleen (solo, 1 vs 3): geslaagd → bieder krijgt het bedrag van elk van de 3;
 *    verlies → bieder betaalt elk van de 3.
 *  - piek/misère (1 vs 3): het puntenblad noemt het TOTAAL; per tegenspeler = ÷3.
 *
 * Geverifieerd tegen het Puntenblad 2025 (zie [[rikken-spec]]). TWEE waarden zijn
 * in de bron niet los gespecificeerd en hier als GEDOCUMENTEERDE AANNAME ingevuld
 * (makkelijk te corrigeren omdat het pure data is):
 *  (a) "8 alleen" (gewoon) → zelfde schaal als beter rik (basis 30);
 *  (b) "N-alleen beter" (N≥9) → zelfde bedrag als gewoon N-alleen (de beter-bonus
 *      voor solo's staat niet in de geverifieerde toppunten).
 */

import { doelSlagen, heeftMaat, type BidKind } from './bids.ts';
import type { Card, Seat } from '../../core/types.ts';
import type { PassGame, RikkenContract, RikkenVariantConfig } from './types.ts';

const SCHOPPENVROUW_ID = 'spades-12';

type Trick = { winner?: Seat; plays: { seat: Seat; card: Card }[] };

/**
 * Telling van de passspellen (Schoppen Mie / 1-of-5). Per-tegenspeler, nulsom.
 *  - Schoppen Mie: wie de ♠V binnenhaalt −5 per tegenspeler; wie de laatste slag
 *    haalt −5 per tegenspeler (dezelfde speler beide = −10 p.s., max −30).
 *  - 1-of-5: wie exact 1 óf exact 5 slagen haalt wint en krijgt +10 per
 *    verliezende speler (elke verliezer betaalt 10 per winnaar).
 */
export function scorePassGame(
  passGame: PassGame,
  trickCounts: readonly number[],
  completedTricks: readonly Trick[],
): number[] {
  const n = trickCounts.length;
  const deltas = new Array<number>(n).fill(0);

  if (passGame === 'schoppenMie') {
    const straf = (seat: number | undefined): void => {
      if (seat === undefined || seat < 0) return;
      for (let o = 0; o < n; o++) {
        if (o === seat) continue;
        deltas[seat]! -= 5;
        deltas[o]! += 5;
      }
    };
    const mieSlag = completedTricks.find((t) => t.plays.some((p) => p.card.id === SCHOPPENVROUW_ID));
    straf(mieSlag?.winner);
    straf(completedTricks[completedTricks.length - 1]?.winner);
    return deltas;
  }

  // 1-of-5
  const winnaars: number[] = [];
  const verliezers: number[] = [];
  for (let s = 0; s < n; s++) {
    if (trickCounts[s] === 1 || trickCounts[s] === 5) winnaars.push(s);
    else verliezers.push(s);
  }
  for (const w of winnaars) deltas[w]! += 10 * verliezers.length;
  for (const l of verliezers) deltas[l]! -= 10 * winnaars.length;
  return deltas;
}

/** Verlies-schaal voor rik/beter rik/8-alleen: 7=-10 … 0=-45 (stap -5). */
function rikVerlies(tricks: number): number {
  return -(10 + (7 - tricks) * 5);
}

/**
 * Bedrag PER TEGENSPELER (positief = de partij wint dit van elke tegenstander,
 * negatief = de partij betaalt dit aan elke tegenstander), gegeven het aantal
 * door de partij behaalde slagen.
 */
export function perOpponent(kind: BidKind, _beter: boolean, partyTricks: number): number {
  // _beter: de beter-bonus voor solo's staat niet in de geverifieerde toppunten
  // (zie kop-commentaar); gewoon en beter delen daarom voorlopig dezelfde schaal.
  switch (kind) {
    case 'rik':
      return partyTricks >= 8 ? (partyTricks === 13 ? 70 : 10 + (partyTricks - 8) * 5) : rikVerlies(partyTricks);
    case 'beterRik':
    case 'alleen8':
      // beter rik & (8-alleen, gewoon én beter): basis 30, +15 per overslag, 13=105.
      return partyTricks >= 8 ? 30 + (partyTricks - 8) * 15 : rikVerlies(partyTricks);
    case 'alleen9':
      return partyTricks >= 9 ? 60 + (partyTricks - 9) * 15 : -25;
    case 'alleen10':
      return partyTricks >= 10 ? 90 + (partyTricks - 10) * 15 : -40;
    case 'alleen11':
      return partyTricks >= 11 ? 120 + (partyTricks - 11) * 15 : -50;
    case 'alleen12':
      return partyTricks >= 12 ? 150 + (partyTricks - 12) * 15 : -55;
    case 'alleen13':
      return partyTricks >= 13 ? 210 : -(70 + (12 - partyTricks) * 5);
    case 'piek':
      return partyTricks === 1 ? 15 : -15;
    case 'misere':
      return partyTricks === 0 ? 25 : -25;
    case 'openPiek':
      return partyTricks === 1 ? 40 : -40;
    case 'openMisere':
      return partyTricks === 0 ? 50 : -50;
    case 'openPiekPraatje':
      return partyTricks === 1 ? 55 : -55;
    case 'openMiserePraatje':
      return partyTricks === 0 ? 60 : -60;
    default:
      return 0;
  }
}

/** Is het contract gehaald, gegeven de partij-slagen? */
export function contractGehaald(kind: BidKind, partyTricks: number): boolean {
  const doel = doelSlagen(kind);
  if (kind === 'piek' || kind === 'openPiek' || kind === 'openPiekPraatje') return partyTricks === 1;
  if (kind === 'misere' || kind === 'openMisere' || kind === 'openMiserePraatje') return partyTricks === 0;
  return partyTricks >= doel; // rik/beter/alleen
}

export interface RondeUitslag {
  /** Score-delta per stoel deze ronde (nulsom). Index = Seat. */
  deltas: number[];
  gehaald: boolean;
  partyTricks: number;
}

/**
 * Reken een afgelopen ronde af. `trickCounts` = gewonnen slagen per stoel.
 * `contract.partner` moet de echte maat zijn (intern bekend, ook vóór onthulling).
 */
export function scoreRonde(
  contract: RikkenContract,
  trickCounts: readonly number[],
  _config: RikkenVariantConfig,
): RondeUitslag {
  const n = trickCounts.length;
  const deltas = new Array<number>(n).fill(0);
  const team = heeftMaat(contract.kind) && contract.partner !== null;
  const partySeats = team ? [contract.declarer, contract.partner as number] : [contract.declarer];
  const partySet = new Set(partySeats);
  const opponents: number[] = [];
  for (let s = 0; s < n; s++) if (!partySet.has(s)) opponents.push(s);

  const partyTricks = partySeats.reduce((sum, s) => sum + (trickCounts[s] ?? 0), 0);
  const gehaald = contractGehaald(contract.kind, partyTricks);
  const bedrag = Math.abs(perOpponent(contract.kind, contract.beter, partyTricks));

  if (gehaald) {
    // Elk partijlid krijgt `bedrag` van elke tegenstander.
    for (const opp of opponents) {
      deltas[opp]! -= bedrag * partySeats.length;
      for (const p of partySeats) deltas[p]! += bedrag;
    }
  } else if (team) {
    // Verlies van een rik: alleen de rikker (declarer) betaalt; maat = 0.
    for (const opp of opponents) {
      deltas[opp]! += bedrag;
      deltas[contract.declarer]! -= bedrag;
    }
  } else {
    // Solo/piek/misère verlies: bieder betaalt elke tegenstander.
    for (const opp of opponents) {
      deltas[opp]! += bedrag;
      deltas[contract.declarer]! -= bedrag;
    }
  }

  return { deltas, gehaald, partyTricks };
}
