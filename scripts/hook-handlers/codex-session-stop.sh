#!/bin/bash
# codex-session-stop.sh
# Codex CLI Stop hook: finalize session in unified memory DB
# For Codex CLI v0.114.0+ experimental hooks engine

set +e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLIENT_SCRIPT="${PARENT_DIR}/harness-mem-client.sh"
PROJECT_CONTEXT_LIB="${SCRIPT_DIR}/lib/project-context.sh"

if [ -f "$PROJECT_CONTEXT_LIB" ]; then
  # shellcheck disable=SC1090
  source "$PROJECT_CONTEXT_LIB"
fi

INPUT=""
if [ ! -t 0 ]; then
  INPUT="$(cat 2>/dev/null)"
fi

PROJECT_ROOT=""
PROJECT_NAME=""
if command -v resolve_project_context >/dev/null 2>&1; then
  CONTEXT="$(resolve_project_context "$INPUT")"
  PROJECT_ROOT="$(printf '%s\n' "$CONTEXT" | sed -n '1p')"
  PROJECT_NAME="$(printf '%s\n' "$CONTEXT" | sed -n '2p')"
fi

[ -n "$PROJECT_ROOT" ] || PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
[ -n "$PROJECT_NAME" ] || PROJECT_NAME="$(basename "$PROJECT_ROOT")"

SESSION_ID=""
if [ -n "$INPUT" ] && command -v jq >/dev/null 2>&1; then
  SESSION_ID="$(printf '%s' "$INPUT" | jq -r '.session_id // .thread_id // empty' 2>/dev/null)"
fi

[ -z "$SESSION_ID" ] && exit 0
[ -x "$CLIENT_SCRIPT" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

# Finalize session
FINALIZE_PAYLOAD=$(jq -nc \
  --arg platform "codex" \
  --arg project "$PROJECT_NAME" \
  --arg session_id "$SESSION_ID" \
  '{platform:$platform,project:$project,session_id:$session_id,summary_mode:"standard"}' 2>/dev/null)

if [ -n "$FINALIZE_PAYLOAD" ]; then
  printf '%s' "$FINALIZE_PAYLOAD" | "$CLIENT_SCRIPT" finalize-session >/dev/null 2>&1 || true
fi

exit 0
