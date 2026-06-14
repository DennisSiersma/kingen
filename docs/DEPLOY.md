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

## Productie op de VPS (siersma.farcon.cloud) — Cloudflare-tunnel

> **Belangrijk:** deze VPS draait via een **Cloudflare-tunnel** (cloudflared), NIET
> via Caddy. De app bindt lokaal op `127.0.0.1:8090` via een **lokale**
> `docker-compose.override.yml` (staat niet in de repo). Gebruik hier de **basis**
> `docker-compose.yml`. Gebruik **NIET** `docker-compose.prod.yml` (Caddy) — die
> bindt poort 80/443 en geeft `address already in use`.

**Deploy / updaten** (in `/opt/kingen` op de VPS):
```bash
./deploy.sh
```
Dat doet `git pull` → `docker compose up -d --build` (basis + override) →
health-check op `127.0.0.1:8090`. Handmatig komt het hierop neer:
```bash
git pull
docker compose up -d --build        # géén -f docker-compose.prod.yml
curl -s http://127.0.0.1:8090/health   # 'ok'
```

**De lokale override** (`/opt/kingen/docker-compose.override.yml`, eenmalig, bindt
de app privé achter de tunnel):
```yaml
services:
  kingen:
    ports: !override
      - "127.0.0.1:8090:8080"
```

**De tunnel** routeert `siersma.farcon.cloud` → `http://localhost:8090`
(cloudflared draait als service op de VPS; WebSockets werken via de tunnel).
**Toegang beperken (optioneel):** zet **Cloudflare Access** vóór het subdomein.

### Alternatief: Caddy (andere machine, geen tunnel)
Alleen op een server waar je 80/443 + TLS zélf afhandelt:
```bash
docker compose -f docker-compose.prod.yml up -d --build
```
DNS `A`-record → VPS-IP, Cloudflare SSL/TLS op **Full (strict)** (eerste keer evt.
proxy op "DNS only" zodat Caddy het Let's Encrypt-cert kan ophalen).

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
