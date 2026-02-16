#!/bin/bash
# memory-user-prompt.sh
# UserPromptSubmit hook: record user prompt event

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

[ -z "$INPUT" ] && exit 0

PROJECT_ROOT=""
PROJECT_NAME=""
if command -v resolve_project_context >/dev/null 2>&1; then
  CONTEXT="$(resolve_project_context "$INPUT")"
  PROJECT_ROOT="$(printf '%s\n' "$CONTEXT" | sed -n '1p')"
  PROJECT_NAME="$(printf '%s\n' "$CONTEXT" | sed -n '2p')"
fi

[ -n "$PROJECT_ROOT" ] || PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
[ -n "$PROJECT_NAME" ] || PROJECT_NAME="$(basename "$PROJECT_ROOT")"

STATE_DIR="${PROJECT_ROOT}/.claude/state"
SESSION_FILE="${STATE_DIR}/session.json"

SESSION_ID=""
PROMPT_TEXT=""
PRIVACY_TAGS_JSON="[]"
HOOK_META_JSON="{}"
if command -v jq >/dev/null 2>&1; then
  SESSION_ID="$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)"
  PROMPT_TEXT="$(printf '%s' "$INPUT" | jq -r '.prompt // empty' 2>/dev/null)"
  PRIVACY_TAGS_JSON="$(printf '%s' "$INPUT" | jq -c '.privacy_tags // []' 2>/dev/null)"
  HOOK_META_JSON="$(printf '%s' "$INPUT" | jq -c '{hook_event:(.hook_event_name // "UserPromptSubmit"), source:(.source // "hook"), ts:(.ts // now | tostring)}' 2>/dev/null)"
fi

if [ -z "$SESSION_ID" ] && [ -f "$SESSION_FILE" ] && command -v jq >/dev/null 2>&1; then
  SESSION_ID="$(jq -r '.session_id // empty' "$SESSION_FILE" 2>/dev/null)"
fi

[ -z "$SESSION_ID" ] && SESSION_ID="session-$(date +%s)"

if [ -x "$CLIENT_SCRIPT" ] && command -v jq >/dev/null 2>&1; then
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
fi

exit 0
