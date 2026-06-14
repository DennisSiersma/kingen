/**
 * @kingen/server — integration.hartenjagen.test-manual.ts
 * Verticale-plak-test voor Hartenjagen: twee in-proces "clients" + 2 AI spelen
 * via het ECHTE protocol (Room/GameHost + generieke move-dispatch uit Phase 0)
 * een volledige partij, inclusief de DOORGEEFFASE. Asserteert dat:
 *   1. geen client ooit andermans hand in een deal-event ontvangt;
 *   2. er daadwerkelijk doorgegeven is (passRequest/cardsPassed/passComplete);
 *   3. de partij netjes eindigt (gameEnd) zodra iemand endScore haalt;
 *   4. beide clients dezelfde eindstand zien.
 *
 * Draai met: npx tsx src/integration.hartenjagen.test-manual.ts
 */

import { strict as assert } from 'node:assert';
import type { Seat } from '@kingen/shared/core/types.ts';
import type { NetMessage } from '@kingen/shared/net/protocol.ts';
import { getGame } from '@kingen/shared/core/gameRegistry.ts';
import { registerBuiltinGames } from '@kingen/shared/games/registry.ts';
import { HARTENJAGEN_A } from '@kingen/shared/games/hartenjagen/types.ts';
import { Room, type ClientConn } from './room.ts';

registerBuiltinGames();
// Profiel A ('hearts') want dit test de doorgeeffase (profiel B kent geen doorgeven).
const GAME_ID = 'hearts';
const ROOM_ID = 'HARTEN';

interface TestClient extends ClientConn {
  seat: Seat | null;
  dealLeaks: string[];
  ontvangen: { play: number; trickWon: number; roundEnd: number };
  pass: { request: number; passed: number; complete: number; moon: number };
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
    dealLeaks: [],
    ontvangen: { play: 0, trickWon: 0, roundEnd: 0 },
    pass: { request: 0, passed: 0, complete: 0, moon: 0 },
    done,
    send(msg: NetMessage) {
      switch (msg.kind) {
        case 'joinedRoom':
          client.seat = msg.yourSeat;
          break;
        case 'requestMove': {
          if (msg.seat !== client.seat) break;
          // Eerste legale zet (werkt voor zowel passCards als playCard) terugsturen.
          setImmediate(() => {
            const move = (msg.legalMoves ?? [])[0];
            if (move === undefined) return;
            room.handleMessage(id, { kind: 'moveRequest', roomId: ROOM_ID, seat: client.seat as Seat, move });
          });
          break;
        }
        case 'gameEvent': {
          const ev = msg.event;
          if (ev.type === 'deal') {
            const vreemd = Object.keys(ev.hands).map(Number).filter((k) => k !== client.seat);
            if (vreemd.length > 0) client.dealLeaks.push(`stoel ${client.seat} zag handen van ${vreemd.join(',')}`);
          } else if (ev.type === 'playCard') {
            client.ontvangen.play++;
          } else if (ev.type === 'trickWon') {
            client.ontvangen.trickWon++;
          } else if (ev.type === 'roundEnd') {
            client.ontvangen.roundEnd++;
          } else if (ev.type === 'custom') {
            if (ev.subtype === 'passRequest') client.pass.request++;
            else if (ev.subtype === 'cardsPassed') client.pass.passed++;
            else if (ev.subtype === 'passComplete') client.pass.complete++;
            else if (ev.subtype === 'shootMoon') client.pass.moon++;
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
  const hearts = getGame(GAME_ID)!;
  const room = new Room({
    id: ROOM_ID,
    naam: 'Hartentafel',
    code: 'HTEST',
    gameId: GAME_ID,
    config: hearts.configForPlayers(4),
    maxPlayers: 4,
    aiThinkDelayMs: [0, 0],
  });

  const a = maakClient('A', room);
  const b = maakClient('B', room);
  room.join(a, 'cid-A', 'Dennis');
  room.join(b, 'cid-B', 'Kaia');

  assert.equal(a.seat, 0, 'client A zou stoel 0 moeten krijgen');
  assert.equal(b.seat, 1, 'client B zou stoel 1 moeten krijgen');

  room.handleMessage('A', { kind: 'startGame', roomId: ROOM_ID });

  const timeout = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error('TIMEOUT: partij niet binnen 30s afgerond')), 30000),
  );
  const [resA, resB] = (await Promise.race([Promise.all([a.done, b.done]), timeout])) as [
    { winners: Seat[]; totals: Record<number, number> },
    { winners: Seat[]; totals: Record<number, number> },
  ];

  // 1. Geen handlekkage (ook niet in het deal-event ná het doorgeven).
  assert.equal(a.dealLeaks.length, 0, `handlek bij A: ${a.dealLeaks.join('; ')}`);
  assert.equal(b.dealLeaks.length, 0, `handlek bij B: ${b.dealLeaks.join('; ')}`);

  // 2. Er is doorgegeven (de nieuwe afhandeling over het protocol werkt).
  assert.ok(a.pass.request >= 1, `geen passRequest gezien: ${a.pass.request}`);
  assert.ok(a.pass.passed >= 4, `te weinig cardsPassed (verwacht >=4 per doorgeefronde): ${a.pass.passed}`);
  assert.ok(a.pass.complete >= 1, `geen passComplete gezien: ${a.pass.complete}`);

  // 3. Partij speelde echt en eindigde via endScore.
  assert.ok(a.ontvangen.play > 50, `te weinig playCard-events: ${a.ontvangen.play}`);
  const maxTotal = Math.max(...Object.values(resA.totals));
  assert.ok(maxTotal >= HARTENJAGEN_A.endScore, `partij eindigde zonder endScore: ${maxTotal}`);

  // 4. Beide clients zien dezelfde eindstand; winnaar = laagste.
  assert.deepEqual(resA.totals, resB.totals, 'A en B zien verschillende eindstand');
  const laagste = Math.min(...Object.values(resA.totals));
  for (const w of resA.winners) assert.equal(resA.totals[w], laagste, 'winnaar heeft niet het laagste totaal');

  console.log('OK  Hartenjagen verticale plak:');
  console.log(`    - geen handlekkage (ook na het doorgeven)`);
  console.log(`    - doorgeven werkt: ${a.pass.request} passRequests, ${a.pass.passed} cardsPassed, ${a.pass.complete} passComplete, ${a.pass.moon} maanschoten`);
  console.log(`    - ${a.ontvangen.play} kaarten, ${a.ontvangen.trickWon} slagen, ${a.ontvangen.roundEnd} rondes`);
  console.log(`    - eindstand: ${JSON.stringify(resA.totals)}, winnaar(s): stoel ${resA.winners.join(',')}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('FAAL', err);
    process.exit(1);
  },
);
