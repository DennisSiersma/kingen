/**
 * @kingen/server — integration.klaverjassen.test-manual.ts
 * Verticale-plak-test voor Klaverjassen: twee in-proces "clients" + 2 AI spelen
 * via het ECHTE protocol (Room/GameHost + generieke move-dispatch) een korte
 * partij (4 bomen). Asserteert dat:
 *   1. geen client ooit andermans hand in een deal-event ontvangt;
 *   2. elke boom een troefkleur krijgt (trumpChosen);
 *   3. de partij netjes eindigt (gameEnd) na de afgesproken bomen;
 *   4. beide clients dezelfde team-eindstand zien; winnaars = het hoogste team.
 *
 * Draai met: npx tsx src/integration.klaverjassen.test-manual.ts
 */

import { strict as assert } from 'node:assert';
import type { Seat } from '@kingen/shared/core/types.ts';
import type { NetMessage } from '@kingen/shared/net/protocol.ts';
import { getGame } from '@kingen/shared/core/gameRegistry.ts';
import { registerBuiltinGames } from '@kingen/shared/games/registry.ts';
import { KLAVERJAS_ROTTERDAMS } from '@kingen/shared/games/klaverjassen/types.ts';
import { Room, type ClientConn } from './room.ts';

registerBuiltinGames();
const GAME_ID = 'klaverjassen';
const ROOM_ID = 'KLAVER';

interface TestClient extends ClientConn {
  seat: Seat | null;
  dealLeaks: string[];
  ontvangen: { play: number; trickWon: number; roundEnd: number; trump: number; roem: number; nat: number; pit: number };
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
    ontvangen: { play: 0, trickWon: 0, roundEnd: 0, trump: 0, roem: 0, nat: 0, pit: 0 },
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
          if (ev.type === 'deal') {
            const vreemd = Object.keys(ev.hands).map(Number).filter((k) => k !== client.seat);
            if (vreemd.length > 0) client.dealLeaks.push(`stoel ${client.seat} zag handen van ${vreemd.join(',')}`);
          } else if (ev.type === 'playCard') client.ontvangen.play++;
          else if (ev.type === 'trickWon') client.ontvangen.trickWon++;
          else if (ev.type === 'roundEnd') client.ontvangen.roundEnd++;
          else if (ev.type === 'trumpChosen') client.ontvangen.trump++;
          else if (ev.type === 'custom') {
            if (ev.subtype === 'roemDeclared') client.ontvangen.roem++;
            else if (ev.subtype === 'natResult') client.ontvangen.nat++;
            else if (ev.subtype === 'pit') client.ontvangen.pit++;
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
  const room = new Room({
    id: ROOM_ID,
    naam: 'Klaverjastafel',
    code: 'KTEST',
    gameId: GAME_ID,
    // Korte partij van 4 bomen i.p.v. de default 16.
    config: { ...KLAVERJAS_ROTTERDAMS, playerCount: 4, eindvoorwaarde: { type: 'aantalBomen', n: 4 } },
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

  // 1. Geen handlekkage.
  assert.equal(a.dealLeaks.length, 0, `handlek bij A: ${a.dealLeaks.join('; ')}`);
  assert.equal(b.dealLeaks.length, 0, `handlek bij B: ${b.dealLeaks.join('; ')}`);

  // 2. Elke boom een troef + 4 bomen gespeeld.
  assert.equal(a.ontvangen.trump, 4, `verwacht 4 trumpChosen, kreeg ${a.ontvangen.trump}`);
  assert.equal(a.ontvangen.roundEnd, 4, `verwacht 4 rondes, kreeg ${a.ontvangen.roundEnd}`);
  assert.equal(a.ontvangen.nat, 4, `verwacht 4 natResult, kreeg ${a.ontvangen.nat}`);

  // 3. Echt gespeeld: 4 bomen × 8 slagen × 4 kaarten = 128 kaarten.
  assert.equal(a.ontvangen.play, 128, `verwacht 128 playCard, kreeg ${a.ontvangen.play}`);
  assert.equal(a.ontvangen.trickWon, 32, `verwacht 32 slagen, kreeg ${a.ontvangen.trickWon}`);

  // 4. Beide clients zien dezelfde team-eindstand; winnaars = hoogste team.
  assert.deepEqual(resA.totals, resB.totals, 'A en B zien verschillende eindstand');
  const wij = resA.totals[0] ?? 0;
  const zij = resA.totals[1] ?? 0;
  if (wij !== zij) {
    const winnendTeam = wij > zij ? 0 : 1;
    assert.equal(resA.winners.length, 2, 'winnaars zouden één team (2 stoelen) moeten zijn');
    for (const w of resA.winners) assert.equal(w % 2, winnendTeam, 'winnaar zit niet in het hoogste team');
  } else {
    assert.equal(resA.winners.length, 4, 'bij gelijkspel zijn alle 4 winnaar');
  }

  console.log('OK  Klaverjassen verticale plak:');
  console.log(`    - geen handlekkage`);
  console.log(`    - ${a.ontvangen.trump} bomen met troef, ${a.ontvangen.roem} roem-meldingen, ${a.ontvangen.pit} pit`);
  console.log(`    - ${a.ontvangen.play} kaarten, ${a.ontvangen.trickWon} slagen, ${a.ontvangen.roundEnd} rondes`);
  console.log(`    - eindstand Wij/Zij: ${wij}/${zij}, winnaar(s): stoel ${resA.winners.join(',')}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('FAAL', err);
    process.exit(1);
  },
);
