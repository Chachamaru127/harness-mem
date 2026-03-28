#!/bin/bash
# memory-session-start.sh
# SessionStart hook: record session start + prepare resume pack for injection

set +e

# shellcheck disable=SC1090
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/hook-common.sh"

hook_init_paths "true"
hook_init_context
DAEMON_SCRIPT="${PARENT_DIR}/harness-memd"

STATE_DIR="${PROJECT_ROOT}/.claude/state"
SESSION_FILE="${STATE_DIR}/session.json"
RESUME_FILE="${STATE_DIR}/memory-resume-context.md"
RESUME_JSON_FILE="${STATE_DIR}/memory-resume-pack.json"
RESUME_PENDING_FLAG="${STATE_DIR}/.memory-resume-pending"
RESUME_ERROR_FILE="${STATE_DIR}/memory-resume-error.md"
mkdir -p "$STATE_DIR" 2>/dev/null || true

hook_resolve_session_id "claude" "$SESSION_FILE" "generate"
HARNESS_SESSION_ID="$SESSION_ID"
hook_init_continuity_state
hook_resolve_correlation_id "$HARNESS_SESSION_ID" "claude" "$INPUT"

RESUME_CORRELATION_ID=""
case "${CORRELATION_ID_SOURCE:-generated}" in
  input|session_state|latest_handoff)
    RESUME_CORRELATION_ID="$CORRELATION_ID"
    ;;
esac

SOURCE="startup"
SESSION_NAME=""
HOOK_META_JSON="{}"
if [ -n "$INPUT" ] && command -v jq >/dev/null 2>&1; then
  SOURCE="$(printf '%s' "$INPUT" | jq -r '.source // "startup"' 2>/dev/null)"
  # Capture session name from -n/--name CLI flag (CC v2.1.76+)
  SESSION_NAME="$(printf '%s' "$INPUT" | jq -r '.session_name // .name // empty' 2>/dev/null)"
  HOOK_META_JSON="$(printf '%s' "$INPUT" | jq -c '{hook_event:(.hook_event_name // "SessionStart"), source:(.source // "startup"), session_name:(.session_name // .name // null), ts:(.ts // now | tostring)}' 2>/dev/null)"
fi

cleanup_resume_stale_context() {
  rm -f "$RESUME_FILE" "$RESUME_JSON_FILE" "$RESUME_PENDING_FLAG" 2>/dev/null || true
}

write_resume_error_file() {
  local error_code="${1:-resume_pack_failed}"
  local error_message="${2:-resume-pack failed}"
  local next_command="${3:-harness-mem doctor --fix}"
  {
    echo "# Memory Resume Error"
    echo ""
    echo "- 原因: resume-pack の取得に失敗しました (${error_code})"
    echo "- 詳細: ${error_message}"
    echo "- 影響: 前回セッションの再開コンテキスト注入をスキップしました。"
    echo "- 次コマンド: \`${next_command}\`"
  } > "$RESUME_ERROR_FILE" 2>/dev/null || true
}

_DAEMON_RESTARTED=false

attempt_daemon_restart() {
  # フォールバック再起動: 1スクリプト実行内で1回のみ実行（_DAEMON_RESTARTEDで制御）
  if [ "$_DAEMON_RESTARTED" = "true" ]; then
    return
  fi
  if [ ! -x "$DAEMON_SCRIPT" ]; then
    return
  fi
  _DAEMON_RESTARTED=true
  HARNESS_MEM_CODEX_PROJECT_ROOT="$PROJECT_ROOT" \
    HARNESS_MEM_HOST="${HARNESS_MEM_HOST:-127.0.0.1}" \
    HARNESS_MEM_PORT="${HARNESS_MEM_PORT:-37888}" \
    HARNESS_MEM_DB_PATH="${HARNESS_MEM_DB_PATH:-$HOME/.harness-mem/harness-mem.db}" \
    "$DAEMON_SCRIPT" cleanup-stale --quiet >/dev/null 2>&1 || true
  HARNESS_MEM_CODEX_PROJECT_ROOT="$PROJECT_ROOT" \
    HARNESS_MEM_HOST="${HARNESS_MEM_HOST:-127.0.0.1}" \
    HARNESS_MEM_PORT="${HARNESS_MEM_PORT:-37888}" \
    HARNESS_MEM_DB_PATH="${HARNESS_MEM_DB_PATH:-$HOME/.harness-mem/harness-mem.db}" \
    "$DAEMON_SCRIPT" start --quiet >/dev/null 2>&1 || true
  sleep 1
}

if [ -x "$CLIENT_SCRIPT" ]; then
  # デーモン生存チェック: 応答がなければフォールバック再起動を試みる
  HEALTH_CHECK_RESULT="$(HARNESS_MEM_CLIENT_TIMEOUT_SEC=2 "$CLIENT_SCRIPT" health 2>/dev/null || true)"
  if [ -z "$HEALTH_CHECK_RESULT" ] || { command -v jq >/dev/null 2>&1 && ! printf '%s' "$HEALTH_CHECK_RESULT" | jq -e '.ok == true' >/dev/null 2>&1; }; then
    attempt_daemon_restart
  fi

  SESSION_NAME_ARG=""
  SESSION_NAME_TAGS='["hook","session_start","requeue_meta_v1"]'
  if [ -n "$SESSION_NAME" ]; then
    SESSION_NAME_ARG="$SESSION_NAME"
    SESSION_NAME_TAGS='["hook","session_start","requeue_meta_v1","named_session"]'
  fi

  EVENT_PAYLOAD=$(jq -nc \
    --arg platform "claude" \
    --arg project "$PROJECT_NAME" \
    --arg session_id "$HARNESS_SESSION_ID" \
    --arg event_type "session_start" \
    --arg correlation_id "$CORRELATION_ID" \
    --arg source "$SOURCE" \
    --arg session_name "$SESSION_NAME_ARG" \
    --argjson tags "$SESSION_NAME_TAGS" \
    --argjson hook_meta "$HOOK_META_JSON" \
    '{event:{platform:$platform,project:$project,session_id:$session_id,event_type:$event_type,correlation_id:$correlation_id,payload:{source:$source,session_name:$session_name,meta:$hook_meta},tags:$tags,privacy_tags:[]}}' 2>/dev/null)

  if [ -n "$EVENT_PAYLOAD" ]; then
    printf '%s' "$EVENT_PAYLOAD" | "$CLIENT_SCRIPT" record-event >/dev/null 2>&1 || true
  fi

  if [ -n "$RESUME_CORRELATION_ID" ]; then
    RESUME_PAYLOAD=$(jq -nc \
      --arg project "$PROJECT_NAME" \
      --arg session_id "$HARNESS_SESSION_ID" \
      --arg correlation_id "$RESUME_CORRELATION_ID" \
      '{project:$project,session_id:$session_id,correlation_id:$correlation_id,limit:5,include_private:false}' 2>/dev/null)
  else
    RESUME_PAYLOAD=$(jq -nc \
      --arg project "$PROJECT_NAME" \
      --arg session_id "$HARNESS_SESSION_ID" \
      '{project:$project,session_id:$session_id,limit:5,include_private:false}' 2>/dev/null)
  fi

  if [ -z "$RESUME_PAYLOAD" ]; then
    cleanup_resume_stale_context
    write_resume_error_file "resume_pack_payload_build_failed" "failed to build resume-pack payload (jq unavailable or invalid state)" "harness-mem doctor --fix"
  else
    RESUME_RESPONSE="$(printf '%s' "$RESUME_PAYLOAD" | "$CLIENT_SCRIPT" resume-pack 2>/dev/null || true)"
    RESUME_FAILED=false
    RESUME_ERROR_CODE=""
    RESUME_ERROR_MESSAGE=""

    if [ -z "$RESUME_RESPONSE" ]; then
      RESUME_FAILED=true
      RESUME_ERROR_CODE="resume_pack_empty_response"
      RESUME_ERROR_MESSAGE="resume-pack returned an empty response"
    elif command -v jq >/dev/null 2>&1; then
      if ! printf '%s' "$RESUME_RESPONSE" | jq -e '.' >/dev/null 2>&1; then
        RESUME_FAILED=true
        RESUME_ERROR_CODE="resume_pack_invalid_json"
        RESUME_ERROR_MESSAGE="resume-pack returned invalid JSON"
      elif printf '%s' "$RESUME_RESPONSE" | jq -e '.ok == false' >/dev/null 2>&1; then
        RESUME_FAILED=true
        RESUME_ERROR_CODE="$(printf '%s' "$RESUME_RESPONSE" | jq -r '.error_code // "resume_pack_failed"' 2>/dev/null)"
        RESUME_ERROR_MESSAGE="$(printf '%s' "$RESUME_RESPONSE" | jq -r '.error // "resume-pack failed"' 2>/dev/null)"
      fi
    fi

    if [ "$RESUME_FAILED" = "true" ]; then
      # フォールバック: デーモン再起動後に resume-pack を1回リトライ
      if [ "$_DAEMON_RESTARTED" = "false" ]; then
        attempt_daemon_restart
        RESUME_RESPONSE="$(printf '%s' "$RESUME_PAYLOAD" | "$CLIENT_SCRIPT" resume-pack 2>/dev/null || true)"
        RESUME_FAILED=false
        RESUME_ERROR_CODE=""
        RESUME_ERROR_MESSAGE=""
        if [ -z "$RESUME_RESPONSE" ]; then
          RESUME_FAILED=true
          RESUME_ERROR_CODE="resume_pack_empty_response"
          RESUME_ERROR_MESSAGE="resume-pack returned an empty response (after daemon restart)"
        elif command -v jq >/dev/null 2>&1; then
          if ! printf '%s' "$RESUME_RESPONSE" | jq -e '.' >/dev/null 2>&1; then
            RESUME_FAILED=true
            RESUME_ERROR_CODE="resume_pack_invalid_json"
            RESUME_ERROR_MESSAGE="resume-pack returned invalid JSON (after daemon restart)"
          elif printf '%s' "$RESUME_RESPONSE" | jq -e '.ok == false' >/dev/null 2>&1; then
            RESUME_FAILED=true
            RESUME_ERROR_CODE="$(printf '%s' "$RESUME_RESPONSE" | jq -r '.error_code // "resume_pack_failed"' 2>/dev/null)"
            RESUME_ERROR_MESSAGE="$(printf '%s' "$RESUME_RESPONSE" | jq -r '.error // "resume-pack failed"' 2>/dev/null)"
          fi
        fi
      fi
    fi

    if [ "$RESUME_FAILED" = "true" ]; then
      cleanup_resume_stale_context
      write_resume_error_file "$RESUME_ERROR_CODE" "$RESUME_ERROR_MESSAGE" "harness-mem doctor --fix"
    else
      rm -f "$RESUME_ERROR_FILE" 2>/dev/null || true
      printf '%s' "$RESUME_RESPONSE" > "$RESUME_JSON_FILE" 2>/dev/null || true

      if command -v jq >/dev/null 2>&1; then
        RENDERED_RESUME_CONTEXT="$(hook_render_resume_pack_markdown "$RESUME_RESPONSE")"
        if [ -n "$RENDERED_RESUME_CONTEXT" ]; then
          printf '%s\n' "$RENDERED_RESUME_CONTEXT" > "$RESUME_FILE"
          touch "$RESUME_PENDING_FLAG" 2>/dev/null || true
        else
          rm -f "$RESUME_FILE" "$RESUME_PENDING_FLAG" 2>/dev/null || true
        fi
      fi
    fi
  fi
fi

exit 0
