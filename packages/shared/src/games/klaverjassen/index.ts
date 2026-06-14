/**
 * src/games/klaverjassen/index.ts
 * Registry-entries voor Klaverjassen. Twee gewesten delen dezelfde engine:
 *  - 'klaverjassen'          = Rotterdams (default — onvoorwaardelijke troefplicht).
 *  - 'klaverjas-amsterdams'  = Amsterdams (troefplicht vervalt als de maat hoog staat).
 *
 * De AI-controller volgt in een aparte stap; zonder createAiController valt
 * GameHost terug op de generieke AiPlayer (kiest legale kaarten).
 */

import type { GameEntry } from '../../core/gameRegistry.ts';
import { createKlaverjasDefinition } from './engine.ts';
import { KLAVERJAS_AMSTERDAMS, KLAVERJAS_ROTTERDAMS } from './types.ts';
import type { KlaverjasMove, KlaverjasState, KlaverjasVariantConfig } from './types.ts';

type Entry = GameEntry<KlaverjasState, KlaverjasMove, KlaverjasVariantConfig>;

/** Rotterdams (default). */
export const klaverjasGame: Entry = {
  id: 'klaverjassen',
  naam: 'Klaverjassen',
  minPlayers: 4,
  maxPlayers: 4,
  configForPlayers: () => ({ ...KLAVERJAS_ROTTERDAMS, playerCount: 4 }),
  createDefinition: () => createKlaverjasDefinition(),
};

/** Amsterdams (selecteerbaar). */
export const klaverjasAmsterdamsGame: Entry = {
  id: 'klaverjas-amsterdams',
  naam: 'Klaverjassen (Amsterdams)',
  minPlayers: 4,
  maxPlayers: 4,
  configForPlayers: () => ({ ...KLAVERJAS_AMSTERDAMS, playerCount: 4 }),
  createDefinition: () => createKlaverjasDefinition(),
};
