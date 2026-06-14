/**
 * src/games/tienduizend/index.ts
 * Registry-entry voor Tienduizend / 10.000 (push-your-luck dobbelspel, 6 stenen).
 */

import type { GameEntry } from '../../core/gameRegistry.ts';
import { createTienduizendDefinition } from './engine.ts';
import { TienduizendAi } from './ai.ts';
import { TIENDUIZEND_DEFAULT } from './types.ts';
import type { TienduizendMove, TienduizendState, TienduizendVariantConfig } from './types.ts';

type Entry = GameEntry<TienduizendState, TienduizendMove, TienduizendVariantConfig>;

export const tienduizendGame: Entry = {
  id: 'tienduizend',
  naam: 'Tienduizend',
  minPlayers: 1,
  maxPlayers: 8,
  configForPlayers: (players: number) => ({ ...TIENDUIZEND_DEFAULT, playerCount: players }),
  createDefinition: () => createTienduizendDefinition(),
  createAiController: (seat, config, player, thinkDelayMs) =>
    new TienduizendAi(seat, player, config, thinkDelayMs),
};
