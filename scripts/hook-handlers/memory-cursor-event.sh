#!/bin/bash
# memory-cursor-event.sh
# Cursor hooks receiver: append incoming hook JSON to local spool JSONL.

set +e

INPUT_JSON=""
if [ ! -t 0 ]; then
  INPUT_JSON="$(cat 2>/dev/null)"
fi

[ -n "$INPUT_JSON" ] || exit 0

SPOOL_PATH="${HARNESS_MEM_CURSOR_EVENTS_PATH:-$HOME/.harness-mem/adapters/cursor/events.jsonl}"
SPOOL_DIR="$(dirname "$SPOOL_PATH")"
mkdir -p "$SPOOL_DIR" >/dev/null 2>&1 || exit 0

if command -v jq >/dev/null 2>&1; then
  COMPACT="$(printf '%s' "$INPUT_JSON" | jq -c '.' 2>/dev/null)"
  if [ -n "$COMPACT" ]; then
    printf '%s\n' "$COMPACT" >>"$SPOOL_PATH" 2>/dev/null || true
    exit 0
  fi
fi

# Fallback: best-effort single-line append.
ONE_LINE="$(printf '%s' "$INPUT_JSON" | tr '\n' ' ' | tr '\r' ' ')"
[ -n "$ONE_LINE" ] || exit 0
printf '%s\n' "$ONE_LINE" >>"$SPOOL_PATH" 2>/dev/null || true
exit 0
