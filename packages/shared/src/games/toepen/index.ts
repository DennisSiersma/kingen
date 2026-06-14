/**
 * src/games/toepen/index.ts
 * Registry-entry voor Toepen (NL standaardvariant: max 15, vuile was + vier
 * gelijke aan). 2..8 spelers. De AI-controller volgt in een aparte fase; zonder
 * createAiController valt GameHost terug op de generieke AiPlayer (die kaarten
 * speelt, nooit toept en claims voorbijgaat — een veilige baseline). De sterke
 * ToepenAi wordt in een latere fase aangehaakt.
 */

import type { GameEntry } from '../../core/gameRegistry.ts';
import { createToepenDefinition } from './engine.ts';
import { TOEPEN_STANDAARD } from './types.ts';
import type { ToepenMove, ToepenState, ToepenVariantConfig } from './types.ts';

type Entry = GameEntry<ToepenState, ToepenMove, ToepenVariantConfig>;

export const toepenGame: Entry = {
  id: 'toepen',
  naam: 'Toepen',
  minPlayers: 2,
  maxPlayers: 8,
  configForPlayers: (players) => ({ ...TOEPEN_STANDAARD, playerCount: players }),
  createDefinition: () => createToepenDefinition(),
};
