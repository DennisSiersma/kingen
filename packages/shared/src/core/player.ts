/**
 * src/core/player.ts
 * Speler-abstractie: mens (LokaleMens in main.ts, wacht op UI-input) of AI
 * (AiPlayer hieronder, vraagt strategie). De TurnManager praat uitsluitend met
 * dit interface; waar de beslissing vandaan komt (UI, AI, of later: netwerk)
 * is voor hem onzichtbaar.
 */

import type { Card, PlayerConfig, PublicGameView, Seat, Suit } from './types.ts';
import { SUITS } from './types.ts';
import { snelheidsFactor } from './speed.ts';
import type { AiStrategy } from '../ai/types.ts';

/**
 * Een beslissingsbron voor één stoel. Alle methodes krijgen de PublicGameView
 * (nooit de volledige state) en geven asynchroon een keuze terug.
 *
 * Spel-onafhankelijk contract: `chooseMove` is de canonieke methode — de
 * TurnManager geeft de legale zetten mee en verwacht er één terug. Nieuwe
 * spellen implementeren ALLEEN `chooseMove`. De Kingen-controllers gebruiken
 * (nog) de getypte legacy-methodes hieronder; `dispatchKingenMove()` vertaalt
 * die naar het generieke contract. Die methodes zijn daarom optioneel.
 */
export interface PlayerController {
  readonly seat: Seat;
  readonly config: PlayerConfig;

  /**
   * Canonieke, spel-onafhankelijke zetkeuze. Krijgt de legale zetten (zoals
   * GameDefinition.getLegalMoves teruggeeft) en retourneert er één — bij
   * voorkeur reference-gelijk aan een element uit `legalMoves`. Ontbreekt deze
   * methode, dan valt de TurnManager terug op de Kingen legacy-methodes.
   */
  chooseMove?(view: PublicGameView, legalMoves: readonly unknown[]): Promise<unknown>;

  /** Legacy (Kingen): kies een kaart uit view.legalCards. */
  chooseCard?(view: PublicGameView): Promise<Card>;

  /** Legacy (Kingen): kies troef (alleen in troefrondes met vrije keuze). */
  chooseTrump?(view: PublicGameView): Promise<Suit>;

  /**
   * Legacy (Kingen): kies een speltype (alleen bij dubbel/vrij kingen, als deler).
   * `available` bevat de nog toegestane keuzes volgens de schrijver-administratie.
   */
  chooseRoundKind?(view: PublicGameView, available: string[]): Promise<string>;

  /**
   * Legacy (Kingen, variant 'hand afleggen'): kies een kaart uit view.legalCards
   * óf claim de hand ('claim'). Alleen aangeroepen wanneer claimen nu een
   * legale zet is; controllers zonder deze methode kunnen niet claimen.
   */
  chooseCardOrClaim?(view: PublicGameView): Promise<Card | 'claim'>;
}

/** Structurele blik op een Kingen-zet (zie zet-conventie in turnManager.ts). */
export interface MoveShape {
  type: string;
  card?: Card;
  suit?: Suit;
  kind?: string;
}

/**
 * Vertaalt het Kingen-zettenpalet (playCard/claimHand/chooseTrump/chooseRoundKind)
 * naar het generieke contract door de legacy-methodes van een controller aan te
 * roepen. Eén centrale plek voor de Kingen-specifieke move-dispatch, gebruikt
 * door zowel AiPlayer.chooseMove als de TurnManager-fallback. `onIllegal` wordt
 * aangeroepen als de controller een hier niet-toegestane keuze teruggeeft (de
 * aanroeper kan dan een illegalMove-event emitten); er wordt altijd een veilige
 * legale zet teruggegeven.
 */
export async function dispatchKingenMove(
  controller: PlayerController,
  view: PublicGameView,
  legal: readonly MoveShape[],
  onIllegal?: (reason: string) => void,
): Promise<MoveShape> {
  const cardMoves = legal.filter((m) => m.type === 'playCard');
  if (cardMoves.length > 0) {
    const claimMove = legal.find((m) => m.type === 'claimHand');
    let card: Card;
    if (claimMove && controller.chooseCardOrClaim) {
      const keuze = await controller.chooseCardOrClaim(view);
      if (keuze === 'claim') return claimMove;
      card = keuze;
    } else {
      card = await controller.chooseCard!(view);
    }
    const move = cardMoves.find((m) => m.card?.id === card.id);
    if (move) return move;
    onIllegal?.(`Kaart ${card.id} is hier niet toegestaan`);
    return cardMoves[0]!;
  }

  if (legal.every((m) => m.type === 'chooseTrump')) {
    const suit = await controller.chooseTrump!(view);
    const move = legal.find((m) => m.suit === suit);
    if (move) return move;
    onIllegal?.(`Troefkeuze ${String(suit)} is hier niet toegestaan`);
    return legal[0]!;
  }

  if (legal.every((m) => m.type === 'chooseRoundKind')) {
    const available = legal.map((m) => m.kind!).filter((k) => k !== undefined);
    const kind = await controller.chooseRoundKind!(view, available);
    const move = legal.find((m) => m.kind === kind);
    if (move) return move;
    onIllegal?.(`Spelkeuze ${kind} is hier niet toegestaan`);
    return legal[0]!;
  }

  // Onbekend zet-type: neem de eerste legale zet (failsafe).
  return legal[0]!;
}

/**
 * AI-speler: delegeert naar een AiStrategy (src/ai), eventueel met een kleine
 * denkvertraging zodat het spel natuurlijk aanvoelt.
 */
export class AiPlayer implements PlayerController {
  readonly seat: Seat;
  readonly config: PlayerConfig;

  private readonly strategy: AiStrategy;
  private readonly thinkDelayMs: [number, number];

  constructor(
    seat: Seat,
    config: PlayerConfig,
    /** Strategie-object uit src/ai; zie src/ai/types.ts AiStrategy. */
    strategy: AiStrategy,
    /** Denkvertraging in ms (min, max). Default [400, 1100]; [0, 0] voor tests. */
    thinkDelayMs: [number, number] = [400, 1100],
  ) {
    this.seat = seat;
    this.config = config;
    this.strategy = strategy;
    this.thinkDelayMs = thinkDelayMs;
  }

  private async think(): Promise<void> {
    const [min, max] = this.thinkDelayMs;
    // De globale speelsnelheid schaalt de denktijd mee (instelbaar in de UI).
    const ms = (min + Math.random() * Math.max(0, max - min)) * snelheidsFactor();
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Generieke zetkeuze: vertaalt via de gedeelde Kingen-dispatch naar de
   * strategie-methodes (chooseCard/chooseTrump/chooseRoundKind/claim), met
   * denkvertraging. De AI respecteert de legalCards-invariant, dus een illegale
   * keuze treedt in de praktijk niet op.
   */
  chooseMove(view: PublicGameView, legalMoves: readonly unknown[]): Promise<unknown> {
    return dispatchKingenMove(this, view, legalMoves as readonly MoveShape[]);
  }

  async chooseCard(view: PublicGameView): Promise<Card> {
    await this.think();
    return this.strategy.chooseCard(view);
  }

  /** Variant 'hand afleggen': claim als de strategie dat wil, anders een kaart. */
  async chooseCardOrClaim(view: PublicGameView): Promise<Card | 'claim'> {
    await this.think();
    if (this.strategy.shouldClaim && (await this.strategy.shouldClaim(view))) {
      return 'claim';
    }
    return this.strategy.chooseCard(view);
  }

  async chooseTrump(view: PublicGameView): Promise<Suit> {
    await this.think();
    // De enige beperkte modus ('laatsteKaart') vraagt nooit om een keuze,
    // dus alle vier de kleuren zijn hier legaal.
    return this.strategy.chooseTrump(view, [...SUITS]);
  }

  async chooseRoundKind(view: PublicGameView, available: string[]): Promise<string> {
    await this.think();
    return this.strategy.chooseRoundKind(
      view,
      available as Parameters<AiStrategy['chooseRoundKind']>[1],
    );
  }
}
