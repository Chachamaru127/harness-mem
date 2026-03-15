#!/bin/bash
# memory-elicitation.sh
# Elicitation hook: record MCP server user input request events

set +e

# shellcheck disable=SC1090
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/hook-common.sh"

hook_init_paths
hook_init_context "true"

STATE_DIR="${PROJECT_ROOT}/.claude/state"
SESSION_FILE="${STATE_DIR}/session.json"

hook_resolve_session_id "claude" "$SESSION_FILE" "generate"

ELICITATION_ID=""
ELICITATION_TYPE=""
HOOK_META_JSON="{}"
if command -v jq >/dev/null 2>&1; then
  ELICITATION_ID="$(printf '%s' "$INPUT" | jq -r '.elicitation_id // empty' 2>/dev/null)"
  ELICITATION_TYPE="$(printf '%s' "$INPUT" | jq -r '.elicitation_type // "unknown"' 2>/dev/null)"
  HOOK_META_JSON="$(printf '%s' "$INPUT" | jq -c '{hook_event:(.hook_event_name // "Elicitation"), source:(.source // "hook"), ts:(.ts // now | tostring)}' 2>/dev/null)"
fi

hook_check_deps

EVENT_PAYLOAD=$(jq -nc \
  --arg platform "claude" \
  --arg project "$PROJECT_NAME" \
  --arg session_id "$SESSION_ID" \
  --arg elicitation_id "$ELICITATION_ID" \
  --arg elicitation_type "$ELICITATION_TYPE" \
  --argjson hook_meta "$HOOK_META_JSON" \
  '{event:{platform:$platform,project:$project,session_id:$session_id,event_type:"elicitation",payload:{elicitation_id:$elicitation_id,elicitation_type:$elicitation_type,meta:$hook_meta},tags:["hook","elicitation"]}}' 2>/dev/null)

if [ -n "$EVENT_PAYLOAD" ]; then
  printf '%s' "$EVENT_PAYLOAD" | "$CLIENT_SCRIPT" record-event >/dev/null 2>&1 || true
fi

exit 0
