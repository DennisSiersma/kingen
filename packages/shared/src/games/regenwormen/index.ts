/**
 * src/games/regenwormen/index.ts
 * Registry-entry voor Regenwormen (Heckmeck am Bratwurmeck / Pickomino).
 */

import type { GameEntry } from '../../core/gameRegistry.ts';
import { createRegenwormenDefinition } from './engine.ts';
import { RegenwormenAi } from './ai.ts';
import { REGENWORMEN_DEFAULT } from './types.ts';
import type { RegenwormenMove, RegenwormenState, RegenwormenVariantConfig } from './types.ts';

type Entry = GameEntry<RegenwormenState, RegenwormenMove, RegenwormenVariantConfig>;

export const regenwormenGame: Entry = {
  id: 'regenwormen',
  naam: 'Regenwormen',
  minPlayers: 1,
  maxPlayers: 7,
  configForPlayers: (players: number) => ({ ...REGENWORMEN_DEFAULT, playerCount: players }),
  createDefinition: () => createRegenwormenDefinition(),
  createAiController: (seat, config, player, thinkDelayMs) =>
    new RegenwormenAi(seat, player, config, thinkDelayMs),
};
