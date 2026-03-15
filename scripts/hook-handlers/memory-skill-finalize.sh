#!/bin/bash
# memory-skill-finalize.sh
# PostToolUse(Skill) hook: スキル完了時にセッションサマリーを更新する
#
# 目的: /harness-work, /harness-review 等のスキル完了後に finalize-session を呼び、
#       ターミナル強制終了時でもサマリーが残るようにする。
# finalize-session は冪等なので、Stop フックとの二重呼び出しも安全。

set +e

# shellcheck disable=SC1090
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/hook-common.sh"

hook_init_paths
hook_init_context "true"

STATE_DIR="${PROJECT_ROOT}/.claude/state"
SESSION_FILE="${STATE_DIR}/session.json"

hook_resolve_session_id "claude" "$SESSION_FILE" "require"

TOOL_NAME=""
if command -v jq >/dev/null 2>&1; then
  TOOL_NAME="$(printf '%s' "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)"
fi

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
