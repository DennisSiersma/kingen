/**
 * src/games/hartenjagen/ai.ts
 * Heuristische Hartenjagen-AI (v1, "heuristiek-eerst"). Implementeert de
 * generieke PlayerController.chooseMove en kiest:
 *  - DOORGEVEN: de 3 gevaarlijkste kaarten weg (♠A/♠K, ♠V indien kort in schoppen,
 *    hoge harten, daarna hoge kaarten).
 *  - SPELEN: laag uitkomen; bij volgen onder de winnende kaart duiken als er
 *    straf in de slag ligt; ♠V dumpen wanneer veilig; bij niet-bekennen de
 *    gevaarlijkste kaart afgooien. Schiet-de-maan wordt niet actief najaagd.
 *
 * Een ISMCTS-versie voor 'moeilijk' kan later het zoekskelet gebruiken; v1 is
 * één heuristiek voor alle niveaus.
 */

import type { PlayerController } from '../../core/player.ts';
import type { Card, PlayerConfig, PublicGameView, Seat } from '../../core/types.ts';
import { trickWinner } from '../../core/deck.ts';
import { snelheidsFactor } from '../../core/speed.ts';
import type { HartenjagenMove, HartenjagenVariantConfig } from './types.ts';

const QUEEN_SPADES_ID = 'spades-12';
const KING_SPADES_ID = 'spades-13';
const ACE_SPADES_ID = 'spades-14';

export class HartenjagenAi implements PlayerController {
  readonly seat: Seat;
  readonly config: PlayerConfig;
  private readonly variant: HartenjagenVariantConfig;
  private readonly thinkDelayMs: [number, number];

  constructor(
    seat: Seat,
    player: PlayerConfig,
    variant: HartenjagenVariantConfig,
    thinkDelayMs: [number, number] = [400, 1100],
  ) {
    this.seat = seat;
    this.config = player;
    this.variant = variant;
    this.thinkDelayMs = thinkDelayMs;
  }

  private async think(): Promise<void> {
    const [min, max] = this.thinkDelayMs;
    const ms = (min + Math.random() * Math.max(0, max - min)) * snelheidsFactor();
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  }

  async chooseMove(view: PublicGameView, legalMoves: readonly unknown[]): Promise<unknown> {
    await this.think();
    const moves = legalMoves as HartenjagenMove[];
    if (moves.length === 0) return moves[0];
    if (moves[0]!.type === 'passCards') return this.kiesDoorgeven(view, moves);
    return this.kiesSpeelkaart(view, moves);
  }

  // --- Doorgeven -----------------------------------------------------------

  private kiesDoorgeven(view: PublicGameView, moves: HartenjagenMove[]): HartenjagenMove {
    const hand = view.hand;
    const schoppen = hand.filter((c) => c.suit === 'spades').length;
    const score = (c: Card): number => this.doorgeefGevaar(c, schoppen);
    const wegmee = [...hand].sort((a, b) => score(b) - score(a)).slice(0, 3);
    const ids = new Set(wegmee.map((c) => c.id));
    // Vind de aangeboden passCards-zet met exact deze 3 kaarten.
    const match = moves.find(
      (m) => m.type === 'passCards' && m.cards.length === 3 && m.cards.every((c) => ids.has(c.id)),
    );
    return match ?? moves[0]!;
  }

  /** Hoe graag geven we deze kaart weg? Hoger = gevaarlijker (eerst weg). */
  private doorgeefGevaar(card: Card, schoppenLengte: number): number {
    if (card.id === ACE_SPADES_ID) return 1000;
    if (card.id === KING_SPADES_ID) return 990;
    if (card.id === QUEEN_SPADES_ID) return schoppenLengte <= 3 ? 980 : 300; // kort in ♠ → weg; lang → houden om te controleren
    if (card.suit === 'hearts') return 100 + card.rank; // hoge harten gevaarlijk
    return card.rank; // verder gewoon de hoogste kaarten
  }

  // --- Spelen --------------------------------------------------------------

  private kiesSpeelkaart(view: PublicGameView, moves: HartenjagenMove[]): HartenjagenMove {
    const kaarten = moves.flatMap((m) => (m.type === 'playCard' ? [m.card] : []));
    const gekozen = this.besteSpeelkaart(view, kaarten);
    const match = moves.find((m) => m.type === 'playCard' && m.card.id === gekozen.id);
    return match ?? moves[0]!;
  }

  private besteSpeelkaart(view: PublicGameView, legaal: Card[]): Card {
    const trick = view.currentTrick;
    const plays = trick?.plays ?? [];
    if (legaal.length === 1) return legaal[0]!;

    // 1. Uitkomen (lege slag): laag en veilig leiden.
    if (plays.length === 0) {
      // Vermijd hoge schoppen leiden (kan de ♠V aantrekken/zelf winnen).
      const veilig = legaal.filter((c) => !this.isHoogSchoppen(c));
      const pool = veilig.length > 0 ? veilig : legaal;
      return laagste(pool);
    }

    const led = plays[0]!.card.suit;
    const kanBekennen = legaal.some((c) => c.suit === led);
    const strafInSlag = plays.reduce((s, p) => s + this.straf(p.card), 0);
    const winnende = trickWinner(plays, null);
    const winnendeKaart = plays.find((p) => p.seat === winnende)!.card;

    if (kanBekennen) {
      // We moeten bekennen (legaal bevat dan alleen de leidkleur).
      const onder = legaal.filter((c) => c.rank < winnendeKaart.rank);
      // ♠V dumpen als schoppen geleid is en we hem mogen/willen lossen.
      if (led === 'spades' && legaal.some((c) => c.id === QUEEN_SPADES_ID)) {
        const queen = legaal.find((c) => c.id === QUEEN_SPADES_ID)!;
        // Alleen veilig dumpen als we de slag niet zelf zouden winnen met de ♠V.
        if (winnendeKaart.rank > queen.rank) return queen;
      }
      if (onder.length > 0) {
        // Duik: speel de hoogste kaart die NIET wint (raak hoge kaarten kwijt).
        return hoogste(onder);
      }
      // We winnen onvermijdelijk: speel de laagste winnende kaart.
      return laagste(legaal);
    }

    // 2. Niet kunnen bekennen → afgooien: dump de gevaarlijkste kaart.
    void strafInSlag;
    return maxBy(legaal, (c) => this.afgooiGevaar(c));
  }

  private isHoogSchoppen(c: Card): boolean {
    return c.id === QUEEN_SPADES_ID || c.id === KING_SPADES_ID || c.id === ACE_SPADES_ID;
  }

  private straf(c: Card): number {
    if (c.id === QUEEN_SPADES_ID) return this.variant.queenPenalty;
    if (c.suit === 'hearts') return this.variant.heartPenalty;
    return 0;
  }

  /** Bij afgooien: hoe graag lossen we deze kaart? ♠V eerst, dan hoge harten/schoppen. */
  private afgooiGevaar(c: Card): number {
    if (c.id === QUEEN_SPADES_ID) return 1000;
    if (c.id === ACE_SPADES_ID) return 900;
    if (c.id === KING_SPADES_ID) return 890;
    if (c.suit === 'hearts') return 100 + c.rank;
    return c.rank;
  }
}

// --- kleine helpers --------------------------------------------------------

function laagste(cards: Card[]): Card {
  return cards.reduce((a, b) => (b.rank < a.rank ? b : a));
}
function hoogste(cards: Card[]): Card {
  return cards.reduce((a, b) => (b.rank > a.rank ? b : a));
}
function maxBy(cards: Card[], score: (c: Card) => number): Card {
  return cards.reduce((a, b) => (score(b) > score(a) ? b : a));
}
