#!/bin/bash
# S105 retrieval A/B quality gate from checked-in benchmark artifacts.

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
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
JA_SUMMARY="${ROOT}/docs/benchmarks/artifacts/s40-ja-baseline-latest/summary.json"
CI_MANIFEST="${ROOT}/memory-server/src/benchmark/results/ci-run-manifest-latest.json"

if ! command -v jq >/dev/null 2>&1; then
  echo "[s105-retrieval-ab-gate] jq is required but not found" >&2
  exit 1
fi

jq -n \
  --slurpfile ja "$JA_SUMMARY" \
  --slurpfile ci "$CI_MANIFEST" \
  '
  {
    schema_version: "s105-retrieval-ab-gate.v1",
    sources: {
      three_run_japanese_summary: "'"$JA_SUMMARY"'",
      ci_manifest: "'"$CI_MANIFEST"'"
    },
    thresholds: {
      three_run_overall_f1_mean: 0.80,
      current_slice_f1: 0.80,
      cross_lingual_f1_mean: 0.75,
      search_latency_p95_ms_mean: 100,
      ci_all_passed: true,
      bilingual_recall: 0.85
    },
    observed: {
      runs: ($ja[0].runs // 0),
      overall_f1_mean: ($ja[0].metrics.overall_f1_mean // 0),
      current_slice_f1: ($ja[0].current_claim_run.slices.current.f1_avg // 0),
      cross_lingual_f1_mean: ($ja[0].metrics.cross_lingual_f1_mean // 0),
      search_latency_p95_ms_mean: ($ja[0].performance.search_latency_p95_ms_mean // 999999),
      companion_gate_verdict: ($ja[0].current_claim_run.verdict // "unknown"),
      ci_all_passed: ($ci[0].results.all_passed // false),
      bilingual_recall: ($ci[0].results.bilingual_recall // 0)
    }
  }
  | .checks = {
      three_run_available: (.observed.runs >= 3),
      overall_f1_pass: (.observed.overall_f1_mean >= .thresholds.three_run_overall_f1_mean),
      current_slice_pass: (.observed.current_slice_f1 >= .thresholds.current_slice_f1),
      cross_lingual_pass: (.observed.cross_lingual_f1_mean >= .thresholds.cross_lingual_f1_mean),
      latency_pass: (.observed.search_latency_p95_ms_mean <= .thresholds.search_latency_p95_ms_mean),
      companion_gate_pass: (.observed.companion_gate_verdict == "pass"),
      ci_all_passed: (.observed.ci_all_passed == true),
      bilingual_recall_pass: (.observed.bilingual_recall >= .thresholds.bilingual_recall)
    }
  | .pass = ([.checks[]] | all(. == true))
  '
