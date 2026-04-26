#!/bin/bash
# codex-user-prompt.sh
# Codex CLI UserPromptSubmit hook: record user prompt event
# For Codex CLI v0.116.0+ experimental hooks engine

set +e

# shellcheck disable=SC1090
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/hook-common.sh"

hook_init_paths
hook_init_context "true"

hook_resolve_session_id "codex" "" "generate"
hook_init_continuity_state
hook_init_whisper_state
hook_resolve_correlation_id "$SESSION_ID" "codex" "$INPUT"

PROMPT_TEXT=""
PRIVACY_TAGS_JSON="[]"
HOOK_META_JSON="{}"
if command -v jq >/dev/null 2>&1; then
  PROMPT_TEXT="$(printf '%s' "$INPUT" | jq -r '.prompt // empty' 2>/dev/null)"
  PRIVACY_TAGS_JSON="$(printf '%s' "$INPUT" | jq -c '.privacy_tags // []' 2>/dev/null)"
  HOOK_META_JSON="$(hook_extract_codex_hook_meta "$INPUT" "UserPromptSubmit")"
fi

hook_check_deps

if echo "$PROMPT_TEXT" | grep -Eqi '(api[_ -]?key|token|secret|password|private[_ -]?key|Bearer[[:space:]]+ey|sk_[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{30,}|AKIA[A-Z0-9]{16})'; then
  PRIVACY_TAGS_JSON="$(jq -cn --argjson base "$PRIVACY_TAGS_JSON" '$base + ["redact"] | unique' 2>/dev/null || echo '["redact"]')"
fi

BASE_TAGS_JSON='["codex_hook","user_prompt"]'
if hook_prompt_should_suppress_visibility "$PROMPT_TEXT"; then
  BASE_TAGS_JSON="$(jq -cn --argjson base "$BASE_TAGS_JSON" '$base + ["visibility_suppressed"] | unique' 2>/dev/null || echo '["codex_hook","user_prompt","visibility_suppressed"]')"
  hook_set_session_visibility_suppressed "$SESSION_ID" "true"
fi
EVENT_PAYLOAD=$(jq -nc \
  --arg platform "codex" \
  --arg project "$PROJECT_NAME" \
  --arg session_id "$SESSION_ID" \
  --arg correlation_id "$CORRELATION_ID" \
  --arg prompt "$PROMPT_TEXT" \
  --argjson privacy_tags "$PRIVACY_TAGS_JSON" \
  --argjson hook_meta "$HOOK_META_JSON" \
  --argjson tags "$BASE_TAGS_JSON" \
  '{event:{platform:$platform,project:$project,session_id:$session_id,event_type:"user_prompt",correlation_id:$correlation_id,payload:{prompt:$prompt,meta:$hook_meta},tags:$tags,privacy_tags:$privacy_tags}}' 2>/dev/null)

if [ -n "$EVENT_PAYLOAD" ]; then
  printf '%s' "$EVENT_PAYLOAD" | "$CLIENT_SCRIPT" record-event >/dev/null 2>&1 || true
fi

hook_record_explicit_continuity_handoff \
  "$SESSION_ID" \
  "codex" \
  "$CORRELATION_ID" \
  "$PROMPT_TEXT" \
  "$PRIVACY_TAGS_JSON" \
  "$HOOK_META_JSON" \
  "$BASE_TAGS_JSON"

RECALL_MODE="$(hook_read_recall_mode)"
RECALL_RESULT="$(hook_run_contextual_recall "codex" "$SESSION_ID" "$PROMPT_TEXT" "$RECALL_MODE")"
RECALL_CONTEXT="$(printf '%s' "$RECALL_RESULT" | jq -r '.content // empty' 2>/dev/null)"
if [ -n "$RECALL_CONTEXT" ]; then
  hook_emit_codex_additional_context "UserPromptSubmit" "$RECALL_CONTEXT"
fi

exit 0
