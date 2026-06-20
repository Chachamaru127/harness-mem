#!/usr/bin/env bash
# check-transformers-version.sh
#
# Postinstall guard: fail if @huggingface/transformers resolves to an
# unsupported major version. §77 (2026-04-10) で silent version drift が
# bilingual_recall 回帰 (0.90 → 0.88) を起こしたため major を pin する。
# §154-720 (2026-06-19) で 3.x → 4.x へ bump、e5-small parity 完全一致
# (worst_cosine=1.0, drift < 1e-6) を s154-e5-parity-check.ts で確認後に
# MAJOR_ALLOWED を 4 に更新。
#
# Usage: bash scripts/check-transformers-version.sh
#        (also called via postinstall in package.json if wired up)

set -euo pipefail

MAJOR_ALLOWED="4"
PKG_JSON="node_modules/@huggingface/transformers/package.json"

if [ ! -f "$PKG_JSON" ]; then
  echo "[transformers-pin] SKIP: $PKG_JSON not found (node_modules not installed yet)" >&2
  exit 0
fi

ACTUAL=$(node -e "process.stdout.write(require('./$PKG_JSON').version)" 2>/dev/null || echo "unknown")
ACTUAL_MAJOR="${ACTUAL%%.*}"

if [ "$ACTUAL_MAJOR" != "$MAJOR_ALLOWED" ]; then
  echo "[transformers-pin] ERROR: @huggingface/transformers resolved to $ACTUAL but major $MAJOR_ALLOWED.x is required." >&2
  echo "[transformers-pin] Run: npm ci  (or: bun install --frozen-lockfile)" >&2
  echo "[transformers-pin] Background: §77 identified version drift as the root cause of bilingual_recall" >&2
  echo "[transformers-pin]   regression (0.90 → 0.88) and Alpha Recall@10 drop (0.6 → 0.4)." >&2
  echo "[transformers-pin] §154-720 (2026-06-19) bumped major 3.x → 4.x after e5-small parity verification." >&2
  exit 1
fi

echo "[transformers-pin] OK: @huggingface/transformers@$ACTUAL (major $MAJOR_ALLOWED.x pinned)"
