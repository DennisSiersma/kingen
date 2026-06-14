/**
 * src/games/klaverjassen/scoring.ts
 * Roem-detectie en rondetelling (nat/gehaald/pit) — los van de kaartpunten.
 *
 * ROEM (automatisch geteld uit de gedeelde handen, de gekozen digitale conventie):
 *  - reeks van 3 aaneengesloten in de NATUURLIJKE volgorde (A-H-V-B-10-9-8-7),
 *    zelfde kleur = 20; reeks van 4+ = 50; meerdere losse reeksen per kleur tellen
 *    apart (bv. 3+4 = 20+50 = 70).
 *  - stuk = Heer + Vrouw van de TROEFkleur = 20 (telt los, óók binnen een reeks).
 *  - vier gelijke hoge (vier 10/H/V/A) = 100; vier Boeren = 200.
 *
 * RONDETELLING:
 *  - makingTotal = kaartpunten + roem van het spelende team; idem defTotal.
 *  - gehaald (ronde "gemaakt") = makingTotal STRIKT groter dan defTotal; bij
 *    gelijkstand → NAT.
 *  - nat: het spelende team krijgt 0, de tegenpartij ALLE 162 + alle roem.
 *  - pit (één team wint alle 8 slagen): dat team krijgt 162 + alle roem + 100, de
 *    ander 0 (een pit door de verdedigers maakt het spelende team per definitie nat).
 */

import type { Card, Rank, Suit } from '../../core/types.ts';
import { naturalPos } from './cards.ts';
import type { RoemKind, Team } from './types.ts';

export interface RoemDetectie {
  kind: RoemKind;
  points: number;
  cards: Card[];
}

const ROEM_VIER_GELIJK_RANKS: ReadonlySet<Rank> = new Set<Rank>([10, 12, 13, 14]); // 10, V, H, A

/** Detecteer alle roem in een hand van 8 kaarten, gegeven de troefkleur. */
export function detectRoem(hand: readonly Card[], trump: Suit | null): RoemDetectie[] {
  const out: RoemDetectie[] = [];

  // --- Reeksen per kleur (natuurlijke volgorde) ---
  for (const suit of ['clubs', 'diamonds', 'hearts', 'spades'] as Suit[]) {
    const kleur = hand
      .filter((c) => c.suit === suit)
      .sort((a, b) => naturalPos(a.rank) - naturalPos(b.rank));
    let run: Card[] = [];
    const flushRun = (): void => {
      if (run.length >= 4) out.push({ kind: 'reeks50', points: 50, cards: run.slice() });
      else if (run.length === 3) out.push({ kind: 'reeks20', points: 20, cards: run.slice() });
    };
    for (const card of kleur) {
      if (run.length === 0 || naturalPos(card.rank) === naturalPos(run[run.length - 1]!.rank) + 1) {
        run.push(card);
      } else {
        flushRun();
        run = [card];
      }
    }
    flushRun();
  }

  // --- Stuk: H + V van troef ---
  if (trump !== null) {
    const heer = hand.find((c) => c.suit === trump && c.rank === 13);
    const vrouw = hand.find((c) => c.suit === trump && c.rank === 12);
    if (heer && vrouw) out.push({ kind: 'stuk20', points: 20, cards: [heer, vrouw] });
  }

  // --- Vier gelijke ---
  const perRang = new Map<Rank, Card[]>();
  for (const c of hand) {
    const lijst = perRang.get(c.rank) ?? [];
    lijst.push(c);
    perRang.set(c.rank, lijst);
  }
  for (const [rank, cards] of perRang) {
    if (cards.length < 4) continue;
    if (rank === 11) out.push({ kind: 'vierBoeren200', points: 200, cards: cards.slice() });
    else if (ROEM_VIER_GELIJK_RANKS.has(rank)) out.push({ kind: 'vierGelijk100', points: 100, cards: cards.slice() });
  }

  return out;
}

export interface RondeUitslag {
  /** Punten die elk team deze ronde krijgt (na nat/pit-verrekening). Index = Team. */
  roundScores: [number, number];
  gehaald: boolean;
  makingTotal: number;
  defTotal: number;
  /** Team dat pit maakte (alle 8 slagen), of null. */
  pitTeam: Team | null;
}

/**
 * Bereken de rondescore uit de (reeds opgetelde) kaartpunten, roem en slagen per
 * team. `teamCardPoints` moet de 162 al bevatten (incl. laatste-slag-bonus).
 */
export function computeRondeUitslag(
  makingTeam: Team,
  teamCardPoints: readonly [number, number],
  teamRoem: readonly [number, number],
  teamTricks: readonly [number, number],
): RondeUitslag {
  const totaalRoem = teamRoem[0] + teamRoem[1];
  const totaalKaart = teamCardPoints[0] + teamCardPoints[1]; // 162
  const def: Team = (1 - makingTeam) as Team;
  const makingTotal = teamCardPoints[makingTeam] + teamRoem[makingTeam];
  const defTotal = teamCardPoints[def] + teamRoem[def];

  // Pit?
  let pitTeam: Team | null = null;
  if (teamTricks[0] === 8) pitTeam = 0;
  else if (teamTricks[1] === 8) pitTeam = 1;

  const roundScores: [number, number] = [0, 0];
  if (pitTeam !== null) {
    roundScores[pitTeam] = totaalKaart + totaalRoem + 100;
    roundScores[(1 - pitTeam) as Team] = 0;
    return { roundScores, gehaald: pitTeam === makingTeam, makingTotal, defTotal, pitTeam };
  }

  const gehaald = makingTotal > defTotal;
  if (gehaald) {
    roundScores[makingTeam] = makingTotal;
    roundScores[def] = defTotal;
  } else {
    roundScores[def] = totaalKaart + totaalRoem;
    roundScores[makingTeam] = 0;
  }
  return { roundScores, gehaald, makingTotal, defTotal, pitTeam: null };
}
