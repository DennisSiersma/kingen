/**
 * @kingen/server — remotePlayer.ts
 * PlayerController voor een menselijke speler op afstand: in plaats van lokaal
 * te beslissen, vraagt hij de verbonden client om een zet (requestMove) en
 * wacht op het bijbehorende moveRequest-antwoord. Zo draait de autoritatieve
 * TurnManager op de server, maar bepaalt de mens zijn eigen zetten.
 *
 * Reageert de speler niet binnen de zet-time-out (weg/verbinding kwijt), dan
 * speelt de server een veilige legale zet namens hem, zodat de tafel niet
 * vastloopt. Komt hij terug, dan speelt hij gewoon zijn volgende beurt zelf.
 */

import type { PlayerController } from '@kingen/shared/core/player.ts';
import type { Card, PlayerConfig, PublicGameView, Seat, Suit } from '@kingen/shared/core/types.ts';
import { SUITS } from '@kingen/shared/core/types.ts';

export interface MoveRequestPayload {
  moveType: 'card' | 'trump' | 'roundKind';
  legalCards?: Card[];
  legalSuits?: Suit[];
  legalKinds?: string[];
}

export interface RemotePlayerOpts {
  /** Time-out in ms; 0/undefined = geen automatische overname. */
  timeoutMs?: number;
  /** Aangeroepen wanneer de server een zet namens deze stoel speelt. */
  onTimeout?: (seat: Seat) => void;
}

interface Pending {
  type: 'card' | 'trump' | 'roundKind';
  resolve: (value: Card | Suit | string) => void;
  /** Veilige standaardzet bij time-out. */
  fallback: Card | Suit | string;
  timer: ReturnType<typeof setTimeout> | null;
}

export class RemotePlayerController implements PlayerController {
  readonly seat: Seat;
  readonly config: PlayerConfig;
  private readonly request: (payload: MoveRequestPayload) => void;
  private readonly opts: RemotePlayerOpts;
  private pending: Pending | null = null;

  constructor(
    seat: Seat,
    config: PlayerConfig,
    request: (payload: MoveRequestPayload) => void,
    opts: RemotePlayerOpts = {},
  ) {
    this.seat = seat;
    this.config = config;
    this.request = request;
    this.opts = opts;
  }

  private wacht<T extends Card | Suit | string>(
    type: Pending['type'],
    fallback: T,
  ): Promise<T> {
    return new Promise<T>((resolve) => {
      const timer =
        this.opts.timeoutMs && this.opts.timeoutMs > 0
          ? setTimeout(() => {
              if (!this.pending) return;
              this.pending = null;
              this.opts.onTimeout?.(this.seat);
              resolve(fallback);
            }, this.opts.timeoutMs)
          : null;
      this.pending = { type, resolve: resolve as Pending['resolve'], fallback, timer };
    });
  }

  chooseCard(view: PublicGameView): Promise<Card> {
    this.request({ moveType: 'card', legalCards: view.legalCards });
    const veilig = view.legalCards[0]!; // er is altijd minstens één legale kaart
    return this.wacht<Card>('card', veilig);
  }

  chooseTrump(_view: PublicGameView): Promise<Suit> {
    this.request({ moveType: 'trump', legalSuits: [...SUITS] });
    return this.wacht<Suit>('trump', SUITS[0]!);
  }

  chooseRoundKind(_view: PublicGameView, available: string[]): Promise<string> {
    this.request({ moveType: 'roundKind', legalKinds: available });
    return this.wacht<string>('roundKind', available[0] ?? '');
  }

  /** Verwerk een binnengekomen moveRequest van de client. */
  deliver(move: { type?: string; card?: Card; suit?: Suit; kind?: string }): boolean {
    const p = this.pending;
    if (!p) return false;
    let waarde: Card | Suit | string | undefined;
    if (p.type === 'card' && move.card) waarde = move.card;
    else if (p.type === 'trump' && move.suit) waarde = move.suit;
    else if (p.type === 'roundKind' && move.kind) waarde = move.kind;
    if (waarde === undefined) return false;
    if (p.timer) clearTimeout(p.timer);
    this.pending = null;
    p.resolve(waarde);
    return true;
  }

  get isWaiting(): boolean {
    return this.pending !== null;
  }
}
