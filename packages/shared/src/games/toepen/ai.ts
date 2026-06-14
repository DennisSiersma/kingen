/**
 * src/games/toepen/ai.ts
 * Heuristische Toepen-AI (v1, "heuristiek + eenvoudige EV + bluf"). Twee soorten
 * beslissingen:
 *
 *  (1) KAART SPELEN — Toepen draait om de LAATSTE (4e) slag. De AI bewaart haar
 *      sterkste kaarten (vooral "bazen" = hoogste onbespeelde kaart van een kleur)
 *      voor het einde: ze duikt laag in de vroege slagen, bekent verplicht, en
 *      pakt de slag pas als het de laatste is (of gedwongen). Kaarttelling via
 *      view.playedCards bepaalt of een kaart nog de baas is.
 *
 *  (2) TOEPEN / MEEGAAN / PASSEN — op basis van een handsterkte-score H (som
 *      toepRankValue + bonus per baas), omgerekend naar een ruwe winkans pWin.
 *      Toepen als pWin hoog (druk zetten) of, afhankelijk van de moeilijkheid,
 *      af en toe als bluf. Meegaan als pWin > 1 − pas-kosten/inzet (de EV-grens),
 *      anders passen. Vier gelijke = altijd direct (gratis winst); vuile was =
 *      aannemen (de engine biedt 'm alleen bij een echte was); een eerlijke
 *      vuile-was-claim van een ander nooit uitdagen (dat kost je +1).
 */

import type { PlayerController } from '../../core/player.ts';
import type { Card, PlayerConfig, PublicGameView, Seat } from '../../core/types.ts';
import { snelheidsFactor } from '../../core/speed.ts';
import { toepRankValue, toepTrickWinner } from './cards.ts';
import type { ToepenMove, ToepenVariantConfig, ToepenViewExtras } from './types.ts';

type Play = { seat: Seat; card: Card };

/** Per moeilijkheid: bluf-frequentie + of kaarttelling (bazen) wordt gebruikt. */
interface Profiel {
  blufKans: number; // kans om met een zwakke hand toch te toepen
  telt: boolean; // gebruikt baas-detectie voor sterkere inschatting
  callDrempel: number; // pWin-marge om mee te gaan (lager = gretiger)
}

function profiel(diff: PlayerConfig['aiDifficulty']): Profiel {
  switch (diff) {
    case 'makkelijk':
      return { blufKans: 0.0, telt: false, callDrempel: 0.1 };
    case 'moeilijk':
      return { blufKans: 0.18, telt: true, callDrempel: 0.0 };
    default:
      return { blufKans: 0.06, telt: true, callDrempel: 0.05 };
  }
}

export class ToepenAi implements PlayerController {
  readonly seat: Seat;
  readonly config: PlayerConfig;
  private readonly thinkDelayMs: [number, number];
  private readonly prof: Profiel;

  constructor(
    seat: Seat,
    player: PlayerConfig,
    _variant: ToepenVariantConfig,
    thinkDelayMs: [number, number] = [400, 1100],
  ) {
    this.seat = seat;
    this.config = player;
    this.thinkDelayMs = thinkDelayMs;
    this.prof = profiel(player.aiDifficulty);
  }

  private async think(): Promise<void> {
    const [min, max] = this.thinkDelayMs;
    const ms = (min + Math.random() * Math.max(0, max - min)) * snelheidsFactor();
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  }

  async chooseMove(view: PublicGameView, legalMoves: readonly unknown[]): Promise<unknown> {
    await this.think();
    const moves = legalMoves as ToepenMove[];
    if (moves.length <= 1) return moves[0];

    // Speciale-hand-fase.
    const vier = moves.find((m) => m.type === 'declareVierGelijke');
    if (vier) return vier; // gratis winst
    const claim = moves.find((m) => m.type === 'claimVuileWas');
    if (claim) return claim; // de engine biedt 'm alleen bij een echte was → ruilen
    if (moves.some((m) => m.type === 'passChallenge')) {
      // Eerlijke claim (v1): uitdagen kost +1 → laten gaan.
      return moves.find((m) => m.type === 'passChallenge')!;
    }
    if (moves.some((m) => m.type === 'passClaim')) {
      return moves.find((m) => m.type === 'passClaim')!;
    }

    // Toep-respons.
    if (moves.some((m) => m.type === 'respondMeegaan')) {
      return this.kiesRespons(view, moves);
    }

    // Slagfase: kaart spelen (+ eventueel toepen).
    return this.kiesSpeelzet(view, moves);
  }

  // --- Handsterkte / winkans ----------------------------------------------

  private extras(view: PublicGameView): ToepenViewExtras {
    return view.viewExtras as ToepenViewExtras;
  }

  /** Is `card` de hoogste nog onbespeelde kaart van zijn kleur (gegarandeerde baas)? */
  private isBaas(card: Card, view: PublicGameView): boolean {
    const gezien = new Set(view.playedCards?.map((c) => c.id) ?? []);
    const mijn = new Set(view.hand.map((c) => c.id));
    const mijnWaarde = toepRankValue(card);
    for (const r of [7, 8, 9, 10, 14, 13, 12, 11] as const) {
      if (toepRankValue({ id: '', suit: card.suit, rank: r }) <= mijnWaarde) continue;
      const id = `${card.suit}-${r}`;
      if (id === card.id) continue;
      // Een hogere kaart die noch gespeeld, noch in mijn hand is → bij een tegenstander.
      if (!gezien.has(id) && !mijn.has(id)) return false;
    }
    return true;
  }

  /** Ruwe handsterkte: som toepRankValue + bonus per baas. */
  private handSterkte(view: PublicGameView, hand: readonly Card[]): number {
    let h = 0;
    for (const c of hand) {
      h += toepRankValue(c);
      if (this.prof.telt && this.isBaas(c, view)) h += 3;
    }
    return h;
  }

  /** Inschatting kans om de ronde (4e slag) te winnen, 0..1. */
  private winKans(view: PublicGameView): number {
    const ex = this.extras(view);
    const actief = ex.status.filter((s) => s === 'active').length || view.seatCount;
    const hand = view.hand;
    const h = this.handSterkte(view, hand);
    // Normaliseer: ~6 (kansloos) tot ~30 (zeer sterk) per hand van 4.
    const ruw = (h - 6) / 24; // 0..1-ish
    const basis = Math.max(0, Math.min(1, ruw));
    // Meer actieve tegenstanders → kleiner aandeel van de winst.
    const tegen = Math.max(1, actief - 1);
    const eerlijk = 1 / actief; // gelijke verdeling als referentie
    return Math.max(0, Math.min(1, eerlijk + (basis - 0.5) * (1.2 / tegen) + basis * 0.35));
  }

  // --- Toep-respons (meegaan/passen) --------------------------------------

  private kiesRespons(view: PublicGameView, moves: ToepenMove[]): ToepenMove {
    const ex = this.extras(view);
    const meegaan = moves.find((m) => m.type === 'respondMeegaan')!;
    const pas = moves.find((m) => m.type === 'respondPas')!;
    const stake = ex.stake;
    const passKosten = ex.penaltyIfIFoldNow;
    const pWin = this.winKans(view);
    // Meegaan als pWin > 1 − passKosten/stake (EV-grens), met een moeilijkheidsmarge.
    const grens = 1 - passKosten / Math.max(1, stake) - this.prof.callDrempel;
    return pWin >= grens ? meegaan : pas;
  }

  // --- Slagfase: kaart spelen (+ toepen) ----------------------------------

  private kiesSpeelzet(view: PublicGameView, moves: ToepenMove[]): ToepenMove {
    const toep = moves.find((m) => m.type === 'callToep');
    const kaartMoves = moves.filter((m) => m.type === 'playCard') as Extract<ToepenMove, { type: 'playCard' }>[];

    // Eventueel toepen vóór het spelen (alleen als het mag).
    if (toep && this.wilToepen(view)) return toep;

    const legaal = kaartMoves.map((m) => m.card);
    const gekozen = this.besteSpeelkaart(view, legaal);
    return kaartMoves.find((m) => m.card.id === gekozen.id) ?? kaartMoves[0]!;
  }

  private wilToepen(view: PublicGameView): boolean {
    const pWin = this.winKans(view);
    // Druk zetten met een sterke hand; soms bluffen met een zwakke.
    if (pWin >= 0.72) return true;
    if (pWin <= 0.4 && Math.random() < this.prof.blufKans) return true;
    return false;
  }

  private besteSpeelkaart(view: PublicGameView, legaal: Card[]): Card {
    if (legaal.length === 1) return legaal[0]!;
    const seat = view.seat;
    const plays = (view.currentTrick?.plays ?? []) as Play[];
    const actief = new Set(
      this.extras(view).status.flatMap((s, i) => (s === 'active' ? [i as Seat] : [])),
    );
    const laatsteSlag = (view.completedTricks?.length ?? 0) >= 3; // 4e slag

    const wintNu = (card: Card): boolean => {
      const nieuw = [...plays.filter((p) => actief.has(p.seat)), { seat, card }];
      return toepTrickWinner(nieuw) === seat;
    };

    // --- Uitkomen ---
    if (plays.length === 0) {
      if (laatsteSlag) return hoogste(legaal); // laatste slag: pak 'm met je beste
      return laagste(legaal); // vroeg: laag uitkomen, bazen bewaren
    }

    // --- Volgen / afgooien ---
    const winners = legaal.filter(wintNu);
    if (laatsteSlag) {
      return winners.length > 0 ? laagsteWinner(winners) : laagste(legaal);
    }
    // Vroege slag: niet winnen (sparen). Duik met de laagste kaart.
    // Als alles wint (gedwongen), speel dan de laagste winnaar.
    const verliezers = legaal.filter((c) => !wintNu(c));
    if (verliezers.length > 0) return laagste(verliezers);
    return laagsteWinner(legaal);
  }
}

// --- helpers ---------------------------------------------------------------

/** Laagste Toepen-kaartkracht. */
function laagste(cards: Card[]): Card {
  return cards.reduce((a, b) => (toepRankValue(b) < toepRankValue(a) ? b : a), cards[0]!);
}
/** Hoogste Toepen-kaartkracht. */
function hoogste(cards: Card[]): Card {
  return cards.reduce((a, b) => (toepRankValue(b) > toepRankValue(a) ? b : a), cards[0]!);
}
/** Goedkoopste (laagste) winnende kaart. */
function laagsteWinner(winners: Card[]): Card {
  return laagste(winners);
}
