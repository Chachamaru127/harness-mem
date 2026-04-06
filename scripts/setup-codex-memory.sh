#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "$ROOT_DIR"

echo "[harness-mem] Repo-local Codex bootstrap: setup --platform codex"
node scripts/harness-mem.js setup --platform codex

echo "[harness-mem] Repo-local Codex bootstrap: doctor --platform codex"
node scripts/harness-mem.js doctor --platform codex
