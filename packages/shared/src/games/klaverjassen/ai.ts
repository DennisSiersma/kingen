/**
 * src/games/klaverjassen/ai.ts
 * Sterke heuristische Klaverjas-AI (v1, "heuristiek-eerst"). De legale-zetten-
 * generator (rules.ts) dwingt al bekennen/troef-/overtroef-/ondertroefplicht af;
 * de AI kiest binnen die ruimte op basis van geverifieerde clubstrategie:
 *
 *  - TROEFBELEID: spaar Boer (20) en Nel (9, 14 pt); trek troef met de laagste
 *    troef als je dominant bent; win slagen zo goedkoop mogelijk.
 *  - MAAT-BEWUSTZIJN ("maat staat hoog"): verspil geen kracht als je maat de slag
 *    al wint — smeer juist punten (Aas/Tien) wanneer je als laatste zit, anders
 *    speel laag. In Amsterdams weegt dit extra zwaar (troefplicht vervalt dan).
 *  - WINNEN/DUIKEN: staat de tegenstander hoog, win dan goedkoop als er punten in
 *    de slag liggen (geen Boer/Nel verspillen voor een lege slag); anders duik en
 *    bewaar Azen/Tienen, gooi je laagste puntloze kaart af.
 *  - BIEDEN (Leids): kies troef op troeflengte + Boer/Nel/Aas-bezit; pas bij een
 *    zwakke hand.
 *
 * Bron: pagat.com, Wikipedia NL, VIP Klaverjas (stoomcursus), CardGamesHub-seinen,
 * KaartspelRanking. Een determinisatie/ISMCTS-versie kan later 'moeilijk' upgraden.
 */

import type { PlayerController } from '../../core/player.ts';
import type { Card, PlayerConfig, PublicGameView, Seat, Suit } from '../../core/types.ts';
import { trickWinner } from '../../core/deck.ts';
import { snelheidsFactor } from '../../core/speed.ts';
import { cardPoints, klaverjasRankValue } from './cards.ts';
import { partnerSeat } from './rules.ts';
import type { KlaverjasMove, KlaverjasVariantConfig } from './types.ts';

type Play = { seat: Seat; card: Card };

export class KlaverjasAi implements PlayerController {
  readonly seat: Seat;
  readonly config: PlayerConfig;
  private readonly thinkDelayMs: [number, number];

  constructor(
    seat: Seat,
    player: PlayerConfig,
    _variant: KlaverjasVariantConfig,
    thinkDelayMs: [number, number] = [400, 1100],
  ) {
    this.seat = seat;
    this.config = player;
    this.thinkDelayMs = thinkDelayMs;
  }

  private async think(): Promise<void> {
    const [min, max] = this.thinkDelayMs;
    const ms = (min + Math.random() * Math.max(0, max - min)) * snelheidsFactor();
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  }

  async chooseMove(view: PublicGameView, legalMoves: readonly unknown[]): Promise<unknown> {
    await this.think();
    const moves = legalMoves as KlaverjasMove[];
    if (moves.length === 0) return moves[0];
    if (moves[0]!.type === 'bid') return this.kiesBod(view, moves);
    return this.kiesSpeelkaart(view, moves);
  }

  // --- Bieden (Leids) ------------------------------------------------------

  private kiesBod(view: PublicGameView, moves: KlaverjasMove[]): KlaverjasMove {
    const hand = view.hand;
    const passMove = moves.find((m) => m.type === 'bid' && m.choice === 'pass');
    // Beoordeel elke aangeboden troefkleur; kies de sterkste.
    let beste: { suit: Suit; score: number } | null = null;
    for (const m of moves) {
      if (m.type !== 'bid' || m.choice === 'pass') continue;
      const suit = m.choice.trump;
      const score = this.troefHandScore(hand, suit);
      if (!beste || score > beste.score) beste = { suit, score };
    }
    if (!beste) return moves[0]!;
    // Pas bij een zwakke hand (tenzij passen niet mag → verplicht spelen).
    if (passMove && beste.score < 45) return passMove;
    return moves.find((m) => m.type === 'bid' && m.choice !== 'pass' && m.choice.trump === beste!.suit) ?? moves[0]!;
  }

  /** Handsterkte als `suit` troef zou zijn: troeflengte + Boer/Nel/Aas + zij-azen. */
  private troefHandScore(hand: readonly Card[], suit: Suit): number {
    const troef = hand.filter((c) => c.suit === suit);
    const heeft = (r: number) => troef.some((c) => c.rank === r);
    const zijAzen = hand.filter((c) => c.suit !== suit && c.rank === 14).length;
    return (
      troef.length * 10 +
      (heeft(11) ? 30 : 0) + // Boer
      (heeft(9) ? 20 : 0) + // Nel
      (heeft(14) ? 8 : 0) + // troefaas
      (heeft(13) ? 4 : 0) + // troefheer
      zijAzen * 6
    );
  }

  // --- Spelen --------------------------------------------------------------

  private kiesSpeelkaart(view: PublicGameView, moves: KlaverjasMove[]): KlaverjasMove {
    const trump = view.round.trump;
    const legaal = moves.flatMap((m) => (m.type === 'playCard' ? [m.card] : []));
    const gekozen = this.besteSpeelkaart(view, legaal, trump);
    return moves.find((m) => m.type === 'playCard' && m.card.id === gekozen.id) ?? moves[0]!;
  }

  private besteSpeelkaart(view: PublicGameView, legaal: Card[], trump: Suit | null): Card {
    if (legaal.length === 1) return legaal[0]!;
    const plays: Play[] = (view.currentTrick?.plays ?? []) as Play[];
    const n = view.seatCount;
    const seat = view.seat;

    const isTrump = (c: Card) => c.suit === trump;
    const kracht = (c: Card) => klaverjasRankValue(c, trump);
    const punten = (c: Card) => cardPoints(c, trump);
    const wintMet = (c: Card): boolean =>
      trickWinner([...plays, { seat, card: c }], trump, klaverjasRankValue) === seat;

    // --- Uitkomen ---
    if (plays.length === 0) return this.kiesUitkomst(view.hand, legaal, trump);

    const laatste = plays.length === n - 1;
    const puntenInSlag = plays.reduce((s, p) => s + punten(p.card), 0);
    const winnaarNu = trickWinner(plays, trump, klaverjasRankValue);
    const maatWint = winnaarNu === partnerSeat(seat, n);

    // --- Maat staat hoog: niet verspillen; smeren als ik laatste zit ---
    if (maatWint) {
      const nietAfpakken = legaal.filter((c) => !wintMet(c));
      const pool = nietAfpakken.length > 0 ? nietAfpakken : legaal; // anders gedwongen overtroef
      if (nietAfpakken.length === 0) return minBy(legaal, kracht); // goedkoopst afpakken (gedwongen)
      if (laatste) return maxBy(pool, punten); // veilig smeren (niemand komt meer)
      // Niet laatste: speel laag en puntloos, maat kan de slag nog binnenhalen.
      return minBy(pool, (c) => punten(c) * 100 + kracht(c));
    }

    // --- Tegenstander wint (of nog open): proberen te winnen, of duiken ---
    const winners = legaal.filter(wintMet);
    if (winners.length > 0) {
      const goedkoopste = minBy(winners, kracht);
      const duurTroef = isTrump(goedkoopste) && kracht(goedkoopste) >= 7; // Boer/Nel
      // Win als er punten liggen of als ik goedkoop kan winnen; verspil geen
      // Boer/Nel aan een magere slag tenzij ik als laatste zit (dan kost het niets extra).
      if (puntenInSlag >= 10 || !duurTroef || laatste) return goedkoopste;
      // Anders duiken: bewaar de hoge troef.
    }

    // --- Duiken / afgooien: laagste punten, bewaar Azen/Tienen en troef ---
    return this.kiesAfgooi(legaal, trump);
  }

  /** Uitkomen: troef trekken bij dominantie, anders een aas cashen of laag spelen. */
  private kiesUitkomst(hand: readonly Card[], legaal: Card[], trump: Suit | null): Card {
    const kracht = (c: Card) => klaverjasRankValue(c, trump);
    const troefInHand = hand.filter((c) => c.suit === trump);
    const heeftBoer = troefInHand.some((c) => c.rank === 11);
    const dominant = troefInHand.length >= 4 || (heeftBoer && troefInHand.length >= 3);

    if (dominant) {
      // Troef trekken met de LAAGSTE troef (Boer/Nel sparen).
      const troefLegaal = legaal.filter((c) => c.suit === trump);
      if (troefLegaal.length > 0) return minBy(troefLegaal, kracht);
    }

    // Cash een niet-troef aas (vóór de tegenstander troefvrij raakt).
    const azen = legaal.filter((c) => c.suit !== trump && c.rank === 14);
    if (azen.length > 0) {
      // Aas uit mijn langste niet-troefkleur (meeste vervolgkans).
      const lengte = (s: Suit) => hand.filter((c) => c.suit === s).length;
      return maxBy(azen, (c) => lengte(c.suit));
    }

    // Anders: speel een lage, puntloze niet-troefkaart uit je KORTSTE niet-troef-
    // kleur, zodat je daar snel kaal raakt en kunt introeven (troefcreatie).
    const nietTroef = legaal.filter((c) => c.suit !== trump && cardPoints(c, trump) === 0);
    if (nietTroef.length > 0) {
      const lengte = (s: Suit) => hand.filter((c) => c.suit === s).length;
      return minBy(nietTroef, (c) => lengte(c.suit) * 10 + kracht(c));
    }
    return this.kiesAfgooi(legaal, trump);
  }

  /** Afgooien/duiken: minimaliseer weggegeven punten; bewaar troef en Azen/Tienen. */
  private kiesAfgooi(legaal: Card[], trump: Suit | null): Card {
    const punten = (c: Card) => cardPoints(c, trump);
    const kracht = (c: Card) => klaverjasRankValue(c, trump);
    const nietTroef = legaal.filter((c) => c.suit !== trump);
    const pool = nietTroef.length > 0 ? nietTroef : legaal; // bewaar troef indien mogelijk
    // Laagste punten eerst, dan laagste kracht (gooi de meest waardeloze kaart).
    return minBy(pool, (c) => punten(c) * 100 + kracht(c));
  }
}

// --- kleine helpers --------------------------------------------------------

function minBy(cards: Card[], score: (c: Card) => number): Card {
  return cards.reduce((a, b) => (score(b) < score(a) ? b : a));
}
function maxBy(cards: Card[], score: (c: Card) => number): Card {
  return cards.reduce((a, b) => (score(b) > score(a) ? b : a));
}
