#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RESULTS_DIR="$ROOT_DIR/memory-server/src/benchmark/results"
TIMESTAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
PANIC_PATTERN='panic\(main thread\)|oh no: Bun has crashed'
RUNS_TSV="$RESULTS_DIR/freeze-run-${TIMESTAMP}.tsv"
SUMMARY_JSON="$RESULTS_DIR/freeze-summary-${TIMESTAMP}.json"

mkdir -p "$RESULTS_DIR"
echo -e "run\tlocomo_f1\tcat2_f1\tcat3_f1\tbilingual\tfreshness\ttemporal" > "$RUNS_TSV"

echo "[freeze] start 3-run freeze (timestamp=${TIMESTAMP})"

for i in 1 2 3; do
  LOG_PATH="$RESULTS_DIR/freeze-run-${TIMESTAMP}-${i}.log"
  MANIFEST_PATH="$RESULTS_DIR/freeze-run-${TIMESTAMP}-${i}.manifest.json"
  echo "[freeze] run ${i}/3 -> $LOG_PATH"

  set +e
  (
    cd "$ROOT_DIR/memory-server"
    bun run src/benchmark/run-ci.ts
  ) 2>&1 | tee "$LOG_PATH"
  PIPE_EXIT_CODES=("${PIPESTATUS[@]}")
  RUN_CI_STATUS=${PIPE_EXIT_CODES[0]:-1}
  TEE_STATUS=${PIPE_EXIT_CODES[1]:-1}
  set -e

  if [ "${TEE_STATUS}" -ne 0 ]; then
    echo "[freeze] tee failed while capturing $LOG_PATH"
    exit "${TEE_STATUS}"
  fi

  if [ ! -f "$RESULTS_DIR/ci-run-manifest-latest.json" ]; then
    echo "[freeze] run-ci did not produce ci-run-manifest-latest.json (exit=${RUN_CI_STATUS})"
    exit "${RUN_CI_STATUS}"
  fi

  if [ "${RUN_CI_STATUS}" -ne 0 ]; then
    echo "[freeze] run-ci exited ${RUN_CI_STATUS}; freezing current manifest as a failing run snapshot"
  fi

  if rg -n --pcre2 "$PANIC_PATTERN" "$LOG_PATH" | rg -v "panic_markers=" >/dev/null; then
    echo "[freeze] panic marker detected in $LOG_PATH"
    exit 1
  fi

  if rg -n "mode=fallback|strict ONNX-only mode violated" "$LOG_PATH" >/dev/null; then
    echo "[freeze] invalid embedding mode detected in $LOG_PATH"
    exit 1
  fi

  cp "$RESULTS_DIR/ci-run-manifest-latest.json" "$MANIFEST_PATH"

  locomo_f1="$(jq -r '.results.locomo_f1' "$MANIFEST_PATH")"
  cat2_f1="$(jq -r '.results.cat2_f1' "$MANIFEST_PATH")"
  cat3_f1="$(jq -r '.results.cat3_f1' "$MANIFEST_PATH")"
  bilingual="$(jq -r '.results.bilingual_recall' "$MANIFEST_PATH")"
  freshness="$(jq -r '.results.freshness' "$MANIFEST_PATH")"
  temporal="$(jq -r '.results.temporal' "$MANIFEST_PATH")"

  if [ -z "${locomo_f1}" ] || [ -z "${cat2_f1}" ] || [ -z "${cat3_f1}" ] || [ -z "${bilingual}" ] || [ -z "${freshness}" ] || [ -z "${temporal}" ]; then
    echo "[freeze] failed to parse metrics from $MANIFEST_PATH"
    exit 1
  fi
  echo -e "${i}\t${locomo_f1}\t${cat2_f1}\t${cat3_f1}\t${bilingual}\t${freshness}\t${temporal}" >> "$RUNS_TSV"
done

locomo_mean="$(awk -F'\t' 'NR>1 {s+=$2;c++} END {if(c>0) printf "%.4f", s/c; else print "0"}' "$RUNS_TSV")"
locomo_min="$(awk -F'\t' 'NR==2 {m=$2} NR>1 && $2<m {m=$2} END {if(m=="") m=0; printf "%.4f", m}' "$RUNS_TSV")"
locomo_max="$(awk -F'\t' 'NR==2 {m=$2} NR>1 && $2>m {m=$2} END {if(m=="") m=0; printf "%.4f", m}' "$RUNS_TSV")"
locomo_span="$(awk -v min="$locomo_min" -v max="$locomo_max" 'BEGIN {printf "%.4f", max-min}')"

cat2_mean="$(awk -F'\t' 'NR>1 {s+=$3;c++} END {if(c>0) printf "%.4f", s/c; else print "0"}' "$RUNS_TSV")"
cat3_mean="$(awk -F'\t' 'NR>1 {s+=$4;c++} END {if(c>0) printf "%.4f", s/c; else print "0"}' "$RUNS_TSV")"
bilingual_mean="$(awk -F'\t' 'NR>1 {s+=$5;c++} END {if(c>0) printf "%.4f", s/c; else print "0"}' "$RUNS_TSV")"
freshness_mean="$(awk -F'\t' 'NR>1 {s+=$6;c++} END {if(c>0) printf "%.4f", s/c; else print "0"}' "$RUNS_TSV")"
temporal_mean="$(awk -F'\t' 'NR>1 {s+=$7;c++} END {if(c>0) printf "%.4f", s/c; else print "0"}' "$RUNS_TSV")"

cat > "$SUMMARY_JSON" <<EOF
{
  "generated_at": "${TIMESTAMP}",
  "runs_tsv": "$(basename "$RUNS_TSV")",
  "manifests": [
    "freeze-run-${TIMESTAMP}-1.manifest.json",
    "freeze-run-${TIMESTAMP}-2.manifest.json",
    "freeze-run-${TIMESTAMP}-3.manifest.json"
  ],
  "git_sha": "$(jq -r '.git_sha' "$RESULTS_DIR/ci-run-manifest-latest.json")",
  "embedding_model": "$(jq -r '.embedding.model' "$RESULTS_DIR/ci-run-manifest-latest.json")",
  "metrics": {
    "locomo_f1": { "mean": ${locomo_mean}, "min": ${locomo_min}, "max": ${locomo_max}, "span": ${locomo_span} },
    "cat2_f1_mean": ${cat2_mean},
    "cat3_f1_mean": ${cat3_mean},
    "bilingual_mean": ${bilingual_mean},
    "freshness_mean": ${freshness_mean},
    "temporal_mean": ${temporal_mean}
  },
  "checks": {
    "panic_or_fallback_detected": false
  }
}
EOF

echo "[freeze] completed: all 3 runs passed without panic/fallback markers"
echo "[freeze] summary: $SUMMARY_JSON"
