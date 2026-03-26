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
hook_init_continuity_state
hook_resolve_correlation_id "$SESSION_ID" "claude" "$INPUT"

SUMMARY_MODE="standard"
LAST_ASSISTANT_MESSAGE=""
HOOK_META_JSON="{}"
if [ -n "$INPUT" ] && command -v jq >/dev/null 2>&1; then
  SUMMARY_MODE="$(printf '%s' "$INPUT" | jq -r '.summary_mode // "standard"' 2>/dev/null)"
  LAST_ASSISTANT_MESSAGE="$(printf '%s' "$INPUT" | jq -r '.last_assistant_message // empty' 2>/dev/null)"
  HOOK_META_JSON="$(printf '%s' "$INPUT" | jq -c '{hook_event:(.hook_event_name // "Stop"), source:(.source // "hook"), ts:(.ts // now | tostring)}' 2>/dev/null)"
fi

hook_check_deps

if [ -n "$LAST_ASSISTANT_MESSAGE" ]; then
  LAST_ASSISTANT_MESSAGE="$(printf '%s' "$LAST_ASSISTANT_MESSAGE" | tr '\n' ' ' | cut -c 1-4000)"
  ASSISTANT_TAGS_JSON='["hook","stop","assistant_response"]'
  if hook_session_visibility_suppressed "$SESSION_ID"; then
    ASSISTANT_TAGS_JSON="$(jq -cn --argjson base "$ASSISTANT_TAGS_JSON" '$base + ["visibility_suppressed"] | unique' 2>/dev/null || echo '["hook","stop","assistant_response","visibility_suppressed"]')"
  fi
  ASSISTANT_EVENT_PAYLOAD=$(jq -nc \
    --arg platform "claude" \
    --arg project "$PROJECT_NAME" \
    --arg session_id "$SESSION_ID" \
    --arg correlation_id "$CORRELATION_ID" \
    --arg content "$LAST_ASSISTANT_MESSAGE" \
    --argjson hook_meta "$HOOK_META_JSON" \
    --argjson tags "$ASSISTANT_TAGS_JSON" \
    '{event:{platform:$platform,project:$project,session_id:$session_id,event_type:"checkpoint",correlation_id:$correlation_id,payload:{title:"assistant_response",content:$content,last_assistant_message:$content,role:"assistant",source:"stop_hook",meta:$hook_meta},tags:$tags,privacy_tags:[]}}' 2>/dev/null)
  if [ -n "$ASSISTANT_EVENT_PAYLOAD" ]; then
    printf '%s' "$ASSISTANT_EVENT_PAYLOAD" | "$CLIENT_SCRIPT" record-event >/dev/null 2>&1 || true
  fi
fi

FINALIZE_PAYLOAD=$(jq -nc \
  --arg platform "claude" \
  --arg project "$PROJECT_NAME" \
  --arg session_id "$SESSION_ID" \
  --arg correlation_id "$CORRELATION_ID" \
  --arg summary_mode "$SUMMARY_MODE" \
  '{platform:$platform,project:$project,session_id:$session_id,correlation_id:$correlation_id,summary_mode:$summary_mode}' 2>/dev/null)

if [ -n "$FINALIZE_PAYLOAD" ]; then
  FINALIZE_RESPONSE="$(printf '%s' "$FINALIZE_PAYLOAD" | "$CLIENT_SCRIPT" finalize-session 2>/dev/null || true)"
  if [ -n "$FINALIZE_RESPONSE" ] && command -v jq >/dev/null 2>&1; then
    FINALIZED_AT="$(printf '%s' "$FINALIZE_RESPONSE" | jq -r '.items[0].finalized_at // empty' 2>/dev/null)"
    hook_mark_continuity_handoff "$SESSION_ID" "claude" "$CORRELATION_ID" "$SUMMARY_MODE" "$FINALIZED_AT"
  fi
fi

exit 0
