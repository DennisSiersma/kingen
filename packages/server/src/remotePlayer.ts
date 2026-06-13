/**
 * @kingen/server — remotePlayer.ts
 * PlayerController voor een menselijke speler op afstand: in plaats van lokaal
 * te beslissen, vraagt hij de verbonden client om een zet (requestMove) en
 * wacht op het bijbehorende moveRequest-antwoord. Zo draait de autoritatieve
 * TurnManager op de server, maar bepaalt de mens zijn eigen zetten.
 */

import type { PlayerController } from '@kingen/shared/core/player.ts';
import type { Card, PlayerConfig, PublicGameView, Seat, Suit } from '@kingen/shared/core/types.ts';
import { SUITS } from '@kingen/shared/core/types.ts';

/** Wat de server naar de client stuurt om een zet te vragen. */
export interface MoveRequestPayload {
  moveType: 'card' | 'trump' | 'roundKind';
  legalCards?: Card[];
  legalSuits?: Suit[];
  legalKinds?: string[];
}

type Pending =
  | { type: 'card'; resolve: (card: Card) => void }
  | { type: 'trump'; resolve: (suit: Suit) => void }
  | { type: 'roundKind'; resolve: (kind: string) => void };

export class RemotePlayerController implements PlayerController {
  readonly seat: Seat;
  readonly config: PlayerConfig;
  private readonly request: (payload: MoveRequestPayload) => void;
  private pending: Pending | null = null;

  constructor(seat: Seat, config: PlayerConfig, request: (payload: MoveRequestPayload) => void) {
    this.seat = seat;
    this.config = config;
    this.request = request;
  }

  chooseCard(view: PublicGameView): Promise<Card> {
    this.request({ moveType: 'card', legalCards: view.legalCards });
    return new Promise<Card>((resolve) => {
      this.pending = { type: 'card', resolve };
    });
  }

  chooseTrump(_view: PublicGameView): Promise<Suit> {
    // In Kingen kiest de troefkiezer vrij uit alle vier de kleuren.
    this.request({ moveType: 'trump', legalSuits: [...SUITS] });
    return new Promise<Suit>((resolve) => {
      this.pending = { type: 'trump', resolve };
    });
  }

  chooseRoundKind(_view: PublicGameView, available: string[]): Promise<string> {
    this.request({ moveType: 'roundKind', legalKinds: available });
    return new Promise<string>((resolve) => {
      this.pending = { type: 'roundKind', resolve };
    });
  }

  /**
   * Verwerk een binnengekomen moveRequest van de client. Retourneert false als
   * er geen zet werd verwacht (genegeerd; de host kan dan een fout sturen).
   */
  deliver(move: { type?: string; card?: Card; suit?: Suit; kind?: string }): boolean {
    const p = this.pending;
    if (!p) return false;
    if (p.type === 'card' && move.card) {
      this.pending = null;
      p.resolve(move.card);
      return true;
    }
    if (p.type === 'trump' && move.suit) {
      this.pending = null;
      p.resolve(move.suit);
      return true;
    }
    if (p.type === 'roundKind' && move.kind) {
      this.pending = null;
      p.resolve(move.kind);
      return true;
    }
    return false;
  }

  /** Is deze speler op dit moment aan zet (wacht op een client-antwoord)? */
  get isWaiting(): boolean {
    return this.pending !== null;
  }
}
