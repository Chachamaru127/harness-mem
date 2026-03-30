#!/bin/bash
# hook-common.sh
# Shared initialization helpers for hook handler scripts.
# Source this file at the top of each hook handler to eliminate boilerplate.

# ---------- hook_init_paths [has_daemon] ----------
# Resolve standard path variables used by all hook handlers.
# Sets: SCRIPT_DIR, PARENT_DIR, CLIENT_SCRIPT, PROJECT_CONTEXT_LIB
# If has_daemon="true", also sets: DAEMON_SCRIPT
hook_init_paths() {
  local has_daemon="${1:-false}"

  # BASH_SOURCE[0] is hook-common.sh itself; the caller is BASH_SOURCE[1]
  local caller_source="${BASH_SOURCE[1]}"
  local caller_dir
  caller_dir="$(cd "$(dirname "$caller_source")" && pwd)"

  if [ -f "${caller_dir}/harness-mem-client.sh" ] || [ -f "${caller_dir}/harness-memd" ]; then
    SCRIPT_DIR="$caller_dir"
    PARENT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
    CLIENT_SCRIPT="${SCRIPT_DIR}/harness-mem-client.sh"
    PROJECT_CONTEXT_LIB="${SCRIPT_DIR}/hook-handlers/lib/project-context.sh"
  else
    SCRIPT_DIR="$caller_dir"
    PARENT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
    CLIENT_SCRIPT="${PARENT_DIR}/harness-mem-client.sh"
    PROJECT_CONTEXT_LIB="${SCRIPT_DIR}/lib/project-context.sh"
  fi

  # CLAUDE_PLUGIN_DATA (CC v2.1.78+): persistent plugin data directory that
  # survives plugin updates. Falls back to HARNESS_MEM_HOME or ~/.harness-mem.
  PLUGIN_DATA_DIR="${CLAUDE_PLUGIN_DATA:-${HARNESS_MEM_HOME:-$HOME/.harness-mem}}"
  export PLUGIN_DATA_DIR

  # Wire PLUGIN_DATA_DIR into DB path fallback chain so that when
  # CLAUDE_PLUGIN_DATA is set, the daemon uses it for state/DB storage.
  if [ -z "${HARNESS_MEM_DB_PATH:-}" ] && [ -n "${CLAUDE_PLUGIN_DATA:-}" ]; then
    export HARNESS_MEM_DB_PATH="${CLAUDE_PLUGIN_DATA}/harness-mem.db"
  fi

  if [ "$has_daemon" = "true" ]; then
    if [ -f "${SCRIPT_DIR}/harness-memd" ]; then
      DAEMON_SCRIPT="${SCRIPT_DIR}/harness-memd"
    else
      DAEMON_SCRIPT="${PARENT_DIR}/harness-memd"
    fi
  fi
}

# ---------- hook_init_context [require_input] ----------
# Read stdin if available, source project-context.sh, resolve PROJECT_ROOT/PROJECT_NAME.
# Sets: INPUT, PROJECT_ROOT, PROJECT_NAME
# If require_input="true", exits 0 when stdin is empty.
hook_init_context() {
  local require_input="${1:-false}"

  INPUT=""
  if [ ! -t 0 ]; then
    INPUT="$(cat 2>/dev/null)"
  fi

  if [ "$require_input" = "true" ] && [ -z "$INPUT" ]; then
    exit 0
  fi

  if [ -f "$PROJECT_CONTEXT_LIB" ]; then
    # shellcheck disable=SC1090
    source "$PROJECT_CONTEXT_LIB"
  fi

  PROJECT_ROOT=""
  PROJECT_NAME=""
  if command -v resolve_project_context >/dev/null 2>&1; then
    local context
    context="$(resolve_project_context "$INPUT")"
    PROJECT_ROOT="$(printf '%s\n' "$context" | sed -n '1p')"
    PROJECT_NAME="$(printf '%s\n' "$context" | sed -n '2p')"
  fi

  [ -n "$PROJECT_ROOT" ] || PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  [ -n "$PROJECT_NAME" ] || PROJECT_NAME="$(basename "$PROJECT_ROOT")"
}

# ---------- hook_resolve_session_id <platform> [session_file] [mode] ----------
# Resolve SESSION_ID from INPUT JSON, optional session file, and platform-specific fallback.
# platform: "codex" | "claude"
#   codex: extracts session_id/thread_id, generates "codex-<ts>" fallback
#   claude: extracts session_id, falls back to session_file, generates "session-<ts>" fallback
# session_file: path to session.json for claude platform (ignored for codex)
# mode: "generate" (default) — generate ID if missing; "require" — exit 0 if missing
# Sets: SESSION_ID
hook_resolve_session_id() {
  local platform="${1:-claude}"
  local session_file="${2:-}"
  local mode="${3:-generate}"

  SESSION_ID=""

  if [ -n "$INPUT" ] && command -v jq >/dev/null 2>&1; then
    case "$platform" in
      codex)
        SESSION_ID="$(printf '%s' "$INPUT" | jq -r '.session_id // .thread_id // empty' 2>/dev/null)"
        ;;
      *)
        SESSION_ID="$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)"
        ;;
    esac
  fi

  # Claude platform: fall back to session.json file
  if [ -z "$SESSION_ID" ] && [ "$platform" != "codex" ] && [ -n "$session_file" ] && [ -f "$session_file" ] && command -v jq >/dev/null 2>&1; then
    SESSION_ID="$(jq -r '.session_id // empty' "$session_file" 2>/dev/null)"
  fi

  if [ -z "$SESSION_ID" ]; then
    case "$mode" in
      require)
        exit 0
        ;;
      *)
        case "$platform" in
          codex) SESSION_ID="codex-$(date +%s)" ;;
          *)     SESSION_ID="session-$(date +%s)" ;;
        esac
        ;;
    esac
  fi
}

# ---------- hook_check_deps ----------
# Verify CLIENT_SCRIPT is executable and jq is available.
# Exits 0 silently if either is missing (non-blocking).
hook_check_deps() {
  [ -x "$CLIENT_SCRIPT" ] || exit 0
  command -v jq >/dev/null 2>&1 || exit 0
}

hook_prompt_contains_explicit_continuity_handoff() {
  local prompt_text="${1:-}"
  [ -n "$prompt_text" ] || return 1

  printf '%s\n' "$prompt_text" | grep -Eiq '(^|[[:space:]])(問題|課題|problem|problems|issue|issues)[[:space:]]*[:：]' || return 1
  printf '%s\n' "$prompt_text" | grep -Eiq '(^|[[:space:]])(決定|方針|decision|decisions)[[:space:]]*[:：]' || return 1
  printf '%s\n' "$prompt_text" | grep -Eiq '(^|[[:space:]])(次アクション|次の対応|次対応|次にやるべきこと|next action|next actions|next step|next steps|todo|todos)[[:space:]]*[:：]' || return 1
  return 0
}

hook_prompt_should_suppress_visibility() {
  local prompt_text="${1:-}"
  [ -n "$prompt_text" ] || return 1

  printf '%s\n' "$prompt_text" | grep -Eiq '^ツールを使わず、次の handoff を次回セッション用に受け取ってください。返答は saved のみ。' && return 0
  printf '%s\n' "$prompt_text" | grep -Eiq '^ツールを使わず、今この新しいセッション開始時に見えている情報だけで答えてください。' && return 0
  return 1
}

hook_set_session_visibility_suppressed() {
  local session_id="${1:-}"
  local suppressed="${2:-true}"
  [ -n "$session_id" ] || return 0
  command -v jq >/dev/null 2>&1 || return 0

  local state_json
  state_json="$(hook_read_continuity_state)"
  state_json="$(
    printf '%s' "$state_json" | jq -c \
      --arg project "${PROJECT_NAME:-}" \
      --arg sid "$session_id" \
      --argjson suppressed "$([ "$suppressed" = "true" ] && printf 'true' || printf 'false')" \
      '
        .version = 1
        | .project = $project
        | .sessions = (.sessions // {})
        | .sessions[$sid] = ((.sessions[$sid] // {}) + {suppress_visibility: $suppressed})
      ' 2>/dev/null
  )"

  [ -n "$state_json" ] && hook_write_continuity_state "$state_json"
}

hook_session_visibility_suppressed() {
  local session_id="${1:-}"
  [ -n "$session_id" ] || return 1
  command -v jq >/dev/null 2>&1 || return 1
  [ -f "${CONTINUITY_STATE_FILE:-}" ] || return 1

  jq -e --arg sid "$session_id" '.sessions[$sid].suppress_visibility == true' "$CONTINUITY_STATE_FILE" >/dev/null 2>&1
}

hook_normalize_explicit_continuity_handoff() {
  local prompt_text="${1:-}"
  [ -n "$prompt_text" ] || return 0

  local normalized
  normalized="$(
    printf '%s\n' "$prompt_text" | awk '
      function trim(s) {
        sub(/^[[:space:]]+/, "", s)
        sub(/[[:space:]]+$/, "", s)
        return s
      }
      function emit_header(label) {
        if (seen_headers[label] == 1) return
        if (out != "") out = out "\n\n"
        out = out label ":"
        seen_headers[label] = 1
      }
      function emit_item(label, value) {
        value = trim(value)
        sub(/^([-*+]|[0-9]+[.)])[[:space:]]*/, "", value)
        value = trim(value)
        if (value == "") return
        emit_header(label)
        out = out "\n- " value
      }
      {
        raw = $0
        line = trim(raw)
        if (line == "") next

        inline = line
        lower = tolower(line)

        if (line ~ /^(問題|課題)[[:space:]]*[:：]?[[:space:]]*$/ || lower ~ /^(problem|problems|issue|issues)[[:space:]]*:[[:space:]]*$/) {
          section = "Problem"
          emit_header(section)
          next
        }
        if (line ~ /^(決定|方針)[[:space:]]*[:：]?[[:space:]]*$/ || lower ~ /^(decision|decisions)[[:space:]]*:[[:space:]]*$/) {
          section = "Decision"
          emit_header(section)
          next
        }
        if (line ~ /^(次アクション|次の対応|次対応|次にやるべきこと)[[:space:]]*[:：]?[[:space:]]*$/ || lower ~ /^(next action|next actions|next step|next steps|todo|todos)[[:space:]]*:[[:space:]]*$/) {
          section = "Next Action"
          emit_header(section)
          next
        }
        if (line ~ /^(リスク|懸念)[[:space:]]*[:：]?[[:space:]]*$/ || lower ~ /^(risk|risks)[[:space:]]*:[[:space:]]*$/) {
          section = "Risk"
          emit_header(section)
          next
        }

        if (line ~ /^(問題|課題)[[:space:]]*[:：][[:space:]]*.+$/) {
          section = "Problem"
          sub(/^(問題|課題)[[:space:]]*[:：][[:space:]]*/, "", inline)
          emit_item(section, inline)
          next
        }
        if (lower ~ /^(problem|problems|issue|issues)[[:space:]]*:[[:space:]]*.+$/) {
          section = "Problem"
          sub(/^[^:]+:[[:space:]]*/, "", inline)
          emit_item(section, inline)
          next
        }
        if (line ~ /^(決定|方針)[[:space:]]*[:：][[:space:]]*.+$/) {
          section = "Decision"
          sub(/^(決定|方針)[[:space:]]*[:：][[:space:]]*/, "", inline)
          emit_item(section, inline)
          next
        }
        if (lower ~ /^(decision|decisions)[[:space:]]*:[[:space:]]*.+$/) {
          section = "Decision"
          sub(/^[^:]+:[[:space:]]*/, "", inline)
          emit_item(section, inline)
          next
        }
        if (line ~ /^(次アクション|次の対応|次対応|次にやるべきこと)[[:space:]]*[:：][[:space:]]*.+$/) {
          section = "Next Action"
          sub(/^(次アクション|次の対応|次対応|次にやるべきこと)[[:space:]]*[:：][[:space:]]*/, "", inline)
          emit_item(section, inline)
          next
        }
        if (lower ~ /^(next action|next actions|next step|next steps|todo|todos)[[:space:]]*:[[:space:]]*.+$/) {
          section = "Next Action"
          sub(/^[^:]+:[[:space:]]*/, "", inline)
          emit_item(section, inline)
          next
        }
        if (line ~ /^(リスク|懸念)[[:space:]]*[:：][[:space:]]*.+$/) {
          section = "Risk"
          sub(/^(リスク|懸念)[[:space:]]*[:：][[:space:]]*/, "", inline)
          emit_item(section, inline)
          next
        }
        if (lower ~ /^(risk|risks)[[:space:]]*:[[:space:]]*.+$/) {
          section = "Risk"
          sub(/^[^:]+:[[:space:]]*/, "", inline)
          emit_item(section, inline)
          next
        }

        if (section != "") {
          emit_item(section, line)
        }
      }
      END {
        print out
      }
    ' 2>/dev/null
  )"

  if [ -n "$normalized" ]; then
    printf '%s\n' "$normalized"
  else
    printf '%s\n' "$prompt_text"
  fi
}

hook_record_explicit_continuity_handoff() {
  local session_id="${1:-}"
  local platform="${2:-}"
  local correlation_id="${3:-}"
  local prompt_text="${4:-}"
  local privacy_tags_json="${5:-[]}"
  local hook_meta_json="${6:-}"
  local base_tags_json="${7:-[]}"
  [ -n "$hook_meta_json" ] || hook_meta_json='{}'

  [ -n "$session_id" ] || return 0
  [ -n "$prompt_text" ] || return 0
  command -v jq >/dev/null 2>&1 || return 0
  hook_prompt_contains_explicit_continuity_handoff "$prompt_text" || return 0

  local normalized_handoff
  normalized_handoff="$(hook_normalize_explicit_continuity_handoff "$prompt_text")"
  [ -n "$normalized_handoff" ] || normalized_handoff="$prompt_text"
  local handoff_tags_json
  handoff_tags_json="$(jq -cn --argjson base "$base_tags_json" '$base - ["visibility_suppressed"]' 2>/dev/null)"
  [ -n "$handoff_tags_json" ] || handoff_tags_json="$base_tags_json"

  local event_payload
  event_payload="$(jq -nc \
    --arg platform "$platform" \
    --arg project "${PROJECT_NAME:-}" \
    --arg session_id "$session_id" \
    --arg correlation_id "$correlation_id" \
    --arg content "$normalized_handoff" \
    --argjson privacy_tags "$privacy_tags_json" \
    --argjson hook_meta "$hook_meta_json" \
    --argjson base_tags "$handoff_tags_json" \
    '{event:{platform:$platform,project:$project,session_id:$session_id,event_type:"checkpoint",correlation_id:$correlation_id,payload:{title:"continuity_handoff",content:$content,source:"user_prompt_hook",meta:$hook_meta},tags:($base_tags + ["continuity_handoff","pinned_continuity"] | unique),privacy_tags:$privacy_tags}}' 2>/dev/null)"

  if [ -n "$event_payload" ]; then
    printf '%s' "$event_payload" | "$CLIENT_SCRIPT" record-event >/dev/null 2>&1 || true
  fi
}

hook_init_continuity_state() {
  SHARED_STATE_DIR="${PROJECT_ROOT}/.harness-mem/state"
  CONTINUITY_STATE_FILE="${SHARED_STATE_DIR}/continuity.json"
  mkdir -p "$SHARED_STATE_DIR" 2>/dev/null || true
}

hook_default_continuity_state() {
  if ! command -v jq >/dev/null 2>&1; then
    printf '{}'
    return
  fi
  jq -nc --arg project "${PROJECT_NAME:-}" '{version:1,project:$project,sessions:{},latest_handoff:null}'
}

hook_read_continuity_state() {
  if [ ! -f "${CONTINUITY_STATE_FILE:-}" ] || ! command -v jq >/dev/null 2>&1; then
    hook_default_continuity_state
    return
  fi

  if jq -e '.' "$CONTINUITY_STATE_FILE" >/dev/null 2>&1; then
    cat "$CONTINUITY_STATE_FILE"
  else
    hook_default_continuity_state
  fi
}

hook_write_continuity_state() {
  local state_json="${1:-}"
  [ -n "$state_json" ] || return 0
  [ -n "${CONTINUITY_STATE_FILE:-}" ] || return 0
  mkdir -p "$(dirname "$CONTINUITY_STATE_FILE")" 2>/dev/null || true
  printf '%s\n' "$state_json" > "$CONTINUITY_STATE_FILE"
}

hook_generate_correlation_id() {
  if command -v uuidgen >/dev/null 2>&1; then
    printf 'corr-%s' "$(uuidgen | tr 'A-Z' 'a-z')"
    return
  fi
  printf 'corr-%s-%s' "$(date +%s)" "${RANDOM:-0}"
}

hook_extract_correlation_id_from_json() {
  local input_json="${1:-}"
  [ -n "$input_json" ] || return 0
  command -v jq >/dev/null 2>&1 || return 0
  printf '%s' "$input_json" | jq -r '.correlation_id // .meta.correlation_id // empty' 2>/dev/null
}

hook_lookup_session_correlation_id() {
  local session_id="${1:-}"
  [ -n "$session_id" ] || return 0
  command -v jq >/dev/null 2>&1 || return 0
  [ -f "${CONTINUITY_STATE_FILE:-}" ] || return 0
  jq -r --arg sid "$session_id" '.sessions[$sid].correlation_id // empty' "$CONTINUITY_STATE_FILE" 2>/dev/null
}

hook_upsert_continuity_session() {
  local session_id="${1:-}"
  local platform="${2:-}"
  local correlation_id="${3:-}"
  local origin="${4:-unknown}"
  [ -n "$session_id" ] || return 0
  [ -n "$correlation_id" ] || return 0
  command -v jq >/dev/null 2>&1 || return 0

  local current_ts
  current_ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  local state_json
  state_json="$(hook_read_continuity_state)"
  state_json="$(
    printf '%s' "$state_json" | jq -c \
      --arg project "${PROJECT_NAME:-}" \
      --arg sid "$session_id" \
      --arg platform "$platform" \
      --arg correlation_id "$correlation_id" \
      --arg origin "$origin" \
      --arg updated_at "$current_ts" \
      '
        .version = 1
        | .project = $project
        | .sessions = (.sessions // {})
        | .sessions[$sid] = ((.sessions[$sid] // {}) + {
            correlation_id: $correlation_id,
            platform: $platform,
            origin: $origin,
            updated_at: $updated_at
          })
      ' 2>/dev/null
  )"

  [ -n "$state_json" ] && hook_write_continuity_state "$state_json"
}

hook_mark_continuity_handoff() {
  local session_id="${1:-}"
  local platform="${2:-}"
  local correlation_id="${3:-}"
  local summary_mode="${4:-standard}"
  local finalized_at="${5:-}"
  [ -n "$session_id" ] || return 0
  [ -n "$correlation_id" ] || return 0
  command -v jq >/dev/null 2>&1 || return 0

  local handoff_ts="${finalized_at:-$(date -u +"%Y-%m-%dT%H:%M:%SZ")}"
  local state_json
  state_json="$(hook_read_continuity_state)"
  state_json="$(
    printf '%s' "$state_json" | jq -c \
      --arg project "${PROJECT_NAME:-}" \
      --arg sid "$session_id" \
      --arg platform "$platform" \
      --arg correlation_id "$correlation_id" \
      --arg summary_mode "$summary_mode" \
      --arg finalized_at "$handoff_ts" \
      '
        .version = 1
        | .project = $project
        | .sessions = (.sessions // {})
        | .sessions[$sid] = ((.sessions[$sid] // {}) + {
            correlation_id: $correlation_id,
            platform: $platform,
            updated_at: $finalized_at
          })
        | .latest_handoff = {
            session_id: $sid,
            platform: $platform,
            correlation_id: $correlation_id,
            summary_mode: $summary_mode,
            finalized_at: $finalized_at,
            consumed_by_session_id: null
          }
      ' 2>/dev/null
  )"

  [ -n "$state_json" ] && hook_write_continuity_state "$state_json"
}

hook_resolve_correlation_id() {
  local session_id="${1:-}"
  local platform="${2:-}"
  local input_json="${3:-}"

  CORRELATION_ID=""
  CORRELATION_ID_SOURCE=""

  local input_correlation_id=""
  input_correlation_id="$(hook_extract_correlation_id_from_json "$input_json")"
  if [ -n "$input_correlation_id" ]; then
    CORRELATION_ID="$input_correlation_id"
    CORRELATION_ID_SOURCE="input"
  fi

  if [ -z "$CORRELATION_ID" ]; then
    local existing_correlation_id=""
    existing_correlation_id="$(hook_lookup_session_correlation_id "$session_id")"
    if [ -n "$existing_correlation_id" ]; then
      CORRELATION_ID="$existing_correlation_id"
      CORRELATION_ID_SOURCE="session_state"
    fi
  fi

  if [ -z "$CORRELATION_ID" ] && command -v jq >/dev/null 2>&1; then
    local state_json
    state_json="$(hook_read_continuity_state)"
    local latest_handoff_corr=""
    latest_handoff_corr="$(
      printf '%s' "$state_json" | jq -r --arg sid "$session_id" '
        .latest_handoff
        | if . == null then empty
          elif (.consumed_by_session_id // "") == "" or (.consumed_by_session_id // "") == $sid then
            .correlation_id // empty
          else
            empty
          end
      ' 2>/dev/null
    )"
    if [ -n "$latest_handoff_corr" ]; then
      CORRELATION_ID="$latest_handoff_corr"
      CORRELATION_ID_SOURCE="latest_handoff"
      state_json="$(
        printf '%s' "$state_json" | jq -c --arg sid "$session_id" '
          if .latest_handoff == null then .
          else .latest_handoff.consumed_by_session_id = $sid
          end
        ' 2>/dev/null
      )"
      [ -n "$state_json" ] && hook_write_continuity_state "$state_json"
    fi
  fi

  if [ -z "$CORRELATION_ID" ]; then
    CORRELATION_ID="$(hook_generate_correlation_id)"
    CORRELATION_ID_SOURCE="generated"
  fi

  hook_upsert_continuity_session "$session_id" "$platform" "$CORRELATION_ID" "$CORRELATION_ID_SOURCE"
}

hook_render_resume_pack_markdown() {
  local resume_response="${1:-}"
  [ -n "$resume_response" ] || return 0
  command -v jq >/dev/null 2>&1 || return 0

  local continuity_briefing=""
  local recent_project_context=""
  continuity_briefing="$(printf '%s' "$resume_response" | jq -r '.meta.continuity_briefing.content // empty' 2>/dev/null)"
  recent_project_context="$(printf '%s' "$resume_response" | jq -r '.meta.recent_project_context.content // empty' 2>/dev/null)"
  if [ -n "$continuity_briefing" ]; then
    if [ -n "$recent_project_context" ] && [ "$recent_project_context" != "$continuity_briefing" ]; then
      printf '%s\n\n%s\n' "$continuity_briefing" "$recent_project_context"
    else
      printf '%s\n' "$continuity_briefing"
    fi
    return 0
  fi
  if [ -n "$recent_project_context" ]; then
    printf '%s\n' "$recent_project_context"
    return 0
  fi

  local item_count=""
  item_count="$(printf '%s' "$resume_response" | jq -r '.meta.count // 0' 2>/dev/null)"
  if [ -z "$item_count" ] || [ "$item_count" = "0" ]; then
    return 0
  fi

  {
    echo "## Memory Resume Pack"
    echo ""
    echo "直近セッションから再利用可能な文脈です。"
    echo ""
    printf '%s' "$resume_response" | jq -r '
      .items[] |
      if .type == "session_summary" then
        "- [summary] " + (.summary // "") | .[0:260]
      else
        "- [" + (.id // "") + "] " + ((.title // "untitled") + " :: " + ((.content // "") | gsub("\\n"; " ") | .[0:140]))
      end
    ' 2>/dev/null
  }
}

hook_emit_claude_additional_context() {
  local hook_event_name="${1:-UserPromptSubmit}"
  local additional_context="${2:-}"

  if command -v jq >/dev/null 2>&1; then
    if [ -n "$additional_context" ]; then
      jq -nc \
        --arg hook_event_name "$hook_event_name" \
        --arg additional_context "$additional_context" \
        '{
          hookSpecificOutput: {
            hookEventName: $hook_event_name,
            additionalContext: $additional_context
          }
        }'
    else
      jq -nc --arg hook_event_name "$hook_event_name" '{hookSpecificOutput:{hookEventName:$hook_event_name}}'
    fi
    return 0
  fi

  [ -n "$additional_context" ] && printf '%s\n' "$additional_context"
}

hook_init_whisper_state() {
  WHISPER_STATE_DIR="${PROJECT_ROOT}/.harness-mem/state"
  WHISPER_STATE_FILE="${WHISPER_STATE_DIR}/whisper-budget.json"
  WHISPER_LOCK_DIR="${WHISPER_STATE_FILE}.lock"
  mkdir -p "$WHISPER_STATE_DIR" 2>/dev/null || true
}

hook_acquire_whisper_lock() {
  hook_init_whisper_state

  local depth="${WHISPER_LOCK_DEPTH:-0}"
  depth="$(hook_clamp_integer "$depth" "0" "0" "99")"
  if [ "$depth" -gt 0 ]; then
    WHISPER_LOCK_DEPTH=$((depth + 1))
    return 0
  fi

  local attempts=50
  local attempt=0
  local owner_pid=""
  while [ "$attempt" -lt "$attempts" ]; do
    if mkdir "$WHISPER_LOCK_DIR" 2>/dev/null; then
      printf '%s\n' "$$" > "${WHISPER_LOCK_DIR}/pid" 2>/dev/null || true
      WHISPER_LOCK_DEPTH=1
      return 0
    fi

    owner_pid="$(cat "${WHISPER_LOCK_DIR}/pid" 2>/dev/null | tr -dc '0-9')"
    if [ -n "$owner_pid" ] && ! kill -0 "$owner_pid" 2>/dev/null; then
      rm -rf "$WHISPER_LOCK_DIR" 2>/dev/null || true
      continue
    fi

    sleep 0.1
    attempt=$((attempt + 1))
  done

  return 1
}

hook_release_whisper_lock() {
  local depth="${WHISPER_LOCK_DEPTH:-0}"
  depth="$(hook_clamp_integer "$depth" "0" "0" "99")"

  if [ "$depth" -gt 1 ]; then
    WHISPER_LOCK_DEPTH=$((depth - 1))
    return 0
  fi

  if [ "$depth" -eq 1 ]; then
    rm -rf "${WHISPER_LOCK_DIR:-${WHISPER_STATE_FILE}.lock}" 2>/dev/null || true
  fi

  WHISPER_LOCK_DEPTH=0
}

hook_default_whisper_state() {
  if ! command -v jq >/dev/null 2>&1; then
    printf '{}'
    return
  fi

  jq -nc --arg project "${PROJECT_NAME:-}" '{version:1,project:$project,sessions:{}}'
}

hook_read_whisper_state() {
  if [ ! -f "${WHISPER_STATE_FILE:-}" ] || ! command -v jq >/dev/null 2>&1; then
    hook_default_whisper_state
    return
  fi

  if jq -e '.' "$WHISPER_STATE_FILE" >/dev/null 2>&1; then
    cat "$WHISPER_STATE_FILE"
  else
    hook_default_whisper_state
  fi
}

hook_write_whisper_state() {
  local state_json="${1:-}"
  [ -n "$state_json" ] || return 0
  [ -n "${WHISPER_STATE_FILE:-}" ] || return 0
  mkdir -p "$(dirname "$WHISPER_STATE_FILE")" 2>/dev/null || true
  local tmp="${WHISPER_STATE_FILE}.tmp.$$"
  printf '%s\n' "$state_json" > "$tmp" && mv "$tmp" "$WHISPER_STATE_FILE"
}

hook_clamp_integer() {
  local raw="${1:-}"
  local fallback="${2:-0}"
  local minimum="${3:-0}"
  local maximum="${4:-999999}"
  local value

  case "$raw" in
    ''|*[!0-9]*) value="$fallback" ;;
    *) value="$raw" ;;
  esac

  if [ "$value" -lt "$minimum" ]; then
    value="$minimum"
  fi
  if [ "$value" -gt "$maximum" ]; then
    value="$maximum"
  fi
  printf '%s' "$value"
}

hook_read_recall_mode() {
  local config_path="${HARNESS_MEM_HOME:-$HOME/.harness-mem}/config.json"
  local mode="quiet"

  if [ -f "$config_path" ] && command -v jq >/dev/null 2>&1; then
    mode="$(jq -r '.recall.mode // "quiet"' "$config_path" 2>/dev/null || printf 'quiet')"
  fi

  case "$mode" in
    on|quiet|off) printf '%s' "$mode" ;;
    *) printf 'quiet' ;;
  esac
}

hook_read_whisper_max_tokens() {
  hook_clamp_integer "${HARNESS_MEM_WHISPER_MAX_TOKENS:-400}" "400" "80" "2000"
}

hook_read_whisper_query_max_chars() {
  hook_clamp_integer "${HARNESS_MEM_WHISPER_QUERY_MAX_CHARS:-120}" "120" "32" "400"
}

hook_read_whisper_timeout_sec() {
  hook_clamp_integer "${HARNESS_MEM_WHISPER_TIMEOUT_SEC:-10}" "10" "2" "30"
}

hook_estimate_tokens() {
  local text="${1:-}"
  [ -n "$text" ] || {
    printf '0'
    return
  }

  local chars
  chars="$(printf '%s' "$text" | wc -m | tr -d '[:space:]')"
  chars="$(hook_clamp_integer "$chars" "0" "0" "999999")"
  if [ "$chars" -eq 0 ]; then
    printf '0'
    return
  fi
  printf '%s' $(( (chars + 3) / 4 ))
}

hook_upsert_whisper_session_defaults() {
  local session_id="${1:-}"
  [ -n "$session_id" ] || return 0
  command -v jq >/dev/null 2>&1 || return 0
  local lock_depth_before="${WHISPER_LOCK_DEPTH:-0}"
  if [ "$lock_depth_before" -eq 0 ] && ! hook_acquire_whisper_lock; then
    return 0
  fi

  local state_json
  state_json="$(hook_read_whisper_state)"
  state_json="$(
    printf '%s' "$state_json" | jq -c \
      --arg project "${PROJECT_NAME:-}" \
      --arg sid "$session_id" \
      '
        .version = 1
        | .project = $project
        | .sessions = (.sessions // {})
        | .sessions[$sid] = ((.sessions[$sid] // {}) + {
            seen_ids: ((.sessions[$sid].seen_ids // []) | if type == "array" then . else [] end),
            accumulated_tokens: (.sessions[$sid].accumulated_tokens // 0),
            prompt_count_since_last_inject: (.sessions[$sid].prompt_count_since_last_inject // 99),
            inject_count: (.sessions[$sid].inject_count // 0),
            pending_resume_skip: (.sessions[$sid].pending_resume_skip // false),
            updated_at: (.sessions[$sid].updated_at // null)
          })
      ' 2>/dev/null
  )"
  [ -n "$state_json" ] && hook_write_whisper_state "$state_json"
  if [ "$lock_depth_before" -eq 0 ]; then
    hook_release_whisper_lock
  fi
}

hook_mark_whisper_prompt() {
  local session_id="${1:-}"
  [ -n "$session_id" ] || return 0
  command -v jq >/dev/null 2>&1 || return 0
  local lock_depth_before="${WHISPER_LOCK_DEPTH:-0}"
  if [ "$lock_depth_before" -eq 0 ] && ! hook_acquire_whisper_lock; then
    return 0
  fi
  hook_upsert_whisper_session_defaults "$session_id"

  local current_ts state_json
  current_ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  state_json="$(hook_read_whisper_state)"
  state_json="$(
    printf '%s' "$state_json" | jq -c \
      --arg sid "$session_id" \
      --arg updated_at "$current_ts" \
      '
        .sessions[$sid].prompt_count_since_last_inject = ((.sessions[$sid].prompt_count_since_last_inject // 0) + 1)
        | .sessions[$sid].updated_at = $updated_at
      ' 2>/dev/null
  )"
  [ -n "$state_json" ] && hook_write_whisper_state "$state_json"
  if [ "$lock_depth_before" -eq 0 ]; then
    hook_release_whisper_lock
  fi
}

hook_mark_whisper_resume_skip() {
  local session_id="${1:-}"
  [ -n "$session_id" ] || return 0
  command -v jq >/dev/null 2>&1 || return 0
  local lock_depth_before="${WHISPER_LOCK_DEPTH:-0}"
  if [ "$lock_depth_before" -eq 0 ] && ! hook_acquire_whisper_lock; then
    return 0
  fi
  hook_upsert_whisper_session_defaults "$session_id"

  local state_json
  state_json="$(hook_read_whisper_state)"
  state_json="$(
    printf '%s' "$state_json" | jq -c --arg sid "$session_id" '
      .sessions[$sid].pending_resume_skip = true
    ' 2>/dev/null
  )"
  [ -n "$state_json" ] && hook_write_whisper_state "$state_json"
  if [ "$lock_depth_before" -eq 0 ]; then
    hook_release_whisper_lock
  fi
}

hook_consume_whisper_resume_skip() {
  local session_id="${1:-}"
  [ -n "$session_id" ] || return 1
  command -v jq >/dev/null 2>&1 || return 1
  local lock_depth_before="${WHISPER_LOCK_DEPTH:-0}"
  if [ "$lock_depth_before" -eq 0 ] && ! hook_acquire_whisper_lock; then
    return 1
  fi
  if [ ! -f "${WHISPER_STATE_FILE:-}" ]; then
    if [ "$lock_depth_before" -eq 0 ]; then
      hook_release_whisper_lock
    fi
    return 1
  fi

  if ! jq -e --arg sid "$session_id" '.sessions[$sid].pending_resume_skip == true' "$WHISPER_STATE_FILE" >/dev/null 2>&1; then
    if [ "$lock_depth_before" -eq 0 ]; then
      hook_release_whisper_lock
    fi
    return 1
  fi

  local state_json
  state_json="$(hook_read_whisper_state)"
  state_json="$(
    printf '%s' "$state_json" | jq -c --arg sid "$session_id" '
      .sessions[$sid].pending_resume_skip = false
    ' 2>/dev/null
  )"
  [ -n "$state_json" ] && hook_write_whisper_state "$state_json"
  if [ "$lock_depth_before" -eq 0 ]; then
    hook_release_whisper_lock
  fi
  return 0
}

hook_record_whisper_injection() {
  local session_id="${1:-}"
  local ids_json="${2:-[]}"
  local tokens="${3:-0}"
  [ -n "$session_id" ] || return 0
  command -v jq >/dev/null 2>&1 || return 0
  local lock_depth_before="${WHISPER_LOCK_DEPTH:-0}"
  if [ "$lock_depth_before" -eq 0 ] && ! hook_acquire_whisper_lock; then
    return 0
  fi
  hook_upsert_whisper_session_defaults "$session_id"

  local current_ts state_json
  current_ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  state_json="$(hook_read_whisper_state)"
  state_json="$(
    printf '%s' "$state_json" | jq -c \
      --arg sid "$session_id" \
      --arg updated_at "$current_ts" \
      --argjson ids "$ids_json" \
      --argjson tokens "$tokens" \
      '
        .sessions[$sid].seen_ids = (((.sessions[$sid].seen_ids // []) + $ids) | unique)
        | .sessions[$sid].accumulated_tokens = ((.sessions[$sid].accumulated_tokens // 0) + $tokens)
        | .sessions[$sid].inject_count = ((.sessions[$sid].inject_count // 0) + 1)
        | .sessions[$sid].prompt_count_since_last_inject = 0
        | .sessions[$sid].updated_at = $updated_at
      ' 2>/dev/null
  )"
  [ -n "$state_json" ] && hook_write_whisper_state "$state_json"
  if [ "$lock_depth_before" -eq 0 ]; then
    hook_release_whisper_lock
  fi
}

hook_whisper_prompt_has_trigger() {
  local prompt_text="${1:-}"
  [ -n "$prompt_text" ] || return 1

  printf '%s\n' "$prompt_text" | grep -Eiq \
    '([A-Za-z0-9_/.-]+\.(ts|tsx|js|jsx|py|rb|go|rs|java|kt|swift|json|md|yaml|yml|toml|sh|sql))|([A-Za-z0-9_/.-]+/[A-Za-z0-9_/.-]+)|(\berror\b|\bfailed\b|\bfailure\b|\bexception\b|\btrace\b|\bbug\b|エラー|失敗|例外|不具合|スタックトレース)|(\bdecid(e|ed|ing)\b|\bchoose\b|\boption\b|\btrade-?off\b|\bnext step\b|\baction item\b|決定|方針|選択|判断|次アクション)'
}

hook_render_contextual_recall_lines() {
  local selected_json="${1:-[]}"
  [ -n "$selected_json" ] || return 0
  command -v jq >/dev/null 2>&1 || return 0

  local body
  body="$(printf '%s' "$selected_json" | jq -r '
    .[]
    | "- "
      + (
          [
            (.title // empty),
            ((.content // "") | gsub("\\n"; " ") | .[0:72])
          ]
          | map(select(length > 0))
          | join(" — ")
        )
  ' 2>/dev/null)"
  [ -n "$body" ] || return 0

  printf '## Contextual Recall\n%s\n' "$body"
}

hook_run_contextual_recall() {
  (
    local platform="${1:-}"
    local session_id="${2:-}"
    local prompt_text="${3:-}"
    local mode="${4:-}"
    [ -n "$session_id" ] || {
      printf '%s' '{"ok":false,"reason":"missing_session"}'
      exit 0
    }

    command -v jq >/dev/null 2>&1 || {
      printf '%s' '{"ok":false,"reason":"jq_unavailable"}'
      exit 0
    }

    hook_init_whisper_state
    if ! hook_acquire_whisper_lock; then
      printf '%s' '{"ok":true,"injected":false,"reason":"lock_unavailable"}'
      exit 0
    fi
    trap 'hook_release_whisper_lock' EXIT

    hook_upsert_whisper_session_defaults "$session_id"
    hook_mark_whisper_prompt "$session_id"

    mode="${mode:-$(hook_read_recall_mode)}"
    case "$mode" in
      off)
        printf '%s' '{"ok":true,"injected":false,"reason":"mode_off"}'
        exit 0
        ;;
      on|quiet)
        ;;
      *)
        mode="quiet"
        ;;
    esac

    if ! hook_whisper_prompt_has_trigger "$prompt_text"; then
      printf '%s' '{"ok":true,"injected":false,"reason":"no_trigger"}'
      exit 0
    fi

    if hook_consume_whisper_resume_skip "$session_id"; then
      printf '%s' '{"ok":true,"injected":false,"reason":"resume_skip"}'
      exit 0
    fi

    local state_json session_state inject_count cooldown_count
    state_json="$(hook_read_whisper_state)"
    session_state="$(printf '%s' "$state_json" | jq -c --arg sid "$session_id" '.sessions[$sid] // {}' 2>/dev/null)"
    inject_count="$(printf '%s' "$session_state" | jq -r '.inject_count // 0' 2>/dev/null)"
    cooldown_count="$(printf '%s' "$session_state" | jq -r '.prompt_count_since_last_inject // 99' 2>/dev/null)"
    inject_count="$(hook_clamp_integer "$inject_count" "0" "0" "99")"
    cooldown_count="$(hook_clamp_integer "$cooldown_count" "99" "0" "999")"
    if [ "$inject_count" -ge 5 ]; then
      printf '%s' '{"ok":true,"injected":false,"reason":"session_limit"}'
      exit 0
    fi
    if [ "$inject_count" -gt 0 ] && [ "$cooldown_count" -lt 3 ]; then
      printf '%s' '{"ok":true,"injected":false,"reason":"cooldown"}'
      exit 0
    fi

    local query_max_chars query timeout_sec payload response
    query_max_chars="$(hook_read_whisper_query_max_chars)"
    timeout_sec="$(hook_read_whisper_timeout_sec)"
    query="$(
      printf '%s' "$prompt_text" \
        | tr '\n' ' ' \
        | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//' \
        | cut -c1-"$query_max_chars"
    )"
    [ -n "$query" ] || {
      printf '%s' '{"ok":true,"injected":false,"reason":"empty_query"}'
      exit 0
    }

    payload="$(jq -nc \
      --arg project "$PROJECT_NAME" \
      --arg query "$query" \
      '{project:$project,query:$query,limit:3,include_private:false,strict_project:true}' 2>/dev/null)"
    [ -n "$payload" ] || {
      printf '%s' '{"ok":false,"reason":"payload_build_failed"}'
      exit 0
    }

    response="$(HARNESS_MEM_CLIENT_TIMEOUT_SEC="$timeout_sec" printf '%s' "$payload" | "$CLIENT_SCRIPT" search 2>/dev/null || true)"
    if [ -z "$response" ] || ! printf '%s' "$response" | jq -e '.ok != false' >/dev/null 2>&1; then
      printf '%s' '{"ok":true,"injected":false,"reason":"search_unavailable"}'
      exit 0
    fi

    local rerank_enabled threshold selected_json seen_ids_json
    rerank_enabled="$(printf '%s' "$response" | jq -r '
      [
        .items[]?
        | (((.scores.rerank // .scores.final // 0) - (.scores.final // 0)) | if . < 0 then -. else . end)
      ]
      | any(. > 0.000001)
    ' 2>/dev/null)"
    case "$rerank_enabled" in
      true|false) ;;
      *) rerank_enabled="false" ;;
    esac

    seen_ids_json="$(printf '%s' "$session_state" | jq -c '.seen_ids // []' 2>/dev/null)"
    [ -n "$seen_ids_json" ] || seen_ids_json='[]'

    if [ "$rerank_enabled" = "true" ]; then
      if [ "$mode" = "quiet" ]; then
        threshold="0.8"
      else
        threshold="0.6"
      fi
      selected_json="$(
        printf '%s' "$response" | jq -c \
          --argjson threshold "$threshold" \
          --argjson seen_ids "$seen_ids_json" \
          '
            [(.items // [])[]
             | select(((.scores.rerank // .scores.final // 0) >= $threshold))
             | .id as $item_id
             | select(($seen_ids | index($item_id) | not))
            ][:3]
          ' 2>/dev/null
      )"
    else
      local fallback_limit
      if [ "$mode" = "quiet" ]; then
        fallback_limit=1
      else
        fallback_limit=3
      fi
      selected_json="$(
        printf '%s' "$response" | jq -c \
          --argjson limit "$fallback_limit" \
          --argjson seen_ids "$seen_ids_json" \
          '
            [(.items // [])[]
             | .id as $item_id
             | select(($seen_ids | index($item_id) | not))
            ][:$limit]
          ' 2>/dev/null
      )"
    fi

    [ -n "$selected_json" ] || selected_json='[]'
    if [ "$(printf '%s' "$selected_json" | jq 'length' 2>/dev/null)" -eq 0 ]; then
      printf '%s' '{"ok":true,"injected":false,"reason":"no_match"}'
      exit 0
    fi

    local rendered tokens accumulated tokens_limit ids_json
    rendered="$(hook_render_contextual_recall_lines "$selected_json")"
    [ -n "$rendered" ] || {
      printf '%s' '{"ok":true,"injected":false,"reason":"render_empty"}'
      exit 0
    }

    tokens="$(hook_estimate_tokens "$rendered")"
    tokens_limit="$(hook_read_whisper_max_tokens)"
    accumulated="$(printf '%s' "$session_state" | jq -r '.accumulated_tokens // 0' 2>/dev/null)"
    accumulated="$(hook_clamp_integer "$accumulated" "0" "0" "99999")"
    if [ "$tokens" -gt "$tokens_limit" ]; then
      printf '%s' '{"ok":true,"injected":false,"reason":"prompt_budget"}'
      exit 0
    fi
    if [ $((accumulated + tokens)) -gt 2000 ]; then
      printf '%s' '{"ok":true,"injected":false,"reason":"session_budget"}'
      exit 0
    fi

    ids_json="$(printf '%s' "$selected_json" | jq -c '[.[].id]' 2>/dev/null)"
    [ -n "$ids_json" ] || ids_json='[]'
    hook_record_whisper_injection "$session_id" "$ids_json" "$tokens"

    jq -nc \
      --arg content "$rendered" \
      --argjson selected_ids "$ids_json" \
      --argjson tokens "$tokens" \
      --arg mode "$mode" \
      --arg rerank_enabled "$rerank_enabled" \
      '{
        ok: true,
        injected: true,
        mode: $mode,
        rerank_enabled: ($rerank_enabled == "true"),
        content: $content,
        selected_ids: $selected_ids,
        tokens: $tokens
      }'
  )
}

hook_emit_codex_additional_context() {
  local hook_event_name="${1:-}"
  local additional_context="${2:-}"
  [ -n "$hook_event_name" ] || return 0
  [ -n "$additional_context" ] || return 0

  if command -v jq >/dev/null 2>&1; then
    jq -nc \
      --arg hook_event_name "$hook_event_name" \
      --arg additional_context "$additional_context" \
      '{
        continue: true,
        hookSpecificOutput: {
          hookEventName: $hook_event_name,
          additionalContext: $additional_context
        }
      }'
    return 0
  fi

  printf '%s\n' "$additional_context"
}
