/**
 * @kingen/server — gameHost.ts
 * Draait één autoritatieve Kingen-partij voor een room. Bouwt per stoel een
 * controller (RemotePlayerController voor mensen, AiPlayer voor computers),
 * draait de gedeelde TurnManager met een server-seed, en stuurt elk GameEvent
 * door naar de clients (de room personaliseert per stoel — verborgen handen).
 */

import { TurnManager } from '@kingen/shared/core/turnManager.ts';
import { createGameEventBus } from '@kingen/shared/core/events.ts';
import { AiPlayer, type PlayerController } from '@kingen/shared/core/player.ts';
import { getStrategyForDifficulty } from '@kingen/shared/ai/strategies.ts';
import { createKingenDefinition } from '@kingen/shared/games/kingen/engine.ts';
import type { KingenVariantConfig } from '@kingen/shared/games/kingen/types.ts';
import type { Card, GameEvent, PlayerConfig, Seat, Suit } from '@kingen/shared/core/types.ts';
import { RemotePlayerController, type MoveRequestPayload } from './remotePlayer.ts';

export interface GameHostDeps {
  roomId: string;
  players: PlayerConfig[];
  variant: KingenVariantConfig;
  /** Stoelen die door een mens bespeeld worden (rest = AI). */
  humanSeats: Set<Seat>;
  /** Vraag de client op `seat` om een zet. */
  sendRequestMove: (seat: Seat, payload: MoveRequestPayload) => void;
  /** Eén GameEvent doorsturen naar de clients (room personaliseert per stoel). */
  forwardEvent: (event: GameEvent) => void;
  /** AI-denktijd (min,max) in ms; weglaten = natuurlijke default. [0,0] in tests. */
  aiThinkDelayMs?: [number, number];
}

export class GameHost {
  private readonly remotes = new Map<Seat, RemotePlayerController>();
  private readonly manager;
  private running = false;

  constructor(private readonly deps: GameHostDeps, seed: number) {
    const definition = createKingenDefinition();
    const bus = createGameEventBus();
    bus.onAny((ev) => this.deps.forwardEvent(ev));

    const controllers: PlayerController[] = deps.players.map((cfg, i) => {
      const seat = i as Seat;
      if (deps.humanSeats.has(seat)) {
        const rp = new RemotePlayerController(seat, cfg, (payload) =>
          deps.sendRequestMove(seat, payload),
        );
        this.remotes.set(seat, rp);
        return rp;
      }
      return new AiPlayer(
        seat,
        cfg,
        getStrategyForDifficulty(cfg.aiDifficulty ?? 'gemiddeld'),
        deps.aiThinkDelayMs,
      );
    });

    this.manager = new TurnManager({
      definition,
      players: deps.players,
      config: deps.variant,
      controllers,
      bus,
      seed,
    });
  }

  /** Start de partij; resolved wanneer de partij klaar is (of gestopt). */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.manager.run();
  }

  stop(): void {
    this.manager.stop();
  }

  /** Lever een client-zet af bij de juiste stoel. */
  deliverMove(seat: Seat, move: { type?: string; card?: Card; suit?: Suit; kind?: string }): boolean {
    return this.remotes.get(seat)?.deliver(move) ?? false;
  }
}
