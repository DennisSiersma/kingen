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
 */
export interface PlayerController {
  readonly seat: Seat;
  readonly config: PlayerConfig;

  /** Kies een kaart uit view.legalCards. */
  chooseCard(view: PublicGameView): Promise<Card>;

  /** Kies troef (alleen gevraagd in troefrondes met vrije keuze). */
  chooseTrump(view: PublicGameView): Promise<Suit>;

  /**
   * Kies een speltype (alleen bij dubbel/vrij kingen, als deler).
   * `available` bevat de nog toegestane keuzes volgens de schrijver-administratie.
   */
  chooseRoundKind(view: PublicGameView, available: string[]): Promise<string>;

  /**
   * Optioneel (variant 'hand afleggen'): kies een kaart uit view.legalCards
   * óf claim de hand ('claim'). Alleen aangeroepen wanneer claimen nu een
   * legale zet is; controllers zonder deze methode kunnen niet claimen.
   */
  chooseCardOrClaim?(view: PublicGameView): Promise<Card | 'claim'>;
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
