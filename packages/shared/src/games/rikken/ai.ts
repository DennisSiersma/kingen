/**
 * src/games/rikken/ai.ts
 * Heuristische Rikken-AI (v1, "heuristiek-eerst"). Behandelt alle fasen:
 *  - BIEDEN: slagschatting per kleur; conservatief rik bij ~6 eigen zekere slagen
 *    (+ de maat), piek bij een exact-1-hand, misère bij een veilige lage hand,
 *    anders passen. Opboden alleen voor een solo-N die we echt kunnen maken.
 *  - TROEFKEUZE: langste/sterkste kleur. MAAT: aas van de kleur waarin we het
 *    sterkst zijn (controle). PASSSPEL: 1-of-5 als we ♠V hebben, anders Schoppen Mie.
 *  - SPELEN: rol-bewust — declarer/maat proberen slagen te winnen (troef trekken,
 *    azen cashen, goedkoop winnen); verdedigers ontkennen en spelen de gevraagde
 *    aas uit om de maat te forceren; misère/piek/passspel duiken (niet winnen).
 *
 * Een determinisatie/ISMCTS-versie kan later 'moeilijk' upgraden (zie [[rikken-spec]]).
 */

import type { PlayerController } from '../../core/player.ts';
import type { Card, PlayerConfig, PublicGameView, Rank, Seat, Suit } from '../../core/types.ts';
import { SUITS } from '../../core/types.ts';
import { trickWinner } from '../../core/deck.ts';
import { snelheidsFactor } from '../../core/speed.ts';
import { isMisereFamilie, isPiekFamilie, type BidKind } from './bids.ts';
import type { RikkenMove, RikkenVariantConfig } from './types.ts';

type Play = { seat: Seat; card: Card };
type ContractView = {
  kind: BidKind;
  declarer: Seat;
  trump: Suit | null;
  askedSuit?: Suit;
  askedAceId?: string;
  partner: Seat | null;
  passGame?: 'schoppenMie' | 'eenOfVijf';
} | null;

export class RikkenAi implements PlayerController {
  readonly seat: Seat;
  readonly config: PlayerConfig;
  private readonly thinkDelayMs: [number, number];

  constructor(seat: Seat, player: PlayerConfig, _variant: RikkenVariantConfig, thinkDelayMs: [number, number] = [400, 1100]) {
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
    const moves = legalMoves as RikkenMove[];
    if (moves.length <= 1) return moves[0];
    switch (moves[0]!.type) {
      case 'bid':
        return this.kiesBod(view, moves);
      case 'chooseTrump':
        return this.kiesTroef(view, moves);
      case 'askAce':
        return this.kiesMaat(view, moves);
      case 'choosePassGame':
        return this.kiesPassspel(view, moves);
      default:
        return this.kiesSpeelkaart(view, moves);
    }
  }

  // --- Bieden -------------------------------------------------------------

  private kiesBod(view: PublicGameView, moves: RikkenMove[]): RikkenMove {
    const hand = view.hand;
    const pass = moves.find((m) => m.type === 'bid' && m.bid === 'pass')!;
    const vindBod = (kind: BidKind) =>
      moves.find((m) => m.type === 'bid' && m.bid !== 'pass' && (m.bid as { kind: BidKind }).kind === kind);

    const rik = vindBod('rik');
    const piek = vindBod('piek');
    const misere = vindBod('misere');
    const opening = rik !== undefined; // rik wordt alleen aan de opener aangeboden

    const beste = this.besteTroef(hand);
    const estTroef = this.schatSlagen(hand, beste);

    const troefLengte = hand.filter((c) => c.suit === beste).length;
    if (opening) {
      // Rik is het hoofdcontract: sterke hand mét lange troef (de maat is
      // grotendeels onbekend, dus de bieder levert zelf het leeuwendeel van de 8).
      if (rik && troefLengte >= 5 && estTroef >= 4.5) return rik;
      // Misère/piek zijn lastig heuristisch te spelen → alleen op een zeer geschikte
      // hand bieden (anders gaan ze te vaak nat).
      if (misere && this.misereVeilig(hand)) return misere;
      if (piek && this.piekHand(hand)) return piek;
      return pass;
    }

    // Opbod aangeboden: conservatief. Alleen een solo-N pakken die we echt maken.
    const opbod = moves.find((m) => m.type === 'bid' && m.bid !== 'pass');
    if (opbod && opbod.type === 'bid' && opbod.bid !== 'pass') {
      const kind = (opbod.bid as { kind: BidKind }).kind;
      const m = /^alleen(\d+)$/.exec(kind);
      if (m) {
        const doel = Number(m[1]);
        if (estTroef >= doel + 0.5) return opbod; // we kunnen N alleen halen
      }
    }
    return pass;
  }

  /** Ruwe slagschatting voor een hand met `trump` als troef (null = troefloos). */
  private schatSlagen(hand: readonly Card[], trump: Suit | null): number {
    let t = 0;
    const troefLengte = trump ? hand.filter((c) => c.suit === trump).length : 0;
    for (const suit of SUITS) {
      const cards = hand.filter((c) => c.suit === suit);
      const len = cards.length;
      const heeft = (r: Rank) => cards.some((c) => c.rank === r);
      if (heeft(14)) t += 0.95; // aas
      if (heeft(13)) t += len >= 2 ? 0.55 : 0.2; // heer (kwetsbaar indien blank)
      if (heeft(12)) t += len >= 3 ? 0.3 : 0.05; // vrouw
      if (heeft(11)) t += len >= 4 ? 0.15 : 0; // boer
      if (suit === trump) {
        t += Math.max(0, len - 4) * 0.6; // extra lange troef (>4)
      } else if (trump && len <= 1 && troefLengte >= 5) {
        t += len === 0 ? 0.6 : 0.3; // korte zijkleur → aftroefkans (alleen met veel troef)
      }
    }
    return t;
  }

  private besteTroef(hand: readonly Card[]): Suit {
    let beste: Suit = 'clubs';
    let besteScore = -1;
    for (const suit of SUITS) {
      const cards = hand.filter((c) => c.suit === suit);
      const score = cards.length * 3 + cards.reduce((s, c) => s + Math.max(0, c.rank - 10), 0);
      if (score > besteScore) {
        besteScore = score;
        beste = suit;
      }
    }
    return beste;
  }

  // Misère/piek zijn met een pure heuristiek moeilijk foutloos te spelen, dus we
  // bieden ze alleen op een (zeldzame) bijna-zekere hand. Een determinisatie/ISMCTS-
  // upgrade kan deze drempels later flink verlagen (zie [[rikken-spec]]).
  private misereVeilig(hand: readonly Card[]): boolean {
    const azen = hand.filter((c) => c.rank === 14).length;
    const heren = hand.filter((c) => c.rank === 13).length;
    const laag = hand.filter((c) => c.rank <= 7).length;
    return azen === 0 && heren === 0 && laag >= 9;
  }

  private piekHand(hand: readonly Card[]): boolean {
    const azen = hand.filter((c) => c.rank === 14).length;
    const heren = hand.filter((c) => c.rank === 13).length;
    const vrouwen = hand.filter((c) => c.rank === 12).length;
    const laag = hand.filter((c) => c.rank <= 7).length;
    return azen === 1 && heren === 0 && vrouwen === 0 && laag >= 10;
  }

  // --- Troef / maat / passspel -------------------------------------------

  private kiesTroef(view: PublicGameView, moves: RikkenMove[]): RikkenMove {
    const suit = this.besteTroef(view.hand);
    return moves.find((m) => m.type === 'chooseTrump' && m.suit === suit) ?? moves[0]!;
  }

  private kiesMaat(view: PublicGameView, moves: RikkenMove[]): RikkenMove {
    const hand = view.hand;
    const score = (cardId: string): number => {
      const sep = cardId.lastIndexOf('-');
      const suit = cardId.slice(0, sep) as Suit;
      const len = hand.filter((c) => c.suit === suit).length;
      const heer = hand.some((c) => c.id === `${suit}-13`);
      return len * 2 + (heer ? 3 : 0);
    };
    const askMoves = moves.filter((m) => m.type === 'askAce') as Extract<RikkenMove, { type: 'askAce' }>[];
    return askMoves.reduce((a, b) => (score(b.cardId) > score(a.cardId) ? b : a), askMoves[0]!);
  }

  private kiesPassspel(view: PublicGameView, moves: RikkenMove[]): RikkenMove {
    // Schoppen Mie is met duiken doorgaans beter te overleven dan 1-of-5 (exact
    // 1 of 5). Alleen met de ♠V én veel hoge schoppen → eerder 1-of-5.
    const schoppen = view.hand.filter((c) => c.suit === 'spades');
    const risico = schoppen.some((c) => c.id === 'spades-12') && schoppen.filter((c) => c.rank >= 12).length >= 2;
    const keuze = risico ? 'eenOfVijf' : 'schoppenMie';
    return moves.find((m) => m.type === 'choosePassGame' && m.game === keuze) ?? moves[0]!;
  }

  // --- Spelen -------------------------------------------------------------

  private kiesSpeelkaart(view: PublicGameView, moves: RikkenMove[]): RikkenMove {
    const legaal = moves.flatMap((m) => (m.type === 'playCard' ? [m.card] : []));
    const gekozen = this.besteSpeelkaart(view, legaal);
    return moves.find((m) => m.type === 'playCard' && m.card.id === gekozen.id) ?? moves[0]!;
  }

  private besteSpeelkaart(view: PublicGameView, legaal: Card[]): Card {
    if (legaal.length === 1) return legaal[0]!;
    const trump = view.round.trump;
    const seat = view.seat;
    const plays = (view.currentTrick?.plays ?? []) as Play[];
    const c = (view.viewExtras as { contract?: ContractView }).contract ?? null;
    const hand = view.hand;

    const wint = (card: Card): boolean => trickWinner([...plays, { seat, card }], trump) === seat;
    const isTrump = (card: Card) => trump !== null && card.suit === trump;

    // Rol bepalen.
    const declarer = !!c && c.declarer === seat;
    const maat = !!c && !!c.askedAceId && hand.some((k) => k.id === c.askedAceId);
    const team = declarer || maat;
    const isMisere = !!c && isMisereFamilie(c.kind);
    const isPiek = !!c && isPiekFamilie(c.kind);
    const isPass = !!c?.passGame;

    // Wil ik deze slag winnen?
    const wilWinnen = isPass ? false : declarer && (isMisere || isPiek) ? false : isMisere && !team ? false : true;

    // --- Uitkomen ---
    if (plays.length === 0) {
      if (!wilWinnen) return laagste(legaal); // misère/piek/passspel: laag uitkomen
      // Verdediger: speel de gevraagde-aas-kleur uit om de maat te forceren.
      if (!team && c?.askedSuit && !c.partner) {
        const aasKleur = legaal.filter((k) => k.suit === c.askedSuit);
        if (aasKleur.length > 0) return laagste(aasKleur);
      }
      // Declarer met troefcontrole: troef trekken (hoog).
      if (declarer && trump) {
        const troef = legaal.filter((k) => k.suit === trump);
        const handTroef = hand.filter((k) => k.suit === trump);
        if (troef.length > 0 && (handTroef.length >= 4 || handTroef.some((k) => k.rank === 14))) {
          return hoogste(troef);
        }
      }
      // Anders: cash een niet-troef-aas, of speel laag.
      const azen = legaal.filter((k) => !isTrump(k) && k.rank === 14);
      if (azen.length > 0) return azen[0]!;
      return laagste(legaal);
    }

    // --- Volgen ---
    const winners = legaal.filter(wint);
    if (wilWinnen) {
      if (winners.length > 0) return goedkoopsteWinner(winners, trump); // goedkoop winnen
      return laagste(legaal); // niet kunnen winnen → laag duiken, hoog bewaren
    }
    // Niet willen winnen: gooi de hoogste kaart die NIET wint (hoog veilig lossen).
    const verliezers = legaal.filter((k) => !wint(k));
    if (verliezers.length > 0) return hoogste(verliezers);
    return laagste(legaal); // gedwongen te winnen → zo goedkoop mogelijk
  }
}

// --- helpers ---------------------------------------------------------------

// Beginwaarde cards[0] zodat een (in de praktijk onbereikbare) lege array niet
// "Reduce of empty array" gooit.
function laagste(cards: Card[]): Card {
  return cards.reduce((a, b) => (b.rank < a.rank ? b : a), cards[0]!);
}
function hoogste(cards: Card[]): Card {
  return cards.reduce((a, b) => (b.rank > a.rank ? b : a), cards[0]!);
}
/** Goedkoopste winnende kaart: liefst een lage niet-troef, anders de laagste troef. */
function goedkoopsteWinner(winners: Card[], trump: Suit | null): Card {
  const score = (c: Card) => (trump !== null && c.suit === trump ? 100 : 0) + c.rank;
  return winners.reduce((a, b) => (score(b) < score(a) ? b : a));
}
