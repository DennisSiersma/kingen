/**
 * @kingen/server — integration.toepen.test-manual.ts
 * Verticale-plak-test voor Toepen: 2 in-proces clients + 2 AI spelen via het
 * ECHTE protocol (Room/GameHost + generieke move-dispatch) een hele
 * eliminatiepartij. Client A toept op zijn eerste speelbeurt; client B past één
 * keer op een toep — zodat callToep, de toep-respons (meegaan/passen) en de
 * pas-boekhouding over de lijn lopen. Checkt: geen handlekkage, toepCalled +
 * playerFolded gezien, en een identieke, consistente eindstand met één winnaar
 * bij beide clients. Draai met: npx tsx src/integration.toepen.test-manual.ts
 */

import { strict as assert } from 'node:assert';
import type { Seat } from '@kingen/shared/core/types.ts';
import type { NetMessage } from '@kingen/shared/net/protocol.ts';
import { registerBuiltinGames } from '@kingen/shared/games/registry.ts';
import { TOEPEN_STANDAARD } from '@kingen/shared/games/toepen/types.ts';
import { Room, type ClientConn } from './room.ts';

registerBuiltinGames();
const GAME_ID = 'toepen';
const ROOM_ID = 'TOEP';

interface TestClient extends ClientConn {
  seat: Seat | null;
  dealLeaks: string[];
  telt: { play: number; toepCalled: number; folded: number; eliminated: number };
  heeftGetoept: boolean;
  heeftGepast: boolean;
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
    telt: { play: 0, toepCalled: 0, folded: 0, eliminated: 0 },
    heeftGetoept: false,
    heeftGepast: false,
    done,
    send(msg: NetMessage) {
      switch (msg.kind) {
        case 'joinedRoom':
          client.seat = msg.yourSeat;
          break;
        case 'requestMove': {
          if (msg.seat !== client.seat) break;
          setImmediate(() => {
            const moves = (msg.legalMoves ?? []) as { type: string }[];
            let move: unknown;
            switch (msg.moveType) {
              case 'playCard': {
                const toep = moves.find((m) => m.type === 'callToep');
                if (toep && id === 'A' && !client.heeftGetoept) {
                  client.heeftGetoept = true;
                  move = toep;
                } else {
                  move = moves.find((m) => m.type === 'playCard') ?? moves[0];
                }
                break;
              }
              case 'respondMeegaan':
              case 'respondPas': {
                if (id === 'B' && !client.heeftGepast) {
                  client.heeftGepast = true;
                  move = moves.find((m) => m.type === 'respondPas') ?? moves[0];
                } else {
                  move = moves.find((m) => m.type === 'respondMeegaan') ?? moves[0];
                }
                break;
              }
              case 'declareVierGelijke':
              case 'claimVuileWas':
              case 'passClaim':
                move = moves.find((m) => m.type === 'declareVierGelijke') ?? moves.find((m) => m.type === 'passClaim') ?? moves[0];
                break;
              case 'passChallenge':
              case 'challengeVuileWas':
                move = moves.find((m) => m.type === 'passChallenge') ?? moves[0];
                break;
              default:
                move = moves[0];
            }
            if (move === undefined) return;
            room.handleMessage(id, { kind: 'moveRequest', roomId: ROOM_ID, seat: client.seat as Seat, move });
          });
          break;
        }
        case 'gameEvent': {
          const ev = msg.event;
          if (ev.type === 'deal') {
            const vreemd = Object.keys(ev.hands).map(Number).filter((kk) => kk !== client.seat);
            if (vreemd.length > 0) client.dealLeaks.push(`stoel ${client.seat} zag handen van ${vreemd.join(',')}`);
          } else if (ev.type === 'playCard') client.telt.play++;
          else if (ev.type === 'custom') {
            if (ev.subtype === 'toepCalled') client.telt.toepCalled++;
            else if (ev.subtype === 'playerFolded') client.telt.folded++;
            else if (ev.subtype === 'playerEliminated') client.telt.eliminated++;
          } else if (ev.type === 'gameEnd') resolveDone({ winners: ev.winners, totals: ev.totals });
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
    naam: 'Toeptafel',
    code: 'TTEST',
    gameId: GAME_ID,
    // Lage drempel zodat de eliminatiepartij snel headless eindigt.
    config: { ...TOEPEN_STANDAARD, maxStrafpunten: 5, playerCount: 4 },
    maxPlayers: 4,
    aiThinkDelayMs: [0, 0],
    seed: 7, // deterministisch
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

  // 1. Geen handlekkage.
  assert.equal(a.dealLeaks.length, 0, `handlek bij A: ${a.dealLeaks.join('; ')}`);
  assert.equal(b.dealLeaks.length, 0, `handlek bij B: ${b.dealLeaks.join('; ')}`);

  // 2. Toep-laag liep over de lijn: ten minste één toep + één pas.
  assert.ok(a.telt.toepCalled >= 1, `geen toepCalled gezien: ${a.telt.toepCalled}`);
  assert.ok(a.telt.folded >= 1, `geen playerFolded gezien: ${a.telt.folded}`);

  // 3. Eliminatie → precies één winnaar, en beide clients zien hetzelfde.
  assert.deepEqual(resA.totals, resB.totals, 'A en B zien verschillende eindstand');
  assert.deepEqual(resA.winners, resB.winners, 'A en B zien verschillende winnaar');
  assert.equal(resA.winners.length, 1, `verwacht 1 winnaar, kreeg ${resA.winners.length}`);
  const max = 5;
  for (const [seat, total] of Object.entries(resA.totals)) {
    if (Number(seat) !== resA.winners[0]) assert.ok(total >= max, `verliezer ${seat} onder max: ${total}`);
  }

  console.log('OK  Toepen verticale plak:');
  console.log(`    - geen handlekkage`);
  console.log(`    - ${a.telt.toepCalled} toeps, ${a.telt.folded} keer gevouwen, ${a.telt.eliminated} eliminaties over de lijn`);
  console.log(`    - ${a.telt.play} kaarten gespeeld`);
  console.log(`    - eindstand: ${JSON.stringify(resA.totals)}, winnaar: stoel ${resA.winners.join(',')}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('FAAL', err);
    process.exit(1);
  },
);
