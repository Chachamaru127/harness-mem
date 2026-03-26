#!/bin/bash
# memory-codex-notify.sh
# Codex notify hook: record after_agent turn completion into unified memory DB.

set +e

# shellcheck disable=SC1090
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/hook-common.sh"

hook_init_paths

# codex-notify: $1 引数優先、stdinフォールバック（通常の hook_init_context とは異なる）
INPUT_JSON="${1:-}"
if [ -z "$INPUT_JSON" ] && [ ! -t 0 ]; then
  INPUT_JSON="$(cat 2>/dev/null)"
fi

[ -z "$INPUT_JSON" ] && exit 0

# project-context.sh を読み込み（hook_init_paths で解決済みのパスを使用）
if [ -f "$PROJECT_CONTEXT_LIB" ]; then
  # shellcheck disable=SC1090
  source "$PROJECT_CONTEXT_LIB"
fi

command -v jq >/dev/null 2>&1 || exit 0
[ -x "$CLIENT_SCRIPT" ] || exit 0

lookup_codex_rollout_file() {
  local thread_id="$1"
  [ -n "$thread_id" ] || return 0
  [ -d "$HOME/.codex/sessions" ] || return 0
  command -v find >/dev/null 2>&1 || return 0

  find "$HOME/.codex/sessions" -type f -name "rollout-*-${thread_id}.jsonl" 2>/dev/null \
    | sort \
    | tail -n 1
}

extract_latest_codex_user_prompt() {
  local thread_id="$1"
  [ -n "$thread_id" ] || return 0

  local rollout_file
  rollout_file="$(lookup_codex_rollout_file "$thread_id")"
  [ -n "$rollout_file" ] && [ -f "$rollout_file" ] || return 0

  jq -r '
    select(
      .type == "response_item"
      and (.payload.type // "") == "message"
      and (.payload.role // "") == "user"
    )
    | (.payload.content // [])
    | map(select((.type // "") == "input_text") | (.text // ""))
    | join("\n")
  ' "$rollout_file" 2>/dev/null \
    | awk 'NF' \
    | tail -n 1
}

extract_latest_codex_assistant_response() {
  local thread_id="$1"
  [ -n "$thread_id" ] || return 0

  local rollout_file
  rollout_file="$(lookup_codex_rollout_file "$thread_id")"
  [ -n "$rollout_file" ] && [ -f "$rollout_file" ] || return 0

  jq -r '
    if .type == "event_msg" and ((.payload.type // "") == "agent_message") then
      (.payload.message // .payload.text // "")
    elif .type == "response_item"
      and (.payload.type // "") == "message"
      and (.payload.role // "") == "assistant" then
      (.payload.content // [])
      | map(
          select(((.type // "") == "output_text") or ((.type // "") == "text"))
          | (.text // "")
        )
      | join("\n")
    elif .type == "event_msg" and ((.payload.type // "") == "task_complete") then
      (.payload.last_agent_message // "")
    else
      empty
    end
  ' "$rollout_file" 2>/dev/null \
    | awk 'NF' \
    | tail -n 1
}

PROJECT_ROOT=""
PROJECT_NAME=""
if command -v resolve_project_context >/dev/null 2>&1; then
  CONTEXT="$(resolve_project_context "$INPUT_JSON")"
  PROJECT_ROOT="$(printf '%s\n' "$CONTEXT" | sed -n '1p')"
  PROJECT_NAME="$(printf '%s\n' "$CONTEXT" | sed -n '2p')"
fi

[ -n "$PROJECT_ROOT" ] || PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
[ -n "$PROJECT_NAME" ] || PROJECT_NAME="$(basename "$PROJECT_ROOT")"
hook_init_continuity_state

NOTIFY_TYPE="$(printf '%s' "$INPUT_JSON" | jq -r '.type // empty' 2>/dev/null)"
[ "$NOTIFY_TYPE" = "agent-turn-complete" ] || exit 0

SESSION_ID="$(printf '%s' "$INPUT_JSON" | jq -r '.thread_id // empty' 2>/dev/null)"
TURN_ID="$(printf '%s' "$INPUT_JSON" | jq -r '.turn_id // empty' 2>/dev/null)"
LAST_ASSISTANT="$(printf '%s' "$INPUT_JSON" | jq -r '.last_assistant_message // ""' 2>/dev/null)"
USER_PROMPT="$(printf '%s' "$INPUT_JSON" | jq -r '.last_user_message // .user_prompt // .prompt // empty' 2>/dev/null)"

if [ -z "$SESSION_ID" ]; then
  SESSION_ID="codex-$(date +%s)"
fi

hook_resolve_correlation_id "$SESSION_ID" "codex" "$INPUT_JSON"

if [ -z "$USER_PROMPT" ]; then
  USER_PROMPT="$(extract_latest_codex_user_prompt "$SESSION_ID")"
fi

if [ -z "$LAST_ASSISTANT" ]; then
  LAST_ASSISTANT="$(extract_latest_codex_assistant_response "$SESSION_ID")"
fi

if [ -n "$LAST_ASSISTANT" ]; then
  # Keep payload size bounded for fast, non-blocking hook execution.
  LAST_ASSISTANT="$(printf '%s' "$LAST_ASSISTANT" | tr '\n' ' ' | cut -c 1-4000)"
else
  LAST_ASSISTANT="agent turn completed"
fi

if [ -n "$USER_PROMPT" ]; then
  USER_PROMPT="$(printf '%s' "$USER_PROMPT" | cut -c 1-4000)"
fi

ASSISTANT_TAGS_JSON='["codex_hook","after_agent","notify"]'
USER_TAGS_JSON='["codex_hook","user_prompt","notify_backfill"]'
if hook_session_visibility_suppressed "$SESSION_ID"; then
  ASSISTANT_TAGS_JSON="$(jq -cn --argjson base "$ASSISTANT_TAGS_JSON" '$base + ["visibility_suppressed"] | unique' 2>/dev/null || echo '["codex_hook","after_agent","notify","visibility_suppressed"]')"
  USER_TAGS_JSON="$(jq -cn --argjson base "$USER_TAGS_JSON" '$base + ["visibility_suppressed"] | unique' 2>/dev/null || echo '["codex_hook","user_prompt","notify_backfill","visibility_suppressed"]')"
fi

EVENT_PAYLOAD="$(jq -nc \
  --arg platform "codex" \
  --arg project "$PROJECT_NAME" \
  --arg session_id "$SESSION_ID" \
  --arg event_type "checkpoint" \
  --arg correlation_id "$CORRELATION_ID" \
  --arg turn_id "$TURN_ID" \
  --arg notify_type "$NOTIFY_TYPE" \
  --arg title "assistant_response" \
  --arg content "$LAST_ASSISTANT" \
  --arg prompt "$USER_PROMPT" \
  --arg last_assistant_message "$LAST_ASSISTANT" \
  --argjson tags "$ASSISTANT_TAGS_JSON" \
  '{event:{platform:$platform,project:$project,session_id:$session_id,event_type:$event_type,correlation_id:$correlation_id,payload:{turn_id:$turn_id,notify_type:$notify_type,title:$title,content:$content,last_assistant_message:$last_assistant_message,prompt:$prompt,role:"assistant",source:"codex_notify"},tags:$tags,privacy_tags:[]}}' 2>/dev/null)"

if [ -n "$EVENT_PAYLOAD" ]; then
  printf '%s' "$EVENT_PAYLOAD" | "$CLIENT_SCRIPT" record-event >/dev/null 2>&1 || true
fi

# Skip user_prompt backfill if UserPromptSubmit hook is active in the INSTALLED
# Codex hooks.json (not just the script on disk). This way, upgrades that haven't
# rerun `harness-mem setup` yet continue to use the backfill path.
CODEX_HOOKS_JSON="${HOME}/.codex/hooks.json"
CODEX_UPS_ACTIVE=false
if [ -f "$CODEX_HOOKS_JSON" ] && command -v jq >/dev/null 2>&1; then
  if jq -e '.hooks.UserPromptSubmit != null' "$CODEX_HOOKS_JSON" >/dev/null 2>&1; then
    CODEX_UPS_ACTIVE=true
  fi
fi
if [ -n "$USER_PROMPT" ] && [ "$CODEX_UPS_ACTIVE" = "false" ]; then
  USER_EVENT_PAYLOAD="$(jq -nc \
    --arg platform "codex" \
    --arg project "$PROJECT_NAME" \
    --arg session_id "$SESSION_ID" \
    --arg event_type "user_prompt" \
    --arg correlation_id "$CORRELATION_ID" \
    --arg turn_id "$TURN_ID" \
    --arg prompt "$USER_PROMPT" \
    --argjson tags "$USER_TAGS_JSON" \
    '{event:{platform:$platform,project:$project,session_id:$session_id,event_type:$event_type,correlation_id:$correlation_id,payload:{turn_id:$turn_id,prompt:$prompt,source:"codex_notify_backfill"},tags:$tags,privacy_tags:[]}}' 2>/dev/null)"

  if [ -n "$USER_EVENT_PAYLOAD" ]; then
    printf '%s' "$USER_EVENT_PAYLOAD" | "$CLIENT_SCRIPT" record-event >/dev/null 2>&1 || true
  fi
fi

exit 0
