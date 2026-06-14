/**
 * @kingen/shared — net/gameHost.ts
 * Draait één autoritatieve partij van een willekeurig geregistreerd spel. Bouwt
 * per stoel een controller (RemotePlayerController voor mensen, per-spel AI of de
 * generieke AiPlayer voor computers), draait de gedeelde TurnManager met een
 * seed, en stuurt elk GameEvent door naar de host-laag (die per stoel
 * personaliseert — verborgen handen). Gebruikt door de server-room én de
 * in-browser LocalHostTransport (lokaal spelen tegen de computer).
 */

import { TurnManager } from '../core/turnManager.ts';
import { createGameEventBus } from '../core/events.ts';
import { AiPlayer, type PlayerController } from '../core/player.ts';
import { getStrategyForDifficulty } from '../ai/strategies.ts';
import { getGame } from '../core/gameRegistry.ts';
import type { GameDefinition, GameEvent, PlayerConfig, Seat } from '../core/types.ts';
import { RemotePlayerController, type MoveRequestPayload } from './remotePlayer.ts';

export interface GameHostDeps {
  roomId: string;
  players: PlayerConfig[];
  /** Welk spel deze tafel speelt (opgezocht in het GameRegistry). */
  gameId: string;
  /** Spel-specifieke config (variant), doorgegeven aan de TurnManager. */
  config: unknown;
  /** Stoelen die door een mens bespeeld worden (rest = AI). */
  humanSeats: Set<Seat>;
  /** Vraag de client op `seat` om een zet. */
  sendRequestMove: (seat: Seat, payload: MoveRequestPayload) => void;
  /** Eén GameEvent doorsturen naar de clients (host personaliseert per stoel). */
  forwardEvent: (event: GameEvent) => void;
  /** AI-denktijd (min,max) in ms; weglaten = natuurlijke default. [0,0] in tests. */
  aiThinkDelayMs?: [number, number];
  /** Zet-time-out per menselijke beurt (ms); daarna speelt de host veilig. */
  moveTimeoutMs?: number;
  /** Aangeroepen wanneer de host een zet namens een (weggelopen) speler speelt. */
  onMoveTimeout?: (seat: Seat) => void;
}

export class GameHost {
  private readonly remotes = new Map<Seat, RemotePlayerController>();
  private readonly manager;
  private readonly definition: GameDefinition<unknown, unknown, unknown>;
  private running = false;

  constructor(private readonly deps: GameHostDeps, seed: number) {
    const entry = getGame(deps.gameId);
    if (!entry) throw new Error(`Onbekend spel: ${deps.gameId}`);
    const definition = entry.createDefinition() as GameDefinition<unknown, unknown, unknown>;
    this.definition = definition;
    const bus = createGameEventBus();
    bus.onAny((ev) => this.deps.forwardEvent(ev));

    const controllers: PlayerController[] = deps.players.map((cfg, i) => {
      const seat = i as Seat;
      if (deps.humanSeats.has(seat)) {
        const rp = new RemotePlayerController(
          seat,
          cfg,
          (payload) => deps.sendRequestMove(seat, payload),
          { timeoutMs: deps.moveTimeoutMs, onTimeout: deps.onMoveTimeout },
        );
        this.remotes.set(seat, rp);
        return rp;
      }
      // Per-spel AI als de registry-entry die levert; anders de Kingen-AiPlayer.
      if (entry.createAiController) {
        return entry.createAiController(seat, deps.config, cfg, deps.aiThinkDelayMs);
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
      config: deps.config,
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

  /** Lever een client-zet af bij de juiste stoel (de controller valideert hem). */
  deliverMove(seat: Seat, move: unknown): boolean {
    return this.remotes.get(seat)?.deliver(move) ?? false;
  }

  /** Publieke view voor een stoel (voor een reconnect-snapshot), of null. */
  getView(seat: Seat) {
    const state = this.manager.getState();
    return state ? this.definition.getView(state, seat) : null;
  }

  /** Stuur het lopende zet-verzoek voor een stoel opnieuw (na reconnect). */
  resendRequest(seat: Seat): void {
    this.remotes.get(seat)?.resend();
  }
}
