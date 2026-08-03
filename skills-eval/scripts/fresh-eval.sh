#!/usr/bin/env bash
# Fresh, isolated skills-eval run.
#
# Stands up a DEDICATED local backend for the behavioural eval so every run
# starts from a pristine, known DB — independent of the developer's shared
# `.wrangler/state` (and their parallel e2e run):
#
#   1. WIPE   a dedicated persist dir (its own D1/KV, separate from the default).
#   2. MIGRATE that fresh D1 (`wrangler d1 migrations apply … --persist-to <dir>`).
#   3. BOOT   `react-router dev` pointed at it via `SE_PERSIST_TO` (see vite.config.ts).
#   4. SEED   the fixture project + owner and MINT an admin key (bootstrap.mjs,
#             `SE_STATE_DIR` → the eval dir, `SE_ENV_OUT` → a scratch env file so
#             the developer's `.contract-env.json` is never clobbered).
#   5. RUN    the eval against that server with the minted token.
#   6. TEARDOWN — kill the server (trap), leaving the wiped dir for next time.
#
# Usage (from anywhere):
#   bash marketplace/skills-eval/scripts/fresh-eval.sh [caseFilter] [-- passthrough]
#   e.g.  bash …/fresh-eval.sh flags
#
# Env overrides:
#   SE_EVAL_PORT      port for the eval dev server        (default 3111)
#   SE_EVAL_PERSIST   dedicated persist dir               (default apps/ui-rr/.wrangler/eval-state)
#   SHIPEASY_EVAL_K   runs per case                       (passed through)
#   Any other SHIPEASY_EVAL_* var is passed through to the eval.
#
# NOTE: one dev server per project dir — stop a parallel apps/ui-rr
# `react-router dev` (e.g. your e2e server) before running this.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVAL_DIR="$(cd "$HERE/.." && pwd)"                 # marketplace/skills-eval
REPO_ROOT="$(cd "$EVAL_DIR/../.." && pwd)"          # repo root (marketplace is a submodule)
UI_DIR="$REPO_ROOT/apps/ui-rr"

PORT="${SE_EVAL_PORT:-3111}"
BASE_URL="http://127.0.0.1:${PORT}"
PERSIST="${SE_EVAL_PERSIST:-$UI_DIR/.wrangler/eval-state}"
ENV_OUT="$EVAL_DIR/.eval-workdir/eval-env.json"
AUTH_SECRET="${AUTH_SECRET:-e2e-test-secret-not-for-production-use-only}"
FILTER="${1:-}"

mkdir -p "$EVAL_DIR/.eval-workdir"

SERVER_PID=""
cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    echo "[fresh-eval] stopping the dev server (pid $SERVER_PID)..."
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Free the port (a stale server would make Vite boot on PORT+1 and desync).
if command -v lsof >/dev/null 2>&1; then
  STALE="$(lsof -ti:"$PORT" 2>/dev/null || true)"
  [[ -n "$STALE" ]] && { echo "[fresh-eval] freeing :$PORT ($STALE)"; echo "$STALE" | xargs kill -9 2>/dev/null || true; sleep 1; }
fi

echo "[fresh-eval] wiping dedicated DB state at $PERSIST"
rm -rf "$PERSIST"

echo "[fresh-eval] migrating fresh D1..."
(cd "$UI_DIR" && pnpm exec wrangler d1 migrations apply shipeasy-db --local --persist-to "$PERSIST" >/dev/null 2>&1)

echo "[fresh-eval] booting react-router dev on :$PORT (isolated state)..."
# Path alignment: `wrangler --persist-to <dir>` and the Cloudflare Vite plugin
# BOTH write under `<dir>/v3/…`, so both take the same BASE dir. (Next's OpenNext
# proxy was the odd one out, needing `<dir>/v3` spelled out — hence the old
# `SE_EVAL_PERSIST="$PERSIST/v3"`.) `bootstrap.mjs`'s SE_STATE_DIR also keeps
# `<dir>` and appends `/v3/d1/…` itself.
#
# `--host 127.0.0.1` is load-bearing: with no --host, Vite binds `localhost`,
# which resolves to `::1` ONLY, and every probe against $BASE_URL's IPv4 literal
# is refused while the server is actually up.
#
# CLOUDFLARE_ENV=e2e resolves `.dev.vars.e2e` instead of the developer's real
# `.dev.vars` — the app runs in workerd, which does NOT inherit this shell, so
# an exported AUTH_SECRET simply is not there and the cookie bootstrap.mjs signs
# would never verify. It replaces Next's NEXT_DEV_WRANGLER_ENV.
(cd "$UI_DIR" && \
  SE_PERSIST_TO="$PERSIST" \
  CLOUDFLARE_ENV=e2e \
  SE_E2E=1 \
  pnpm exec react-router dev --port "$PORT" --host 127.0.0.1 \
    >"$EVAL_DIR/.eval-workdir/dev-server.log" 2>&1) &
SERVER_PID=$!

echo "[fresh-eval] waiting for server..."
for i in $(seq 1 120); do
  if curl -s -o /dev/null --max-time 5 "$BASE_URL/api/admin/gates" 2>/dev/null; then
    echo "[fresh-eval] server up after ${i}s"; break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "[fresh-eval] dev server died — tail of log:"; tail -30 "$EVAL_DIR/.eval-workdir/dev-server.log"; exit 1
  fi
  sleep 1
  [[ "$i" == "120" ]] && { echo "[fresh-eval] server not ready in 120s"; tail -30 "$EVAL_DIR/.eval-workdir/dev-server.log"; exit 1; }
done

echo "[fresh-eval] seeding fixture project + minting admin key (isolated D1)..."
BEARER="$(cd "$UI_DIR" && \
  SE_STATE_DIR="$PERSIST" \
  SE_ENV_OUT="$ENV_OUT" \
  CONTRACT_BASE_URL="$BASE_URL" \
  AUTH_SECRET="$AUTH_SECRET" \
  node contract-tests/bootstrap.mjs)"
if [[ -z "$BEARER" ]]; then echo "[fresh-eval] mint failed"; exit 1; fi

# Warm the admin routes the MCP tools hit. Vite transforms each route module on
# first request; a cold route under an agent run returns a slow/transient error,
# so the agent gives up and the transcript shows no tool calls ("saw [none]").
# One serial GET per route forces compilation up front (status is irrelevant) —
# same fix contract-tests/run.sh uses before its fuzz.
echo "[fresh-eval] warming admin routes (transforming route modules)..."
for route in gates gates/templates killswitches configs experiments universes metrics events alert-rules ops attributes; do
  curl -s -o /dev/null --max-time 60 \
    -H "Authorization: Bearer $BEARER" -H "X-Project-Id: e2e-project-id" \
    "$BASE_URL/api/admin/$route" || true
done

echo "[fresh-eval] running eval${FILTER:+ (filter: $FILTER)}..."
cd "$EVAL_DIR"
SHIPEASY_EVAL_TOKEN="$BEARER" \
SHIPEASY_EVAL_PROJECT_ID=e2e-project-id \
SHIPEASY_EVAL_BASE_URL="$BASE_URL" \
  pnpm exec tsx src/run.ts ${FILTER:+-- "$FILTER"}
