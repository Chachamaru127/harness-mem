#!/bin/bash
# memory-worktree-event.sh
# WorktreeCreate / WorktreeRemove hook: track worktree lifecycle and memory isolation
# Supports sparse checkout (worktree.sparsePaths, CC v2.1.76+)

set +e

# shellcheck disable=SC1090
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/hook-common.sh"

hook_init_paths
hook_init_context

STATE_DIR="${PROJECT_ROOT}/.claude/state"
SESSION_FILE="${STATE_DIR}/session.json"

hook_resolve_session_id "claude" "$SESSION_FILE" "generate"
hook_check_deps

ACTION="${1:-create}"

WORKTREE_PATH=""
IS_SPARSE="false"
SPARSE_PATHS_JSON="[]"
if [ -n "$INPUT" ] && command -v jq >/dev/null 2>&1; then
  WORKTREE_PATH="$(printf '%s' "$INPUT" | jq -r '.worktree_path // .path // empty' 2>/dev/null)"
  # Detect sparse checkout (CC v2.1.76+ worktree.sparsePaths setting)
  # Claude sends camelCase (.sparsePaths), normalize to snake_case
  SPARSE_PATHS_JSON="$(printf '%s' "$INPUT" | jq -c '.sparsePaths // .sparse_paths // []' 2>/dev/null)"
  if [ "$SPARSE_PATHS_JSON" != "[]" ] && [ "$SPARSE_PATHS_JSON" != "null" ]; then
    IS_SPARSE="true"
  fi
fi

# If worktree path available, also check git sparse-checkout state
if [ -n "$WORKTREE_PATH" ] && [ -d "$WORKTREE_PATH" ] && [ "$IS_SPARSE" = "false" ]; then
  if git -C "$WORKTREE_PATH" sparse-checkout list >/dev/null 2>&1; then
    SPARSE_LIST="$(git -C "$WORKTREE_PATH" sparse-checkout list 2>/dev/null || true)"
    if [ -n "$SPARSE_LIST" ] && [ "$SPARSE_LIST" != "/*" ]; then
      IS_SPARSE="true"
    fi
  fi
fi

EVENT_PAYLOAD=$(jq -nc \
  --arg platform "claude" \
  --arg project "$PROJECT_NAME" \
  --arg session_id "$SESSION_ID" \
  --arg action "$ACTION" \
  --arg worktree_path "$WORKTREE_PATH" \
  --argjson is_sparse "$IS_SPARSE" \
  --argjson sparse_paths "$SPARSE_PATHS_JSON" \
  '{event:{platform:$platform,project:$project,session_id:$session_id,event_type:("worktree_" + $action),payload:{worktree_path:$worktree_path,is_sparse:$is_sparse,sparse_paths:$sparse_paths},tags:["hook","worktree",$action]}}' 2>/dev/null)

if [ -n "$EVENT_PAYLOAD" ]; then
  printf '%s' "$EVENT_PAYLOAD" | "$CLIENT_SCRIPT" record-event >/dev/null 2>&1 || true
fi

exit 0
