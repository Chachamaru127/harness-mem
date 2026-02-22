#!/bin/bash
# proof-pack.sh — thin wrapper around harness-mem-proof-pack.sh (SSOT)
#
# This script delegates all logic to harness-mem-proof-pack.sh.
# Options (--out-dir, --skip-smoke, --skip-latency, --output-dir) are forwarded as-is.
#
# Usage:
#   scripts/proof-pack.sh [--out-dir <dir>] [--skip-smoke] [--skip-latency]

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

SSOT="${SCRIPT_DIR}/harness-mem-proof-pack.sh"

if [ ! -x "$SSOT" ]; then
  echo "[proof-pack] ERROR: SSOT script not found: ${SSOT}" >&2
  exit 1
fi

# Translate legacy --output-dir to --out-dir
ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir) ARGS+=("--out-dir"); shift ;;
    *)            ARGS+=("$1"); shift ;;
  esac
done

exec "$SSOT" "${ARGS[@]}"
