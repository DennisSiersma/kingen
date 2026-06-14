/**
 * @kingen/server — integration.tienduizend.test-manual.ts
 * Verticale-plak-test voor Tienduizend: 2 in-proces "clients" + AI spelen via
 * het ECHTE protocol een volledige partij (verlaagd doel voor snelheid).
 * Asserteert dat er gegooid en gebankt is, de partij eindigt (gameEnd) en beide
 * clients dezelfde eindstand zien, met een winnaar op of boven het doel.
 * Draai met: npx tsx src/integration.tienduizend.test-manual.ts
 */

import { strict as assert } from 'node:assert';
import type { Seat } from '@kingen/shared/core/types.ts';
import type { NetMessage } from '@kingen/shared/net/protocol.ts';
import { getGame } from '@kingen/shared/core/gameRegistry.ts';
import { registerBuiltinGames } from '@kingen/shared/games/registry.ts';
import { Room, type ClientConn } from './room.ts';

registerBuiltinGames();
const GAME_ID = 'tienduizend';
const ROOM_ID = 'TIENDUIZEND';
const TARGET = 2500;

interface TestClient extends ClientConn {
  seat: Seat | null;
  ev: { rolled: number; banked: number; bust: number };
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
    ev: { rolled: 0, banked: 0, bust: 0 },
    done,
    send(msg: NetMessage) {
      switch (msg.kind) {
        case 'joinedRoom':
          client.seat = msg.yourSeat;
          break;
        case 'requestMove': {
          if (msg.seat !== client.seat) break;
          setImmediate(() => {
            const moves = (msg.legalMoves ?? []) as { type: string; bank?: boolean }[];
            // Sim-speler: bank zodra het mag (anders blijft hij doorgooien → altijd bust).
            const move = moves.find((m) => m.type === 'setAside' && m.bank === true) ?? moves[0];
            if (move === undefined) return;
            room.handleMessage(id, { kind: 'moveRequest', roomId: ROOM_ID, seat: client.seat as Seat, move });
          });
          break;
        }
        case 'gameEvent': {
          const ev = msg.event;
          if (ev.type === 'custom') {
            if (ev.subtype === 'tdRolled') client.ev.rolled++;
            else if (ev.subtype === 'tdBank') client.ev.banked++;
            else if (ev.subtype === 'tdBust') client.ev.bust++;
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
  const tienduizend = getGame(GAME_ID)!;
  const room = new Room({
    id: ROOM_ID,
    naam: 'Tienduizendtafel',
    code: 'TDTEST',
    gameId: GAME_ID,
    config: { ...(tienduizend.configForPlayers(3) as object), targetScore: TARGET },
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

  assert.ok(a.ev.rolled >= 3, `te weinig worpen: ${a.ev.rolled}`);
  assert.ok(a.ev.banked >= 1, `te weinig bank-acties: ${a.ev.banked}`);
  assert.ok(resA.winners.length >= 1, 'minstens één winnaar');
  const maxTotal = Math.max(...Object.values(resA.totals));
  assert.ok(maxTotal >= TARGET, `winnaar haalde het doel (${maxTotal} ≥ ${TARGET})`);
  for (const w of resA.winners) assert.equal(resA.totals[w], maxTotal, 'winnaar = hoogste totaal');
  assert.deepEqual(resA.totals, resB.totals, 'A en B zien dezelfde eindstand');

  console.log('OK  Tienduizend verticale plak:');
  console.log(`    - ${a.ev.rolled} worpen, ${a.ev.banked} bank-acties, ${a.ev.bust} busts`);
  console.log(`    - eindstand: ${JSON.stringify(resA.totals)}, winnaar(s): stoel ${resA.winners.join(',')}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('FAAL', err);
    process.exit(1);
  },
);
