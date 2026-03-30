#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SAFE_RUNNER="${SCRIPT_DIR}/run-bun-test-safe.sh"

MODE="raw"
declare -a TARGETS=()

usage() {
  cat <<'EOF'
Usage:
  bash scripts/repro-bun-panic.sh [--raw|--safe] [test-file ...]

Examples:
  bash scripts/repro-bun-panic.sh --raw
  bash scripts/repro-bun-panic.sh --raw tests/benchmarks/cross-tool-transfer.test.ts
  bash scripts/repro-bun-panic.sh --safe tests/benchmarks/cross-tool-transfer.test.ts

Default targets:
  tests/benchmarks/cross-tool-transfer.test.ts
  tests/benchmarks/locomo-runner-smoke.test.ts
EOF
}

while (($# > 0)); do
  case "$1" in
    --raw)
      MODE="raw"
      shift
      ;;
    --safe)
      MODE="safe"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      TARGETS+=("$1")
      shift
      ;;
  esac
done

if [ ${#TARGETS[@]} -eq 0 ]; then
  TARGETS=(
    "tests/benchmarks/cross-tool-transfer.test.ts"
    "tests/benchmarks/locomo-runner-smoke.test.ts"
  )
fi

cd "${ROOT_DIR}"

echo "[bun-panic-repro] mode=${MODE}"
echo "[bun-panic-repro] bun=$(bun --version)"
echo "[bun-panic-repro] git=$(git rev-parse --short HEAD)"

for target in "${TARGETS[@]}"; do
  echo
  echo "==> ${target}"
  if [ "${MODE}" = "safe" ]; then
    bash "${SAFE_RUNNER}" "${target}"
  else
    bun test "${target}"
  fi
done
