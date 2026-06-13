/**
 * @kingen/server — integration.test-manual.ts
 * Verticale-plak-test (Fase 1): twee in-proces "clients" spelen via het echte
 * protocol een volledige Kingen-partij tegen elkaar + AI-fill, autoritatief op
 * de server (Room/GameHost). Asserteert dat:
 *   1. geen client ooit andermans hand in een deal-event ontvangt;
 *   2. de partij netjes eindigt (gameEnd);
 *   3. de eindstand nulsom is (Kingen is per definitie nulsom).
 *
 * Draai met: npm run test -w @kingen/server   (gebruikt tsx)
 */

import { strict as assert } from 'node:assert';
import type { Card, Seat, Suit } from '@kingen/shared/core/types.ts';
import type { NetMessage } from '@kingen/shared/net/protocol.ts';
import { Room, type ClientConn } from './room.ts';

const ROOM_ID = 'ONLINE';

interface TestClient extends ClientConn {
  seat: Seat | null;
  dealLeaks: string[];
  ontvangen: { play: number; trickWon: number; roundEnd: number };
  done: Promise<{ winners: Seat[]; totals: Record<number, number> }>;
}

function maakClient(id: string, naam: string, room: Room): TestClient {
  let resolveDone!: (v: { winners: Seat[]; totals: Record<number, number> }) => void;
  const done = new Promise<{ winners: Seat[]; totals: Record<number, number> }>((res) => {
    resolveDone = res;
  });

  const client: TestClient = {
    id,
    seat: null,
    dealLeaks: [],
    ontvangen: { play: 0, trickWon: 0, roundEnd: 0 },
    done,
    send(msg: NetMessage) {
      switch (msg.kind) {
        case 'joinedRoom':
          client.seat = msg.yourSeat;
          break;
        case 'requestMove': {
          if (msg.seat !== client.seat) break;
          // Speel de eerste legale zet en stuur hem ongewijzigd terug
          // (netwerk-async nabootsen met setImmediate).
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
            const keys = Object.keys(ev.hands).map(Number);
            const vreemd = keys.filter((k) => k !== client.seat);
            if (vreemd.length > 0) {
              client.dealLeaks.push(`stoel ${client.seat} zag handen van ${vreemd.join(',')}`);
            }
          } else if (ev.type === 'playCard') {
            client.ontvangen.play++;
          } else if (ev.type === 'trickWon') {
            client.ontvangen.trickWon++;
          } else if (ev.type === 'roundEnd') {
            client.ontvangen.roundEnd++;
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
  // AI zonder denkvertraging zodat een hele partij in milliseconden speelt.
  const room = new Room({ id: ROOM_ID, naam: 'Testtafel', code: 'KTEST', aiThinkDelayMs: [0, 0] });

  const a = maakClient('A', 'Dennis', room);
  const b = maakClient('B', 'Kaia', room);

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

  // 1. Geen handlekkage.
  assert.equal(a.dealLeaks.length, 0, `handlek bij A: ${a.dealLeaks.join('; ')}`);
  assert.equal(b.dealLeaks.length, 0, `handlek bij B: ${b.dealLeaks.join('; ')}`);

  // 2. Partij speelde echt (kaarten, slagen, rondes).
  assert.ok(a.ontvangen.play > 100, `te weinig playCard-events: ${a.ontvangen.play}`);
  assert.ok(a.ontvangen.roundEnd >= 10, `te weinig rondes: ${a.ontvangen.roundEnd}`);

  // 3. Nulsom-eindstand; beide clients zien dezelfde stand.
  const som = Object.values(resA.totals).reduce((s, v) => s + v, 0);
  assert.equal(som, 0, `eindstand niet nulsom: ${JSON.stringify(resA.totals)}`);
  assert.deepEqual(resA.totals, resB.totals, 'A en B zien verschillende eindstand');

  console.log('OK  Fase 1 verticale plak:');
  console.log(`    - geen handlekkage (A en B zagen alleen hun eigen hand)`);
  console.log(`    - ${a.ontvangen.play} kaarten gespeeld, ${a.ontvangen.trickWon} slagen, ${a.ontvangen.roundEnd} rondes`);
  console.log(`    - eindstand (nulsom): ${JSON.stringify(resA.totals)}, winnaar(s): stoel ${resA.winners.join(',')}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('FAAL', err);
    process.exit(1);
  },
);
