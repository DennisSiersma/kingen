/**
 * src/games/hartenjagen/index.ts
 * Registry-entry voor Hartenjagen (Hearts): koppelt het spel-id aan zijn
 * GameDefinition, spelersbereik en config-fabriek voor het GameRegistry.
 */

import type { GameEntry } from '../../core/gameRegistry.ts';
import { createHartenjagenDefinition } from './engine.ts';
import { HartenjagenAi } from './ai.ts';
import { HARTENJAGEN_DEFAULT } from './types.ts';
import type { HartenjagenMove, HartenjagenState, HartenjagenVariantConfig } from './types.ts';

export const hartenjagenGame: GameEntry<HartenjagenState, HartenjagenMove, HartenjagenVariantConfig> = {
  id: 'hartenjagen',
  naam: 'Hartenjagen',
  // Standaardvariant: 4 spelers. (3-6 spelers volgen als variant.)
  minPlayers: 4,
  maxPlayers: 4,
  configForPlayers: () => ({ ...HARTENJAGEN_DEFAULT, playerCount: 4 }),
  createDefinition: () => createHartenjagenDefinition(),
  createAiController: (seat, config, player, thinkDelayMs) =>
    new HartenjagenAi(seat, player, config, thinkDelayMs),
};
