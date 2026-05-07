#!/bin/bash
# S108-003 retrieval ablation harness for dev-workflow-60.

set -euo pipefail

SCRIPT_SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SCRIPT_SOURCE" ]; do
  SCRIPT_SOURCE_DIR="$(cd -P "$(dirname "$SCRIPT_SOURCE")" && pwd)"
  SCRIPT_TARGET="$(readlink "$SCRIPT_SOURCE")"
  if [[ "$SCRIPT_TARGET" != /* ]]; then
    SCRIPT_SOURCE="${SCRIPT_SOURCE_DIR}/${SCRIPT_TARGET}"
  else
    SCRIPT_SOURCE="$SCRIPT_TARGET"
  fi
done

SCRIPT_DIR="$(cd -P "$(dirname "$SCRIPT_SOURCE")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

exec bun run "${ROOT}/scripts/s108-retrieval-ablation.ts" "$@"
