/**
 * @kingen/server — integration.regenwormen.test-manual.ts
 * Verticale-plak-test voor Regenwormen: 2 in-proces "clients" + AI spelen via het
 * ECHTE protocol een volledige partij. De sim-clients stellen een worm zeker,
 * leggen waarden apart en pakken een tegel zodra het mag. Asserteert dat er
 * tegels veroverd zijn, de partij eindigt (gameEnd, leeg midden) en beide clients
 * dezelfde eindstand zien. Draai met: npx tsx src/integration.regenwormen.test-manual.ts
 */

import { strict as assert } from 'node:assert';
import type { Seat } from '@kingen/shared/core/types.ts';
import type { NetMessage } from '@kingen/shared/net/protocol.ts';
import { getGame } from '@kingen/shared/core/gameRegistry.ts';
import { registerBuiltinGames } from '@kingen/shared/games/registry.ts';
import { Room, type ClientConn } from './room.ts';

registerBuiltinGames();
const GAME_ID = 'regenwormen';
const ROOM_ID = 'REGENWORMEN';

type Move =
  | { type: 'roll' }
  | { type: 'reserve'; value: number }
  | { type: 'take'; tile: number; from: 'center' | number };

/** Sim-speler: pak een tegel zodra het mag, stel anders een worm/hoge waarde zeker. */
function kiesZet(legal: Move[]): Move | undefined {
  const take = legal.find((m) => m.type === 'take');
  if (take) return take;
  const reserves = legal.filter((m): m is Extract<Move, { type: 'reserve' }> => m.type === 'reserve');
  if (reserves.length > 0) {
    return reserves.find((m) => m.value === 6) ?? reserves.reduce((a, b) => (b.value > a.value ? b : a));
  }
  return legal[0];
}

interface TestClient extends ClientConn {
  seat: Seat | null;
  ev: { dice: number; take: number; bust: number };
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
    ev: { dice: 0, take: 0, bust: 0 },
    done,
    send(msg: NetMessage) {
      switch (msg.kind) {
        case 'joinedRoom':
          client.seat = msg.yourSeat;
          break;
        case 'requestMove': {
          if (msg.seat !== client.seat) break;
          setImmediate(() => {
            const move = kiesZet((msg.legalMoves ?? []) as Move[]);
            if (move === undefined) return;
            room.handleMessage(id, { kind: 'moveRequest', roomId: ROOM_ID, seat: client.seat as Seat, move });
          });
          break;
        }
        case 'gameEvent': {
          const ev = msg.event;
          if (ev.type === 'custom') {
            if (ev.subtype === 'rwDice') client.ev.dice++;
            else if (ev.subtype === 'rwTake') client.ev.take++;
            else if (ev.subtype === 'rwBust') client.ev.bust++;
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
  const regenwormen = getGame(GAME_ID)!;
  const room = new Room({
    id: ROOM_ID,
    naam: 'Regenwormentafel',
    code: 'RWTEST',
    gameId: GAME_ID,
    config: regenwormen.configForPlayers(3),
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

  assert.ok(a.ev.dice >= 3, `te weinig worpen: ${a.ev.dice}`);
  assert.ok(a.ev.take >= 1, `er is geen enkele tegel veroverd: ${a.ev.take}`);
  assert.ok(resA.winners.length >= 1, 'minstens één winnaar');
  const maxTotal = Math.max(...Object.values(resA.totals));
  for (const w of resA.winners) assert.equal(resA.totals[w], maxTotal, 'winnaar = meeste wormen');
  assert.deepEqual(resA.totals, resB.totals, 'A en B zien dezelfde eindstand');

  console.log('OK  Regenwormen verticale plak:');
  console.log(`    - ${a.ev.dice} worpen, ${a.ev.take} tegels veroverd, ${a.ev.bust} busts`);
  console.log(`    - eindstand (wormen): ${JSON.stringify(resA.totals)}, winnaar(s): stoel ${resA.winners.join(',')}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('FAAL', err);
    process.exit(1);
  },
);
