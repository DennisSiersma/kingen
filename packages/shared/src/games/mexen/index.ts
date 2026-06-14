/**
 * src/games/mexen/index.ts
 * Registry-entry voor Mexen (Nederlandse blufvariant met doorgeven).
 */

import type { GameEntry } from '../../core/gameRegistry.ts';
import { createMexenDefinition } from './engine.ts';
import { MexenAi } from './ai.ts';
import { MEXEN_DEFAULT } from './types.ts';
import type { MexenMove, MexenState, MexenVariantConfig } from './types.ts';

type Entry = GameEntry<MexenState, MexenMove, MexenVariantConfig>;

export const mexenGame: Entry = {
  id: 'mexen',
  naam: 'Mexen',
  minPlayers: 4,
  maxPlayers: 8,
  configForPlayers: (players: number) => ({ ...MEXEN_DEFAULT, playerCount: players }),
  createDefinition: () => createMexenDefinition(),
  createAiController: (seat, config, player, thinkDelayMs) =>
    new MexenAi(seat, player, config, thinkDelayMs),
};
