#!/bin/bash
# Harness template: Cursor hook wrapper.
# This script forwards stdin JSON to harness-mem's central cursor hook receiver.

set +e

HARNESS_ROOT="__HARNESS_ROOT__"
HANDLER="${HARNESS_ROOT}/scripts/hook-handlers/memory-cursor-event.sh"

INPUT_JSON=""
if [ ! -t 0 ]; then
  INPUT_JSON="$(cat 2>/dev/null)"
fi

[ -x "$HANDLER" ] || exit 0

if [ -n "$INPUT_JSON" ]; then
  printf '%s' "$INPUT_JSON" | "$HANDLER" "$@" >/dev/null 2>&1 || true
else
  "$HANDLER" "$@" >/dev/null 2>&1 || true
fi

exit 0
