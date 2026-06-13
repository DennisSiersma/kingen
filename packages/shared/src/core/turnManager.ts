/**
 * src/core/turnManager.ts
 * Spel-onafhankelijke spelloop: vraagt de GameDefinition wie aan zet is,
 * laat de juiste PlayerController kiezen, past de zet toe en publiceert de
 * resulterende events op de EventBus. Render/UI hangen aan de bus en kunnen
 * de loop pauzeren via een animatie-gate (afterEvent).
 *
 * Zet-conventie: de TurnManager is generiek. Hij vraagt elke controller om een
 * zet via de spel-onafhankelijke `chooseMove(view, legalMoves)`. Controllers die
 * die (nog) niet hebben — de Kingen legacy-controllers — worden afgehandeld via
 * dispatchKingenMove(), dat hun getypte methodes (chooseCard/chooseTrump/
 * chooseRoundKind/claim) op de zet-types { type, card/suit/kind } afbeeldt.
 */

import type { GameDefinition, GameEvent, PlayerConfig, PublicGameView, Seat } from './types.ts';
import type { GameEventBus } from './events.ts';
import { dispatchKingenMove, type MoveShape, type PlayerController } from './player.ts';

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
    view: PublicGameView,
    legal: MoveShape[],
  ): Promise<MoveShape> {
    const meldIllegal = (reason: string): void => {
      this.opts.bus.emit({ type: 'illegalMove', seat, reason });
    };

    // Canoniek pad: de controller kiest zelf een generieke zet.
    if (controller.chooseMove) {
      const chosen = (await controller.chooseMove(view, legal)) as MoveShape;
      if (legal.includes(chosen)) return chosen;
      meldIllegal('Ongeldige zet');
      return legal[0]!;
    }

    // Legacy (Kingen): vertaal via de getypte methodes.
    return dispatchKingenMove(controller, view, legal, meldIllegal);
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
