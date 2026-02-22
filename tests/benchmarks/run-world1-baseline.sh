#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_DIR="${HARNESS_MEM_BASELINE_OUT_DIR:-$ROOT/tests/benchmarks/output}"
LABEL="${1:-before}"
OUTPUT_PATH="$OUT_DIR/$LABEL.json"
RERANKER_MODE="${HARNESS_MEM_BASELINE_RERANKER:-}"

if [[ -z "$RERANKER_MODE" ]]; then
  if [[ "$LABEL" == "after" ]]; then
    RERANKER_MODE="on"
  else
    RERANKER_MODE="off"
  fi
fi

mkdir -p "$OUT_DIR"

echo "[world1-baseline] generating snapshot label=$LABEL"
bun run "$ROOT/tests/benchmarks/baseline-runner.ts" \
  --run-label "$LABEL" \
  --reranker "$RERANKER_MODE" \
  --output "$OUTPUT_PATH" >/dev/null
echo "[world1-baseline] wrote $OUTPUT_PATH"

BEFORE_PATH="$OUT_DIR/before.json"
AFTER_PATH="$OUT_DIR/after.json"
if [[ -f "$BEFORE_PATH" && -f "$AFTER_PATH" ]]; then
  if command -v jq >/dev/null 2>&1; then
    echo "[world1-baseline] before/after summary"
    jq -n \
      --slurpfile before "$BEFORE_PATH" \
      --slurpfile after "$AFTER_PATH" \
      '{
        recall_at_10: { before: $before[0].quality.recall_at_10, after: $after[0].quality.recall_at_10, delta: ($after[0].quality.recall_at_10 - $before[0].quality.recall_at_10) },
        mrr_at_10: { before: $before[0].quality.mrr_at_10, after: $after[0].quality.mrr_at_10, delta: ($after[0].quality.mrr_at_10 - $before[0].quality.mrr_at_10) },
        search_p95_ms: { before: $before[0].performance.search_latency_ms.p95, after: $after[0].performance.search_latency_ms.p95, delta: ($after[0].performance.search_latency_ms.p95 - $before[0].performance.search_latency_ms.p95) },
        token_reduction_ratio: { before: $before[0].token_efficiency.reduction_ratio, after: $after[0].token_efficiency.reduction_ratio, delta: ($after[0].token_efficiency.reduction_ratio - $before[0].token_efficiency.reduction_ratio) }
      }'
  else
    echo "[world1-baseline] jq not found; skip before/after summary"
  fi
fi
