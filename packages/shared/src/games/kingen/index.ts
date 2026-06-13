/**
 * src/games/kingen/index.ts
 * Registry-entry voor Kingen: koppelt het spel-id aan zijn GameDefinition,
 * spelersbereik en config-fabriek voor het GameRegistry.
 */

import type { GameEntry } from '../../core/gameRegistry.ts';
import { createKingenDefinition } from './engine.ts';
import { DEFAULT_VARIANT } from './types.ts';
import type { KingenMove, KingenState, KingenVariantConfig } from './types.ts';

export const kingenGame: GameEntry<KingenState, KingenMove, KingenVariantConfig> = {
  id: 'kingen',
  naam: 'Kingen',
  minPlayers: 3,
  maxPlayers: 5,
  configForPlayers: (players) => ({
    ...DEFAULT_VARIANT,
    playerCount: Math.min(5, Math.max(3, Math.round(players))) as 3 | 4 | 5,
  }),
  createDefinition: () => createKingenDefinition(),
};
