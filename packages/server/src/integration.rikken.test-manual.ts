/**
 * @kingen/server — integration.rikken.test-manual.ts
 * Verticale-plak-test voor Rikken: 2 in-proces clients + 2 AI spelen via het
 * ECHTE protocol (Room/GameHost + generieke move-dispatch) een korte partij.
 * De clients bieden bewust RIK zodra dat wordt aangeboden (de fallback-AI past in
 * de biedfase), zodat elke ronde een echt rik-contract gespeeld wordt: maat
 * meevragen, troefkeuze, verborgen-maat-onthulling en 13 slagen lopen over de lijn.
 * Checkt: geen handlekkage, biedfase/contract-events, nulsom-eindstand bij beide
 * clients. Draai met: npx tsx src/integration.rikken.test-manual.ts
 */

import { strict as assert } from 'node:assert';
import type { Seat } from '@kingen/shared/core/types.ts';
import type { NetMessage } from '@kingen/shared/net/protocol.ts';
import { getGame } from '@kingen/shared/core/gameRegistry.ts';
import { registerBuiltinGames } from '@kingen/shared/games/registry.ts';
import { RIKKEN_STICHTING } from '@kingen/shared/games/rikken/types.ts';
import { Room, type ClientConn } from './room.ts';

registerBuiltinGames();
const GAME_ID = 'rikken';
const ROOM_ID = 'RIK';

interface TestClient extends ClientConn {
  seat: Seat | null;
  dealLeaks: string[];
  telt: { play: number; trickWon: number; roundEnd: number; biddingEnded: number; aceAsked: number; partnerRevealed: number };
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
    telt: { play: 0, trickWon: 0, roundEnd: 0, biddingEnded: 0, aceAsked: 0, partnerRevealed: 0 },
    done,
    send(msg: NetMessage) {
      switch (msg.kind) {
        case 'joinedRoom':
          client.seat = msg.yourSeat;
          break;
        case 'requestMove': {
          if (msg.seat !== client.seat) break;
          setImmediate(() => {
            const moves = (msg.legalMoves ?? []) as { type: string; bid?: unknown }[];
            let move: unknown;
            if (msg.moveType === 'bid') {
              // Bied RIK zodra het wordt aangeboden (alleen de opener krijgt 'rik').
              const rik = moves.find(
                (m) => m.type === 'bid' && typeof m.bid === 'object' && m.bid !== null && (m.bid as { kind?: string }).kind === 'rik',
              );
              move = rik ?? moves.find((m) => m.type === 'bid' && (m as { bid?: unknown }).bid === 'pass') ?? moves[0];
            } else {
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
            const vreemd = Object.keys(ev.hands).map(Number).filter((k) => k !== client.seat);
            if (vreemd.length > 0) client.dealLeaks.push(`stoel ${client.seat} zag handen van ${vreemd.join(',')}`);
          } else if (ev.type === 'playCard') client.telt.play++;
          else if (ev.type === 'trickWon') client.telt.trickWon++;
          else if (ev.type === 'roundEnd') client.telt.roundEnd++;
          else if (ev.type === 'custom') {
            if (ev.subtype === 'biddingEnded') client.telt.biddingEnded++;
            else if (ev.subtype === 'aceAsked') client.telt.aceAsked++;
            else if (ev.subtype === 'partnerRevealed') client.telt.partnerRevealed++;
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
  void getGame(GAME_ID);
  const room = new Room({
    id: ROOM_ID,
    naam: 'Riktafel',
    code: 'RTEST',
    gameId: GAME_ID,
    config: { ...RIKKEN_STICHTING, playerCount: 4, rondes: 3 },
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

  // 1. Geen handlekkage.
  assert.equal(a.dealLeaks.length, 0, `handlek bij A: ${a.dealLeaks.join('; ')}`);
  assert.equal(b.dealLeaks.length, 0, `handlek bij B: ${b.dealLeaks.join('; ')}`);

  // 2. Elke ronde een contract (rik) → biddingEnded + maat-meevraag + onthulling.
  assert.equal(a.telt.biddingEnded, 3, `verwacht 3 contracten, kreeg ${a.telt.biddingEnded}`);
  assert.ok(a.telt.aceAsked >= 1, `geen maat meegevraagd: ${a.telt.aceAsked}`);
  assert.ok(a.telt.partnerRevealed >= 1, `maat nooit onthuld: ${a.telt.partnerRevealed}`);

  // 3. Volledige rik-rondes: 3 × 13 slagen × 4 kaarten = 156 kaarten, 39 slagen.
  assert.equal(a.telt.play, 156, `verwacht 156 playCard, kreeg ${a.telt.play}`);
  assert.equal(a.telt.trickWon, 39, `verwacht 39 slagen, kreeg ${a.telt.trickWon}`);

  // 4. Beide clients zien dezelfde nulsom-eindstand.
  assert.deepEqual(resA.totals, resB.totals, 'A en B zien verschillende eindstand');
  const som = Object.values(resA.totals).reduce((p, c) => p + c, 0);
  assert.equal(som, 0, `eindstand niet nulsom: ${som}`);

  console.log('OK  Rikken verticale plak:');
  console.log(`    - geen handlekkage`);
  console.log(`    - ${a.telt.biddingEnded} contracten, ${a.telt.aceAsked} maat-meevragen, ${a.telt.partnerRevealed} onthullingen`);
  console.log(`    - ${a.telt.play} kaarten, ${a.telt.trickWon} slagen, ${a.telt.roundEnd} rondes`);
  console.log(`    - eindstand (nulsom): ${JSON.stringify(resA.totals)}, winnaar(s): stoel ${resA.winners.join(',')}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('FAAL', err);
    process.exit(1);
  },
);
