#!/usr/bin/env bash
# memory-gemini-event.sh — Gemini CLI hook handler for harness-mem
# Usage: Called by Gemini CLI hooks with event type as $1
#   bash memory-gemini-event.sh SessionStart
#   bash memory-gemini-event.sh SessionEnd
#   bash memory-gemini-event.sh AfterTool
#   bash memory-gemini-event.sh PreCompress
#   bash memory-gemini-event.sh BeforeModel
#   bash memory-gemini-event.sh BeforeToolSelection
#
# stdin: Hook JSON payload from Gemini CLI
# Environment: GEMINI_SESSION_ID, GEMINI_PROJECT_DIR, GEMINI_CWD

set +e

# shellcheck disable=SC1090
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/hook-common.sh"

EVENT_NAME="${1:-unknown}"

hook_init_paths

# Gemini: stdin読み取り + 環境変数ブリッジで resolve_project_context を利用
# GEMINI_PROJECT_DIR/GEMINI_CWD を HARNESS_MEM_PROJECT_ROOT にブリッジ
if [ -n "${GEMINI_PROJECT_DIR:-}" ]; then
  export HARNESS_MEM_PROJECT_ROOT="$GEMINI_PROJECT_DIR"
elif [ -n "${GEMINI_CWD:-}" ]; then
  export HARNESS_MEM_PROJECT_ROOT="$GEMINI_CWD"
fi

hook_init_context

# --- Session ID: 環境変数 → stdin → フォールバック ---
SESSION_ID="${GEMINI_SESSION_ID:-}"
if [ -z "$SESSION_ID" ] && [ -n "$INPUT" ] && command -v jq >/dev/null 2>&1; then
  SESSION_ID="$(printf '%s' "$INPUT" | jq -r '.session_id // .thread_id // empty' 2>/dev/null)"
fi
[ -z "$SESSION_ID" ] && SESSION_ID="gemini-$(date +%s)-$$"

hook_check_deps

# --- Map Gemini event to harness-mem event type ---
map_event_type() {
  case "$1" in
    SessionStart)         echo "session_start" ;;
    SessionEnd)           echo "session_end" ;;
    AfterTool)            echo "tool_use" ;;
    PreCompress)          echo "checkpoint" ;;
    BeforeAgent)          echo "user_prompt" ;;
    AfterAgent)           echo "assistant_response" ;;
    BeforeModel)          echo "model_request" ;;
    BeforeToolSelection)  echo "tool_selection" ;;
    *)                    echo "checkpoint" ;;
  esac
}

EVENT_TYPE="$(map_event_type "$EVENT_NAME")"

# --- Build and send payload ---
if [ "$EVENT_TYPE" = "session_end" ]; then
  # Finalize session
  FINALIZE_PAYLOAD=$(jq -nc \
    --arg platform "gemini" \
    --arg project "$PROJECT_NAME" \
    --arg session_id "$SESSION_ID" \
    --arg summary_mode "standard" \
    '{platform:$platform,project:$project,session_id:$session_id,summary_mode:$summary_mode}' 2>/dev/null)

  if [ -n "$FINALIZE_PAYLOAD" ]; then
    printf '%s' "$FINALIZE_PAYLOAD" | "$CLIENT_SCRIPT" finalize-session >/dev/null 2>&1 || true
  fi
else
  # Record event
  EVENT_PAYLOAD=$(jq -nc \
    --arg platform "gemini" \
    --arg project "$PROJECT_NAME" \
    --arg session_id "$SESSION_ID" \
    --arg event_type "$EVENT_TYPE" \
    --arg hook_event "$EVENT_NAME" \
    --argjson stdin_payload "${INPUT:-null}" \
    '{event:{platform:$platform,project:$project,session_id:$session_id,event_type:$event_type,payload:{hook_event_name:$hook_event,gemini_payload:$stdin_payload},tags:["hook","gemini"]}}' 2>/dev/null)

  if [ -n "$EVENT_PAYLOAD" ]; then
    printf '%s' "$EVENT_PAYLOAD" | "$CLIENT_SCRIPT" record-event >/dev/null 2>&1 || true
  fi
fi

# --- Return empty JSON to Gemini CLI (required for hooks) ---
echo '{}'
