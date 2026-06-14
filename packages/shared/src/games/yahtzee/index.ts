/**
 * src/games/yahtzee/index.ts
 * Registry-entry voor Yahtzee (dobbelspel; 5 stenen, scorekaart met 13 categorieën).
 */

import type { GameEntry } from '../../core/gameRegistry.ts';
import { createYahtzeeDefinition } from './engine.ts';
import { YahtzeeAi } from './ai.ts';
import { YAHTZEE_DEFAULT } from './types.ts';
import type { YahtzeeMove, YahtzeeState, YahtzeeVariantConfig } from './types.ts';

type Entry = GameEntry<YahtzeeState, YahtzeeMove, YahtzeeVariantConfig>;

export const yahtzeeGame: Entry = {
  id: 'yahtzee',
  naam: 'Yahtzee',
  minPlayers: 1,
  maxPlayers: 8,
  configForPlayers: (players: number) => ({ ...YAHTZEE_DEFAULT, playerCount: players }),
  createDefinition: () => createYahtzeeDefinition(),
  createAiController: (seat, config, player, thinkDelayMs) =>
    new YahtzeeAi(seat, player, config, thinkDelayMs),
};
