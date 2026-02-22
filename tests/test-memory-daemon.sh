#!/bin/bash
# Unified memory daemon integration smoke test

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP_HOME="$(mktemp -d)"
export HARNESS_MEM_HOME="$TMP_HOME"
export HARNESS_MEM_DB_PATH="$TMP_HOME/harness-mem.db"
export HARNESS_MEM_HOST="127.0.0.1"
export HARNESS_MEM_PORT="37988"
export HARNESS_MEM_CODEX_PROJECT_ROOT="$ROOT"

cleanup() {
  "$ROOT/scripts/harness-memd" stop --quiet >/dev/null 2>&1 || true
  rm -rf "$TMP_HOME"
}
trap cleanup EXIT

echo "[memory-test] start daemon"
"$ROOT/scripts/harness-memd" start --quiet

echo "[memory-test] health"
HEALTH="$($ROOT/scripts/harness-mem-client.sh health)"
printf '%s' "$HEALTH" | jq -e '.ok == true' >/dev/null

echo "[memory-test] record event"
$ROOT/scripts/harness-mem-client.sh record-event '{"event":{"platform":"claude","project":"test","session_id":"s1","event_type":"user_prompt","payload":{"content":"hello memory"},"tags":["test"],"privacy_tags":[]}}' >/dev/null

echo "[memory-test] search"
SEARCH="$($ROOT/scripts/harness-mem-client.sh search '{"query":"hello memory","project":"test","limit":5}')"
printf '%s' "$SEARCH" | jq -e '.ok == true and (.items | length) >= 1' >/dev/null

echo "[memory-test] admin metrics"
METRICS="$($ROOT/scripts/harness-mem-client.sh admin-metrics)"
printf '%s' "$METRICS" | jq -e '.ok == true' >/dev/null

echo "[memory-test] admin reindex"
REINDEX="$($ROOT/scripts/harness-mem-client.sh admin-reindex-vectors '{"limit":100}')"
printf '%s' "$REINDEX" | jq -e '.ok == true' >/dev/null

echo "[memory-test] stop daemon"
"$ROOT/scripts/harness-memd" stop --quiet

echo "[memory-test] PASSED"
