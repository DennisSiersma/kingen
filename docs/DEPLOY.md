# Kingen — deployen (Docker)

De app is één Docker-image die de gebouwde client **en** de WebSocket-server op
één poort (8080) serveert. Geen aparte webserver nodig; de server-bundel is
self-contained (engine + ws + sirv erin), dus de runtime-image is slank.

Twee scenario's:
- **Dev/intern op Proxmox** — bereikbaar via `http://<host-ip>:8080`.
- **Productie op de VPS** — `https://siersma.farcon.cloud` via Caddy (auto-TLS),
  achter Cloudflare.

## Vereisten op de doelmachine

- Docker + Docker Compose-plugin. Op een schone Debian/Ubuntu (LXC/VM):
  ```bash
  curl -fsSL https://get.docker.com | sh
  ```
- De projectbestanden op de machine. Twee manieren:
  - **git clone** (vereist dat de huidige versie naar GitHub is gepusht):
    ```bash
    git clone https://github.com/DennisSiersma/kingen.git
    cd kingen
    ```
  - **rsync** vanaf je Mac (zonder GitHub), vanuit de projectmap:
    ```bash
    rsync -av --exclude node_modules --exclude dist --exclude .git \
      ./ user@HOST:/opt/kingen/
    ```

## Dev op Proxmox

In een Proxmox-LXC/VM met Docker, in de projectmap:

```bash
docker compose up -d --build
```

- Open `http://<proxmox-ip>:8080`.
- Online spelen: klik "🌐 Online (beta)" of ga naar `…:8080/?online`.
- Updaten na wijzigingen:
  ```bash
  git pull        # of opnieuw rsync'en
  docker compose up -d --build
  ```
- Stoppen: `docker compose down`. Logs: `docker compose logs -f`.

## Productie op de VPS (siersma.farcon.cloud)

1. **DNS (Cloudflare):** maak een `A`-record `siersma.farcon.cloud` → het IP van
   de VPS.
2. **TLS-modus:** zet in Cloudflare SSL/TLS op **Full (strict)**. Caddy haalt op
   de origin een echt Let's Encrypt-certificaat op.
   - Staat de Cloudflare-proxy (oranje wolk) aan, dan kan de HTTP-challenge
     mislukken. Twee opties:
     - Zet het record tijdens de **eerste** uitrol op **DNS only** (grijze wolk),
       laat Caddy het cert ophalen, zet de proxy daarna weer aan; of
     - gebruik een Cloudflare **Origin Certificate** + de DNS-challenge in Caddy.
3. **Starten** (in de projectmap op de VPS):
   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   ```
   Caddy luistert op 80/443, haalt automatisch het certificaat op en proxyt
   HTTP + de WebSocket (`/ws`) door naar de app.
4. Open `https://siersma.farcon.cloud`.
5. **Toegang beperken (optioneel):** zet **Cloudflare Access** (Zero Trust) vóór
   het subdomein voor een inlog-/allowlist-laag zolang er nog geen eigen accounts
   zijn.
6. Updaten: `git pull` (of rsync) + `docker compose -f docker-compose.prod.yml up -d --build`.

## Configuratie (env-vars)

| Variabele | Default | Betekenis |
|---|---|---|
| `PORT` | `8080` | Poort van de app in de container |
| `PUBLIC_DIR` | `/app/public` | Map met de gebouwde client (in de image al gezet) |
| `MAX_ROOMS` | `4` | Max. aantal tafels tegelijk (Fase 2) |
| `MOVE_TIMEOUT_MS` | `60000` | Zet-time-out → AI-overname (Fase 3) |
| `RECONNECT_GRACE_MS` | `120000` | Hoe lang een stoel gereserveerd blijft (Fase 3) |
| `KINGEN_AI_FAST` | — | `1` = AI zonder denkvertraging (tests/CI) |

## Zonder Docker (alternatief)

Op een machine met Node 22+:
```bash
npm ci
npm run build:all
PORT=8080 PUBLIC_DIR=packages/client/dist node packages/server/dist/index.cjs
```
Zet er desgewenst een reverse proxy (Caddy/nginx) vóór voor TLS, of draai onder
een procesmanager (systemd/pm2).

## Status

Dit dekt de huidige stand: **Fase 1** (één online tafel, AI-fill). De lobby met
meerdere rooms (Fase 2), chat/reconnect (Fase 3) en de bijbehorende env-vars
worden in latere fasen geactiveerd.
