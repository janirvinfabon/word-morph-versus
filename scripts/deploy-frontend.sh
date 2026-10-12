#!/usr/bin/env bash
#
# deploy-frontend.sh — build and deploy the WordMorph frontend to Cloudflare Pages.
#
# What it does:
#   1. runs the test suite (skip with SKIP_TESTS=1),
#   2. generates the static site with the production Worker URL baked in,
#   3. verifies the Worker URL actually landed in the output,
#   4. deploys .output/public to the Cloudflare Pages project,
#   5. verifies the live site responds.
#
# Config (override via env vars):
#   WS_URL        Worker base URL baked into the build (NUXT_PUBLIC_WS_URL)
#   PAGES_PROJECT Cloudflare Pages project name
#   BRANCH        Pages branch (production branch = main)
#   SKIP_TESTS=1  skip the test run
#
# Usage:
#   ./scripts/deploy-frontend.sh
#   WS_URL="https://my-worker.example.workers.dev" ./scripts/deploy-frontend.sh
#
set -euo pipefail

# ---- config ---------------------------------------------------------------
# Resolve repo root (parent of this script's dir) and run from there.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

# Load .env (git-ignored) if present, so the Worker URL isn't hardcoded here.
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi

WS_URL="${WS_URL:-}"
PAGES_PROJECT="${PAGES_PROJECT:-word-morph-versus}"
BRANCH="${BRANCH:-main}"
OUT_DIR=".output/public"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
die() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$1" >&2; exit 1; }

[ -n "$WS_URL" ] || die "WS_URL is not set. Create a .env (see .env.example) or pass WS_URL=..."

say "Frontend deploy"
echo "  Worker URL : $WS_URL"
echo "  Pages proj : $PAGES_PROJECT (branch: $BRANCH)"

# ---- 1. tests -------------------------------------------------------------
if [ "${SKIP_TESTS:-0}" = "1" ]; then
  say "Skipping tests (SKIP_TESTS=1)"
else
  say "Running tests"
  npm test
fi

# ---- 2. generate ----------------------------------------------------------
say "Generating static site with production Worker URL"
NUXT_PUBLIC_WS_URL="$WS_URL" npm run generate

# ---- 3. verify the URL was baked in --------------------------------------
say "Verifying Worker URL is present in the build"
HOST="$(printf '%s' "$WS_URL" | sed -E 's#^https?://##; s#/.*$##')"
if grep -rq "$HOST" "$OUT_DIR"/*.html; then
  echo "  OK: found $HOST in generated HTML"
else
  die "Worker host '$HOST' not found in $OUT_DIR — aborting before deploy."
fi

# ---- 4. deploy ------------------------------------------------------------
say "Deploying to Cloudflare Pages"
npx wrangler pages deploy "$OUT_DIR" \
  --project-name="$PAGES_PROJECT" \
  --branch="$BRANCH" \
  --commit-dirty=true

# ---- 5. verify live -------------------------------------------------------
say "Verifying live site"
LIVE_URL="https://${PAGES_PROJECT}.pages.dev/"
# Pages edge can lag a few seconds right after upload; retry briefly.
code=000
for _ in 1 2 3 4 5 6; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$LIVE_URL" || echo 000)"
  [ "$code" = "200" ] && break
  sleep 3
done
if [ "$code" = "200" ]; then
  echo "  OK: $LIVE_URL returned 200"
else
  die "Live site $LIVE_URL returned HTTP $code (edge may still be propagating)."
fi

say "Done — deployed to $LIVE_URL"
