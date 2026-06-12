/**
 * src/ai/types.ts
 * Contract voor computerspeler-strategieën. Een strategie ziet UITSLUITEND de
 * PublicGameView (eigen hand + openbare informatie) — nooit de volledige state.
 */

import type { Card, PublicGameView, Suit } from '../core/types.ts';
import type { KingenRoundKind } from '../games/kingen/types.ts';

/** Moeilijkheidsgraad zoals gekozen op het setup-scherm. */
export type AiDifficulty = 'makkelijk' | 'gemiddeld' | 'moeilijk';

/**
 * Een AI-strategie. Mag synchroon of asynchroon antwoorden (Promise), zodat
 * zwaardere strategieën (simulaties) niet de main thread blokkeren.
 * INVARIANT: chooseCard retourneert altijd een element uit view.legalCards.
 */
export interface AiStrategy {
  /** Uniek id, bijv. 'random', 'heuristisch', 'simulatie'. */
  readonly id: string;
  /** Nederlandse naam voor de UI, bijv. 'Eenvoudig'. */
  readonly naam: string;
  readonly difficulty: AiDifficulty;

  /** Kies een kaart uit view.legalCards (view.turn === view.seat is gegarandeerd). */
  chooseCard(view: PublicGameView): Card | Promise<Card>;

  /** Kies een troefkleur uit `legal` (troefronde, deze stoel mag kiezen). */
  chooseTrump(view: PublicGameView, legal: Suit[]): Suit | Promise<Suit>;

  /** Dubbelkingen: kies een speltype uit de nog toegestane `available`. */
  chooseRoundKind(view: PublicGameView, available: KingenRoundKind[]): KingenRoundKind | Promise<KingenRoundKind>;

  /** Optioneel (variant 'hand afleggen'): wil deze AI nu claimen? */
  shouldClaim?(view: PublicGameView): boolean | Promise<boolean>;
}

/** Vind de standaardstrategie bij een moeilijkheidsgraad. */
export type StrategyFactory = (difficulty: AiDifficulty) => AiStrategy;
