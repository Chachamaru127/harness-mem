#!/bin/bash
# memory-self-check.sh
# SessionStart hook: lightweight self-check for harness-mem environment.
# Non-blocking: set +e, always exit 0. Writes artifacts and warning file on failure.

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

STATE_DIR="${PROJECT_ROOT}/.claude/state"
SELFCHECK_JSON="${STATE_DIR}/memory-self-check.json"
SELFCHECK_JSONL="${STATE_DIR}/memory-self-check.jsonl"
SELFCHECK_WARNING="${STATE_DIR}/memory-self-check-warning.md"
RETRY_STAMP="${STATE_DIR}/.memory-self-check-retry-stamp"
COOLDOWN_SEC=300

mkdir -p "$STATE_DIR" 2>/dev/null || true

# --- Health check (short timeout) ---
VALIDATION_START=$(date +%s)
HEALTH_RESULT=""
if [ -x "$CLIENT_SCRIPT" ]; then
  HEALTH_RESULT="$(HARNESS_MEM_CLIENT_TIMEOUT_SEC=2 "$CLIENT_SCRIPT" health 2>/dev/null || printf '{"ok":false,"error":"unreachable"}')"
fi
VALIDATION_END=$(date +%s)
DURATION_MS=$(( (VALIDATION_END - VALIDATION_START) * 1000 ))

# --- Parse health ---
HEALTH_OK=false
BACKEND_MODE="local"
WARNINGS="[]"
if command -v jq >/dev/null 2>&1 && [ -n "$HEALTH_RESULT" ]; then
  if printf '%s' "$HEALTH_RESULT" | jq -e '.ok == true' >/dev/null 2>&1; then
    HEALTH_OK=true
  fi
  BACKEND_MODE="$(printf '%s' "$HEALTH_RESULT" | jq -r '.items[0].backend_mode // "local"' 2>/dev/null || echo "local")"
  WARNINGS="$(printf '%s' "$HEALTH_RESULT" | jq -c '.items[0].warnings // []' 2>/dev/null || echo "[]")"
fi

# --- One-shot repair (only when unhealthy, with cooldown) ---
REPAIR_ATTEMPTED=false
REPAIR_SUCCESS=false
if [ "$HEALTH_OK" = "false" ] && [ -x "$DAEMON_SCRIPT" ]; then
  NOW=$(date +%s)
  STAMP_AGE=999999
  if [ -f "$RETRY_STAMP" ]; then
    STAMP_TS=$(cat "$RETRY_STAMP" 2>/dev/null || echo "0")
    STAMP_AGE=$(( NOW - STAMP_TS ))
  fi
  if [ "$STAMP_AGE" -ge "$COOLDOWN_SEC" ]; then
    REPAIR_ATTEMPTED=true
    printf '%s' "$NOW" > "$RETRY_STAMP" 2>/dev/null || true
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
    HEALTH_AFTER="$(HARNESS_MEM_CLIENT_TIMEOUT_SEC=2 "$CLIENT_SCRIPT" health 2>/dev/null || printf '{"ok":false}')"
    if printf '%s' "$HEALTH_AFTER" | jq -e '.ok == true' >/dev/null 2>&1; then
      REPAIR_SUCCESS=true
      HEALTH_OK=true
      HEALTH_RESULT="$HEALTH_AFTER"
    fi
  fi
fi

# --- Resume-pack probe (short timeout, machine-readable) ---
RESUME_PROBE_OK=false
RESUME_PROBE_COUNT=0
RESUME_PROBE_ERROR_CODE=""
RESUME_PROBE_ERROR=""
if [ -x "$CLIENT_SCRIPT" ] && command -v jq >/dev/null 2>&1; then
  PROBE_SESSION_ID="self-check-$(date +%s)"
  PROBE_PAYLOAD="$(jq -nc \
    --arg project "$PROJECT_NAME" \
    --arg session_id "$PROBE_SESSION_ID" \
    '{project:$project,session_id:$session_id,limit:1,include_private:false}' 2>/dev/null)"
  if [ -n "$PROBE_PAYLOAD" ]; then
    RESUME_PROBE_RESULT="$(HARNESS_MEM_CLIENT_TIMEOUT_SEC=2 "$CLIENT_SCRIPT" resume-pack "$PROBE_PAYLOAD" 2>/dev/null || printf '{"ok":false,"error":"resume-probe-unreachable","error_code":"resume_probe_unreachable"}')"
    if printf '%s' "$RESUME_PROBE_RESULT" | jq -e '.' >/dev/null 2>&1; then
      if printf '%s' "$RESUME_PROBE_RESULT" | jq -e '.ok == false' >/dev/null 2>&1; then
        RESUME_PROBE_OK=false
        RESUME_PROBE_COUNT=0
        RESUME_PROBE_ERROR_CODE="$(printf '%s' "$RESUME_PROBE_RESULT" | jq -r '.error_code // "resume_probe_failed"' 2>/dev/null)"
        RESUME_PROBE_ERROR="$(printf '%s' "$RESUME_PROBE_RESULT" | jq -r '.error // "resume-pack probe failed"' 2>/dev/null)"
      else
        RESUME_PROBE_OK=true
        RESUME_PROBE_COUNT="$(printf '%s' "$RESUME_PROBE_RESULT" | jq -r '.meta.count // (.items | length) // 0' 2>/dev/null)"
      fi
    else
      RESUME_PROBE_OK=false
      RESUME_PROBE_COUNT=0
      RESUME_PROBE_ERROR_CODE="resume_probe_invalid_json"
      RESUME_PROBE_ERROR="resume-pack probe returned invalid JSON"
    fi
  else
    RESUME_PROBE_OK=false
    RESUME_PROBE_COUNT=0
    RESUME_PROBE_ERROR_CODE="resume_probe_payload_build_failed"
    RESUME_PROBE_ERROR="failed to build resume-pack probe payload"
  fi
fi

case "$RESUME_PROBE_COUNT" in
  ''|*[!0-9]*)
    RESUME_PROBE_COUNT=0
    ;;
esac

# --- Write artifacts ---
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
if command -v jq >/dev/null 2>&1; then
  if [ -n "$HEALTH_RESULT" ]; then
    BACKEND_MODE="$(printf '%s' "$HEALTH_RESULT" | jq -r '.items[0].backend_mode // "local"' 2>/dev/null || echo "local")"
    WARNINGS="$(printf '%s' "$HEALTH_RESULT" | jq -c '.items[0].warnings // []' 2>/dev/null || echo "[]")"
  fi
  ENTRY=$(jq -nc \
    --arg ts "$TS" \
    --arg hook "SessionStart" \
    --arg project "$PROJECT_NAME" \
    --argjson duration_ms "$DURATION_MS" \
    --argjson health_ok "$HEALTH_OK" \
    --arg backend_mode "$BACKEND_MODE" \
    --argjson repair_attempted "$REPAIR_ATTEMPTED" \
    --argjson repair_success "$REPAIR_SUCCESS" \
    --argjson resume_probe_ok "$RESUME_PROBE_OK" \
    --argjson resume_probe_count "$RESUME_PROBE_COUNT" \
    --arg resume_probe_error_code "$RESUME_PROBE_ERROR_CODE" \
    --arg resume_probe_error "$RESUME_PROBE_ERROR" \
    --argjson warnings "$WARNINGS" \
    '{ts:$ts,hook:$hook,project:$project,duration_ms:$duration_ms,health_ok:$health_ok,backend_mode:$backend_mode,repair_attempted:$repair_attempted,repair_success:$repair_success,resume_probe_ok:$resume_probe_ok,resume_probe_count:$resume_probe_count,resume_probe_error_code:$resume_probe_error_code,resume_probe_error:$resume_probe_error,warnings:$warnings}')
  printf '%s\n' "$ENTRY" > "$SELFCHECK_JSON" 2>/dev/null || true
  printf '%s\n' "$ENTRY" >> "$SELFCHECK_JSONL" 2>/dev/null || true
fi

# --- Warning file: generate on failure, clear on success ---
if [ "$HEALTH_OK" = "true" ] && [ "$RESUME_PROBE_OK" = "true" ]; then
  rm -f "$SELFCHECK_WARNING" 2>/dev/null || true
else
  {
    echo "# harness-mem セルフチェック: 異常検出"
    echo ""
    echo "harness-mem の環境が正常に動作していません。"
    echo ""
    echo "- health_ok: ${HEALTH_OK}"
    echo "- resume_probe_ok: ${RESUME_PROBE_OK}"
    if [ -n "$RESUME_PROBE_ERROR_CODE" ]; then
      echo "- resume_probe_error_code: ${RESUME_PROBE_ERROR_CODE}"
    fi
    if [ -n "$RESUME_PROBE_ERROR" ]; then
      echo "- resume_probe_error: ${RESUME_PROBE_ERROR}"
    fi
    echo ""
    echo "## 修復手順"
    echo ""
    echo "1. 以下を実行して自動修復を試してください:"
    echo "   \`\`\`"
    echo "   harness-mem doctor --fix"
    echo "   \`\`\`"
    echo ""
    echo "2. それでも解決しない場合は daemon を再起動してください:"
    echo "   \`\`\`"
    echo "   harness-memd stop"
    echo "   harness-memd start"
    echo "   \`\`\`"
    echo ""
    echo "3. 詳細な診断:"
    echo "   \`\`\`"
    echo "   harness-mem doctor"
    echo "   \`\`\`"
    echo ""
    echo "4. resume-pack probe の手動確認:"
    echo "   \`\`\`"
    echo "   ./scripts/harness-mem-client.sh resume-pack '{\"project\":\"${PROJECT_NAME}\",\"session_id\":\"self-check-manual\",\"limit\":1,\"include_private\":false}'"
    echo "   \`\`\`"
    echo ""
    echo "---"
    echo "検出日時: $TS"
  } > "$SELFCHECK_WARNING" 2>/dev/null || true
fi

exit 0
