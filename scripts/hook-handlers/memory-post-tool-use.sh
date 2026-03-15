#!/bin/bash
# memory-post-tool-use.sh
# PostToolUse hook: record tool use event

set +e

# shellcheck disable=SC1090
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/hook-common.sh"

hook_init_paths
hook_init_context "true"

STATE_DIR="${PROJECT_ROOT}/.claude/state"
SESSION_FILE="${STATE_DIR}/session.json"

hook_resolve_session_id "claude" "$SESSION_FILE" "generate"

TOOL_NAME=""
TOOL_INPUT_JSON="{}"
PRIVACY_TAGS_JSON="[]"
HOOK_META_JSON="{}"
if command -v jq >/dev/null 2>&1; then
  TOOL_NAME="$(printf '%s' "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)"
  TOOL_INPUT_JSON="$(printf '%s' "$INPUT" | jq -c '.tool_input // {}' 2>/dev/null)"
  PRIVACY_TAGS_JSON="$(printf '%s' "$INPUT" | jq -c '.privacy_tags // []' 2>/dev/null)"
  HOOK_META_JSON="$(printf '%s' "$INPUT" | jq -c '{hook_event:(.hook_event_name // "PostToolUse"), source:(.source // "hook"), ts:(.ts // now | tostring)}' 2>/dev/null)"
fi

hook_check_deps

if printf '%s' "$TOOL_INPUT_JSON" | grep -Eqi '(api[_ -]?key|token|secret|password|sk_[A-Za-z0-9]{16,})'; then
  PRIVACY_TAGS_JSON="$(jq -cn --argjson base "$PRIVACY_TAGS_JSON" '$base + ["redact"] | unique' 2>/dev/null || echo '["redact"]')"
fi

EVENT_PAYLOAD=$(jq -nc \
  --arg platform "claude" \
  --arg project "$PROJECT_NAME" \
  --arg session_id "$SESSION_ID" \
  --arg tool_name "$TOOL_NAME" \
  --argjson tool_input "$TOOL_INPUT_JSON" \
  --argjson privacy_tags "$PRIVACY_TAGS_JSON" \
  --argjson hook_meta "$HOOK_META_JSON" \
  '{event:{platform:$platform,project:$project,session_id:$session_id,event_type:"tool_use",payload:{tool_name:$tool_name,tool_input:$tool_input,meta:$hook_meta},tags:["hook","tool_use","requeue_meta_v1"],privacy_tags:$privacy_tags}}' 2>/dev/null)

if [ -n "$EVENT_PAYLOAD" ]; then
  printf '%s' "$EVENT_PAYLOAD" | "$CLIENT_SCRIPT" record-event >/dev/null 2>&1 || true
fi

exit 0
