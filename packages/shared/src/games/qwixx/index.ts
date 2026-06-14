/**
 * src/games/qwixx/index.ts
 * Registry-entry voor Qwixx (mechaniek nagebouwd; eigen procedureel scorebord).
 */

import type { GameEntry } from '../../core/gameRegistry.ts';
import { createQwixxDefinition } from './engine.ts';
import { QwixxAi } from './ai.ts';
import { QWIXX_DEFAULT } from './types.ts';
import type { QwixxMove, QwixxState, QwixxVariantConfig } from './types.ts';

type Entry = GameEntry<QwixxState, QwixxMove, QwixxVariantConfig>;

export const qwixxGame: Entry = {
  id: 'qwixx',
  naam: 'Qwixx',
  minPlayers: 2,
  maxPlayers: 5,
  configForPlayers: (players: number) => ({ ...QWIXX_DEFAULT, playerCount: players }),
  createDefinition: () => createQwixxDefinition(),
  createAiController: (seat, config, player, thinkDelayMs) =>
    new QwixxAi(seat, player, config, thinkDelayMs),
};
