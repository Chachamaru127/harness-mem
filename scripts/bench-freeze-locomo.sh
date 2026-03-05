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
  echo "[freeze] run ${i}/3 -> $LOG_PATH"

  (
    cd "$ROOT_DIR/memory-server"
    bun run src/benchmark/run-ci.ts
  ) 2>&1 | tee "$LOG_PATH"

  if rg -n --pcre2 "$PANIC_PATTERN" "$LOG_PATH" | rg -v "panic_markers=" >/dev/null; then
    echo "[freeze] panic marker detected in $LOG_PATH"
    exit 1
  fi

  if rg -n "mode=fallback|strict ONNX-only mode violated" "$LOG_PATH" >/dev/null; then
    echo "[freeze] invalid embedding mode detected in $LOG_PATH"
    exit 1
  fi

  locomo_f1="$(rg -o "F1=[0-9.]+$" "$LOG_PATH" | head -n1 | sed 's/F1=//')"
  cat2_f1="$(rg -o "cat-2 gate PASSED: f1=[0-9.]+" "$LOG_PATH" | head -n1 | sed 's/.*f1=//')"
  cat3_f1="$(rg -o "cat-3 gate PASSED: f1=[0-9.]+" "$LOG_PATH" | head -n1 | sed 's/.*f1=//')"
  bilingual="$(rg -o "bilingual-50 recall@10: [0-9.]+" "$LOG_PATH" | head -n1 | awk '{print $3}')"
  freshness="$(rg -o "Freshness@K: [0-9.]+" "$LOG_PATH" | head -n1 | awk '{print $2}')"
  temporal="$(rg -o "temporal-100 Order Score: [0-9.]+" "$LOG_PATH" | head -n1 | awk '{print $4}')"

  if [ -z "${locomo_f1}" ] || [ -z "${cat2_f1}" ] || [ -z "${cat3_f1}" ] || [ -z "${bilingual}" ] || [ -z "${freshness}" ] || [ -z "${temporal}" ]; then
    echo "[freeze] failed to parse metrics from $LOG_PATH"
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
