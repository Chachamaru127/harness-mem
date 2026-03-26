#!/bin/bash
# codex-session-stop.sh
# Codex CLI Stop hook: finalize session in unified memory DB
# For Codex CLI v0.114.0+ experimental hooks engine

set +e

# shellcheck disable=SC1090
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/hook-common.sh"

hook_init_paths
hook_init_context
hook_resolve_session_id "codex" "" "require"
hook_init_continuity_state
hook_resolve_correlation_id "$SESSION_ID" "codex" "$INPUT"
hook_check_deps

# Finalize session
FINALIZE_PAYLOAD=$(jq -nc \
  --arg platform "codex" \
  --arg project "$PROJECT_NAME" \
  --arg session_id "$SESSION_ID" \
  --arg correlation_id "$CORRELATION_ID" \
  '{platform:$platform,project:$project,session_id:$session_id,correlation_id:$correlation_id,summary_mode:"standard"}' 2>/dev/null)

if [ -n "$FINALIZE_PAYLOAD" ]; then
  FINALIZE_RESPONSE="$(printf '%s' "$FINALIZE_PAYLOAD" | "$CLIENT_SCRIPT" finalize-session 2>/dev/null || true)"
  if [ -n "$FINALIZE_RESPONSE" ] && command -v jq >/dev/null 2>&1; then
    FINALIZED_AT="$(printf '%s' "$FINALIZE_RESPONSE" | jq -r '.items[0].finalized_at // empty' 2>/dev/null)"
    hook_mark_continuity_handoff "$SESSION_ID" "codex" "$CORRELATION_ID" "standard" "$FINALIZED_AT"
  fi
fi

exit 0
