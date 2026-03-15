#!/bin/bash
# memory-user-prompt.sh
# UserPromptSubmit hook: record user prompt event

set +e

# shellcheck disable=SC1090
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/hook-common.sh"

hook_init_paths
hook_init_context "true"

STATE_DIR="${PROJECT_ROOT}/.claude/state"
SESSION_FILE="${STATE_DIR}/session.json"

hook_resolve_session_id "claude" "$SESSION_FILE" "generate"

PROMPT_TEXT=""
PRIVACY_TAGS_JSON="[]"
HOOK_META_JSON="{}"
if command -v jq >/dev/null 2>&1; then
  PROMPT_TEXT="$(printf '%s' "$INPUT" | jq -r '.prompt // empty' 2>/dev/null)"
  PRIVACY_TAGS_JSON="$(printf '%s' "$INPUT" | jq -c '.privacy_tags // []' 2>/dev/null)"
  HOOK_META_JSON="$(printf '%s' "$INPUT" | jq -c '{hook_event:(.hook_event_name // "UserPromptSubmit"), source:(.source // "hook"), ts:(.ts // now | tostring)}' 2>/dev/null)"
fi

hook_check_deps

if echo "$PROMPT_TEXT" | grep -Eqi '(api[_ -]?key|token|secret|password|private[_ -]?key|Bearer[[:space:]]+ey|sk_[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{30,}|AKIA[A-Z0-9]{16})'; then
  PRIVACY_TAGS_JSON="$(jq -cn --argjson base "$PRIVACY_TAGS_JSON" '$base + ["redact"] | unique' 2>/dev/null || echo '["redact"]')"
fi

EVENT_PAYLOAD=$(jq -nc \
  --arg platform "claude" \
  --arg project "$PROJECT_NAME" \
  --arg session_id "$SESSION_ID" \
  --arg prompt "$PROMPT_TEXT" \
  --argjson privacy_tags "$PRIVACY_TAGS_JSON" \
  --argjson hook_meta "$HOOK_META_JSON" \
  '{event:{platform:$platform,project:$project,session_id:$session_id,event_type:"user_prompt",payload:{prompt:$prompt,meta:$hook_meta},tags:["hook","user_prompt","requeue_meta_v1"],privacy_tags:$privacy_tags}}' 2>/dev/null)

if [ -n "$EVENT_PAYLOAD" ]; then
  printf '%s' "$EVENT_PAYLOAD" | "$CLIENT_SCRIPT" record-event >/dev/null 2>&1 || true
fi

exit 0
