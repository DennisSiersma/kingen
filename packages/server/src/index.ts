/**
 * @kingen/server — index.ts
 * HTTP + WebSocket-server + lobby-hub. Serveert de gebouwde client (statisch,
 * SPA-fallback) én host de WebSocket op /ws. De hub routeert lobby-berichten
 * (listRooms/createRoom/joinRoom/leaveRoom) naar de RoomManager en in-room-
 * berichten (startGame/moveRequest/chat) naar de tafel van de verbinding.
 */

import http from 'node:http';
import { existsSync } from 'node:fs';
import { WebSocketServer, type WebSocket } from 'ws';
import sirv from 'sirv';
import type { NetMessage } from '@kingen/shared/net/protocol.ts';
import { registerBuiltinGames } from '@kingen/shared/games/registry.ts';
import { getGame } from '@kingen/shared/core/gameRegistry.ts';
import type { ClientConn, Room } from './room.ts';
import { RoomManager } from './roomManager.ts';
import { Stats } from './stats.ts';

// Registreer de ingebouwde spellen in het GameRegistry vóór er tafels ontstaan.
registerBuiltinGames();

const PORT = Number(process.env.PORT ?? 8080);
const PUBLIC_DIR = process.env.PUBLIC_DIR ?? './public';
const aiDelay: [number, number] | undefined = process.env.KINGEN_AI_FAST ? [0, 0] : undefined;
const moveTimeoutMs = Number(process.env.MOVE_TIMEOUT_MS ?? 60000);
const maxRooms = Number(process.env.MAX_ROOMS ?? 4);

const serveStatic = existsSync(PUBLIC_DIR)
  ? sirv(PUBLIC_DIR, {
      single: true,
      gzip: true,
      brotli: true,
      // Alleen de content-gehashte Vite-assets lang + immutable cachen; index.html
      // en overige bestanden houden de sirv-default (geen lange cache) zodat een
      // nieuwe deploy meteen zichtbaar is.
      setHeaders(res, pathname) {
        if (pathname.startsWith('/assets/')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    })
  : null;

// STATS_FILE (op een Docker-volume) maakt de cijfers persistent over herstarts.
const stats = new Stats(process.env.STATS_FILE);

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  // Beacon vanuit de client voor LOKALE partijen (lokaal-tegen-de-computer raakt
  // de server normaal niet). Best-effort: alleen bekende spel-id's tellen mee, zodat
  // willekeurige keys de statistiek niet kunnen vervuilen; body gecapt op 1 KB.
  if (req.method === 'POST' && req.url === '/api/stats/lokaal') {
    let body = '';
    let teGroot = false;
    req.on('data', (chunk: Buffer) => {
      body += chunk;
      if (body.length > 1024) {
        teGroot = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!teGroot) {
        try {
          const m = JSON.parse(body) as { gameId?: unknown; event?: unknown };
          const gameId = typeof m.gameId === 'string' ? m.gameId : '';
          const event = m.event === 'start' || m.event === 'finish' ? m.event : null;
          if (gameId && getGame(gameId) && event) {
            if (event === 'start') stats.recordStart(gameId, 'lokaal');
            else stats.recordFinish(gameId, 'lokaal');
          }
        } catch {
          // ongeldige body → negeren
        }
      }
      res.writeHead(204).end();
    });
    return;
  }
  if (req.url === '/api/stats') {
    const body = JSON.stringify({
      live: { ...manager.liveStats(), spelersOnline: sessies.size },
      ...stats.snapshot(),
      tijd: Date.now(),
    });
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(body);
    return;
  }
  if (serveStatic) {
    serveStatic(req, res, () => {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Niet gevonden');
    });
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Kingen multiplayer-server. WebSocket op /ws. (Geen client-build aanwezig.)');
});

// --- Verbindingen + lobby-hub ---------------------------------------------

interface Sessie {
  conn: ClientConn;
  clientId: string;
  name: string;
  room: Room | null;
  /** Rate-limiter: tellervenster van 1s. */
  msgVensterStart: number;
  msgTeller: number;
}

// Hardening: weiger absurd grote frames en begrens berichten per seconde.
const MAX_MSG_BYTES = 32 * 1024;
const MAX_MSG_PER_SEC = 40;

const sessies = new Map<string, Sessie>();

const stuurLobbyLijst = (): void => {
  const rooms = manager.openList();
  for (const s of sessies.values()) {
    if (!s.room) s.conn.send({ kind: 'roomList', rooms });
  }
};

const manager = new RoomManager({
  maxRooms,
  aiThinkDelayMs: aiDelay,
  moveTimeoutMs,
  onLobbyChange: stuurLobbyLijst,
  onGameStart: (gameId) => stats.recordStart(gameId, 'online'),
  onGameEnd: (gameId) => stats.recordFinish(gameId, 'online'),
});

const isStr = (v: unknown): v is string => typeof v === 'string';

function verwerk(sessie: Sessie, msg: NetMessage): void {
  switch (msg.kind) {
    case 'hello':
      // Velden komen van een onvertrouwde client: valideer voor we ze gebruiken.
      if (!isStr(msg.clientId) || !isStr(msg.name)) return;
      sessie.clientId = msg.clientId.slice(0, 64);
      sessie.name = msg.name;
      sessie.conn.send({ kind: 'helloOk', connectionId: sessie.conn.id, clientId: sessie.clientId });
      sessie.conn.send({ kind: 'roomList', rooms: manager.openList() });
      break;
    case 'listRooms':
      sessie.conn.send({ kind: 'roomList', rooms: manager.openList() });
      break;
    case 'createRoom': {
      if (!isStr(msg.naam) || typeof msg.maxPlayers !== 'number' || !Number.isFinite(msg.maxPlayers)) {
        sessie.conn.send({ kind: 'error', code: 'ongeldig', melding: 'Ongeldige tafelgegevens' });
        break;
      }
      const zicht = msg.zichtbaarheid === 'prive' ? 'prive' : 'open';
      const gameId = isStr(msg.gameId) ? msg.gameId : 'kingen';
      const room = manager.create(msg.naam, gameId, msg.maxPlayers, zicht);
      if (!room) {
        sessie.conn.send({ kind: 'error', code: 'max-tafels', melding: 'Tafel maken mislukt (vol of onbekend spel)' });
        break;
      }
      if (room.join(sessie.conn, sessie.clientId, sessie.name)) sessie.room = room;
      break;
    }
    case 'joinRoom': {
      if (!isStr(msg.code)) {
        sessie.conn.send({ kind: 'error', code: 'geen-tafel', melding: 'Geen tafel met die code' });
        break;
      }
      const room = manager.byCode(msg.code);
      if (!room) {
        sessie.conn.send({ kind: 'error', code: 'geen-tafel', melding: 'Geen tafel met die code' });
        break;
      }
      if (room.join(sessie.conn, sessie.clientId, sessie.name)) sessie.room = room;
      break;
    }
    case 'leaveRoom':
      sessie.room?.disconnect(sessie.conn.id);
      sessie.room = null;
      sessie.conn.send({ kind: 'roomList', rooms: manager.openList() });
      break;
    default:
      // In-room berichten naar de tafel van deze verbinding.
      sessie.room?.handleMessage(sessie.conn.id, msg);
      break;
  }
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MSG_BYTES });
let teller = 0;
wss.on('connection', (ws: WebSocket) => {
  const id = `c${++teller}`;
  const conn: ClientConn = {
    id,
    send: (msg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
  };
  const sessie: Sessie = { conn, clientId: '', name: '', room: null, msgVensterStart: 0, msgTeller: 0 };
  sessies.set(id, sessie);

  ws.on('message', (data) => {
    // Rate-limit: te veel berichten in 1s → stilletjes negeren (beschermt de tafels).
    const nu = Date.now();
    if (nu - sessie.msgVensterStart > 1000) {
      sessie.msgVensterStart = nu;
      sessie.msgTeller = 0;
    }
    if (++sessie.msgTeller > MAX_MSG_PER_SEC) return;

    let msg: NetMessage;
    try {
      msg = JSON.parse(String(data)) as NetMessage;
    } catch {
      return;
    }
    // Eén kapot bericht mag nooit de hele server (alle tafels) neerhalen.
    try {
      verwerk(sessie, msg);
    } catch (err) {
      console.error(`[verwerk] fout bij bericht van ${id}:`, (err as Error).message);
    }
  });

  const sluit = (): void => {
    sessie.room?.disconnect(id);
    sessies.delete(id);
  };
  ws.on('close', sluit);
  ws.on('error', sluit);
});

server.listen(PORT, () => {
  console.log(`Kingen-server luistert op http://localhost:${PORT} (WebSocket op /ws)`);
  console.log(serveStatic ? `Serveert client uit ${PUBLIC_DIR}` : 'Geen client-build (dev-modus)');
});

// Vangnet: een onverwachte fout (bijv. in een room-timer) mag de server niet
// fataal neerhalen tijdens een potje — log en blijf draaien.
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));

// Nette shutdown: schrijf uitgestelde stats weg vóór het proces stopt
// (docker stop stuurt SIGTERM), zodat de laatste tellers niet verloren gaan.
const shutdown = (sig: string): void => {
  console.log(`${sig} ontvangen — stats wegschrijven en afsluiten…`);
  stats.flush();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
