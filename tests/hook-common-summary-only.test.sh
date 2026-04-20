#!/usr/bin/env bash
# hook-common-summary-only.test.sh — §90-002 follow-up (harness-mem #70)
# Unit tests for hook_extract_meta_summary and hook_fetch_resume_pack_summary_only.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_COMMON="${SCRIPT_DIR}/../scripts/hook-handlers/lib/hook-common.sh"

PASS=0
FAIL=0

# shellcheck source=/dev/null
source "$HOOK_COMMON"

assert_eq() {
  local actual="$1"
  local expected="$2"
  local name="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name"
    echo "    expected: $expected"
    echo "    actual:   $actual"
    FAIL=$((FAIL + 1))
  fi
}

assert_empty() {
  local actual="$1"
  local name="$2"
  if [ -z "$actual" ]; then
    echo "  PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name (expected empty, got: '$actual')"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== hook_extract_meta_summary tests ==="

# Test 1: summary_only=true shape response
RESP_WITH_SUMMARY='{"ok":true,"source":"core","items":[],"meta":{"summary_only":true,"summary":"hello world","session_id":"sess-1","is_partial":false}}'
OUT="$(hook_extract_meta_summary "$RESP_WITH_SUMMARY")"
assert_eq "$OUT" "hello world" "extracts meta.summary from summary_only response"

# Test 2: partial=true shape
RESP_PARTIAL='{"ok":true,"source":"core","items":[],"meta":{"summary_only":true,"summary":"partial summary","session_id":"sess-2","is_partial":true}}'
OUT="$(hook_extract_meta_summary "$RESP_PARTIAL")"
assert_eq "$OUT" "partial summary" "extracts partial summary"

# Test 3: empty summary case
RESP_EMPTY='{"ok":true,"source":"core","items":[],"meta":{"summary_only":true,"summary":"","session_id":null,"is_partial":false}}'
OUT="$(hook_extract_meta_summary "$RESP_EMPTY")"
assert_empty "$OUT" "empty summary returns empty string"

# Test 4: legacy full response (no meta.summary key) — should be empty
RESP_LEGACY='{"ok":true,"source":"core","items":[{"type":"session_summary","summary":"legacy"}],"meta":{"count":1,"latency_ms":42}}'
OUT="$(hook_extract_meta_summary "$RESP_LEGACY")"
assert_empty "$OUT" "legacy full response without meta.summary returns empty"

# Test 5: empty input
OUT="$(hook_extract_meta_summary "")"
assert_empty "$OUT" "empty input returns empty"

# Test 6: malformed JSON — should not crash
OUT="$(hook_extract_meta_summary "not-json-at-all" 2>/dev/null || true)"
assert_empty "$OUT" "malformed JSON returns empty"

# Test 7: python3 fallback (simulate jq absence in a subshell)
OUT="$(
  jq() { return 127; }
  command() {
    if [ "$1" = "-v" ] && [ "$2" = "jq" ]; then return 1; fi
    builtin command "$@"
  }
  hook_extract_meta_summary "$RESP_WITH_SUMMARY"
)"
assert_eq "$OUT" "hello world" "python3 fallback works when jq absent"

# Test 8: summary with newlines
RESP_MULTILINE='{"ok":true,"meta":{"summary":"line1\nline2\nline3","session_id":"s"}}'
OUT="$(hook_extract_meta_summary "$RESP_MULTILINE")"
assert_eq "$OUT" "$(printf 'line1\nline2\nline3')" "multiline summary preserved"

echo ""
echo "=== Summary: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
