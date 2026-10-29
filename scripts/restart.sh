#!/usr/bin/env bash
# Dev helper: rebuild and restart the production server on :3000 with .env loaded.
set -e
cd "$(dirname "$0")/.."
fuser -k 3000/tcp >/dev/null 2>&1 || true
npm run build 2>&1 | grep -E "✓ Compiled|rror|Failed" || true
set -a; . ./.env; set +a
nohup npm start > "${LOG:-/tmp/omega-server.log}" 2>&1 &
pg_isready -q -h localhost || service postgresql start >/dev/null
for i in $(seq 1 30); do curl -sf localhost:3000/api/health >/dev/null && echo "server up" && exit 0; sleep 1; done
echo "server failed to start"; exit 1
