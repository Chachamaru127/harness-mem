#!/usr/bin/env bash
# check-transformers-version.sh
#
# Postinstall guard: fail if @huggingface/transformers resolves to any version
# other than the pinned 3.8.1. This prevents silent version drift that caused
# the retrieval quality regression discovered in §77 (2026-04-10).
#
# Usage: bash scripts/check-transformers-version.sh
#        (also called via postinstall in package.json if wired up)

set -euo pipefail

EXPECTED="3.8.1"
PKG_JSON="node_modules/@huggingface/transformers/package.json"

if [ ! -f "$PKG_JSON" ]; then
  echo "[transformers-pin] SKIP: $PKG_JSON not found (node_modules not installed yet)" >&2
  exit 0
fi

ACTUAL=$(node -e "process.stdout.write(require('./$PKG_JSON').version)" 2>/dev/null || echo "unknown")

if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "[transformers-pin] ERROR: @huggingface/transformers resolved to $ACTUAL but $EXPECTED is required." >&2
  echo "[transformers-pin] Run: npm ci  (or: bun install --frozen-lockfile)" >&2
  echo "[transformers-pin] Background: §77 identified version drift as the root cause of bilingual_recall" >&2
  echo "[transformers-pin]   regression (0.90 → 0.88) and Alpha Recall@10 drop (0.6 → 0.4)." >&2
  exit 1
fi

echo "[transformers-pin] OK: @huggingface/transformers@$ACTUAL (pinned)"
