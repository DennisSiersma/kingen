/**
 * @kingen/server — integration.mexen.test-manual.ts
 * Verticale-plak-test voor Mexen: 2 in-proces "clients" + 2 AI spelen via het
 * ECHTE protocol (Room/GameHost + generieke move-dispatch) een volledige partij.
 * Asserteert dat:
 *   1. geen enkel gameEvent de verdekte worp lekt vóór de onthulling ('revealed');
 *   2. er echt gegooid/aangekondigd/getwijfeld is (diceRolled/announced/doubted);
 *   3. de partij netjes eindigt (gameEnd) met precies één winnaar die levens overheeft;
 *   4. beide clients dezelfde eindstand zien.
 *
 * Draai met: npx tsx src/integration.mexen.test-manual.ts
 */

import { strict as assert } from 'node:assert';
import type { Seat } from '@kingen/shared/core/types.ts';
import type { NetMessage } from '@kingen/shared/net/protocol.ts';
import { getGame } from '@kingen/shared/core/gameRegistry.ts';
import { registerBuiltinGames } from '@kingen/shared/games/registry.ts';
import { Room, type ClientConn } from './room.ts';

registerBuiltinGames();
const GAME_ID = 'mexen';
const ROOM_ID = 'MEXEN';

interface TestClient extends ClientConn {
  seat: Seat | null;
  rollLeaks: string[];
  ev: { diceRolled: number; announced: number; doubted: number; revealed: number; lifeLost: number; eliminated: number };
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
    rollLeaks: [],
    ev: { diceRolled: 0, announced: 0, doubted: 0, revealed: 0, lifeLost: 0, eliminated: 0 },
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
            // Lek-controle: alleen 'revealed' mag een worp bevatten.
            if (ev.subtype !== 'revealed' && /"roll"/.test(JSON.stringify(ev.data ?? {}))) {
              client.rollLeaks.push(`stoel ${client.seat} zag een worp in '${ev.subtype}'`);
            }
            if (ev.subtype === 'diceRolled') client.ev.diceRolled++;
            else if (ev.subtype === 'announced') client.ev.announced++;
            else if (ev.subtype === 'doubted') client.ev.doubted++;
            else if (ev.subtype === 'revealed') client.ev.revealed++;
            else if (ev.subtype === 'lifeLost') client.ev.lifeLost++;
            else if (ev.subtype === 'playerEliminated') client.ev.eliminated++;
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
  const mexen = getGame(GAME_ID)!;
  const room = new Room({
    id: ROOM_ID,
    naam: 'Mexentafel',
    code: 'MTEST',
    gameId: GAME_ID,
    config: mexen.configForPlayers(4),
    maxPlayers: 4,
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

  // 1. Geen worplekkage vóór de onthulling.
  assert.equal(a.rollLeaks.length, 0, `worplek bij A: ${a.rollLeaks.join('; ')}`);
  assert.equal(b.rollLeaks.length, 0, `worplek bij B: ${b.rollLeaks.join('; ')}`);

  // 2. Er is echt gegooid/aangekondigd/getwijfeld/onthuld.
  assert.ok(a.ev.diceRolled >= 1, `geen diceRolled: ${a.ev.diceRolled}`);
  assert.ok(a.ev.announced >= 1, `geen announced: ${a.ev.announced}`);
  assert.ok(a.ev.doubted >= 1, `geen doubted: ${a.ev.doubted}`);
  assert.ok(a.ev.revealed >= 1, `geen revealed: ${a.ev.revealed}`);
  assert.ok(a.ev.eliminated >= 3, `te weinig eliminaties (verwacht 3): ${a.ev.eliminated}`);

  // 3. Partij eindigde met precies één winnaar die nog levens heeft.
  assert.equal(resA.winners.length, 1, 'precies één winnaar');
  const winnaar = resA.winners[0]!;
  assert.ok((resA.totals[winnaar] ?? 0) > 0, `winnaar heeft geen levens over: ${resA.totals[winnaar]}`);

  // 4. Beide clients zien dezelfde eindstand.
  assert.deepEqual(resA.totals, resB.totals, 'A en B zien verschillende eindstand');

  console.log('OK  Mexen verticale plak:');
  console.log('    - geen worplekkage vóór de onthulling');
  console.log(`    - ${a.ev.diceRolled} worpen, ${a.ev.announced} aankondigingen, ${a.ev.doubted} twijfels, ${a.ev.revealed} onthullingen`);
  console.log(`    - ${a.ev.lifeLost} levensverliezen, ${a.ev.eliminated} eliminaties`);
  console.log(`    - eindstand: ${JSON.stringify(resA.totals)}, winnaar: stoel ${winnaar}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('FAAL', err);
    process.exit(1);
  },
);
