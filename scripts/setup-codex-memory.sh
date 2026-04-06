#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "$ROOT_DIR"

command -v node >/dev/null 2>&1 || { echo "[harness-mem] Error: node is required but not found on PATH"; exit 1; }
[ -f "$ROOT_DIR/scripts/harness-mem.js" ] || { echo "[harness-mem] Error: scripts/harness-mem.js not found — run from a full repo checkout"; exit 1; }

echo "[harness-mem] Repo-local Codex bootstrap: setup --platform codex"
node scripts/harness-mem.js setup --platform codex

echo "[harness-mem] Repo-local Codex bootstrap: doctor --platform codex"
node scripts/harness-mem.js doctor --platform codex
