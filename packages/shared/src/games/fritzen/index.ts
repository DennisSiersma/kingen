/**
 * src/games/fritzen/index.ts
 * Registry-entry voor Fritzen (dobbelspel; ≥30 of ≤10 ogen, push-your-luck).
 */

import type { GameEntry } from '../../core/gameRegistry.ts';
import { createFritzenDefinition } from './engine.ts';
import { FritzenAi } from './ai.ts';
import { FRITZEN_DEFAULT } from './types.ts';
import type { FritzenMove, FritzenState, FritzenVariantConfig } from './types.ts';

type Entry = GameEntry<FritzenState, FritzenMove, FritzenVariantConfig>;

export const fritzenGame: Entry = {
  id: 'fritzen',
  naam: 'Fritzen',
  minPlayers: 2,
  maxPlayers: 8,
  configForPlayers: (players: number) => ({ ...FRITZEN_DEFAULT, playerCount: players }),
  createDefinition: () => createFritzenDefinition(),
  createAiController: (seat, config, player, thinkDelayMs) =>
    new FritzenAi(seat, player, config, thinkDelayMs),
};
