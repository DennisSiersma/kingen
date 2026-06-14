/**
 * src/games/rikken/index.ts
 * Registry-entry voor Rikken (Stichting 2025). De AI-controller volgt in een
 * aparte fase; zonder createAiController valt GameHost terug op de generieke
 * AiPlayer (die in de biedfase past).
 */

import type { GameEntry } from '../../core/gameRegistry.ts';
import { createRikkenDefinition } from './engine.ts';
import { RIKKEN_STICHTING } from './types.ts';
import type { RikkenMove, RikkenState, RikkenVariantConfig } from './types.ts';

type Entry = GameEntry<RikkenState, RikkenMove, RikkenVariantConfig>;

export const rikkenGame: Entry = {
  id: 'rikken',
  naam: 'Rikken',
  minPlayers: 4,
  maxPlayers: 4,
  configForPlayers: () => ({ ...RIKKEN_STICHTING, playerCount: 4 }),
  createDefinition: () => createRikkenDefinition(),
};
