#!/bin/bash
# memory-post-compact.sh
# PostCompact hook: record compaction completion and save checkpoint
# Counterpart to PreCompact (pre-compact-save.js)

set +e

# shellcheck disable=SC1090
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/hook-common.sh"

hook_init_paths
hook_init_context

STATE_DIR="${PROJECT_ROOT}/.claude/state"
SESSION_FILE="${STATE_DIR}/session.json"
SNAPSHOT_FILE="${STATE_DIR}/precompact-snapshot.json"

hook_resolve_session_id "claude" "$SESSION_FILE" "require"
hook_check_deps

# Read pre-compact snapshot if available
SNAPSHOT_DATA="{}"
if [ -f "$SNAPSHOT_FILE" ]; then
  SNAPSHOT_DATA="$(jq -c '.' "$SNAPSHOT_FILE" 2>/dev/null || echo '{}')"
fi

EVENT_PAYLOAD=$(jq -nc \
  --arg platform "claude" \
  --arg project "$PROJECT_NAME" \
  --arg session_id "$SESSION_ID" \
  --argjson snapshot "$SNAPSHOT_DATA" \
  '{event:{platform:$platform,project:$project,session_id:$session_id,event_type:"post_compact",payload:{snapshot:$snapshot},tags:["hook","compact","checkpoint"]}}' 2>/dev/null)

if [ -n "$EVENT_PAYLOAD" ]; then
  printf '%s' "$EVENT_PAYLOAD" | "$CLIENT_SCRIPT" record-event >/dev/null 2>&1 || true
fi

# Record checkpoint after compaction
CHECKPOINT_PAYLOAD=$(jq -nc \
  --arg platform "claude" \
  --arg project "$PROJECT_NAME" \
  --arg session_id "$SESSION_ID" \
  --arg title "post-compact checkpoint" \
  --arg content "Context compaction completed" \
  '{platform:$platform,project:$project,session_id:$session_id,title:$title,content:$content}' 2>/dev/null)

if [ -n "$CHECKPOINT_PAYLOAD" ]; then
  printf '%s' "$CHECKPOINT_PAYLOAD" | "$CLIENT_SCRIPT" record-checkpoint >/dev/null 2>&1 || true
fi

exit 0
