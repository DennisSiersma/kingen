/**
 * @kingen/server — integration.localhost.test-manual.ts
 * Headless smoke-test voor het LOKALE-spel-pad (LocalHostTransport): exact de
 * solo-configuratie van de in-browser host — stoel 0 = "mens" (antwoordt met de
 * eerste legale zet via een async callback, net als de echte client over het
 * transport), stoelen 1-3 = AI. Speelt elk spel tot gameEnd zonder crash.
 * Draai met: npx tsx src/integration.localhost.test-manual.ts
 */

import { strict as assert } from 'node:assert';
import type { GameEvent, PlayerConfig, Seat } from '@kingen/shared/core/types.ts';
import { getGame } from '@kingen/shared/core/gameRegistry.ts';
import { registerBuiltinGames } from '@kingen/shared/games/registry.ts';
import { GameHost } from '@kingen/shared/net/gameHost.ts';

registerBuiltinGames();

function players(n: number): PlayerConfig[] {
  return Array.from({ length: n }, (_, i) =>
    i === 0 ? { name: 'Jij', kind: 'human' } : { name: `Computer ${i}`, kind: 'ai', aiDifficulty: 'gemiddeld' },
  );
}

async function speelSolo(gameId: string): Promise<{ play: number; end: boolean; leak: boolean }> {
  const entry = getGame(gameId);
  assert.ok(entry, `spel ${gameId} niet geregistreerd`);
  const n = entry.minPlayers;
  const stat = { play: 0, end: false, leak: false };

  await new Promise<void>((resolve, reject) => {
    const host = new GameHost(
      {
        roomId: 'LOCAL',
        players: players(n),
        gameId,
        config: entry.configForPlayers(n),
        humanSeats: new Set<Seat>([0 as Seat]),
        // De "mens" antwoordt asynchroon (zoals de echte client over het transport):
        // synchroon antwoorden zou vóór het opzetten van de pending-promise vallen.
        sendRequestMove: (seat, payload) => {
          setImmediate(() => host.deliverMove(seat, payload.legalMoves[0]));
        },
        forwardEvent: (ev: GameEvent) => {
          if (ev.type === 'playCard') stat.play++;
          if (ev.type === 'gameEnd') {
            stat.end = true;
            resolve();
          }
        },
        aiThinkDelayMs: [0, 0],
      },
      4242,
    );
    host.start().catch(reject);
  });

  return stat;
}

async function main(): Promise<void> {
  for (const gameId of ['kingen', 'hartenjagen', 'hearts', 'klaverjassen', 'klaverjas-amsterdams', 'rikken', 'toepen']) {
    const r = await speelSolo(gameId);
    assert.ok(r.end, `${gameId}: partij eindigde niet`);
    assert.ok(r.play > 0, `${gameId}: geen kaarten gespeeld`);
    console.log(`    OK  ${gameId}: ${r.play} kaarten, gameEnd bereikt`);
  }
  console.log('OK  Lokale host: alle spellen solo (mens + AI-fill) tot het einde gespeeld');
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('FAAL', err);
    process.exit(1);
  },
);
