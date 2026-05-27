#!/usr/bin/env bash
# §S125-016: WorkGraph release gate.
#
# Defaults to warn mode for local compatibility. Release workflow sets
# HARNESS_MEM_WORKGRAPH_GATE=enforce after the readiness pack is green.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
MANIFEST_PATH="${MANIFEST_PATH:-${REPO_ROOT}/memory-server/src/benchmark/results/ci-run-manifest-latest.json}"
MODE="${HARNESS_MEM_WORKGRAPH_GATE:-warn}"

if ! command -v jq &>/dev/null; then
  echo "::error::jq is required but not found in PATH"
  exit 1
fi

case "${MODE}" in
  warn|enforce) ;;
  *)
    echo "::warning::Unknown HARNESS_MEM_WORKGRAPH_GATE=${MODE}; falling back to warn"
    MODE="warn"
    ;;
esac

warn_or_fail() {
  local message="$1"
  if [ "${MODE}" = "enforce" ]; then
    echo "::error::${message}"
    exit 1
  fi
  echo "::warning::${message}"
  exit 0
}

if [ ! -f "${MANIFEST_PATH}" ]; then
  warn_or_fail "WorkGraph gate manifest not found: ${MANIFEST_PATH}"
fi

if ! jq -e '.workgraph_release_gate' "${MANIFEST_PATH}" >/dev/null 2>&1; then
  warn_or_fail "manifest is missing workgraph_release_gate; rerun npm run benchmark"
fi

PASSED="$(jq -r '.workgraph_release_gate.passed // false' "${MANIFEST_PATH}")"
TIER="$(jq -r '.workgraph_release_gate.tier // "missing"' "${MANIFEST_PATH}")"
FAILED="$(jq -r '.workgraph_release_gate.failed_metrics // [] | join(",")' "${MANIFEST_PATH}")"

PLANS_IMPORT="$(jq -r '.workgraph_release_gate.metrics.plans_import_fidelity // "null"' "${MANIFEST_PATH}")"
READY_PRECISION="$(jq -r '.workgraph_release_gate.metrics.ready_precision // "null"' "${MANIFEST_PATH}")"
BLOCKER_RECALL="$(jq -r '.workgraph_release_gate.metrics.blocker_recall // "null"' "${MANIFEST_PATH}")"
NEXT_ACTION="$(jq -r '.workgraph_release_gate.metrics.next_action_accuracy // "null"' "${MANIFEST_PATH}")"
DUPLICATE_RATE="$(jq -r '.workgraph_release_gate.metrics.duplicate_work_rate // "null"' "${MANIFEST_PATH}")"
CLAIM_LEASE="$(jq -r '.workgraph_release_gate.metrics.claim_lease_success_rate // "null"' "${MANIFEST_PATH}")"
WORK_HINT="$(jq -r '.workgraph_release_gate.metrics.work_hint_consumed_rate // "null"' "${MANIFEST_PATH}")"

echo ""
echo "=== WorkGraph Release Gate (§S125-016) ==="
echo "  Manifest                  : ${MANIFEST_PATH}"
echo "  mode                      : ${MODE}"
echo "  tier                      : ${TIER}"
echo "  passed                    : ${PASSED}"
echo "  failed_metrics            : ${FAILED:-none}"
echo "  plans_import_fidelity     : ${PLANS_IMPORT}"
echo "  ready_precision           : ${READY_PRECISION}"
echo "  blocker_recall            : ${BLOCKER_RECALL}"
echo "  next_action_accuracy      : ${NEXT_ACTION}"
echo "  duplicate_work_rate       : ${DUPLICATE_RATE}"
echo "  claim_lease_success_rate  : ${CLAIM_LEASE}"
echo "  work_hint_consumed_rate   : ${WORK_HINT}"
echo ""

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "## WorkGraph Release Gate (§S125-016)"
    echo ""
    echo "| Metric | Value |"
    echo "|--------|-------|"
    echo "| mode | ${MODE} |"
    echo "| tier | ${TIER} |"
    echo "| passed | ${PASSED} |"
    echo "| failed_metrics | ${FAILED:-none} |"
    echo "| plans_import_fidelity | ${PLANS_IMPORT} |"
    echo "| ready_precision | ${READY_PRECISION} |"
    echo "| blocker_recall | ${BLOCKER_RECALL} |"
    echo "| next_action_accuracy | ${NEXT_ACTION} |"
    echo "| duplicate_work_rate | ${DUPLICATE_RATE} |"
    echo "| claim_lease_success_rate | ${CLAIM_LEASE} |"
    echo "| work_hint_consumed_rate | ${WORK_HINT} |"
  } >> "${GITHUB_STEP_SUMMARY}"
fi

if [ "${PASSED}" = "true" ]; then
  echo "WorkGraph release gate: PASSED (${TIER})"
  exit 0
fi

warn_or_fail "WorkGraph release gate: ${TIER} failed_metrics=${FAILED:-unknown}"
