/**
 * @kingen/server — index.ts
 * HTTP + WebSocket-server. Serveert de gebouwde client (statisch, met SPA-
 * fallback) én host de WebSocket op /ws — alles op één poort, geen CORS.
 * Fase 1: precies één room ('ONLINE'); de lobby met meerdere rooms volgt in
 * Fase 2.
 */

import http from 'node:http';
import { existsSync } from 'node:fs';
import { WebSocketServer, type WebSocket } from 'ws';
import sirv from 'sirv';
import type { NetMessage } from '@kingen/shared/net/protocol.ts';
import { Room, type ClientConn } from './room.ts';

const PORT = Number(process.env.PORT ?? 8080);
// Map met de gebouwde client (vite dist). In dev draait de client apart op Vite;
// dan bestaat deze map niet en serveren we alleen een statusregel.
const PUBLIC_DIR = process.env.PUBLIC_DIR ?? './public';

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

const wss = new WebSocketServer({ server, path: '/ws' });
// KINGEN_AI_FAST=1 → AI zonder denkvertraging (handig voor tests/CI).
const aiDelay: [number, number] | undefined = process.env.KINGEN_AI_FAST ? [0, 0] : undefined;
const moveTimeoutMs = Number(process.env.MOVE_TIMEOUT_MS ?? 60000);
const room = new Room('ONLINE', 'Online tafel', undefined, aiDelay, moveTimeoutMs);

let teller = 0;
wss.on('connection', (ws: WebSocket) => {
  const id = `c${++teller}`;
  const conn: ClientConn = {
    id,
    send: (msg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
  };
  room.connect(conn);

  ws.on('message', (data) => {
    let msg: NetMessage;
    try {
      msg = JSON.parse(String(data)) as NetMessage;
    } catch {
      return; // ongeldige JSON negeren
    }
    room.handleMessage(id, msg);
  });

  ws.on('close', () => room.disconnect(id));
  ws.on('error', () => room.disconnect(id));
});

server.listen(PORT, () => {
  console.log(`Kingen-server luistert op http://localhost:${PORT} (WebSocket op /ws)`);
  console.log(serveStatic ? `Serveert client uit ${PUBLIC_DIR}` : 'Geen client-build (dev-modus)');
});
