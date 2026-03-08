#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATASET_PATH="$ROOT_DIR/tests/benchmarks/fixtures/japanese-release-pack-32.json"
ARTIFACT_DIR="$ROOT_DIR/docs/benchmarks/artifacts/s40-ja-release-latest"
LABEL="ja-release-pack"
TIMESTAMP="$(date -u +"%Y%m%dT%H%M%SZ")"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dataset)
      DATASET_PATH="$2"
      shift 2
      ;;
    --artifact-dir)
      ARTIFACT_DIR="$2"
      shift 2
      ;;
    --label)
      LABEL="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

case "$DATASET_PATH" in
  /*) ;;
  *) DATASET_PATH="$ROOT_DIR/$DATASET_PATH" ;;
esac
case "$ARTIFACT_DIR" in
  /*) ;;
  *) ARTIFACT_DIR="$ROOT_DIR/$ARTIFACT_DIR" ;;
esac
DATASET_PATH="$(cd "$(dirname "$DATASET_PATH")" && pwd -P)/$(basename "$DATASET_PATH")"
ARTIFACT_DIR="$(cd "$(dirname "$ARTIFACT_DIR")" && pwd -P)/$(basename "$ARTIFACT_DIR")"
RUNS_TSV="$ARTIFACT_DIR/runs.tsv"
REPRO_REPORT="$ARTIFACT_DIR/repro-report.json"
SUMMARY_MD="$ARTIFACT_DIR/summary.md"

rm -rf "$ARTIFACT_DIR"
mkdir -p "$ARTIFACT_DIR"
echo -e "run\toverall_f1\tcross_lingual_f1\tzero_f1" > "$RUNS_TSV"

echo "[ja-freeze] label=$LABEL"
echo "[ja-freeze] dataset=$DATASET_PATH"
echo "[ja-freeze] artifact_dir=$ARTIFACT_DIR"

for i in 1 2 3; do
  RUN_DIR="$ARTIFACT_DIR/run${i}"
  mkdir -p "$RUN_DIR"

  RESULT_JSON="$RUN_DIR/result.json"
  SCORE_JSON="$RUN_DIR/score-report.json"
  SLICE_JSON="$RUN_DIR/slice-report.json"
  BACKLOG_JSON="$RUN_DIR/failure-backlog.json"
  BACKLOG_MD="$RUN_DIR/failure-backlog.md"
  RISK_MD="$RUN_DIR/risk-notes.md"
  COMPANION_JSON="$RUN_DIR/companion-gate.json"

  echo "[ja-freeze] run ${i}/3"
  (
    cd "$ROOT_DIR"
    bun run tests/benchmarks/run-locomo-benchmark.ts \
      --system harness-mem \
      --dataset "$DATASET_PATH" \
      --output "$RESULT_JSON"
  )

  (
    cd "$ROOT_DIR"
    bun run tests/benchmarks/locomo-score-report.ts \
      --result "$RESULT_JSON" \
      --output "$SCORE_JSON"
  ) >/dev/null

  (
    cd "$ROOT_DIR"
    bun run tests/benchmarks/japanese-release-report.ts \
      --dataset "$DATASET_PATH" \
      --result "$RESULT_JSON" \
      --output "$SLICE_JSON"
  ) >/dev/null

  (
    cd "$ROOT_DIR"
    bun run tests/benchmarks/locomo-failure-backlog.ts \
      --result "$RESULT_JSON" \
      --limit 50 \
      --output "$BACKLOG_JSON" \
      --markdown-output "$BACKLOG_MD"
  ) >/dev/null

  (
    cd "$ROOT_DIR"
    bun run tests/benchmarks/japanese-companion-gate.ts \
      --dataset "$DATASET_PATH" \
      --result "$RESULT_JSON" \
      --slice-report "$SLICE_JSON" \
      --output "$COMPANION_JSON"
  ) >/dev/null

  overall_f1="$(jq -r '.summary.overall.f1_avg' "$SLICE_JSON")"
  cross_f1="$(jq -r '.summary.cross_lingual.f1_avg' "$SLICE_JSON")"
  zero_f1="$(jq -r '.summary.overall.zero_f1_count' "$SLICE_JSON")"
  missing_metadata="$(jq -r '.summary.missing_metadata | length' "$SLICE_JSON")"

  cat > "$RISK_MD" <<RISK
# Run ${i} Risk Notes

- timestamp: ${TIMESTAMP}
- overall_f1: ${overall_f1}
- cross_lingual_f1: ${cross_f1}
- zero_f1_count: ${zero_f1}
- missing_metadata: ${missing_metadata}
- residual_risks:
  - current vs previous の取り違え
  - why/list の短答圧縮
  - README claim ceiling を超える表現
RISK

  echo -e "${i}\t${overall_f1}\t${cross_f1}\t${zero_f1}" >> "$RUNS_TSV"
done

(
  cd "$ROOT_DIR"
  bun run tests/benchmarks/locomo-repro-report.ts \
    --reports "$ARTIFACT_DIR/run1/score-report.json,$ARTIFACT_DIR/run2/score-report.json,$ARTIFACT_DIR/run3/score-report.json" \
    --output "$REPRO_REPORT"
) >/dev/null

overall_mean="$(awk -F'\t' 'NR>1 {s+=$2; c++} END {if (c>0) printf "%.4f", s/c; else print "0.0000"}' "$RUNS_TSV")"
cross_mean="$(awk -F'\t' 'NR>1 {s+=$3; c++} END {if (c>0) printf "%.4f", s/c; else print "0.0000"}' "$RUNS_TSV")"
zero_mean="$(awk -F'\t' 'NR>1 {s+=$4; c++} END {if (c>0) printf "%.2f", s/c; else print "0.00"}' "$RUNS_TSV")"

cat > "$SUMMARY_MD" <<EOF2
# Japanese Release Pack Summary

- generated_at: ${TIMESTAMP}
- label: ${LABEL}
- dataset: ${DATASET_PATH}
- runs: 3
- overall_f1_mean: ${overall_mean}
- cross_lingual_f1_mean: ${cross_mean}
- zero_f1_mean: ${zero_mean}

## Artifacts

- run1:
  - result.json
  - score-report.json
  - slice-report.json
  - failure-backlog.json / .md
  - risk-notes.md
- run2: same as run1
- run3: same as run1
- repro-report.json

## Notes

- This release pack is the README claim gate supplementary evidence, not a ship/no-ship replacement.
- Main gate remains \`run-ci\`.
EOF2

echo "[ja-freeze] done -> $ARTIFACT_DIR"
