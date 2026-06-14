/**
 * @kingen/server — integration.yahtzee.test-manual.ts
 * Verticale-plak-test voor Yahtzee: 2 in-proces "clients" + AI spelen via het
 * ECHTE protocol een volledige partij. Asserteert dat er gegooid en gescoord is,
 * de partij eindigt (gameEnd) en beide clients dezelfde eindstand zien.
 * Draai met: npx tsx src/integration.yahtzee.test-manual.ts
 */

import { strict as assert } from 'node:assert';
import type { Seat } from '@kingen/shared/core/types.ts';
import type { NetMessage } from '@kingen/shared/net/protocol.ts';
import { getGame } from '@kingen/shared/core/gameRegistry.ts';
import { registerBuiltinGames } from '@kingen/shared/games/registry.ts';
import { Room, type ClientConn } from './room.ts';

registerBuiltinGames();
const GAME_ID = 'yahtzee';
const ROOM_ID = 'YAHTZEE';

interface TestClient extends ClientConn {
  seat: Seat | null;
  ev: { rolled: number; scored: number };
  done: Promise<{ winners: Seat[]; totals: Record<number, number> }>;
}

function maakClient(id: string, room: Room): TestClient {
  let resolveDone!: (v: { winners: Seat[]; totals: Record<number, number> }) => void;
  const done = new Promise<{ winners: Seat[]; totals: Record<number, number> }>((res) => {
    resolveDone = res;
  });
  const client: TestClient = {
    id,
    seat: null,
    ev: { rolled: 0, scored: 0 },
    done,
    send(msg: NetMessage) {
      switch (msg.kind) {
        case 'joinedRoom':
          client.seat = msg.yourSeat;
          break;
        case 'requestMove': {
          if (msg.seat !== client.seat) break;
          setImmediate(() => {
            const move = (msg.legalMoves ?? [])[0];
            if (move === undefined) return;
            room.handleMessage(id, { kind: 'moveRequest', roomId: ROOM_ID, seat: client.seat as Seat, move });
          });
          break;
        }
        case 'gameEvent': {
          const ev = msg.event;
          if (ev.type === 'custom') {
            if (ev.subtype === 'yahtzeeRolled') client.ev.rolled++;
            else if (ev.subtype === 'yahtzeeScored') client.ev.scored++;
          } else if (ev.type === 'gameEnd') {
            resolveDone({ winners: ev.winners, totals: ev.totals });
          }
          break;
        }
        default:
          break;
      }
    },
  };
  return client;
}

async function main(): Promise<void> {
  const yahtzee = getGame(GAME_ID)!;
  const room = new Room({
    id: ROOM_ID,
    naam: 'Yahtzeetafel',
    code: 'YTEST',
    gameId: GAME_ID,
    config: yahtzee.configForPlayers(3),
    maxPlayers: 3,
    aiThinkDelayMs: [0, 0],
  });

  const a = maakClient('A', room);
  const b = maakClient('B', room);
  room.join(a, 'cid-A', 'Dennis');
  room.join(b, 'cid-B', 'Kaia');
  assert.equal(a.seat, 0, 'client A → stoel 0');
  assert.equal(b.seat, 1, 'client B → stoel 1');

  room.handleMessage('A', { kind: 'startGame', roomId: ROOM_ID });

  const timeout = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error('TIMEOUT: partij niet binnen 30s afgerond')), 30000),
  );
  const [resA, resB] = (await Promise.race([Promise.all([a.done, b.done]), timeout])) as [
    { winners: Seat[]; totals: Record<number, number> },
    { winners: Seat[]; totals: Record<number, number> },
  ];

  // 3 spelers × 13 categorieën = 39 score-beurten; minstens evenveel worpen.
  assert.ok(a.ev.scored >= 39, `te weinig score-beurten: ${a.ev.scored}`);
  assert.ok(a.ev.rolled >= 39, `te weinig worpen: ${a.ev.rolled}`);
  assert.ok(resA.winners.length >= 1, 'minstens één winnaar');
  const maxTotal = Math.max(...Object.values(resA.totals));
  for (const w of resA.winners) assert.equal(resA.totals[w], maxTotal, 'winnaar = hoogste totaal');
  assert.deepEqual(resA.totals, resB.totals, 'A en B zien dezelfde eindstand');

  console.log('OK  Yahtzee verticale plak:');
  console.log(`    - ${a.ev.rolled} worpen, ${a.ev.scored} score-beurten`);
  console.log(`    - eindstand: ${JSON.stringify(resA.totals)}, winnaar(s): stoel ${resA.winners.join(',')}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('FAAL', err);
    process.exit(1);
  },
);
