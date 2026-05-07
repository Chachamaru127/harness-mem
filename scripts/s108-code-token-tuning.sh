#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec bun "$ROOT_DIR/scripts/s108-code-token-tuning.ts" "$@"
