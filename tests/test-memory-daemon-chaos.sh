#!/bin/bash
# Chaos validation for harness-memd kill/restart behavior

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP_HOME="$(mktemp -d)"
PORT="${HARNESS_MEM_CHAOS_PORT:-37996}"
ROUNDS="${1:-5}"

export HARNESS_MEM_HOME="$TMP_HOME"
export HARNESS_MEM_DB_PATH="$TMP_HOME/harness-mem.db"
export HARNESS_MEM_HOST="127.0.0.1"
export HARNESS_MEM_PORT="$PORT"
export HARNESS_MEM_CODEX_PROJECT_ROOT="$ROOT"
export HARNESS_MEM_ENABLE_OPENCODE_INGEST="false"
export HARNESS_MEM_ENABLE_CURSOR_INGEST="false"
export HARNESS_MEM_ENABLE_ANTIGRAVITY_INGEST="false"

cleanup() {
  "$ROOT/scripts/harness-memd" stop --quiet >/dev/null 2>&1 || true
  rm -rf "$TMP_HOME"
}
trap cleanup EXIT

"$ROOT/scripts/harness-memd" start --quiet

for round in $(seq 1 "$ROUNDS"); do
  "$ROOT/scripts/harness-mem-client.sh" record-event "{\"event\":{\"event_id\":\"chaos-${round}\",\"platform\":\"codex\",\"project\":\"chaos\",\"session_id\":\"chaos-session\",\"event_type\":\"user_prompt\",\"payload\":{\"content\":\"chaos round ${round}\"},\"tags\":[\"chaos\"],\"privacy_tags\":[]}}" >/dev/null

  pid="$(cat "$HARNESS_MEM_HOME/daemon.pid" 2>/dev/null || true)"
  if [ -n "$pid" ]; then
    kill -KILL "$pid" >/dev/null 2>&1 || true
  fi

  "$ROOT/scripts/harness-memd" start --quiet

  health="$($ROOT/scripts/harness-mem-client.sh health)"
  printf '%s' "$health" | jq -e '.ok == true' >/dev/null

  search="$($ROOT/scripts/harness-mem-client.sh search '{"query":"chaos round","project":"chaos","limit":5}')"
  printf '%s' "$search" | jq -e '.ok == true and (.items | length) >= 1' >/dev/null

done

echo "[chaos] PASSED rounds=${ROUNDS}"
