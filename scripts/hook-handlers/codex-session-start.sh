#!/bin/bash
# codex-session-start.sh
# Codex CLI SessionStart hook: record session start + retrieve resume pack
# For Codex CLI v0.114.0+ experimental hooks engine

set +e

# shellcheck disable=SC1090
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/hook-common.sh"

hook_init_paths "true"
hook_init_context
hook_resolve_session_id "codex" "" "generate"
hook_init_continuity_state
hook_init_whisper_state
hook_resolve_correlation_id "$SESSION_ID" "codex" "$INPUT"
hook_check_deps

HOOK_META_JSON="{}"
if command -v jq >/dev/null 2>&1; then
  HOOK_META_JSON="$(hook_extract_codex_hook_meta "$INPUT" "SessionStart")"
fi

RESUME_CORRELATION_ID=""
case "${CORRELATION_ID_SOURCE:-generated}" in
  input|session_state|latest_handoff)
    RESUME_CORRELATION_ID="$CORRELATION_ID"
    ;;
esac

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
  --arg correlation_id "$CORRELATION_ID" \
  --argjson hook_meta "$HOOK_META_JSON" \
  '{event:{platform:$platform,project:$project,session_id:$session_id,event_type:"session_start",correlation_id:$correlation_id,payload:{source:"codex_hooks_engine",meta:$hook_meta},tags:["codex_hook","session_start"]}}' 2>/dev/null)

if [ -n "$EVENT_PAYLOAD" ]; then
  printf '%s' "$EVENT_PAYLOAD" | "$CLIENT_SCRIPT" record-event >/dev/null 2>&1 || true
fi

# Retrieve resume pack
if [ -n "$RESUME_CORRELATION_ID" ]; then
  RESUME_PAYLOAD=$(jq -nc \
      --arg project "$PROJECT_NAME" \
      --arg session_id "$SESSION_ID" \
      --arg correlation_id "$RESUME_CORRELATION_ID" \
      '{project:$project,session_id:$session_id,correlation_id:$correlation_id,limit:5,include_private:false,detail_level:"L0",resume_pack_max_tokens:1200}' 2>/dev/null)
  else
    RESUME_PAYLOAD=$(jq -nc \
      --arg project "$PROJECT_NAME" \
      --arg session_id "$SESSION_ID" \
      '{project:$project,session_id:$session_id,limit:5,include_private:false,detail_level:"L0",resume_pack_max_tokens:1200}' 2>/dev/null)
  fi

if [ -n "$RESUME_PAYLOAD" ]; then
  RESUME_RESPONSE="$(printf '%s' "$RESUME_PAYLOAD" | "$CLIENT_SCRIPT" resume-pack 2>/dev/null || true)"
  if [ -n "$RESUME_RESPONSE" ] && printf '%s' "$RESUME_RESPONSE" | jq -e '.ok != false' >/dev/null 2>&1; then
    RESUME_IDENTITY_JSON="$(hook_current_resume_artifact_identity_json "harness_mem_resume_pack")"
    RESUME_RESPONSE_WITH_IDENTITY="$(hook_attach_resume_pack_identity "$RESUME_RESPONSE" "$RESUME_IDENTITY_JSON")"
    [ -n "$RESUME_RESPONSE_WITH_IDENTITY" ] && RESUME_RESPONSE="$RESUME_RESPONSE_WITH_IDENTITY"
    RENDERED_RESUME_CONTEXT=""
    if hook_resume_artifact_json_matches_current "$RESUME_RESPONSE" "harness_mem_resume_pack"; then
      RENDERED_RESUME_CONTEXT="$(hook_render_resume_pack_markdown "$RESUME_RESPONSE")"
    fi
    if [ -n "$RENDERED_RESUME_CONTEXT" ]; then
      hook_mark_whisper_resume_skip "$SESSION_ID" "harness_mem_resume_pack"
      hook_emit_codex_additional_context "SessionStart" "$RENDERED_RESUME_CONTEXT"
    fi
  fi
fi

exit 0
