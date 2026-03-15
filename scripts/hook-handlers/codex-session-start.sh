#!/bin/bash
# codex-session-start.sh
# Codex CLI SessionStart hook: record session start + retrieve resume pack
# For Codex CLI v0.114.0+ experimental hooks engine

set +e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLIENT_SCRIPT="${PARENT_DIR}/harness-mem-client.sh"
DAEMON_SCRIPT="${PARENT_DIR}/harness-memd"
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

SESSION_ID=""
if [ -n "$INPUT" ] && command -v jq >/dev/null 2>&1; then
  SESSION_ID="$(printf '%s' "$INPUT" | jq -r '.session_id // .thread_id // empty' 2>/dev/null)"
fi

[ -z "$SESSION_ID" ] && SESSION_ID="codex-$(date +%s)"

[ -x "$CLIENT_SCRIPT" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

# Ensure daemon is running
HEALTH_CHECK="$(HARNESS_MEM_CLIENT_TIMEOUT_SEC=2 "$CLIENT_SCRIPT" health 2>/dev/null || true)"
if [ -z "$HEALTH_CHECK" ] || ! printf '%s' "$HEALTH_CHECK" | jq -e '.ok == true' >/dev/null 2>&1; then
  if [ -x "$DAEMON_SCRIPT" ]; then
    HARNESS_MEM_CODEX_PROJECT_ROOT="$PROJECT_ROOT" \
      "$DAEMON_SCRIPT" start --quiet >/dev/null 2>&1 || true
    sleep 1
  fi
fi

# Record session start event
EVENT_PAYLOAD=$(jq -nc \
  --arg platform "codex" \
  --arg project "$PROJECT_NAME" \
  --arg session_id "$SESSION_ID" \
  '{event:{platform:$platform,project:$project,session_id:$session_id,event_type:"session_start",payload:{source:"codex_hooks_engine"},tags:["codex_hook","session_start"]}}' 2>/dev/null)

if [ -n "$EVENT_PAYLOAD" ]; then
  printf '%s' "$EVENT_PAYLOAD" | "$CLIENT_SCRIPT" record-event >/dev/null 2>&1 || true
fi

# Retrieve resume pack
RESUME_PAYLOAD=$(jq -nc \
  --arg project "$PROJECT_NAME" \
  --arg session_id "$SESSION_ID" \
  '{project:$project,session_id:$session_id,limit:5,include_private:false}' 2>/dev/null)

if [ -n "$RESUME_PAYLOAD" ]; then
  RESUME_RESPONSE="$(printf '%s' "$RESUME_PAYLOAD" | "$CLIENT_SCRIPT" resume-pack 2>/dev/null || true)"
  if [ -n "$RESUME_RESPONSE" ] && printf '%s' "$RESUME_RESPONSE" | jq -e '.ok != false' >/dev/null 2>&1; then
    ITEM_COUNT="$(printf '%s' "$RESUME_RESPONSE" | jq -r '.meta.count // 0' 2>/dev/null)"
    if [ -n "$ITEM_COUNT" ] && [ "$ITEM_COUNT" != "0" ]; then
      echo "## Memory Resume Pack (Codex)" >&2
      echo "" >&2
      printf '%s' "$RESUME_RESPONSE" | jq -r '
        .items[] |
        if .type == "session_summary" then
          "- [summary] " + (.summary // "") | .[0:260]
        else
          "- [" + (.id // "") + "] " + ((.title // "untitled") + " :: " + ((.content // "") | gsub("\\n"; " ") | .[0:140]))
        end
      ' 2>/dev/null >&2 || true
    fi
  fi
fi

exit 0
