#!/bin/bash
# memory-stop-failure.sh
# StopFailure hook: emergency flush of pending observations on API error termination

set +e

# shellcheck disable=SC1090
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/hook-common.sh"

hook_init_paths
hook_init_context

STATE_DIR="${PROJECT_ROOT}/.claude/state"
SESSION_FILE="${STATE_DIR}/session.json"

hook_resolve_session_id "claude" "$SESSION_FILE" "generate"

hook_check_deps

# Record a stop_failure event to mark this abnormal termination
EVENT_PAYLOAD=$(jq -nc \
  --arg platform "claude" \
  --arg project "$PROJECT_NAME" \
  --arg session_id "$SESSION_ID" \
  --arg event_type "stop_failure" \
  '{event:{platform:$platform,project:$project,session_id:$session_id,event_type:$event_type,payload:{},tags:["hook","stop_failure","error_termination"],privacy_tags:[]}}' 2>/dev/null)

if [ -n "$EVENT_PAYLOAD" ]; then
  printf '%s' "$EVENT_PAYLOAD" | "$CLIENT_SCRIPT" record-event >/dev/null 2>&1 || true
fi

# Flush pending observations via finalize-session with emergency summary mode
FINALIZE_PAYLOAD=$(jq -nc \
  --arg platform "claude" \
  --arg project "$PROJECT_NAME" \
  --arg session_id "$SESSION_ID" \
  --arg summary_mode "emergency" \
  '{platform:$platform,project:$project,session_id:$session_id,summary_mode:$summary_mode}' 2>/dev/null)

if [ -n "$FINALIZE_PAYLOAD" ]; then
  printf '%s' "$FINALIZE_PAYLOAD" | "$CLIENT_SCRIPT" finalize-session >/dev/null 2>&1 || true
fi

exit 0
