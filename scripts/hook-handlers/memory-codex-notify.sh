#!/bin/bash
# memory-codex-notify.sh
# Codex notify hook: record after_agent turn completion into unified memory DB.

set +e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLIENT_SCRIPT="${PARENT_DIR}/harness-mem-client.sh"
PROJECT_CONTEXT_LIB="${SCRIPT_DIR}/lib/project-context.sh"

if [ -f "$PROJECT_CONTEXT_LIB" ]; then
  # shellcheck disable=SC1090
  source "$PROJECT_CONTEXT_LIB"
fi

INPUT_JSON="${1:-}"
if [ -z "$INPUT_JSON" ] && [ ! -t 0 ]; then
  INPUT_JSON="$(cat 2>/dev/null)"
fi

[ -z "$INPUT_JSON" ] && exit 0
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

PROJECT_ROOT=""
PROJECT_NAME=""
if command -v resolve_project_context >/dev/null 2>&1; then
  CONTEXT="$(resolve_project_context "$INPUT_JSON")"
  PROJECT_ROOT="$(printf '%s\n' "$CONTEXT" | sed -n '1p')"
  PROJECT_NAME="$(printf '%s\n' "$CONTEXT" | sed -n '2p')"
fi

[ -n "$PROJECT_ROOT" ] || PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
[ -n "$PROJECT_NAME" ] || PROJECT_NAME="$(basename "$PROJECT_ROOT")"

NOTIFY_TYPE="$(printf '%s' "$INPUT_JSON" | jq -r '.type // empty' 2>/dev/null)"
[ "$NOTIFY_TYPE" = "agent-turn-complete" ] || exit 0

SESSION_ID="$(printf '%s' "$INPUT_JSON" | jq -r '.thread_id // empty' 2>/dev/null)"
TURN_ID="$(printf '%s' "$INPUT_JSON" | jq -r '.turn_id // empty' 2>/dev/null)"
LAST_ASSISTANT="$(printf '%s' "$INPUT_JSON" | jq -r '.last_assistant_message // ""' 2>/dev/null)"
USER_PROMPT="$(printf '%s' "$INPUT_JSON" | jq -r '.last_user_message // .user_prompt // .prompt // empty' 2>/dev/null)"

if [ -z "$SESSION_ID" ]; then
  SESSION_ID="codex-$(date +%s)"
fi

if [ -z "$USER_PROMPT" ]; then
  USER_PROMPT="$(extract_latest_codex_user_prompt "$SESSION_ID")"
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

EVENT_PAYLOAD="$(jq -nc \
  --arg platform "codex" \
  --arg project "$PROJECT_NAME" \
  --arg session_id "$SESSION_ID" \
  --arg event_type "checkpoint" \
  --arg turn_id "$TURN_ID" \
  --arg notify_type "$NOTIFY_TYPE" \
  --arg last_assistant_message "$LAST_ASSISTANT" \
  '{event:{platform:$platform,project:$project,session_id:$session_id,event_type:$event_type,payload:{turn_id:$turn_id,notify_type:$notify_type,last_assistant_message:$last_assistant_message},tags:["codex_hook","after_agent","notify"],privacy_tags:[]}}' 2>/dev/null)"

if [ -n "$EVENT_PAYLOAD" ]; then
  printf '%s' "$EVENT_PAYLOAD" | "$CLIENT_SCRIPT" record-event >/dev/null 2>&1 || true
fi

if [ -n "$USER_PROMPT" ]; then
  USER_EVENT_PAYLOAD="$(jq -nc \
    --arg platform "codex" \
    --arg project "$PROJECT_NAME" \
    --arg session_id "$SESSION_ID" \
    --arg event_type "user_prompt" \
    --arg turn_id "$TURN_ID" \
    --arg prompt "$USER_PROMPT" \
    '{event:{platform:$platform,project:$project,session_id:$session_id,event_type:$event_type,payload:{turn_id:$turn_id,prompt:$prompt,source:"codex_notify_backfill"},tags:["codex_hook","user_prompt","notify_backfill"],privacy_tags:[]}}' 2>/dev/null)"

  if [ -n "$USER_EVENT_PAYLOAD" ]; then
    printf '%s' "$USER_EVENT_PAYLOAD" | "$CLIENT_SCRIPT" record-event >/dev/null 2>&1 || true
  fi
fi

exit 0
