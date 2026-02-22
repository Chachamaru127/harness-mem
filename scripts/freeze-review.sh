#!/bin/bash
# freeze-review.sh
# Phase1 freeze review: runs proof-pack 3 times and validates freeze gates.
#
# Usage:
#   scripts/freeze-review.sh

set -euo pipefail
IFS=$'\n\t'

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
SOURCE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

PROOF_PACK="${SCRIPT_DIR}/harness-mem-proof-pack.sh"
ARTIFACTS_DIR="${SOURCE_ROOT}/artifacts/freeze-review"
REPORT_FILE="${ARTIFACTS_DIR}/freeze-report.json"

NUM_RUNS=3
SLEEP_BETWEEN_RUNS=2

ONBOARDING_REPORT_NAME="onboarding-report.json"
CONTINUITY_REPORT_NAME="continuity-report.json"
PRIVACY_BOUNDARY_REPORT_NAME="privacy-boundary-report.json"
SESSION_SELFCHECK_REPORT_NAME="session-selfcheck-report.json"

log()  { echo "[freeze-review] $*"; }
warn() { echo "[freeze-review] WARN: $*" >&2; }
die()  { echo "[freeze-review] ERROR: $*" >&2; exit 1; }

parse_pass() {
  local summary="$1"
  if [[ ! -f "$summary" ]]; then
    echo "false"
    return
  fi
  local result
  result=$(jq -r '
    if type == "object" then
      if (.phase1_pass // .pass) == true then "true"
      else "false"
      end
    else "false"
    end
  ' "$summary" 2>/dev/null || echo "false")
  echo "$result"
}

json_get() {
  local file="$1"
  local key="$2"
  local default="$3"
  if [[ ! -f "$file" ]]; then
    echo "$default"
    return
  fi
  jq -r "${key} // ${default}" "$file" 2>/dev/null || echo "$default"
}

json_get_bool() {
  local file="$1"
  local key="$2"
  local default="$3"
  local value
  value="$(json_get "$file" "$key" "$default")"
  if [[ "$value" == "true" ]]; then
    echo "true"
  else
    echo "false"
  fi
}

json_get_number() {
  local file="$1"
  local key="$2"
  local default="$3"
  local value
  value="$(json_get "$file" "$key" "$default")"
  if [[ "$value" =~ ^-?[0-9]+([.][0-9]+)?$ ]]; then
    echo "$value"
  else
    echo "$default"
  fi
}

check_consistent_kpi() {
  local field="$1"
  local first=""
  for i in $(seq 1 "$NUM_RUNS"); do
    local summary_file="${RUN_SUMMARY_FILES[$((i-1))]:-}"
    if [[ -z "$summary_file" || ! -f "$summary_file" ]]; then
      continue
    fi
    local value
    value=$(json_get "$summary_file" "$field" "null")
    if [[ -z "$first" ]]; then
      first="$value"
    elif [[ "$value" != "$first" ]]; then
      echo "false"
      return
    fi
  done
  echo "true"
}

if [[ ! -f "$PROOF_PACK" ]]; then
  die "harness-mem-proof-pack.sh not found at ${PROOF_PACK}. Create it before running freeze-review."
fi

if ! command -v jq >/dev/null 2>&1; then
  die "jq is required but not found. Install with: brew install jq"
fi

mkdir -p "${ARTIFACTS_DIR}"
log "Output directory : ${ARTIFACTS_DIR}"
log "Starting Phase1 freeze review (${NUM_RUNS} runs)..."
echo ""

declare -a RUN_TIMESTAMPS=()
declare -a RUN_PASS=()
declare -a RUN_SUMMARY_PASS=()
declare -a RUN_MANDATORY_PASS=()
declare -a RUN_REPORTS_PRESENT=()
declare -a RUN_KPI_FILES=()
declare -a RUN_SUMMARY_FILES=()
declare -a RUN_STDOUT_LOGS=()
declare -a RUN_MISSING_REPORTS_JSON=()
declare -a RUN_ONBOARDING_ONE_COMMAND=()
declare -a RUN_CONTINUITY_RATE=()
declare -a RUN_PRIVACY_LEAK_COUNT=()
declare -a RUN_BOUNDARY_LEAK_COUNT=()
declare -a RUN_REPORT_ONBOARDING=()
declare -a RUN_REPORT_CONTINUITY=()
declare -a RUN_REPORT_PRIVACY_BOUNDARY=()
declare -a RUN_REPORT_SESSION_SELFCHECK=()

for i in $(seq 1 "$NUM_RUNS"); do
  RUN_DIR="${ARTIFACTS_DIR}/run-${i}"
  mkdir -p "$RUN_DIR"

  TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  RUN_TIMESTAMPS+=("$TIMESTAMP")
  log "=== Run ${i}/${NUM_RUNS} started at ${TIMESTAMP} ==="

  STDOUT_LOG="${RUN_DIR}/stdout.log"
  RUN_STDOUT_LOGS+=("$STDOUT_LOG")
  EXIT_CODE=0
  bash "$PROOF_PACK" --out-dir "$RUN_DIR" 2>&1 | tee "$STDOUT_LOG" || EXIT_CODE=${PIPESTATUS[0]}

  SUMMARY_FILE=""
  KPI_FILE=""
  while IFS= read -r -d '' f; do
    SUMMARY_FILE="$f"
  done < <(find "$RUN_DIR" -maxdepth 1 -name '*-summary.json' -print0 2>/dev/null | sort -z)
  while IFS= read -r -d '' f; do
    KPI_FILE="$f"
  done < <(find "$RUN_DIR" -maxdepth 1 -name '*-sla-latency.json' -print0 2>/dev/null | sort -z)

  if [[ -z "$SUMMARY_FILE" ]]; then
    SUMMARY_FILE="${RUN_DIR}/summary.json"
    if [[ "$EXIT_CODE" -eq 0 ]]; then
      echo '{"pass":true}' > "$SUMMARY_FILE"
    else
      echo '{"pass":false}' > "$SUMMARY_FILE"
    fi
  fi

  RUN_SUMMARY_FILES+=("$SUMMARY_FILE")
  RUN_KPI_FILES+=("${KPI_FILE:-}")

  SUMMARY_PASS="$(parse_pass "$SUMMARY_FILE")"
  RUN_SUMMARY_PASS+=("$SUMMARY_PASS")

  ONBOARDING_REPORT="${RUN_DIR}/${ONBOARDING_REPORT_NAME}"
  CONTINUITY_REPORT="${RUN_DIR}/${CONTINUITY_REPORT_NAME}"
  PRIVACY_BOUNDARY_REPORT="${RUN_DIR}/${PRIVACY_BOUNDARY_REPORT_NAME}"
  SESSION_SELFCHECK_REPORT="${RUN_DIR}/${SESSION_SELFCHECK_REPORT_NAME}"

  RUN_REPORT_ONBOARDING+=("$ONBOARDING_REPORT")
  RUN_REPORT_CONTINUITY+=("$CONTINUITY_REPORT")
  RUN_REPORT_PRIVACY_BOUNDARY+=("$PRIVACY_BOUNDARY_REPORT")
  RUN_REPORT_SESSION_SELFCHECK+=("$SESSION_SELFCHECK_REPORT")

  missing_reports=()
  for report in \
    "$ONBOARDING_REPORT_NAME:$ONBOARDING_REPORT" \
    "$CONTINUITY_REPORT_NAME:$CONTINUITY_REPORT" \
    "$PRIVACY_BOUNDARY_REPORT_NAME:$PRIVACY_BOUNDARY_REPORT" \
    "$SESSION_SELFCHECK_REPORT_NAME:$SESSION_SELFCHECK_REPORT"; do
    report_name="${report%%:*}"
    report_path="${report#*:}"
    if [[ ! -f "$report_path" ]]; then
      missing_reports+=("$report_name")
    elif ! jq -e . "$report_path" >/dev/null 2>&1; then
      missing_reports+=("${report_name}:invalid-json")
    fi
  done

  REPORTS_PRESENT="true"
  MISSING_REPORTS_JSON="[]"
  if [[ "${#missing_reports[@]}" -gt 0 ]]; then
    REPORTS_PRESENT="false"
    MISSING_REPORTS_JSON="$(printf '%s\n' "${missing_reports[@]}" | jq -Rsc 'split("\n") | map(select(length > 0))')"
  fi
  RUN_REPORTS_PRESENT+=("$REPORTS_PRESENT")
  RUN_MISSING_REPORTS_JSON+=("$MISSING_REPORTS_JSON")

  ONBOARDING_ONE_COMMAND="false"
  CONTINUITY_RATE="0"
  PRIVACY_LEAK_COUNT="-1"
  BOUNDARY_LEAK_COUNT="-1"

  if [[ "$REPORTS_PRESENT" == "true" ]]; then
    ONBOARDING_ONE_COMMAND="$(json_get_bool "$ONBOARDING_REPORT" '.one_command_onboarding' "false")"
    CONTINUITY_RATE="$(json_get_number "$CONTINUITY_REPORT" '.continuity_rate_pct' "0")"
    PRIVACY_LEAK_COUNT="$(json_get_number "$PRIVACY_BOUNDARY_REPORT" '.privacy.leak_count' "-1")"
    BOUNDARY_LEAK_COUNT="$(json_get_number "$PRIVACY_BOUNDARY_REPORT" '.boundary.leak_count' "-1")"
  fi

  RUN_ONBOARDING_ONE_COMMAND+=("$ONBOARDING_ONE_COMMAND")
  RUN_CONTINUITY_RATE+=("$CONTINUITY_RATE")
  RUN_PRIVACY_LEAK_COUNT+=("$PRIVACY_LEAK_COUNT")
  RUN_BOUNDARY_LEAK_COUNT+=("$BOUNDARY_LEAK_COUNT")

  CONTINUITY_RATE_PASS="false"
  if awk -v rate="$CONTINUITY_RATE" 'BEGIN { exit !(rate >= 95) }'; then
    CONTINUITY_RATE_PASS="true"
  fi

  MANDATORY_PASS="false"
  if [[ "$ONBOARDING_ONE_COMMAND" == "true" ]] && \
     [[ "$CONTINUITY_RATE_PASS" == "true" ]] && \
     [[ "$PRIVACY_LEAK_COUNT" == "0" ]] && \
     [[ "$BOUNDARY_LEAK_COUNT" == "0" ]]; then
    MANDATORY_PASS="true"
  fi
  RUN_MANDATORY_PASS+=("$MANDATORY_PASS")

  RUN_PASS_BOOL="false"
  if [[ "$SUMMARY_PASS" == "true" ]] && \
     [[ "$REPORTS_PRESENT" == "true" ]] && \
     [[ "$MANDATORY_PASS" == "true" ]]; then
    RUN_PASS_BOOL="true"
  fi
  RUN_PASS+=("$RUN_PASS_BOOL")

  if [[ "$RUN_PASS_BOOL" == "true" ]]; then
    log "Run ${i}: PASS (summary=true, required_reports=true, mandatory_gate=true)"
  else
    warn "Run ${i}: FAIL (summary=${SUMMARY_PASS}, reports=${REPORTS_PRESENT}, mandatory=${MANDATORY_PASS}, exit_code=${EXIT_CODE})"
    if [[ "$REPORTS_PRESENT" != "true" ]]; then
      warn "  missing reports: ${MISSING_REPORTS_JSON}"
    fi
  fi

  echo ""
  if [[ "$i" -lt "$NUM_RUNS" ]]; then
    log "Waiting ${SLEEP_BETWEEN_RUNS}s before next run to avoid timing artifacts..."
    sleep "$SLEEP_BETWEEN_RUNS"
    echo ""
  fi
done

log "=== Generating diff summary ==="
DIFF_FILE="${ARTIFACTS_DIR}/diff-summary.txt"
{
  echo "# Freeze Review Diff Summary"
  echo "# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo ""
  for i in $(seq 1 "$NUM_RUNS"); do
    idx=$((i-1))
    echo "## Run ${i}: pass=${RUN_PASS[$idx]}, summary_pass=${RUN_SUMMARY_PASS[$idx]}, reports=${RUN_REPORTS_PRESENT[$idx]}, mandatory=${RUN_MANDATORY_PASS[$idx]}"
    echo "### required report files"
    echo "- ${RUN_REPORT_ONBOARDING[$idx]}"
    echo "- ${RUN_REPORT_CONTINUITY[$idx]}"
    echo "- ${RUN_REPORT_PRIVACY_BOUNDARY[$idx]}"
    echo "- ${RUN_REPORT_SESSION_SELFCHECK[$idx]}"
    echo "### missing reports"
    echo "${RUN_MISSING_REPORTS_JSON[$idx]}"
    echo "### mandatory gate values"
    echo "onboarding_one_command=${RUN_ONBOARDING_ONE_COMMAND[$idx]}"
    echo "continuity_rate_pct=${RUN_CONTINUITY_RATE[$idx]}"
    echo "privacy_leak_count=${RUN_PRIVACY_LEAK_COUNT[$idx]}"
    echo "boundary_leak_count=${RUN_BOUNDARY_LEAK_COUNT[$idx]}"
    echo ""

    summary_file="${RUN_SUMMARY_FILES[$idx]:-}"
    kpi_file="${RUN_KPI_FILES[$idx]:-}"
    if [[ -n "$kpi_file" && -f "$kpi_file" ]]; then
      echo "### sla-latency.json"
      cat "$kpi_file"
      echo ""
    fi
    if [[ -f "$summary_file" ]]; then
      echo "### summary.json"
      cat "$summary_file"
      echo ""
    fi
  done

  for pair in "0 1" "1 2"; do
    a=$(echo "$pair" | cut -d' ' -f1)
    b=$(echo "$pair" | cut -d' ' -f2)
    file_a="${RUN_SUMMARY_FILES[$a]:-}"
    file_b="${RUN_SUMMARY_FILES[$b]:-}"
    if [[ -n "$file_a" && -n "$file_b" && -f "$file_a" && -f "$file_b" ]]; then
      echo "## diff run-$((a+1))/summary vs run-$((b+1))/summary"
      diff "$file_a" "$file_b" || true
      echo ""
    fi
  done
} > "$DIFF_FILE"
log "Diff summary written: ${DIFF_FILE}"

ALL_PASS="true"
SUMMARY_ALL_PASS="true"
MANDATORY_ALL_PASS="true"
REPORTS_ALL_PRESENT="true"
PASS_COUNT=0
CONSECUTIVE_STREAK=0
MAX_CONSECUTIVE_STREAK=0

for i in $(seq 1 "$NUM_RUNS"); do
  idx=$((i-1))

  if [[ "${RUN_SUMMARY_PASS[$idx]}" != "true" ]]; then
    SUMMARY_ALL_PASS="false"
  fi
  if [[ "${RUN_MANDATORY_PASS[$idx]}" != "true" ]]; then
    MANDATORY_ALL_PASS="false"
  fi
  if [[ "${RUN_REPORTS_PRESENT[$idx]}" != "true" ]]; then
    REPORTS_ALL_PRESENT="false"
  fi

  if [[ "${RUN_PASS[$idx]}" == "true" ]]; then
    PASS_COUNT=$((PASS_COUNT + 1))
    CONSECUTIVE_STREAK=$((CONSECUTIVE_STREAK + 1))
    if [[ "$CONSECUTIVE_STREAK" -gt "$MAX_CONSECUTIVE_STREAK" ]]; then
      MAX_CONSECUTIVE_STREAK="$CONSECUTIVE_STREAK"
    fi
  else
    ALL_PASS="false"
    CONSECUTIVE_STREAK=0
  fi
done

THREE_RUN_CONSECUTIVE_PASS="false"
if [[ "$MAX_CONSECUTIVE_STREAK" -ge "$NUM_RUNS" ]]; then
  THREE_RUN_CONSECUTIVE_PASS="true"
fi

LATENCY_VALUES=()
for i in $(seq 1 "$NUM_RUNS"); do
  idx=$((i-1))
  kpi_file="${RUN_KPI_FILES[$idx]:-}"
  if [[ -n "$kpi_file" && -f "$kpi_file" ]]; then
    value="$(json_get "$kpi_file" '.p95_ms' "null")"
    if [[ "$value" =~ ^-?[0-9]+([.][0-9]+)?$ ]]; then
      LATENCY_VALUES+=("$value")
    fi
  fi
done

LATENCY_VARIANCE="null"
if [[ "${#LATENCY_VALUES[@]}" -ge 2 ]]; then
  LATENCY_VARIANCE=$(printf '%s\n' "${LATENCY_VALUES[@]}" | awk '
    { sum += $1; vals[NR] = $1 }
    END {
      mean = sum / NR
      for (i = 1; i <= NR; i++) sq += (vals[i] - mean)^2
      printf "%.2f", sq / NR
    }
  ')
fi

CONSISTENT_DOCTOR="$(check_consistent_kpi ".kpi.doctor_all_green")"
CONSISTENT_PRIVACY="$(check_consistent_kpi ".privacy.default_excluded")"
CONSISTENT_BOUNDARY="$(check_consistent_kpi ".boundary.isolation")"
CONSISTENT_CONTINUITY="$(check_consistent_kpi ".kgi_continuity.correlation_id_chain")"

build_run_kpi() {
  local summary_file="$1"
  if [[ -f "$summary_file" ]]; then
    jq '.kpi // {}' "$summary_file" 2>/dev/null || echo '{}'
  else
    echo "null"
  fi
}

FROZEN_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
COMMENT="Phase1 freeze review: ${PASS_COUNT}/${NUM_RUNS} runs passed (requires 3-run consecutive pass)"

FREEZE_BACKEND_MODE="unknown"
FIRST_SUMMARY="${RUN_SUMMARY_FILES[0]:-}"
if [[ -n "$FIRST_SUMMARY" && -f "$FIRST_SUMMARY" ]]; then
  FREEZE_BACKEND_MODE="$(json_get "$FIRST_SUMMARY" '.backend_mode' '"local"')"
  [[ -z "$FREEZE_BACKEND_MODE" ]] && FREEZE_BACKEND_MODE="local"
fi

RUNS_JSON="["
for i in $(seq 1 "$NUM_RUNS"); do
  idx=$((i-1))
  comma=""
  [[ "$i" -gt 1 ]] && comma=","

  kpi_json="$(build_run_kpi "${RUN_SUMMARY_FILES[$idx]:-}")"
  run_json="$(jq -n \
    --argjson run "$i" \
    --arg timestamp "${RUN_TIMESTAMPS[$idx]}" \
    --arg summary_file "${RUN_SUMMARY_FILES[$idx]}" \
    --arg stdout_log "${RUN_STDOUT_LOGS[$idx]}" \
    --arg onboarding_report "${RUN_REPORT_ONBOARDING[$idx]}" \
    --arg continuity_report "${RUN_REPORT_CONTINUITY[$idx]}" \
    --arg privacy_boundary_report "${RUN_REPORT_PRIVACY_BOUNDARY[$idx]}" \
    --arg session_selfcheck_report "${RUN_REPORT_SESSION_SELFCHECK[$idx]}" \
    --argjson pass "$( [[ "${RUN_PASS[$idx]}" == "true" ]] && echo true || echo false )" \
    --argjson summary_pass "$( [[ "${RUN_SUMMARY_PASS[$idx]}" == "true" ]] && echo true || echo false )" \
    --argjson mandatory_pass "$( [[ "${RUN_MANDATORY_PASS[$idx]}" == "true" ]] && echo true || echo false )" \
    --argjson reports_present "$( [[ "${RUN_REPORTS_PRESENT[$idx]}" == "true" ]] && echo true || echo false )" \
    --arg onboarding_one_command "${RUN_ONBOARDING_ONE_COMMAND[$idx]}" \
    --arg continuity_rate "${RUN_CONTINUITY_RATE[$idx]}" \
    --arg privacy_leak_count "${RUN_PRIVACY_LEAK_COUNT[$idx]}" \
    --arg boundary_leak_count "${RUN_BOUNDARY_LEAK_COUNT[$idx]}" \
    --argjson missing_reports "${RUN_MISSING_REPORTS_JSON[$idx]}" \
    --argjson kpi "${kpi_json}" \
    '{
      run: $run,
      timestamp: $timestamp,
      pass: $pass,
      pass_breakdown: {
        summary_pass: $summary_pass,
        mandatory_pass: $mandatory_pass,
        required_reports_present: $reports_present
      },
      mandatory_gate: {
        onboarding_one_command: ($onboarding_one_command == "true"),
        continuity_rate_pct: ($continuity_rate | tonumber? // 0),
        privacy_leak_count: ($privacy_leak_count | tonumber? // -1),
        boundary_leak_count: ($boundary_leak_count | tonumber? // -1),
        pass: $mandatory_pass
      },
      required_reports: {
        all_present: $reports_present,
        missing: $missing_reports,
        files: {
          onboarding_report: $onboarding_report,
          continuity_report: $continuity_report,
          privacy_boundary_report: $privacy_boundary_report,
          session_selfcheck_report: $session_selfcheck_report
        }
      },
      kpi: $kpi,
      summary_file: $summary_file,
      stdout_log: $stdout_log
    }')"
  RUNS_JSON="${RUNS_JSON}${comma}${run_json}"
done
RUNS_JSON="${RUNS_JSON}]"

jq -n \
  --arg backend_mode "$FREEZE_BACKEND_MODE" \
  --argjson runs "$RUNS_JSON" \
  --argjson all_pass "$( [[ "$ALL_PASS" == "true" ]] && echo true || echo false )" \
  --argjson summary_all_pass "$( [[ "$SUMMARY_ALL_PASS" == "true" ]] && echo true || echo false )" \
  --argjson mandatory_gate_all_pass "$( [[ "$MANDATORY_ALL_PASS" == "true" ]] && echo true || echo false )" \
  --argjson required_reports_all_present "$( [[ "$REPORTS_ALL_PRESENT" == "true" ]] && echo true || echo false )" \
  --argjson three_run_consecutive_pass "$( [[ "$THREE_RUN_CONSECUTIVE_PASS" == "true" ]] && echo true || echo false )" \
  --argjson pass_count "$PASS_COUNT" \
  --argjson consecutive_pass_streak "$MAX_CONSECUTIVE_STREAK" \
  --argjson latency_variance "${LATENCY_VARIANCE}" \
  --argjson consistent_doctor "$( [[ "$CONSISTENT_DOCTOR" == "true" ]] && echo true || echo false )" \
  --argjson consistent_privacy "$( [[ "$CONSISTENT_PRIVACY" == "true" ]] && echo true || echo false )" \
  --argjson consistent_boundary "$( [[ "$CONSISTENT_BOUNDARY" == "true" ]] && echo true || echo false )" \
  --argjson consistent_continuity "$( [[ "$CONSISTENT_CONTINUITY" == "true" ]] && echo true || echo false )" \
  --arg frozen_at "$FROZEN_AT" \
  --arg comment "$COMMENT" \
  '{
    backend_mode: $backend_mode,
    runs: $runs,
    reproducibility: {
      all_pass: $all_pass,
      pass_count: $pass_count,
      summary_all_pass: $summary_all_pass,
      mandatory_gate_all_pass: $mandatory_gate_all_pass,
      required_reports_all_present: $required_reports_all_present,
      consecutive_pass_streak: $consecutive_pass_streak,
      three_run_consecutive_pass: $three_run_consecutive_pass,
      latency_variance_ms: $latency_variance,
      consistent_doctor: $consistent_doctor,
      consistent_privacy: $consistent_privacy,
      consistent_boundary: $consistent_boundary,
      consistent_continuity: $consistent_continuity
    },
    frozen_at: $frozen_at,
    comment: $comment
  }' > "$REPORT_FILE"

echo ""
log "=== Freeze Review Complete ==="
log "Report       : ${REPORT_FILE}"
log "Diff summary : ${DIFF_FILE}"
log "Backend mode : ${FREEZE_BACKEND_MODE}"
log ""
log "Results:"
for i in $(seq 1 "$NUM_RUNS"); do
  idx=$((i-1))
  log "  Run ${i}: pass=${RUN_PASS[$idx]} summary=${RUN_SUMMARY_PASS[$idx]} reports=${RUN_REPORTS_PRESENT[$idx]} mandatory=${RUN_MANDATORY_PASS[$idx]}"
done
log ""
log "Reproducibility:"
log "  all_pass                    : ${ALL_PASS}"
log "  summary_all_pass            : ${SUMMARY_ALL_PASS}"
log "  mandatory_gate_all_pass     : ${MANDATORY_ALL_PASS}"
log "  required_reports_all_present: ${REPORTS_ALL_PRESENT}"
log "  three_run_consecutive_pass  : ${THREE_RUN_CONSECUTIVE_PASS}"
log "  latency_variance_ms         : ${LATENCY_VARIANCE}"
log "  consistent_doctor           : ${CONSISTENT_DOCTOR}"
log "  consistent_privacy          : ${CONSISTENT_PRIVACY}"
log "  consistent_boundary         : ${CONSISTENT_BOUNDARY}"
log "  consistent_continuity       : ${CONSISTENT_CONTINUITY}"
log ""
log "${COMMENT}"

if [[ "$REPORTS_ALL_PRESENT" != "true" ]]; then
  warn "Required submission reports are missing in at least one run."
  exit 1
fi
if [[ "$MANDATORY_ALL_PASS" != "true" ]]; then
  warn "Mandatory gate failed in at least one run (leak=0/boundary=0/continuity>=95/one-command onboarding)."
  exit 1
fi
if [[ "$THREE_RUN_CONSECUTIVE_PASS" != "true" ]]; then
  warn "3-run consecutive pass condition not met."
  exit 1
fi
if [[ "$ALL_PASS" != "true" ]]; then
  warn "Not all runs passed. Review ${ARTIFACTS_DIR}/run-*/stdout.log for details."
  exit 1
fi
