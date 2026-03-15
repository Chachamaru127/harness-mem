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
hook_check_deps

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
