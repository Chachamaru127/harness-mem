#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEFAULT_REPO_PATH="${TAU3_REPO_PATH:-../tau2-bench}"
REPO_PATH="$DEFAULT_REPO_PATH"
DOMAIN="retail"
TASK_SPLIT_NAME="base"
NUM_TASKS="10"
NUM_TRIALS="1"
MODE="on-off"
AGENT_LLM="gpt-5-mini"
USER_LLM="gemini/gemini-2.5-flash-lite"
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: scripts/bench-tau3.sh [options]

Options:
  --repo-path PATH      External tau3 repo path (default: ../tau2-bench or $TAU3_REPO_PATH)
  --domain NAME         Domain to run (default: retail)
  --task-split-name NAME
                        Task split to run (default: base)
  --split NAME          Deprecated alias for --task-split-name
  --num-tasks N         Number of tasks to sample (default: 10)
  --num-trials N        Number of trials (default: 1)
  --agent-llm NAME      Agent model identifier (default: gpt-5-mini)
  --user-llm NAME       User simulator model identifier (default: gemini/gemini-2.5-flash-lite)
  --mode on|off|on-off  Wrapper-level comparison mode (default: on-off)
  --dry-run             Print required conditions and recommended commands only
  --help                Show this help

Environment:
  TAU3_REPO_PATH        Default external repo path
  TAU3_EXECUTE=1        Opt in to running the external command when the repo exists
  TAU3_RUNNER_CMD       Runner command inside the external repo
                        (default: "uv run python <repo>/scripts/bench-tau3-runner.py")
  HARNESS_MEM_BENCH_MODE
                        Exported as off/on for the child process so a custom runner can wire
                        harness-mem injection without changing the other controls
EOF
}

resolve_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s\n' "$ROOT_DIR/$1" ;;
  esac
}

default_runner_cmd() {
  printf 'uv run python %s --tau3-repo-path %s --agent-llm %s --user-llm %s' \
    "$ROOT_DIR/scripts/bench-tau3-runner.py" "$REPO_PATH" "$AGENT_LLM" "$USER_LLM"
}

print_plan() {
  local repo_display="$1"
  local repo_exists="$2"
  local runner_cmd="${TAU3_RUNNER_CMD:-$(default_runner_cmd)}"

  echo "[tau3] external benchmark entry point"
  echo "[tau3] repo path: $repo_display"
  echo "[tau3] domain: $DOMAIN"
  echo "[tau3] task split: $TASK_SPLIT_NAME"
  echo "[tau3] num-tasks: $NUM_TASKS"
  echo "[tau3] num-trials: $NUM_TRIALS"
  echo "[tau3] agent-llm: $AGENT_LLM"
  echo "[tau3] user-llm: $USER_LLM"
  echo "[tau3] mode: $MODE"
  echo "[tau3] dry-run: ${DRY_RUN}"
  echo "[tau3] repo exists: $repo_exists"
  echo "[tau3] required conditions: tau3 repo checkout, Python 3.12+, uv, external provider/API keys, fixed prompt/model config"
  echo "[tau3] fixed controls: keep repo path, domain, task split, num-tasks, num-trials, model, prompt, and retries unchanged across comparisons"
  echo "[tau3] comparison note: --mode is a wrapper concept. The tau2 CLI does not natively expose memory on/off, so the runner must consume HARNESS_MEM_BENCH_MODE (or an equivalent custom hook) to make the on/off pair meaningful."
  echo "[tau3] recommended command(s):"

  if [ "$MODE" = "on-off" ]; then
    printf '  cd %s && HARNESS_MEM_BENCH_MODE=off %s --mode off --domain %s --task-split-name %s --num-tasks %s --num-trials %s --save-to harness-mem-off-%s-%s-%stasks-%strials\n' \
      "$repo_display" "$runner_cmd" "$DOMAIN" "$TASK_SPLIT_NAME" "$NUM_TASKS" "$NUM_TRIALS" "$DOMAIN" "$TASK_SPLIT_NAME" "$NUM_TASKS" "$NUM_TRIALS"
    printf '  cd %s && HARNESS_MEM_BENCH_MODE=on %s --mode on --domain %s --task-split-name %s --num-tasks %s --num-trials %s --save-to harness-mem-on-%s-%s-%stasks-%strials\n' \
      "$repo_display" "$runner_cmd" "$DOMAIN" "$TASK_SPLIT_NAME" "$NUM_TASKS" "$NUM_TRIALS" "$DOMAIN" "$TASK_SPLIT_NAME" "$NUM_TASKS" "$NUM_TRIALS"
  else
    printf '  cd %s && HARNESS_MEM_BENCH_MODE=%s %s --mode %s --domain %s --task-split-name %s --num-tasks %s --num-trials %s --save-to harness-mem-%s-%s-%s-%stasks-%strials\n' \
      "$repo_display" "$MODE" "$runner_cmd" "$MODE" "$DOMAIN" "$TASK_SPLIT_NAME" "$NUM_TASKS" "$NUM_TRIALS" "$MODE" "$DOMAIN" "$TASK_SPLIT_NAME" "$NUM_TASKS" "$NUM_TRIALS"
  fi
}

run_command() {
  local runner_cmd="${TAU3_RUNNER_CMD:-$(default_runner_cmd)}"
  local -a runner_parts=()
  read -r -a runner_parts <<< "$runner_cmd"

  if [ "$MODE" = "on-off" ]; then
    for run_mode in off on; do
      echo "[tau3] executing mode=${run_mode}"
      HARNESS_MEM_BENCH_MODE="$run_mode" \
        "${runner_parts[@]}" \
          --mode "$run_mode" \
          --domain "$DOMAIN" \
          --task-split-name "$TASK_SPLIT_NAME" \
          --num-tasks "$NUM_TASKS" \
          --num-trials "$NUM_TRIALS" \
          --save-to "harness-mem-${run_mode}-${DOMAIN}-${TASK_SPLIT_NAME}-${NUM_TASKS}tasks-${NUM_TRIALS}trials"
    done
  else
    echo "[tau3] executing mode=${MODE}"
    HARNESS_MEM_BENCH_MODE="$MODE" \
      "${runner_parts[@]}" \
        --mode "$MODE" \
        --domain "$DOMAIN" \
        --task-split-name "$TASK_SPLIT_NAME" \
        --num-tasks "$NUM_TASKS" \
        --num-trials "$NUM_TRIALS" \
        --save-to "harness-mem-${MODE}-${DOMAIN}-${TASK_SPLIT_NAME}-${NUM_TASKS}tasks-${NUM_TRIALS}trials"
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo-path)
      REPO_PATH="${2:-}"
      shift 2
      ;;
    --domain)
      DOMAIN="${2:-}"
      shift 2
      ;;
    --task-split-name|--split)
      TASK_SPLIT_NAME="${2:-}"
      shift 2
      ;;
    --num-tasks)
      NUM_TASKS="${2:-}"
      shift 2
      ;;
    --num-trials)
      NUM_TRIALS="${2:-}"
      shift 2
      ;;
    --agent-llm)
      AGENT_LLM="${2:-}"
      shift 2
      ;;
    --user-llm)
      USER_LLM="${2:-}"
      shift 2
      ;;
    --mode)
      MODE="${2:-}"
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
      echo "[tau3] unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

case "$MODE" in
  on|off|on-off) ;;
  *)
    echo "[tau3] invalid mode: $MODE" >&2
    exit 1
    ;;
esac

REPO_PATH="$(resolve_path "$REPO_PATH")"
if [ -d "$REPO_PATH" ]; then
  REPO_PATH="$(cd "$REPO_PATH" && pwd -P)"
fi

if [ "$DRY_RUN" -eq 1 ]; then
  print_plan "$REPO_PATH" "$( [ -d "$REPO_PATH" ] && echo yes || echo no )"
  exit 0
fi

if [ "${TAU3_EXECUTE:-0}" != "1" ]; then
  echo "[tau3] execution is opt-in; set TAU3_EXECUTE=1 to run the external command."
  print_plan "$REPO_PATH" "$( [ -d "$REPO_PATH" ] && echo yes || echo no )"
  exit 0
fi

if [ ! -d "$REPO_PATH" ]; then
  echo "[tau3] repo path not found; falling back to dry-run." >&2
  print_plan "$REPO_PATH" no
  exit 0
fi

cd "$REPO_PATH"
run_command
