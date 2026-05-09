#!/usr/bin/env bash
# §S109-004: Inject actionability gate (delivered_rate / consumed_rate)
#
# Reads `inject_actionability.tier` from ci-run-manifest-latest.json and:
#   - tier=red    → emit ::error::  + exit 1   (block release)
#   - tier=yellow → emit ::warning:: + exit 0  (warn but allow)
#   - tier=green  → silent          + exit 0
#
# The tier itself is decided by run-ci.ts → inject-actionability-smoke.ts and
# encoded by `decideTier()`:
#     delivered_rate < 0.95  ⇒ red
#     consumed_rate  < 0.30  ⇒ red
#     0.30 ≤ consumed_rate < 0.60 ⇒ yellow
#     delivered_rate ≥ 0.95 AND consumed_rate ≥ 0.60 ⇒ green
#
# Backed by `.claude/memory/decisions.md` D8.
#
# Usage:
#   bash scripts/check-inject-actionability.sh
#   MANIFEST_PATH=/path/to/ci-run-manifest-latest.json bash scripts/check-inject-actionability.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

MANIFEST_PATH="${MANIFEST_PATH:-${REPO_ROOT}/memory-server/src/benchmark/results/ci-run-manifest-latest.json}"

if ! command -v jq &>/dev/null; then
  echo "::error::jq is required but not found in PATH"
  exit 1
fi

if [ ! -f "${MANIFEST_PATH}" ]; then
  echo "::error::CI manifest not found: ${MANIFEST_PATH}"
  echo "Run 'npm run benchmark' (or 'bun run memory-server/src/benchmark/run-ci.ts') first."
  exit 1
fi

# Pull tier + numeric fields. `// "missing"` produces a sentinel when the
# inject_actionability section was not emitted (older manifests).
TIER="$(jq -r '.inject_actionability.tier // "missing"' "${MANIFEST_PATH}")"
DELIVERED="$(jq -r '.inject_actionability.delivered_rate // "null"' "${MANIFEST_PATH}")"
CONSUMED="$(jq -r '.inject_actionability.consumed_rate // "null"' "${MANIFEST_PATH}")"
FIXTURE_SIZE="$(jq -r '.inject_actionability.fixture_size // "null"' "${MANIFEST_PATH}")"
CONSUMED_COUNT="$(jq -r '.inject_actionability.consumed_count // "null"' "${MANIFEST_PATH}")"

echo ""
echo "=== Inject Actionability Gate (§S109-004) ==="
echo "  Manifest        : ${MANIFEST_PATH}"
echo "  delivered_rate  : ${DELIVERED}"
echo "  consumed_rate   : ${CONSUMED}"
echo "  fixture_size    : ${FIXTURE_SIZE}"
echo "  consumed_count  : ${CONSUMED_COUNT}"
echo "  tier            : ${TIER}"
echo ""

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "## Inject Actionability Gate (§S109-004)"
    echo ""
    echo "| Metric | Value |"
    echo "|--------|-------|"
    echo "| delivered_rate | ${DELIVERED} |"
    echo "| consumed_rate  | ${CONSUMED} |"
    echo "| fixture_size   | ${FIXTURE_SIZE} |"
    echo "| consumed_count | ${CONSUMED_COUNT} |"
    echo "| tier           | ${TIER} |"
  } >> "${GITHUB_STEP_SUMMARY}"
fi

case "${TIER}" in
  green)
    echo "Inject actionability gate: PASSED (green)"
    exit 0
    ;;
  yellow)
    echo "::warning::Inject actionability gate: WARN — consumed_rate=${CONSUMED} in 30%–60% band (delivered=${DELIVERED}). Investigate signal coverage."
    echo "Inject actionability gate: WARN (yellow — not blocking)"
    exit 0
    ;;
  red)
    echo "::error::Inject actionability gate: FAILED — tier=red (delivered=${DELIVERED}, consumed=${CONSUMED}). Either delivered_rate<95% (broken inject path) or consumed_rate<30% (envelopes not being acted on)."
    echo "Inject actionability gate: FAILED (red — blocking)"
    exit 1
    ;;
  missing)
    echo "::error::Inject actionability gate: manifest is missing inject_actionability section. Re-run 'npm run benchmark' to regenerate."
    exit 1
    ;;
  *)
    echo "::error::Inject actionability gate: unknown tier '${TIER}'"
    exit 1
    ;;
esac
