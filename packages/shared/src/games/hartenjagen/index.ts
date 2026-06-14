/**
 * src/games/hartenjagen/index.ts
 * Registry-entries voor Hartenjagen. Twee profielen delen dezelfde engine + AI:
 *  - 'hartenjagen' = profiel B (Nederlands, 32 kaarten) — default voor de NL-app.
 *  - 'hearts'      = profiel A (internationaal Hearts, 52 kaarten) — selecteerbaar.
 */

import type { GameEntry } from '../../core/gameRegistry.ts';
import { createHartenjagenDefinition } from './engine.ts';
import { HartenjagenAi } from './ai.ts';
import { HARTENJAGEN_A, HARTENJAGEN_B } from './types.ts';
import type { HartenjagenMove, HartenjagenState, HartenjagenVariantConfig } from './types.ts';

type Entry = GameEntry<HartenjagenState, HartenjagenMove, HartenjagenVariantConfig>;

/** Profiel B — Nederlands Hartenjagen (default). */
export const hartenjagenGame: Entry = {
  id: 'hartenjagen',
  naam: 'Hartenjagen',
  minPlayers: 4,
  maxPlayers: 4,
  configForPlayers: () => ({ ...HARTENJAGEN_B, playerCount: 4 }),
  createDefinition: () => createHartenjagenDefinition(),
  createAiController: (seat, config, player, thinkDelayMs) =>
    new HartenjagenAi(seat, player, config, thinkDelayMs),
};

/** Profiel A — internationaal Hearts (selecteerbaar). */
export const heartsGame: Entry = {
  id: 'hearts',
  naam: 'Hearts',
  minPlayers: 4,
  maxPlayers: 4,
  configForPlayers: () => ({ ...HARTENJAGEN_A, playerCount: 4 }),
  createDefinition: () => createHartenjagenDefinition(),
  createAiController: (seat, config, player, thinkDelayMs) =>
    new HartenjagenAi(seat, player, config, thinkDelayMs),
};
