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
import type { ClientConn, Room } from './room.ts';
import { RoomManager } from './roomManager.ts';

const PORT = Number(process.env.PORT ?? 8080);
const PUBLIC_DIR = process.env.PUBLIC_DIR ?? './public';
const aiDelay: [number, number] | undefined = process.env.KINGEN_AI_FAST ? [0, 0] : undefined;
const moveTimeoutMs = Number(process.env.MOVE_TIMEOUT_MS ?? 60000);
const maxRooms = Number(process.env.MAX_ROOMS ?? 4);

const serveStatic =
  existsSync(PUBLIC_DIR) ? sirv(PUBLIC_DIR, { single: true, gzip: true, brotli: true }) : null;

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
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
}

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
});

function verwerk(sessie: Sessie, msg: NetMessage): void {
  switch (msg.kind) {
    case 'hello':
      sessie.clientId = msg.clientId;
      sessie.name = msg.name;
      sessie.conn.send({ kind: 'helloOk', connectionId: sessie.conn.id, clientId: msg.clientId });
      sessie.conn.send({ kind: 'roomList', rooms: manager.openList() });
      break;
    case 'listRooms':
      sessie.conn.send({ kind: 'roomList', rooms: manager.openList() });
      break;
    case 'createRoom': {
      const room = manager.create(msg.naam, msg.maxPlayers, msg.zichtbaarheid);
      if (!room) {
        sessie.conn.send({ kind: 'error', code: 'max-tafels', melding: 'Maximaal aantal tafels bereikt' });
        break;
      }
      if (room.join(sessie.conn, sessie.clientId, sessie.name)) sessie.room = room;
      break;
    }
    case 'joinRoom': {
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

const wss = new WebSocketServer({ server, path: '/ws' });
let teller = 0;
wss.on('connection', (ws: WebSocket) => {
  const id = `c${++teller}`;
  const conn: ClientConn = {
    id,
    send: (msg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
  };
  const sessie: Sessie = { conn, clientId: '', name: '', room: null };
  sessies.set(id, sessie);

  ws.on('message', (data) => {
    let msg: NetMessage;
    try {
      msg = JSON.parse(String(data)) as NetMessage;
    } catch {
      return;
    }
    verwerk(sessie, msg);
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
