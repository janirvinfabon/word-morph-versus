#!/usr/bin/env bash
# Boots wrangler dev, waits for readiness, runs the PARTY WS integration
# driver, then tears the server down. Self-contained.
set -u
PORT="${PORT:-8788}"
LOG="$(mktemp)"

npx wrangler dev --port "$PORT" >"$LOG" 2>&1 &
WPID=$!

cleanup() {
  kill "$WPID" 2>/dev/null
  wait "$WPID" 2>/dev/null
}
trap cleanup EXIT

ready=0
for _ in $(seq 1 40); do
  if curl -s -o /dev/null "http://127.0.0.1:${PORT}/" 2>/dev/null; then
    ready=1
    break
  fi
  sleep 1
done

echo "=== wrangler log (head) ==="
head -n 20 "$LOG"
echo "==========================="

if [ "$ready" -ne 1 ]; then
  echo "server did not become ready"
  exit 1
fi

node test/ws-party.mjs "ws://127.0.0.1:${PORT}"
exit $?
