/**
 * src/core/turnManager.ts
 * Spel-onafhankelijke spelloop: vraagt de GameDefinition wie aan zet is,
 * laat de juiste PlayerController kiezen, past de zet toe en publiceert de
 * resulterende events op de EventBus. Render/UI hangen aan de bus en kunnen
 * de loop pauzeren via een animatie-gate (afterEvent).
 *
 * Zet-conventie: de TurnManager is generiek, maar verwacht voor slagenspellen
 * dat zetten objecten zijn met een `type`-veld:
 *   { type: 'playCard', card }  { type: 'chooseTrump', suit }
 *   { type: 'chooseRoundKind', kind }  en optioneel andere typen.
 * Op basis daarvan wordt de juiste PlayerController-methode aangeroepen.
 */

import type { Card, GameDefinition, GameEvent, PlayerConfig, Seat, Suit } from './types.ts';
import type { GameEventBus } from './events.ts';
import type { PlayerController } from './player.ts';

export interface TurnManagerOptions<TState, TMove, TConfig> {
  definition: GameDefinition<TState, TMove, TConfig>;
  players: PlayerConfig[];
  config: TConfig;
  controllers: PlayerController[]; // index = Seat
  bus: GameEventBus;
  /** Deterministische seed voor het schudden (replay/netwerk). */
  seed?: number;
  /**
   * Optionele gate: wordt na elk event ge-await zodat render-animaties
   * (delen, spelen, slag innemen) kunnen afronden vóór de volgende zet.
   */
  afterEvent?: (event: GameEvent) => Promise<void>;
}

/** Structurele blik op een zet (zie zet-conventie hierboven). */
interface MoveShape {
  type: string;
  card?: Card;
  suit?: Suit;
  kind?: string;
}

export class TurnManager<TState, TMove, TConfig> {
  private readonly opts: TurnManagerOptions<TState, TMove, TConfig>;
  private state: TState | null = null;
  private stopped = false;

  constructor(options: TurnManagerOptions<TState, TMove, TConfig>) {
    this.opts = options;
  }

  private async publish(event: GameEvent): Promise<void> {
    this.opts.bus.emit(event);
    if (this.opts.afterEvent) await this.opts.afterEvent(event);
  }

  /** Start de partij en speelt door tot het einde (of tot stop()). */
  async run(): Promise<void> {
    const def = this.opts.definition;
    this.stopped = false;

    let state = def.createInitialState(this.opts.players, this.opts.config, this.opts.seed);
    this.state = state;

    for (const event of def.initialEvents(state)) {
      if (this.stopped) return;
      await this.publish(event);
    }

    while (!this.stopped && !def.isFinished(state)) {
      const actor = def.currentActor(state);
      if (actor === null) return; // niets te doen (extern gestuurd of klaar)

      const controller = this.opts.controllers[actor];
      if (!controller) throw new Error(`Geen PlayerController voor stoel ${actor}`);

      const view = def.getView(state, actor);
      const legal = def.getLegalMoves(state, actor);
      if (legal.length === 0) {
        throw new Error(`Stoel ${actor} is aan zet maar heeft geen legale zetten`);
      }
      const shaped = legal as unknown as MoveShape[];

      const move = await this.pickMove(actor, controller, view, shaped);
      if (this.stopped) return;

      const result = def.applyMove(state, actor, move as unknown as TMove);
      state = result.state;
      this.state = state;

      for (const event of result.events) {
        if (this.stopped) return;
        await this.publish(event);
      }
    }
  }

  private async pickMove(
    seat: Seat,
    controller: PlayerController,
    view: Parameters<PlayerController['chooseCard']>[0],
    legal: MoveShape[],
  ): Promise<MoveShape> {
    const cardMoves = legal.filter((m) => m.type === 'playCard');
    if (cardMoves.length > 0) {
      const claimMove = legal.find((m) => m.type === 'claimHand');
      let card: Card;
      if (claimMove && controller.chooseCardOrClaim) {
        // Variant 'hand afleggen': de controller mag kiezen tussen een kaart
        // spelen en claimen (AI via strategy.shouldClaim, mens via de HUD-knop).
        const keuze = await controller.chooseCardOrClaim(view);
        if (keuze === 'claim') return claimMove;
        card = keuze;
      } else {
        card = await controller.chooseCard(view);
      }
      const move = cardMoves.find((m) => m.card?.id === card.id);
      if (move) return move;
      this.opts.bus.emit({
        type: 'illegalMove',
        seat,
        reason: `Kaart ${card.id} is hier niet toegestaan`,
      });
      return cardMoves[0]!;
    }

    if (legal.every((m) => m.type === 'chooseTrump')) {
      const suit = await controller.chooseTrump(view);
      const move = legal.find((m) => m.suit === suit);
      if (move) return move;
      this.opts.bus.emit({
        type: 'illegalMove',
        seat,
        reason: `Troefkeuze ${String(suit)} is hier niet toegestaan`,
      });
      return legal[0]!;
    }

    if (legal.every((m) => m.type === 'chooseRoundKind')) {
      const available = legal.map((m) => m.kind!).filter((k) => k !== undefined);
      const kind = await controller.chooseRoundKind(view, available);
      const move = legal.find((m) => m.kind === kind);
      if (move) return move;
      this.opts.bus.emit({
        type: 'illegalMove',
        seat,
        reason: `Spelkeuze ${kind} is hier niet toegestaan`,
      });
      return legal[0]!;
    }

    // Onbekend zet-type: neem de eerste legale zet (failsafe).
    return legal[0]!;
  }

  /** Onderbreek de partij netjes (terug naar setup). */
  stop(): void {
    this.stopped = true;
  }

  /** Huidige actor (stoel die aan zet is), of null. */
  getCurrentActor(): Seat | null {
    return this.state === null ? null : this.opts.definition.currentActor(this.state);
  }

  /** Huidige (geheime) spelstate, of null vóór de start. Voor host-snapshots. */
  getState(): TState | null {
    return this.state;
  }
}
