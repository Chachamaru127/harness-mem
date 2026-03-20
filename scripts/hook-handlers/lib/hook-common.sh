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
  SCRIPT_DIR="$(cd "$(dirname "$caller_source")" && pwd)"
  PARENT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
  CLIENT_SCRIPT="${PARENT_DIR}/harness-mem-client.sh"
  PROJECT_CONTEXT_LIB="${SCRIPT_DIR}/lib/project-context.sh"

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
    DAEMON_SCRIPT="${PARENT_DIR}/harness-memd"
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
