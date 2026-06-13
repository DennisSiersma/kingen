/**
 * src/games/registry.ts
 * Registreert de ingebouwde spellen in het GameRegistry. Roep
 * registerBuiltinGames() eenmalig aan bij het opstarten (server) vóór er tafels
 * worden gemaakt. Idempotent.
 */

import { registerGame } from '../core/gameRegistry.ts';
import { kingenGame } from './kingen/index.ts';

let gedaan = false;

export function registerBuiltinGames(): void {
  if (gedaan) return;
  gedaan = true;
  registerGame(kingenGame);
}
