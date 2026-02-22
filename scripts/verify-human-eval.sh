#!/bin/bash
# verify-human-eval.sh
# Validate Phase1 human evaluation gates.
#
# Required gates:
# - evaluators >= 5
# - no duplicate evaluator IDs
# - understandability average >= 80
#
# Usage:
#   scripts/verify-human-eval.sh <input-json> [--out <output-json>]

set -euo pipefail
IFS=$'\n\t'

usage() {
  cat <<'EOF'
Usage:
  scripts/verify-human-eval.sh <input-json> [--out <output-json>]

Input schema:
{
  "evaluations": [
    { "evaluator_id": "u1", "understandability_pct": 82 },
    { "evaluator_id": "u2", "understandability_pct": 88 }
  ]
}

Accepted keys:
- evaluator id: `evaluator_id` or `id`
- understandability score: `understandability_pct` or `understandability` or `clarity_pct`
EOF
}

if ! command -v jq >/dev/null 2>&1; then
  echo "[verify-human-eval] ERROR: jq is required but not found. Install with: brew install jq" >&2
  exit 1
fi

INPUT_FILE=""
OUTPUT_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out)
      [[ $# -lt 2 ]] && { echo "[verify-human-eval] ERROR: --out requires a value" >&2; exit 1; }
      OUTPUT_FILE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -z "$INPUT_FILE" ]]; then
        INPUT_FILE="$1"
        shift
      else
        echo "[verify-human-eval] ERROR: unexpected argument: $1" >&2
        usage >&2
        exit 1
      fi
      ;;
  esac
done

if [[ -z "$INPUT_FILE" ]]; then
  echo "[verify-human-eval] ERROR: input JSON path is required" >&2
  usage >&2
  exit 1
fi

if [[ ! -f "$INPUT_FILE" ]]; then
  echo "[verify-human-eval] ERROR: input file not found: $INPUT_FILE" >&2
  exit 1
fi

if ! jq -e . "$INPUT_FILE" >/dev/null 2>&1; then
  echo "[verify-human-eval] ERROR: input file is not valid JSON: $INPUT_FILE" >&2
  exit 1
fi

if ! jq -e '.evaluations | type == "array"' "$INPUT_FILE" >/dev/null 2>&1; then
  echo "[verify-human-eval] ERROR: .evaluations array is required" >&2
  exit 1
fi

RESULT_JSON="$(
  jq -c '
    .evaluations as $evals
    | ($evals | map((.evaluator_id // .id // "") | tostring)) as $raw_ids
    | ($raw_ids | map(select(length > 0))) as $ids
    | ($ids | group_by(.) | map(select(length > 1) | .[0])) as $duplicate_ids
    | ($evals | map((.understandability_pct // .understandability // .clarity_pct // empty) | tonumber?) | map(select(. != null))) as $scores
    | ($evals | length) as $evaluator_count
    | ($ids | length) as $id_count
    | ($ids | unique | length) as $unique_id_count
    | ($scores | length) as $score_count
    | (if $score_count > 0 then (($scores | add) / $score_count) else 0 end) as $avg_score
    | {
        evaluator_count: $evaluator_count,
        id_count: $id_count,
        unique_id_count: $unique_id_count,
        duplicate_ids: $duplicate_ids,
        understandability_avg_pct: ($avg_score * 100 | round / 100),
        understandability_sample_count: $score_count,
        gates: {
          min_evaluators: ($evaluator_count >= 5),
          unique_ids: (
            $id_count == $evaluator_count
            and $unique_id_count == $evaluator_count
            and ($duplicate_ids | length) == 0
          ),
          understandability_ge_80: (
            $score_count == $evaluator_count
            and $avg_score >= 80
          )
        }
      }
    | . + { pass: (.gates.min_evaluators and .gates.unique_ids and .gates.understandability_ge_80) }
  ' "$INPUT_FILE"
)"

if [[ -n "$OUTPUT_FILE" ]]; then
  mkdir -p "$(dirname "$OUTPUT_FILE")"
  printf '%s\n' "$RESULT_JSON" | jq . > "$OUTPUT_FILE"
  printf '%s\n' "$RESULT_JSON" | jq .
else
  printf '%s\n' "$RESULT_JSON" | jq .
fi

PASS="$(printf '%s\n' "$RESULT_JSON" | jq -r '.pass')"
if [[ "$PASS" != "true" ]]; then
  echo "[verify-human-eval] ERROR: human evaluation gates not met" >&2
  exit 1
fi
