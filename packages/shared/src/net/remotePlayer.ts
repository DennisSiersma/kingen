/**
 * @kingen/shared — net/remotePlayer.ts
 * PlayerController voor een speler buiten de engine: in plaats van lokaal te
 * beslissen, vraagt hij om een zet (requestMove) en wacht op het antwoord. Zo
 * draait de autoritatieve TurnManager (op de server óf in-browser) terwijl de
 * mens zijn eigen zetten bepaalt. Gedeeld door de server-room en de in-browser
 * LocalHostTransport.
 *
 * Reageert de speler niet binnen de zet-time-out (weg/verbinding kwijt), dan
 * speelt de host een veilige legale zet namens hem, zodat de tafel niet
 * vastloopt. Komt hij terug, dan speelt hij gewoon zijn volgende beurt zelf.
 */

import type { PlayerController } from '../core/player.ts';
import type { PlayerConfig, PublicGameView, Seat } from '../core/types.ts';

/** Spel-agnostisch zet-verzoek voor de client: hint + de legale zetten zelf. */
export interface MoveRequestPayload {
  moveType: string;
  legalMoves: unknown[];
  /** Eigen (geheime) view-extra's, bijv. Mexen's verborgen worp. Optioneel. */
  viewExtras?: unknown;
}

export interface RemotePlayerOpts {
  /** Time-out in ms; 0/undefined = geen automatische overname. */
  timeoutMs?: number;
  /** Aangeroepen wanneer de host een zet namens deze stoel speelt. */
  onTimeout?: (seat: Seat) => void;
}

interface Pending {
  resolve: (move: unknown) => void;
  /** Veilige standaardzet bij time-out (een legale zet). */
  fallback: unknown;
  timer: ReturnType<typeof setTimeout> | null;
}

export class RemotePlayerController implements PlayerController {
  readonly seat: Seat;
  readonly config: PlayerConfig;
  private readonly request: (payload: MoveRequestPayload) => void;
  private readonly opts: RemotePlayerOpts;
  private pending: Pending | null = null;
  private lastPayload: MoveRequestPayload | null = null;
  /** De zetten die nu aan de client zijn aangeboden (om het antwoord te valideren). */
  private pendingLegal: unknown[] = [];

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

  /**
   * Spel-onafhankelijke zetkeuze: vraag de client om een zet en wacht op het
   * antwoord. Bij time-out (speler weg) speelt de host de eerste legale zet.
   */
  chooseMove(view: PublicGameView, legalMoves: readonly unknown[]): Promise<unknown> {
    const moves = [...legalMoves];
    this.pendingLegal = moves;
    const moveType = (moves[0] as { type?: string } | undefined)?.type ?? 'move';
    this.vraag({ moveType, legalMoves: moves, viewExtras: view.viewExtras });
    const fallback = moves[0]; // eerste legale zet = veilige standaard
    return new Promise<unknown>((resolve) => {
      const timer =
        this.opts.timeoutMs && this.opts.timeoutMs > 0
          ? setTimeout(() => {
              if (!this.pending) return;
              this.pending = null;
              this.opts.onTimeout?.(this.seat);
              resolve(fallback);
            }, this.opts.timeoutMs)
          : null;
      this.pending = { resolve, fallback, timer };
    });
  }

  private vraag(payload: MoveRequestPayload): void {
    this.lastPayload = payload;
    this.request(payload);
  }

  /** Stuur het lopende zet-verzoek opnieuw (na een reconnect). */
  resend(): void {
    if (this.pending && this.lastPayload) this.request(this.lastPayload);
  }

  /**
   * Verwerk een binnengekomen moveRequest van de client. De zet moet exact één
   * van de aangeboden legale zetten zijn (waarde-vergelijking); zo niet, dan
   * wordt hij genegeerd. We resolven met het HOST-object zodat de engine
   * gegarandeerd een gevalideerde, legale zet toepast.
   */
  deliver(move: unknown): boolean {
    const p = this.pending;
    if (!p) return false;
    const gevraagd = JSON.stringify(move);
    const match = this.pendingLegal.find((lm) => JSON.stringify(lm) === gevraagd);
    if (match === undefined) return false;
    if (p.timer) clearTimeout(p.timer);
    this.pending = null;
    this.pendingLegal = [];
    p.resolve(match);
    return true;
  }

  get isWaiting(): boolean {
    return this.pending !== null;
  }
}
