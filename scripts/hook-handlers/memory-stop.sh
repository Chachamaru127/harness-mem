#!/bin/bash
# memory-stop.sh
# Stop hook: finalize session summary in unified memory DB

set +e

# shellcheck disable=SC1090
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/hook-common.sh"

hook_init_paths
hook_init_context

STATE_DIR="${PROJECT_ROOT}/.claude/state"
SESSION_FILE="${STATE_DIR}/session.json"

hook_resolve_session_id "claude" "$SESSION_FILE" "require"

SUMMARY_MODE="standard"
if [ -n "$INPUT" ] && command -v jq >/dev/null 2>&1; then
  SUMMARY_MODE="$(printf '%s' "$INPUT" | jq -r '.summary_mode // "standard"' 2>/dev/null)"
fi

hook_check_deps

FINALIZE_PAYLOAD=$(jq -nc \
  --arg platform "claude" \
  --arg project "$PROJECT_NAME" \
  --arg session_id "$SESSION_ID" \
  --arg summary_mode "$SUMMARY_MODE" \
  '{platform:$platform,project:$project,session_id:$session_id,summary_mode:$summary_mode}' 2>/dev/null)

if [ -n "$FINALIZE_PAYLOAD" ]; then
  printf '%s' "$FINALIZE_PAYLOAD" | "$CLIENT_SCRIPT" finalize-session >/dev/null 2>&1 || true
fi

exit 0
