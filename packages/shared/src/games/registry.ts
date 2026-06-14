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
import { mexenGame } from './mexen/index.ts';
import { qwixxGame } from './qwixx/index.ts';
import { fritzenGame } from './fritzen/index.ts';
import { yahtzeeGame } from './yahtzee/index.ts';
import { tienduizendGame } from './tienduizend/index.ts';
import { regenwormenGame } from './regenwormen/index.ts';

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
  registerGame(mexenGame);
  registerGame(qwixxGame);
  registerGame(fritzenGame);
  registerGame(yahtzeeGame);
  registerGame(tienduizendGame);
  registerGame(regenwormenGame);
}
