#!/usr/bin/env bash
# §78-A01: Developer-domain benchmark gate (Layer 1 absolute floor)
#
# Reads the CI manifest and the threshold config, compares each metric,
# and emits GitHub Actions ::warning:: or ::error:: annotations.
# Exits 0 in warn mode; exits 1 in enforce mode when any metric fails.
#
# Usage:
#   bash scripts/check-developer-domain-gate.sh
#   MANIFEST_PATH=/path/to/ci-run-manifest-latest.json bash scripts/check-developer-domain-gate.sh
#   THRESHOLDS_PATH=/path/to/thresholds.json bash scripts/check-developer-domain-gate.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

MANIFEST_PATH="${MANIFEST_PATH:-${REPO_ROOT}/memory-server/src/benchmark/results/ci-run-manifest-latest.json}"
THRESHOLDS_PATH="${THRESHOLDS_PATH:-${REPO_ROOT}/docs/benchmarks/developer-domain-thresholds.json}"

# Verify jq is available
if ! command -v jq &>/dev/null; then
  echo "::error::jq is required but not found in PATH"
  exit 1
fi

# Verify files exist
if [ ! -f "${MANIFEST_PATH}" ]; then
  echo "::error::CI manifest not found: ${MANIFEST_PATH}"
  echo "Run 'npm run benchmark' to generate it."
  exit 1
fi

if [ ! -f "${THRESHOLDS_PATH}" ]; then
  echo "::error::Threshold config not found: ${THRESHOLDS_PATH}"
  exit 1
fi

# Read mode (warn | enforce)
# S108-005: HARNESS_MEM_DEVDOMAIN_GATE env override (warn|enforce) takes precedence over JSON.
MODE="$(jq -r '.mode // "warn"' "${THRESHOLDS_PATH}")"
if [ -n "${HARNESS_MEM_DEVDOMAIN_GATE:-}" ]; then
  MODE="${HARNESS_MEM_DEVDOMAIN_GATE}"
fi

# Read thresholds
T_DEV_WORKFLOW="$(jq -r '.dev_workflow_recall_10' "${THRESHOLDS_PATH}")"
T_BILINGUAL="$(jq -r '.bilingual_recall_10' "${THRESHOLDS_PATH}")"
T_KNOWLEDGE="$(jq -r '.knowledge_update_freshness' "${THRESHOLDS_PATH}")"
T_TEMPORAL="$(jq -r '.temporal_ordering' "${THRESHOLDS_PATH}")"

# Read actual scores from manifest
# dev_workflow_recall is not yet emitted by run-ci.ts (§78-A05 will add it).
# Use null sentinel to detect the missing field and report as N/A.
S_DEV_WORKFLOW="$(jq -r '.results.dev_workflow_recall // "null"' "${MANIFEST_PATH}")"
S_BILINGUAL="$(jq -r '.results.bilingual_recall // "null"' "${MANIFEST_PATH}")"
S_KNOWLEDGE="$(jq -r '.results.freshness // "null"' "${MANIFEST_PATH}")"
S_TEMPORAL="$(jq -r '.results.temporal // "null"' "${MANIFEST_PATH}")"

ANY_FAIL=0

# -----------------------------------------------------------------------
# compare_metric <name> <score> <threshold>
# Prints a table row and emits ::warning:: / ::error:: as appropriate.
# Sets ANY_FAIL=1 when score < threshold.
# -----------------------------------------------------------------------
compare_metric() {
  local name="$1"
  local score="$2"
  local threshold="$3"

  if [ "${score}" = "null" ]; then
    local status="N/A (not yet in manifest)"
    local symbol="?"
    # Missing field counts as failing in enforce mode
    if [ "${MODE}" = "enforce" ]; then
      echo "::error::Developer-domain gate [${name}]: score missing from manifest (threshold=${threshold})"
      ANY_FAIL=1
    else
      echo "::warning::Developer-domain gate [${name}]: score missing from manifest — will be populated by §78-A05 (threshold=${threshold})"
    fi
    printf "  %-30s  %8s  %8s  %s\n" "${name}" "${symbol}" "${threshold}" "${status}"
    return
  fi

  # Use awk for float comparison (bash can't do it natively)
  local pass
  pass=$(awk -v s="${score}" -v t="${threshold}" 'BEGIN { print (s >= t) ? "1" : "0" }')

  if [ "${pass}" = "1" ]; then
    local status="PASS"
    local symbol="OK"
    printf "  %-30s  %8.4f  %8s  %s\n" "${name}" "${score}" "${threshold}" "${status}"
  else
    local status="FAIL (score=${score} < threshold=${threshold})"
    local symbol="!!"
    if [ "${MODE}" = "enforce" ]; then
      echo "::error::Developer-domain gate [${name}]: ${status}"
      ANY_FAIL=1
    else
      echo "::warning::Developer-domain gate [${name}]: ${status}"
    fi
    printf "  %-30s  %8.4f  %8s  %s\n" "${name}" "${score}" "${threshold}" "${status}"
  fi
}

# -----------------------------------------------------------------------
# Print header
# -----------------------------------------------------------------------
echo ""
echo "=== Developer-Domain Benchmark Gate (§78-A01) ==="
echo "  Manifest : ${MANIFEST_PATH}"
echo "  Thresholds: ${THRESHOLDS_PATH}"
echo "  Mode     : ${MODE}"
echo ""
printf "  %-30s  %8s  %8s  %s\n" "Metric" "Score" "Threshold" "Status"
printf "  %-30s  %8s  %8s  %s\n" "------------------------------" "--------" "---------" "------"

compare_metric "dev-workflow recall@10"   "${S_DEV_WORKFLOW}" "${T_DEV_WORKFLOW}"
compare_metric "bilingual recall@10"      "${S_BILINGUAL}"    "${T_BILINGUAL}"
compare_metric "knowledge-update freshness" "${S_KNOWLEDGE}"  "${T_KNOWLEDGE}"
compare_metric "temporal ordering"        "${S_TEMPORAL}"     "${T_TEMPORAL}"

echo ""

# -----------------------------------------------------------------------
# GitHub Actions Step Summary (if running in CI)
# -----------------------------------------------------------------------
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "## Developer-Domain Benchmark Gate"
    echo ""
    echo "| Metric | Score | Threshold | Status |"
    echo "|--------|-------|-----------|--------|"

    _row() {
      local name="$1" score="$2" threshold="$3"
      if [ "${score}" = "null" ]; then
        echo "| ${name} | N/A | ${threshold} | ⚠ missing |"
        return
      fi
      local pass
      pass=$(awk -v s="${score}" -v t="${threshold}" 'BEGIN { print (s >= t) ? "1" : "0" }')
      if [ "${pass}" = "1" ]; then
        echo "| ${name} | ${score} | ${threshold} | OK |"
      else
        echo "| ${name} | ${score} | ${threshold} | FAIL |"
      fi
    }

    _row "dev-workflow recall@10"      "${S_DEV_WORKFLOW}" "${T_DEV_WORKFLOW}"
    _row "bilingual recall@10"         "${S_BILINGUAL}"    "${T_BILINGUAL}"
    _row "knowledge-update freshness"  "${S_KNOWLEDGE}"    "${T_KNOWLEDGE}"
    _row "temporal ordering"           "${S_TEMPORAL}"     "${T_TEMPORAL}"

    echo ""
    echo "> Mode: \`${MODE}\` — flip to \`enforce\` after §78-A03 and §78-A05 land."
  } >> "${GITHUB_STEP_SUMMARY}"
fi

# -----------------------------------------------------------------------
# Exit
# -----------------------------------------------------------------------
if [ "${ANY_FAIL}" = "1" ] && [ "${MODE}" = "enforce" ]; then
  echo "Developer-domain gate: FAILED (enforce mode)"
  exit 1
elif [ "${ANY_FAIL}" = "1" ]; then
  echo "Developer-domain gate: WARN (mode=${MODE} — not blocking)"
  exit 0
else
  echo "Developer-domain gate: PASSED"
  exit 0
fi
