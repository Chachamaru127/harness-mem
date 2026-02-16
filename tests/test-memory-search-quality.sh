#!/bin/bash
# Search quality guard for unified harness memory.
# - Runs deterministic unit/integration search tests
# - Validates HTTP path privacy behavior through daemon/client

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "[memory-quality] bun is required"
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "[memory-quality] jq is required"
  exit 1
fi

echo "[memory-quality] running memory-server quality tests"
(
  cd "$ROOT/memory-server"
  bun test tests/unit/core.test.ts tests/integration/search-quality.test.ts
)

TMP_HOME="$(mktemp -d)"
PORT="${HARNESS_MEM_QUALITY_PORT:-37997}"
PROJECT_NAME="memory-quality-http"
MARKER="quality-http-$(date +%s)-$RANDOM"

cleanup() {
  HARNESS_MEM_HOME="$TMP_HOME" \
    HARNESS_MEM_DB_PATH="$TMP_HOME/harness-mem.db" \
    HARNESS_MEM_HOST="127.0.0.1" \
    HARNESS_MEM_PORT="$PORT" \
    HARNESS_MEM_CODEX_PROJECT_ROOT="$ROOT" \
    "$ROOT/scripts/harness-memd" stop --quiet >/dev/null 2>&1 || true
  rm -rf "$TMP_HOME"
}
trap cleanup EXIT

echo "[memory-quality] starting isolated daemon"
HARNESS_MEM_HOME="$TMP_HOME" \
  HARNESS_MEM_DB_PATH="$TMP_HOME/harness-mem.db" \
  HARNESS_MEM_HOST="127.0.0.1" \
  HARNESS_MEM_PORT="$PORT" \
  HARNESS_MEM_CODEX_PROJECT_ROOT="$ROOT" \
  "$ROOT/scripts/harness-memd" start --quiet

echo "[memory-quality] record public/private events"
jq -nc \
  --arg project "$PROJECT_NAME" \
  --arg marker "$MARKER" \
  '{event:{platform:"claude",project:$project,session_id:"quality-http",event_type:"user_prompt",payload:{content:("public " + $marker)},tags:["quality_http"],privacy_tags:[]}}' \
  | HARNESS_MEM_HOME="$TMP_HOME" \
    HARNESS_MEM_DB_PATH="$TMP_HOME/harness-mem.db" \
    HARNESS_MEM_HOST="127.0.0.1" \
    HARNESS_MEM_PORT="$PORT" \
    HARNESS_MEM_CODEX_PROJECT_ROOT="$ROOT" \
    "$ROOT/scripts/harness-mem-client.sh" record-event >/dev/null

jq -nc \
  --arg project "$PROJECT_NAME" \
  --arg marker "$MARKER" \
  '{event:{platform:"claude",project:$project,session_id:"quality-http",event_type:"user_prompt",payload:{content:("private " + $marker)},tags:["quality_http"],privacy_tags:["private"]}}' \
  | HARNESS_MEM_HOME="$TMP_HOME" \
    HARNESS_MEM_DB_PATH="$TMP_HOME/harness-mem.db" \
    HARNESS_MEM_HOST="127.0.0.1" \
    HARNESS_MEM_PORT="$PORT" \
    HARNESS_MEM_CODEX_PROJECT_ROOT="$ROOT" \
    "$ROOT/scripts/harness-mem-client.sh" record-event >/dev/null

echo "[memory-quality] verify private hidden by default"
DEFAULT_SEARCH="$(
  jq -nc --arg q "$MARKER" --arg project "$PROJECT_NAME" '{query:$q,project:$project,limit:10,include_private:false}' \
    | HARNESS_MEM_HOME="$TMP_HOME" \
      HARNESS_MEM_DB_PATH="$TMP_HOME/harness-mem.db" \
      HARNESS_MEM_HOST="127.0.0.1" \
      HARNESS_MEM_PORT="$PORT" \
      HARNESS_MEM_CODEX_PROJECT_ROOT="$ROOT" \
      "$ROOT/scripts/harness-mem-client.sh" search
)"
printf '%s' "$DEFAULT_SEARCH" | jq -e '.ok == true and (.items | length) >= 1' >/dev/null
printf '%s' "$DEFAULT_SEARCH" | jq -e '[.items[] | (.privacy_tags // []) | index("private")] | map(select(. != null)) | length == 0' >/dev/null

echo "[memory-quality] verify private visible when include_private=true"
PRIVATE_SEARCH="$(
  jq -nc --arg q "$MARKER" --arg project "$PROJECT_NAME" '{query:$q,project:$project,limit:10,include_private:true}' \
    | HARNESS_MEM_HOME="$TMP_HOME" \
      HARNESS_MEM_DB_PATH="$TMP_HOME/harness-mem.db" \
      HARNESS_MEM_HOST="127.0.0.1" \
      HARNESS_MEM_PORT="$PORT" \
      HARNESS_MEM_CODEX_PROJECT_ROOT="$ROOT" \
      "$ROOT/scripts/harness-mem-client.sh" search
)"
printf '%s' "$PRIVATE_SEARCH" | jq -e '[.items[] | (.privacy_tags // []) | index("private")] | map(select(. != null)) | length >= 1' >/dev/null

echo "[memory-quality] PASSED"
