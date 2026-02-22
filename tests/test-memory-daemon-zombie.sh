#!/bin/bash
# Daemon start/stop loop test (zombie guard)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOOPS="${1:-100}"
TMP_HOME="$(mktemp -d)"
export HARNESS_MEM_HOME="$TMP_HOME"
export HARNESS_MEM_DB_PATH="$TMP_HOME/harness-mem.db"
export HARNESS_MEM_HOST="127.0.0.1"
export HARNESS_MEM_PORT="37989"
export HARNESS_MEM_UI_PORT="38989"

cleanup() {
  "$ROOT/scripts/harness-memd" stop --quiet >/dev/null 2>&1 || true
  rm -rf "$TMP_HOME"
}
trap cleanup EXIT

for i in $(seq 1 "$LOOPS"); do
  "$ROOT/scripts/harness-memd" start --quiet
  "$ROOT/scripts/harness-memd" stop --quiet
  if lsof -nP -tiTCP:"$HARNESS_MEM_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[FAIL] daemon port still listening after stop at loop $i"
    exit 1
  fi
  if lsof -nP -tiTCP:"$HARNESS_MEM_UI_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[FAIL] ui port still listening after stop at loop $i"
    exit 1
  fi
  if [ $((i % 10)) -eq 0 ]; then
    echo "loop $i/$LOOPS"
  fi
done

echo "[PASS] no zombie detected after $LOOPS loops"
