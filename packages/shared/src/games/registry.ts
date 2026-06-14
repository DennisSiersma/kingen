/**
 * src/games/registry.ts
 * Registreert de ingebouwde spellen in het GameRegistry. Roep
 * registerBuiltinGames() eenmalig aan bij het opstarten (server) vóór er tafels
 * worden gemaakt. Idempotent.
 */

import { registerGame } from '../core/gameRegistry.ts';
import { kingenGame } from './kingen/index.ts';
import { hartenjagenGame, heartsGame } from './hartenjagen/index.ts';
import { klaverjasAmsterdamsGame, klaverjasGame } from './klaverjassen/index.ts';
import { rikkenGame } from './rikken/index.ts';
import { toepenGame } from './toepen/index.ts';

let gedaan = false;

export function registerBuiltinGames(): void {
  if (gedaan) return;
  gedaan = true;
  registerGame(kingenGame);
  registerGame(hartenjagenGame);
  registerGame(heartsGame);
  registerGame(klaverjasGame);
  registerGame(klaverjasAmsterdamsGame);
  registerGame(rikkenGame);
  registerGame(toepenGame);
}
