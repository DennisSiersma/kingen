/**
 * src/core/gameRegistry.ts
 * Centraal register van speelbare spellen. Elk spel meldt zich aan met een
 * GameEntry (id, naam, spelersbereik, config-fabriek en GameDefinition-fabriek).
 * Server-zijde (GameHost, RoomManager) zoekt het spel op via getGame(); zo is
 * geen enkel onderdeel meer hardcoded aan Kingen gebonden.
 */

import type { GameDefinition, PlayerConfig, Seat } from './types.ts';
import type { PlayerController } from './player.ts';

export interface GameEntry<TState = unknown, TMove = unknown, TConfig = unknown> {
  /** Uniek id, bijv. 'kingen', 'hartenjagen'. */
  readonly id: string;
  /** Weergavenaam (NL) voor de lobby. */
  readonly naam: string;
  readonly minPlayers: number;
  readonly maxPlayers: number;
  /** Bouw de config voor een tafel met `players` spelers (binnen [min,max]). */
  configForPlayers(players: number): TConfig;
  /** Maak een verse GameDefinition voor dit spel. */
  createDefinition(): GameDefinition<TState, TMove, TConfig>;
  /**
   * Optioneel: maak de AI-controller voor een computerstoel. Ontbreekt deze,
   * dan valt GameHost terug op de generieke Kingen-AiPlayer. Spellen met eigen
   * zet-types (Hartenjagen: passCards) leveren hier hun eigen heuristiek.
   */
  createAiController?(
    seat: Seat,
    config: TConfig,
    player: PlayerConfig,
    thinkDelayMs?: [number, number],
  ): PlayerController;
}

const registry = new Map<string, GameEntry>();

/** Registreer (of overschrijf) een spel. */
export function registerGame(entry: GameEntry): void {
  registry.set(entry.id, entry);
}

/** Zoek een spel op id, of undefined. */
export function getGame(id: string): GameEntry | undefined {
  return registry.get(id);
}

/** Alle geregistreerde spellen. */
export function listGames(): GameEntry[] {
  return [...registry.values()];
}
