#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEFAULT_REPO_PATH="${SWEBENCH_PRO_REPO_PATH:-../SWE-bench_Pro-os}"
REPO_PATH="$DEFAULT_REPO_PATH"
SUBSET_MANIFEST="smoke"
MODE="on-off"
RUNNER="local-docker"
MODEL="gpt-5-mini"
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: scripts/bench-swebench-pro.sh [options]

Options:
  --repo-path PATH          External SWE-bench Pro repo path (default: ../SWE-bench_Pro-os or $SWEBENCH_PRO_REPO_PATH)
  --subset-manifest PATH    Subset manifest to run (default: smoke)
  --mode on|off|on-off      Memory mode to run (default: on-off)
  --runner local-docker|modal  Runner backend (default: local-docker)
  --model NAME              Model identifier to compare (default: gpt-5-mini)
  --dry-run                 Print required conditions and recommended commands only
  --help                    Show this help

Environment:
  SWEBENCH_PRO_REPO_PATH    Default external repo path
  SWEBENCH_PRO_EXECUTE=1    Opt in to running the external command when the repo exists
  SWEBENCH_PRO_RUNNER_CMD   Runner command inside the external repo (default: "uv run swebench-pro run")
EOF
}

resolve_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s\n' "$ROOT_DIR/$1" ;;
  esac
}

print_plan() {
  local repo_display="$1"
  local repo_exists="$2"
  local runner_cmd="${SWEBENCH_PRO_RUNNER_CMD:-uv run swebench-pro run}"

  echo "[swebench-pro] external benchmark entry point"
  echo "[swebench-pro] repo path: $repo_display"
  echo "[swebench-pro] subset manifest: $SUBSET_MANIFEST"
  echo "[swebench-pro] mode: $MODE"
  echo "[swebench-pro] runner: $RUNNER"
  echo "[swebench-pro] model: $MODEL"
  echo "[swebench-pro] dry-run: ${DRY_RUN}"
  echo "[swebench-pro] repo exists: $repo_exists"
  echo "[swebench-pro] required conditions: SWE-bench Pro checkout, Docker or Modal access, fixed model/provider, immutable subset manifest"
  echo "[swebench-pro] fixed controls: keep repo path, subset manifest, runner, model, and mode unchanged across comparisons"
  echo "[swebench-pro] recommended command(s):"

  if [ "$MODE" = "on-off" ]; then
    printf '  cd %s && %s --subset-manifest %s --runner %s --model %s --mode off\n' \
      "$repo_display" "$runner_cmd" "$SUBSET_MANIFEST" "$RUNNER" "$MODEL"
    printf '  cd %s && %s --subset-manifest %s --runner %s --model %s --mode on\n' \
      "$repo_display" "$runner_cmd" "$SUBSET_MANIFEST" "$RUNNER" "$MODEL"
  else
    printf '  cd %s && %s --subset-manifest %s --runner %s --model %s --mode %s\n' \
      "$repo_display" "$runner_cmd" "$SUBSET_MANIFEST" "$RUNNER" "$MODEL" "$MODE"
  fi
}

run_command() {
  local repo_abs="$1"
  local runner_cmd="${SWEBENCH_PRO_RUNNER_CMD:-uv run swebench-pro run}"
  local -a runner_parts=()
  read -r -a runner_parts <<< "$runner_cmd"

  if [ "$MODE" = "on-off" ]; then
    for run_mode in off on; do
      echo "[swebench-pro] executing mode=${run_mode}"
      "${runner_parts[@]}" --subset-manifest "$SUBSET_MANIFEST" --runner "$RUNNER" --model "$MODEL" --mode "$run_mode"
    done
  else
    echo "[swebench-pro] executing mode=${MODE}"
    "${runner_parts[@]}" --subset-manifest "$SUBSET_MANIFEST" --runner "$RUNNER" --model "$MODEL" --mode "$MODE"
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo-path)
      REPO_PATH="${2:-}"
      shift 2
      ;;
    --subset-manifest)
      SUBSET_MANIFEST="${2:-}"
      shift 2
      ;;
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --runner)
      RUNNER="${2:-}"
      shift 2
      ;;
    --model)
      MODEL="${2:-}"
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
      echo "[swebench-pro] unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

case "$MODE" in
  on|off|on-off) ;;
  *)
    echo "[swebench-pro] invalid mode: $MODE" >&2
    exit 1
    ;;
esac

case "$RUNNER" in
  local-docker|modal) ;;
  *)
    echo "[swebench-pro] invalid runner: $RUNNER" >&2
    exit 1
    ;;
esac

if [ -z "$SUBSET_MANIFEST" ]; then
  echo "[swebench-pro] subset manifest is required" >&2
  exit 1
fi

REPO_PATH="$(resolve_path "$REPO_PATH")"
if [ -d "$REPO_PATH" ]; then
  REPO_PATH="$(cd "$REPO_PATH" && pwd -P)"
fi

if [ "$DRY_RUN" -eq 1 ]; then
  print_plan "$REPO_PATH" "$( [ -d "$REPO_PATH" ] && echo yes || echo no )"
  exit 0
fi

if [ "${SWEBENCH_PRO_EXECUTE:-0}" != "1" ]; then
  echo "[swebench-pro] execution is opt-in; set SWEBENCH_PRO_EXECUTE=1 to run the external command."
  print_plan "$REPO_PATH" "$( [ -d "$REPO_PATH" ] && echo yes || echo no )"
  exit 0
fi

if [ ! -d "$REPO_PATH" ]; then
  echo "[swebench-pro] repo path not found; falling back to dry-run." >&2
  print_plan "$REPO_PATH" no
  exit 0
fi

cd "$REPO_PATH"
run_command "$REPO_PATH"
