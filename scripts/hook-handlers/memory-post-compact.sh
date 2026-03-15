#!/bin/bash
# memory-post-compact.sh
# PostCompact hook: record compaction completion and save checkpoint
# Counterpart to PreCompact (pre-compact-save.js)

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
SNAPSHOT_FILE="${STATE_DIR}/precompact-snapshot.json"

SESSION_ID=""
if [ -n "$INPUT" ] && command -v jq >/dev/null 2>&1; then
  SESSION_ID="$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)"
fi

if [ -z "$SESSION_ID" ] && [ -f "$SESSION_FILE" ] && command -v jq >/dev/null 2>&1; then
  SESSION_ID="$(jq -r '.session_id // empty' "$SESSION_FILE" 2>/dev/null)"
fi

[ -z "$SESSION_ID" ] && exit 0

if [ -x "$CLIENT_SCRIPT" ] && command -v jq >/dev/null 2>&1; then
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
fi

exit 0
