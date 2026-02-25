#!/bin/bash
# harness-mem-client.sh
# Thin HTTP client for harness-memd API

set -euo pipefail

SCRIPT_SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SCRIPT_SOURCE" ]; do
  SCRIPT_SOURCE_DIR="$(cd -P "$(dirname "$SCRIPT_SOURCE")" && pwd)"
  SCRIPT_TARGET="$(readlink "$SCRIPT_SOURCE")"
  if [[ "$SCRIPT_TARGET" != /* ]]; then
    SCRIPT_SOURCE="${SCRIPT_SOURCE_DIR}/${SCRIPT_TARGET}"
  else
    SCRIPT_SOURCE="$SCRIPT_TARGET"
  fi
done
SCRIPT_DIR="$(cd -P "$(dirname "$SCRIPT_SOURCE")" && pwd)"
DAEMON_SCRIPT="${SCRIPT_DIR}/harness-memd"
HOST="${HARNESS_MEM_HOST:-127.0.0.1}"
PORT="${HARNESS_MEM_PORT:-37888}"
BASE_URL="http://${HOST}:${PORT}"
REQUEST_TIMEOUT="${HARNESS_MEM_CLIENT_TIMEOUT_SEC:-8}"
QUIET="${HARNESS_MEM_CLIENT_QUIET:-1}"
ADMIN_TOKEN="${HARNESS_MEM_ADMIN_TOKEN:-}"

log() {
  if [ "$QUIET" = "1" ]; then
    return
  fi
  echo "$@" >&2
}

read_payload() {
  local payload="${1:-}"
  if [ -n "$payload" ]; then
    printf '%s' "$payload"
    return
  fi

  if [ ! -t 0 ]; then
    cat
    return
  fi

  printf '{}'
}

ensure_daemon() {
  "$DAEMON_SCRIPT" start --quiet >/dev/null 2>&1 || true
}

call_get() {
  local path="$1"
  local -a args=(--silent --show-error --max-time "$REQUEST_TIMEOUT" --fail)
  if [ -n "$ADMIN_TOKEN" ]; then
    args+=(-H "x-harness-mem-token: ${ADMIN_TOKEN}")
  fi
  curl "${args[@]}" "${BASE_URL}${path}"
}

call_post() {
  local path="$1"
  local payload="$2"
  local -a args=(--silent --show-error --max-time "$REQUEST_TIMEOUT" --fail -H 'content-type: application/json' -X POST -d "$payload")
  if [ -n "$ADMIN_TOKEN" ]; then
    args+=(-H "x-harness-mem-token: ${ADMIN_TOKEN}")
  fi
  curl "${args[@]}" "${BASE_URL}${path}"
}

payload_to_query() {
  local raw="${1:-}"
  if [ -z "$raw" ] || [ "$raw" = "{}" ]; then
    printf ''
    return
  fi

  if [[ "$raw" == \?* ]]; then
    printf '%s' "$raw"
    return
  fi

  if echo "$raw" | jq -e . >/dev/null 2>&1; then
    local query
    query="$(
      echo "$raw" | jq -r '
        to_entries
        | map(select(.value != null))
        | map("\(.key)=\((.value|tostring)|@uri)")
        | join("&")
      '
    )"
    if [ -n "$query" ]; then
      printf '?%s' "$query"
    else
      printf ''
    fi
    return
  fi

  printf '%s' "$raw"
}

is_safe_job_id() {
  local value="${1:-}"
  [[ "$value" =~ ^[A-Za-z0-9._:-]+$ ]]
}

fallback_error_code() {
  local command="${1:-unknown}"
  case "$command" in
    health) printf 'health_check_failed' ;;
    record-event) printf 'record_event_failed' ;;
    search) printf 'search_failed' ;;
    timeline) printf 'timeline_failed' ;;
    get-observations) printf 'get_observations_failed' ;;
    resume-pack) printf 'resume_pack_failed' ;;
    record-checkpoint) printf 'record_checkpoint_failed' ;;
    finalize-session) printf 'finalize_session_failed' ;;
    ingest-codex-history) printf 'ingest_codex_history_failed' ;;
    admin-backup) printf 'admin_backup_failed' ;;
    admin-reindex-vectors) printf 'admin_reindex_vectors_failed' ;;
    admin-metrics) printf 'admin_metrics_failed' ;;
    admin-consolidation-run) printf 'admin_consolidation_run_failed' ;;
    admin-consolidation-status) printf 'admin_consolidation_status_failed' ;;
    admin-audit-log) printf 'admin_audit_log_failed' ;;
    sessions-list) printf 'sessions_list_failed' ;;
    session-thread) printf 'session_thread_failed' ;;
    search-facets) printf 'search_facets_failed' ;;
    import-claude-mem) printf 'import_claude_mem_failed' ;;
    import-status-missing-job-id) printf 'import_status_requires_job_id' ;;
    import-status-invalid-job-id) printf 'import_status_invalid_job_id' ;;
    import-status) printf 'import_status_failed' ;;
    verify-import-missing-job-id) printf 'verify_import_requires_job_id' ;;
    verify-import-invalid-job-id) printf 'verify_import_invalid_job_id' ;;
    verify-import) printf 'verify_import_failed' ;;
    *) printf 'request_failed' ;;
  esac
}

fallback_error() {
  local command="${1:-unknown}"
  local message="${2:-}"
  if [ -z "$message" ]; then
    message="$command"
    case "$message" in
      "health check failed") command="health" ;;
      "resume-pack failed") command="resume-pack" ;;
      *) command="unknown" ;;
    esac
  fi
  local error_code
  error_code="$(fallback_error_code "$command")"
  printf '{"ok":false,"source":"core","items":[],"meta":{"count":0,"latency_ms":0,"filters":{},"ranking":"hybrid_v1"},"error":"%s","error_code":"%s"}\n' "$message" "$error_code"
}

is_get_command() {
  case "$1" in
    health|admin-metrics|admin-consolidation-status|admin-audit-log|sessions-list|session-thread|search-facets)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

main() {
  local command="${1:-health}"
  shift || true

  local payload
  if is_get_command "$command"; then
    # GET commands: never read from STDIN to avoid hanging
    payload="${1:-{}}"
  else
    payload="$(read_payload "${1:-}")"
  fi

  if [ "$command" != "health" ]; then
    ensure_daemon
  fi

  case "$command" in
    health)
      call_get "/health" || fallback_error "health" "health check failed"
      ;;
    record-event)
      call_post "/v1/events/record" "$payload" || fallback_error "record-event" "record-event failed"
      ;;
    search)
      call_post "/v1/search" "$payload" || fallback_error "search" "search failed"
      ;;
    timeline)
      call_post "/v1/timeline" "$payload" || fallback_error "timeline" "timeline failed"
      ;;
    get-observations)
      call_post "/v1/observations/get" "$payload" || fallback_error "get-observations" "get-observations failed"
      ;;
    resume-pack)
      call_post "/v1/resume-pack" "$payload" || fallback_error "resume-pack" "resume-pack failed"
      ;;
    record-checkpoint)
      call_post "/v1/checkpoints/record" "$payload" || fallback_error "record-checkpoint" "record-checkpoint failed"
      ;;
    finalize-session)
      call_post "/v1/sessions/finalize" "$payload" || fallback_error "finalize-session" "finalize-session failed"
      ;;
    ingest-codex-history)
      call_post "/v1/ingest/codex-history" "$payload" || fallback_error "ingest-codex-history" "ingest-codex-history failed"
      ;;
    admin-backup)
      call_post "/v1/admin/backup" "$payload" || fallback_error "admin-backup" "admin-backup failed"
      ;;
    admin-reindex-vectors)
      call_post "/v1/admin/reindex-vectors" "$payload" || fallback_error "admin-reindex-vectors" "admin-reindex-vectors failed"
      ;;
    admin-metrics)
      call_get "/v1/admin/metrics" || fallback_error "admin-metrics" "admin-metrics failed"
      ;;
    admin-consolidation-run)
      call_post "/v1/admin/consolidation/run" "$payload" || fallback_error "admin-consolidation-run" "admin-consolidation-run failed"
      ;;
    admin-consolidation-status)
      call_get "/v1/admin/consolidation/status" || fallback_error "admin-consolidation-status" "admin-consolidation-status failed"
      ;;
    admin-audit-log)
      local audit_query
      audit_query="$(payload_to_query "$payload")"
      call_get "/v1/admin/audit-log${audit_query}" || fallback_error "admin-audit-log" "admin-audit-log failed"
      ;;
    sessions-list)
      local sessions_query
      sessions_query="$(payload_to_query "$payload")"
      call_get "/v1/sessions/list${sessions_query}" || fallback_error "sessions-list" "sessions-list failed"
      ;;
    session-thread)
      local thread_query
      thread_query="$(payload_to_query "$payload")"
      call_get "/v1/sessions/thread${thread_query}" || fallback_error "session-thread" "session-thread failed"
      ;;
    search-facets)
      local facets_query
      facets_query="$(payload_to_query "$payload")"
      call_get "/v1/search/facets${facets_query}" || fallback_error "search-facets" "search-facets failed"
      ;;
    import-claude-mem)
      call_post "/v1/admin/imports/claude-mem" "$payload" || fallback_error "import-claude-mem" "import-claude-mem failed"
      ;;
    import-status)
      local job_id
      job_id="$(echo "$payload" | jq -r '.job_id // empty' 2>/dev/null || true)"
      if [ -z "$job_id" ]; then
        fallback_error "import-status-missing-job-id" "import-status requires job_id"
        exit 1
      fi
      if ! is_safe_job_id "$job_id"; then
        fallback_error "import-status-invalid-job-id" "import-status job_id contains unsupported characters"
        exit 1
      fi
      call_get "/v1/admin/imports/${job_id}" || fallback_error "import-status" "import-status failed"
      ;;
    verify-import)
      local verify_job_id
      verify_job_id="$(echo "$payload" | jq -r '.job_id // empty' 2>/dev/null || true)"
      if [ -z "$verify_job_id" ]; then
        fallback_error "verify-import-missing-job-id" "verify-import requires job_id"
        exit 1
      fi
      if ! is_safe_job_id "$verify_job_id"; then
        fallback_error "verify-import-invalid-job-id" "verify-import job_id contains unsupported characters"
        exit 1
      fi
      call_post "/v1/admin/imports/${verify_job_id}/verify" "{}" || fallback_error "verify-import" "verify-import failed"
      ;;
    *)
      echo "Usage: $0 {health|record-event|search|timeline|get-observations|resume-pack|record-checkpoint|finalize-session|ingest-codex-history|admin-backup|admin-reindex-vectors|admin-metrics|admin-consolidation-run|admin-consolidation-status|admin-audit-log|sessions-list|session-thread|search-facets|import-claude-mem|import-status|verify-import} [json/query]" >&2
      exit 1
      ;;
  esac
}

main "$@"
