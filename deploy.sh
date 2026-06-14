#!/usr/bin/env bash
#
# Productie-deploy voor de VPS achter de Cloudflare-tunnel (siersma.farcon.cloud).
#
# Gebruikt de BASIS docker-compose.yml + de lokale docker-compose.override.yml
# (die bindt op 127.0.0.1:8090). Daar wijst de Cloudflare-tunnel naartoe.
#
# Gebruik NIET docker-compose.prod.yml op deze VPS — dat is de Caddy-variant die
# poort 80/443 bindt en faalt met "address already in use".
#
# Draaien op de VPS:  cd /opt/kingen && ./deploy.sh
#
set -euo pipefail
cd "$(dirname "$0")"

echo "→ git pull"
git pull

if [ ! -f docker-compose.override.yml ]; then
  echo "⚠  docker-compose.override.yml ontbreekt — zonder dit bindt de app PUBLIEK op 0.0.0.0:8080."
  echo "   Maak hem aan met (bindt op 127.0.0.1:8090, achter de tunnel):"
  echo '   printf "services:\n  kingen:\n    ports: !override\n      - \"127.0.0.1:8090:8080\"\n" > docker-compose.override.yml'
  echo "   en draai ./deploy.sh opnieuw."
  exit 1
fi

echo "→ docker compose up -d --build (basis + override)"
docker compose up -d --build

echo "→ status"
docker compose ps

echo "→ health-check (127.0.0.1:8090)"
if curl -fsS http://127.0.0.1:8090/health >/dev/null; then
  echo "✓ OK — https://siersma.farcon.cloud zou nu live moeten zijn."
else
  echo "✗ Geen 'ok' op 127.0.0.1:8090 — check 'docker compose logs -f' en de override-poort."
  exit 1
fi
