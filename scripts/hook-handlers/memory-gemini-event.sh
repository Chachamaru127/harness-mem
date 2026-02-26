#!/usr/bin/env bash
# memory-gemini-event.sh — Gemini CLI hook handler for harness-mem
# Usage: Called by Gemini CLI hooks with event type as $1
#   bash memory-gemini-event.sh SessionStart
#   bash memory-gemini-event.sh SessionEnd
#   bash memory-gemini-event.sh AfterTool
#   bash memory-gemini-event.sh PreCompress
#
# stdin: Hook JSON payload from Gemini CLI
# Environment: GEMINI_SESSION_ID, GEMINI_PROJECT_DIR, GEMINI_CWD

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT="${SCRIPT_DIR}/../harness-mem-client.sh"

# --- Config ---
MEM_HOST="${HARNESS_MEM_HOST:-127.0.0.1}"
MEM_PORT="${HARNESS_MEM_PORT:-37888}"
BASE_URL="http://${MEM_HOST}:${MEM_PORT}"

EVENT_NAME="${1:-unknown}"

# --- Read stdin (Gemini hook JSON payload) ---
STDIN_JSON=""
if [ ! -t 0 ]; then
  STDIN_JSON="$(cat)"
fi

# --- Resolve session & project ---
SESSION_ID="${GEMINI_SESSION_ID:-}"
if [ -z "$SESSION_ID" ]; then
  SESSION_ID="gemini-$(date +%s)-$$"
fi

PROJECT_DIR="${GEMINI_PROJECT_DIR:-${GEMINI_CWD:-$(pwd)}}"
PROJECT="$(basename "$PROJECT_DIR")"

# --- Map Gemini event to harness-mem event type ---
map_event_type() {
  case "$1" in
    SessionStart)  echo "session_start" ;;
    SessionEnd)    echo "session_end" ;;
    AfterTool)     echo "tool_use" ;;
    PreCompress)   echo "checkpoint" ;;
    BeforeAgent)   echo "user_prompt" ;;
    AfterAgent)    echo "assistant_response" ;;
    *)             echo "checkpoint" ;;
  esac
}

EVENT_TYPE="$(map_event_type "$EVENT_NAME")"

# --- Build payload ---
PAYLOAD="$(jq -n \
  --arg session_id "$SESSION_ID" \
  --arg platform "gemini" \
  --arg project "$PROJECT" \
  --arg event_type "$EVENT_TYPE" \
  --arg hook_event "$EVENT_NAME" \
  --argjson stdin_payload "${STDIN_JSON:-null}" \
  '{
    platform: $platform,
    project: $project,
    session_id: $session_id,
    event_type: $event_type,
    payload: {
      hook_event_name: $hook_event,
      gemini_payload: $stdin_payload
    }
  }'
)"

# --- Send to daemon ---
if [ "$EVENT_TYPE" = "session_end" ]; then
  # Finalize session
  curl -s --connect-timeout 1 --max-time 2 -X POST "${BASE_URL}/v1/sessions/finalize" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" >/dev/null 2>&1 || true
else
  # Record event
  curl -s --connect-timeout 1 --max-time 2 -X POST "${BASE_URL}/v1/events/record" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" >/dev/null 2>&1 || true
fi

# --- Return empty JSON to Gemini CLI (required for hooks) ---
echo '{}'
