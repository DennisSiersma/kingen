/**
 * src/core/gameRegistry.ts
 * Centraal register van speelbare spellen. Elk spel meldt zich aan met een
 * GameEntry (id, naam, spelersbereik, config-fabriek en GameDefinition-fabriek).
 * Server-zijde (GameHost, RoomManager) zoekt het spel op via getGame(); zo is
 * geen enkel onderdeel meer hardcoded aan Kingen gebonden.
 */

import type { GameDefinition } from './types.ts';

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
