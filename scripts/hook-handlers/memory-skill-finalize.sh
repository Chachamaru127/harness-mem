#!/bin/bash
# memory-skill-finalize.sh
# PostToolUse(Skill) hook: スキル完了時にセッションサマリーを更新する
#
# 目的: /harness-work, /harness-review 等のスキル完了後に finalize-session を呼び、
#       ターミナル強制終了時でもサマリーが残るようにする。
# finalize-session は冪等なので、Stop フックとの二重呼び出しも安全。

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

[ -z "$INPUT" ] && exit 0

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

SESSION_ID=""
TOOL_NAME=""
if command -v jq >/dev/null 2>&1; then
  SESSION_ID="$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)"
  TOOL_NAME="$(printf '%s' "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)"
fi

if [ -z "$SESSION_ID" ] && [ -f "$SESSION_FILE" ] && command -v jq >/dev/null 2>&1; then
  SESSION_ID="$(jq -r '.session_id // empty' "$SESSION_FILE" 2>/dev/null)"
fi

[ -z "$SESSION_ID" ] && exit 0

# Skill ツール以外はスキップ（念のため）
[ "$TOOL_NAME" != "Skill" ] && exit 0

# finalize-session を呼ぶ（harness-mem-client.sh 経由）
if [ -x "$CLIENT_SCRIPT" ] && command -v jq >/dev/null 2>&1; then
  FINALIZE_PAYLOAD=$(jq -nc \
    --arg platform "claude" \
    --arg project "$PROJECT_NAME" \
    --arg session_id "$SESSION_ID" \
    --arg summary_mode "skill_completed" \
    '{platform:$platform,project:$project,session_id:$session_id,summary_mode:$summary_mode}' 2>/dev/null)

  if [ -n "$FINALIZE_PAYLOAD" ]; then
    printf '%s' "$FINALIZE_PAYLOAD" | "$CLIENT_SCRIPT" finalize-session >/dev/null 2>&1 || true
  fi
# フォールバック: curl で直接 API を呼ぶ
elif command -v curl >/dev/null 2>&1; then
  _port="${HARNESS_MEM_PORT:-37888}"
  curl -sf -X POST "http://localhost:${_port}/v1/sessions/finalize" \
    -H "Content-Type: application/json" \
    -d "{\"project\":\"${PROJECT_NAME}\",\"session_id\":\"${SESSION_ID}\",\"summary_mode\":\"skill_completed\"}" \
    --connect-timeout 3 --max-time 5 \
    >/dev/null 2>&1 || true
fi

exit 0
