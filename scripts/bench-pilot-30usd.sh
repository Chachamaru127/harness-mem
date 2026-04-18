#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TAU3_REPO_PATH="${TAU3_REPO_PATH:-../tau2-bench}"
SWEBENCH_REPO_PATH="${SWEBENCH_PRO_REPO_PATH:-../SWE-bench_Pro-os}"
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: scripts/bench-pilot-30usd.sh [options]

Options:
  --tau3-repo-path PATH       External tau3 repo path (default: ../tau2-bench or $TAU3_REPO_PATH)
  --swebench-repo-path PATH   External SWE-bench Pro repo path (default: ../SWE-bench_Pro-os or $SWEBENCH_PRO_REPO_PATH)
  --dry-run                   Print the 30 USD pilot sequence and recommended commands
  --help                      Show this help

Notes:
  - This wrapper is intentionally planning-first. It does not auto-run paid API benchmark phases.
  - The pilot assumes direct API only. Do not use OpenRouter or OpenCode in this sequence.
EOF
}

resolve_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s\n' "$ROOT_DIR/$1" ;;
  esac
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --tau3-repo-path)
      TAU3_REPO_PATH="${2:-}"
      shift 2
      ;;
    --swebench-repo-path)
      SWEBENCH_REPO_PATH="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "[pilot30] unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

TAU3_REPO_PATH="$(resolve_path "$TAU3_REPO_PATH")"
SWEBENCH_REPO_PATH="$(resolve_path "$SWEBENCH_REPO_PATH")"

cat <<EOF
[pilot30] direct-API single pilot
[pilot30] budget cap: 30 USD
[pilot30] providers: direct API only
[pilot30] excluded: OpenRouter, OpenCode, NoLiMa
[pilot30] tau3 repo: $TAU3_REPO_PATH
[pilot30] swebench repo: $SWEBENCH_REPO_PATH

[pilot30] budget allocation
  phase0 preflight: 0 USD
  phase1 tau3 smoke: 3 USD
  phase2 swebench smoke: 7 USD
  phase3 tau3 compare: 8 USD
  phase4 swebench compare: 10 USD
  reserve: 2 USD

[pilot30] models
  tau3 agent: gpt-5-mini
  tau3 simulator: gemini/gemini-2.5-flash-lite
  swebench-pro agent: gpt-5-mini

[pilot30] phase commands
  phase0:
    npm run benchmark:tau3:dry-run
    npm run benchmark:swebench-pro:dry-run
  phase1:
    bash scripts/bench-tau3.sh --repo-path "$TAU3_REPO_PATH" --domain retail --task-split-name base --num-tasks 5 --num-trials 1 --mode on-off --dry-run
  phase2:
    bash scripts/bench-swebench-pro.sh --repo-path "$SWEBENCH_REPO_PATH" --subset-manifest pilot-smoke-5 --runner local-docker --model gpt-5-mini --mode on-off --dry-run
  phase3:
    bash scripts/bench-tau3.sh --repo-path "$TAU3_REPO_PATH" --domain retail --task-split-name base --num-tasks 5 --num-trials 1 --mode on-off --dry-run
    bash scripts/bench-tau3.sh --repo-path "$TAU3_REPO_PATH" --domain airline --task-split-name base --num-tasks 5 --num-trials 1 --mode on-off --dry-run
    bash scripts/bench-tau3.sh --repo-path "$TAU3_REPO_PATH" --domain telecom --task-split-name base --num-tasks 5 --num-trials 1 --mode on-off --dry-run
  phase4:
    bash scripts/bench-swebench-pro.sh --repo-path "$SWEBENCH_REPO_PATH" --subset-manifest pilot-compare-8 --runner local-docker --model gpt-5-mini --mode on-off --dry-run

[pilot30] stop rules
  - stop when a phase exceeds its budget cap
  - stop when on/off controls are no longer identical except for memory injection
  - stop when the reserve is exhausted
EOF

if [ "$DRY_RUN" -eq 1 ]; then
  exit 0
fi

echo
echo "[pilot30] This wrapper intentionally does not auto-run paid phases."
echo "[pilot30] Use the commands above after confirming direct API keys and external repos."
