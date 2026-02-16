#!/bin/bash
# project-context.sh
# Shared project resolution helpers for hook handlers.

expand_home_path() {
  local input="$1"
  if [[ "$input" == "~/"* ]]; then
    printf '%s\n' "${HOME}/${input#~/}"
    return
  fi
  if [[ "$input" == "~" ]]; then
    printf '%s\n' "$HOME"
    return
  fi
  printf '%s\n' "$input"
}

to_abs_dir() {
  local input="$1"
  [ -n "$input" ] || return 1
  if [ -d "$input" ]; then
    (cd "$input" 2>/dev/null && pwd) || return 1
    return 0
  fi
  return 1
}

project_root_from_path() {
  local raw="$1"
  [ -n "$raw" ] || return 1

  local candidate
  candidate="$(expand_home_path "$raw")"

  if [ -f "$candidate" ]; then
    candidate="$(dirname "$candidate")"
  fi

  if [ ! -d "$candidate" ]; then
    candidate="$(dirname "$candidate")"
  fi

  if [ ! -d "$candidate" ]; then
    return 1
  fi

  local abs_candidate git_root
  abs_candidate="$(to_abs_dir "$candidate" 2>/dev/null)" || return 1
  git_root="$(git -C "$abs_candidate" rev-parse --show-toplevel 2>/dev/null || true)"
  if [ -n "$git_root" ] && [ -d "$git_root" ]; then
    printf '%s\n' "$git_root"
    return 0
  fi

  printf '%s\n' "$abs_candidate"
  return 0
}

extract_context_path_from_json() {
  local input_json="$1"
  [ -n "$input_json" ] || return 0
  command -v jq >/dev/null 2>&1 || return 0

  printf '%s' "$input_json" | jq -r '
    [
      .cwd,
      .workdir,
      .workspace,
      .workspace_path,
      .project_root,
      .project_path,
      .meta.cwd,
      .meta.workdir,
      .meta.workspace,
      .tool_input.cwd,
      .tool_input.workdir
    ]
    | map(select(type == "string" and length > 0))
    | .[0] // empty
  ' 2>/dev/null
}

extract_thread_id_from_json() {
  local input_json="$1"
  [ -n "$input_json" ] || return 0
  command -v jq >/dev/null 2>&1 || return 0
  printf '%s' "$input_json" | jq -r '.thread_id // .session_id // empty' 2>/dev/null
}

lookup_codex_session_cwd() {
  local thread_id="$1"
  [ -n "$thread_id" ] || return 0
  [ -d "$HOME/.codex/sessions" ] || return 0
  command -v jq >/dev/null 2>&1 || return 0
  command -v rg >/dev/null 2>&1 || return 0

  rg -N --no-filename "\"${thread_id}\"" "$HOME/.codex/sessions" -g 'rollout-*.jsonl' 2>/dev/null \
    | jq -r --arg sid "$thread_id" 'select(.type == "session_meta" and (.payload.id // "") == $sid) | .payload.cwd // empty' 2>/dev/null \
    | head -n 1
}

lookup_claude_session_cwd() {
  local session_id="$1"
  [ -n "$session_id" ] || return 0
  command -v jq >/dev/null 2>&1 || return 0

  local projects_dir history_file session_file
  projects_dir="$HOME/.claude/projects"
  history_file="$HOME/.claude/history.jsonl"

  if [ -d "$projects_dir" ] && command -v find >/dev/null 2>&1; then
    session_file="$(find "$projects_dir" -maxdepth 2 -type f -name "${session_id}.jsonl" -print -quit 2>/dev/null)"
    if [ -n "$session_file" ] && [ -f "$session_file" ]; then
      jq -r --arg sid "$session_id" 'select((.sessionId // "") == $sid) | .cwd // empty' "$session_file" 2>/dev/null \
        | head -n 1
      return 0
    fi
  fi

  if [ -f "$history_file" ] && command -v rg >/dev/null 2>&1; then
    rg -N --no-filename "\"sessionId\":\"${session_id}\"" "$history_file" 2>/dev/null \
      | jq -r --arg sid "$session_id" 'select((.sessionId // "") == $sid) | .project // empty' 2>/dev/null \
      | head -n 1
  fi
}

extract_env_context_path() {
  local candidate
  for candidate in \
    "${HARNESS_MEM_PROJECT_ROOT:-}" \
    "${HARNESS_MEM_CODEX_PROJECT_ROOT:-}" \
    "${CLAUDE_MEM_PROJECT_CWD:-}" \
    "${WORKSPACE_FOLDER:-}" \
    "${WORKSPACE_ROOT:-}"
  do
    if [ -n "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 0
}

resolve_project_context() {
  local input_json="${1:-}"
  local default_root default_name
  default_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  default_name="$(basename "$default_root")"

  local path_candidate
  path_candidate="$(extract_context_path_from_json "$input_json")"

  if [ -z "$path_candidate" ]; then
    local thread_id
    thread_id="$(extract_thread_id_from_json "$input_json")"
    if [ -n "$thread_id" ]; then
      path_candidate="$(lookup_codex_session_cwd "$thread_id")"
    fi
    if [ -z "$path_candidate" ] && [ -n "$thread_id" ]; then
      path_candidate="$(lookup_claude_session_cwd "$thread_id")"
    fi
  fi

  if [ -z "$path_candidate" ]; then
    path_candidate="$(extract_env_context_path)"
  fi

  local resolved_root
  resolved_root="$(project_root_from_path "$path_candidate" 2>/dev/null || true)"
  if [ -z "$resolved_root" ]; then
    resolved_root="$default_root"
  fi

  local resolved_name
  resolved_name="$(basename "$resolved_root")"
  if [ -z "$resolved_name" ]; then
    resolved_name="$default_name"
  fi

  printf '%s\n%s\n' "$resolved_root" "$resolved_name"
}
