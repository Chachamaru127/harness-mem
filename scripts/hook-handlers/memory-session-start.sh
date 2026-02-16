#!/bin/bash
# memory-session-start.sh
# SessionStart hook: record session start + prepare resume pack for injection

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
RESUME_FILE="${STATE_DIR}/memory-resume-context.md"
RESUME_JSON_FILE="${STATE_DIR}/memory-resume-pack.json"
RESUME_PENDING_FLAG="${STATE_DIR}/.memory-resume-pending"

mkdir -p "$STATE_DIR" 2>/dev/null || true

CC_SESSION_ID=""
SOURCE="startup"
HOOK_META_JSON="{}"
if [ -n "$INPUT" ] && command -v jq >/dev/null 2>&1; then
  CC_SESSION_ID="$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)"
  SOURCE="$(printf '%s' "$INPUT" | jq -r '.source // "startup"' 2>/dev/null)"
  HOOK_META_JSON="$(printf '%s' "$INPUT" | jq -c '{hook_event:(.hook_event_name // "SessionStart"), source:(.source // "startup"), ts:(.ts // now | tostring)}' 2>/dev/null)"
fi

HARNESS_SESSION_ID="$CC_SESSION_ID"
if [ -z "$HARNESS_SESSION_ID" ] && [ -f "$SESSION_FILE" ] && command -v jq >/dev/null 2>&1; then
  HARNESS_SESSION_ID="$(jq -r '.session_id // empty' "$SESSION_FILE" 2>/dev/null)"
fi

if [ -z "$HARNESS_SESSION_ID" ]; then
  HARNESS_SESSION_ID="session-$(date +%s)"
fi

if [ -x "$CLIENT_SCRIPT" ]; then
  EVENT_PAYLOAD=$(jq -nc \
    --arg platform "claude" \
    --arg project "$PROJECT_NAME" \
    --arg session_id "$HARNESS_SESSION_ID" \
    --arg event_type "session_start" \
    --arg source "$SOURCE" \
    --argjson hook_meta "$HOOK_META_JSON" \
    '{event:{platform:$platform,project:$project,session_id:$session_id,event_type:$event_type,payload:{source:$source,meta:$hook_meta},tags:["hook","session_start","requeue_meta_v1"],privacy_tags:[]}}' 2>/dev/null)

  if [ -n "$EVENT_PAYLOAD" ]; then
    printf '%s' "$EVENT_PAYLOAD" | "$CLIENT_SCRIPT" record-event >/dev/null 2>&1 || true
  fi

  RESUME_PAYLOAD=$(jq -nc \
    --arg project "$PROJECT_NAME" \
    --arg session_id "$HARNESS_SESSION_ID" \
    '{project:$project,session_id:$session_id,limit:5,include_private:false}' 2>/dev/null)

  if [ -n "$RESUME_PAYLOAD" ]; then
    RESUME_RESPONSE="$(printf '%s' "$RESUME_PAYLOAD" | "$CLIENT_SCRIPT" resume-pack 2>/dev/null || true)"

    if [ -n "$RESUME_RESPONSE" ]; then
      printf '%s' "$RESUME_RESPONSE" > "$RESUME_JSON_FILE" 2>/dev/null || true

      if command -v jq >/dev/null 2>&1; then
        ITEM_COUNT="$(printf '%s' "$RESUME_RESPONSE" | jq -r '.meta.count // 0' 2>/dev/null)"
        if [ -n "$ITEM_COUNT" ] && [ "$ITEM_COUNT" != "0" ]; then
          {
            echo "## Memory Resume Pack"
            echo ""
            echo "直近セッションから再利用可能な文脈です。"
            echo ""
            printf '%s' "$RESUME_RESPONSE" | jq -r '
              .items[] |
              if .type == "session_summary" then
                "- [summary] " + (.summary // "") | .[0:260]
              else
                "- [" + (.id // "") + "] " + ((.title // "untitled") + " :: " + ((.content // "") | gsub("\\n"; " ") | .[0:140]))
              end
            ' 2>/dev/null
          } > "$RESUME_FILE"
          touch "$RESUME_PENDING_FLAG" 2>/dev/null || true
        else
          rm -f "$RESUME_FILE" "$RESUME_PENDING_FLAG" 2>/dev/null || true
        fi
      fi
    fi
  fi
fi

exit 0
