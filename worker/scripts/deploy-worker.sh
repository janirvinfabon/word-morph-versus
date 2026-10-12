#!/usr/bin/env bash
#
# deploy-worker.sh — build and deploy the WordMorph Cloudflare Worker (backend).
#
# What it does:
#   1. runs the unit tests (skip with SKIP_TESTS=1),
#   2. does a dry-run build to catch bundling/binding errors before shipping,
#   3. deploys the Worker (RoomDurableObject + LobbyRegistry),
#   4. verifies the live /health and /rooms endpoints respond.
#
# Config (override via env vars):
#   WORKER_URL    Deployed Worker base URL (used for post-deploy verification)
#   SKIP_TESTS=1  skip the test run
#
# Usage:
#   ./scripts/deploy-worker.sh
#   WORKER_URL="https://my-worker.example.workers.dev" ./scripts/deploy-worker.sh
#
# Note: assumes you are authenticated (`wrangler login`). The first deploy on a
# brand-new Cloudflare account may need a workers.dev subdomain created once via
# the dashboard (Workers & Pages) — see README.
#
set -euo pipefail

# ---- config ---------------------------------------------------------------
# Run from the worker/ dir (parent of this script's dir).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$WORKER_ROOT"

# Load the repo-root .env (git-ignored) if present, so the URL isn't hardcoded.
# The Worker verification URL comes from WORKER_URL, falling back to WS_URL.
REPO_ROOT="$(cd "$WORKER_ROOT/.." && pwd)"
if [ -f "$REPO_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$REPO_ROOT/.env"
  set +a
fi

WORKER_URL="${WORKER_URL:-${WS_URL:-}}"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
die() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$1" >&2; exit 1; }

[ -n "$WORKER_URL" ] || die "WORKER_URL/WS_URL not set. Create a .env (see .env.example) or pass WORKER_URL=..."

say "Worker deploy"
echo "  Worker URL : $WORKER_URL"

# ---- 1. tests -------------------------------------------------------------
if [ "${SKIP_TESTS:-0}" = "1" ]; then
  say "Skipping tests (SKIP_TESTS=1)"
else
  say "Running unit tests"
  npm test
fi

# ---- 2. dry-run build -----------------------------------------------------
say "Dry-run build (validating bundle + bindings)"
npx wrangler deploy --dry-run --outdir=dist

# ---- 3. deploy ------------------------------------------------------------
say "Deploying Worker"
npx wrangler deploy

# ---- 4. verify live -------------------------------------------------------
say "Verifying live endpoints"
# Edge can lag a few seconds right after deploy; retry briefly.
health=""
for _ in 1 2 3 4 5 6; do
  health="$(curl -s "${WORKER_URL}/health" || true)"
  printf '%s' "$health" | grep -q '"ok":true' && break
  sleep 3
done
printf '%s' "$health" | grep -q '"ok":true' \
  || die "/health did not return ok (got: ${health:-<empty>})"
echo "  OK: /health -> $health"

rooms="$(curl -s "${WORKER_URL}/rooms" || true)"
printf '%s' "$rooms" | grep -q '"rooms"' \
  || die "/rooms did not return a rooms list (got: ${rooms:-<empty>})"
echo "  OK: /rooms -> $rooms"

say "Done — Worker deployed and healthy at $WORKER_URL"
