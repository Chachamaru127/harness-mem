#!/usr/bin/env bash
# gemini-hook-handler.test.sh — Unit tests for memory-gemini-event.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HANDLER="${SCRIPT_DIR}/../scripts/hook-handlers/memory-gemini-event.sh"
PASS=0
FAIL=0

assert_contains() {
  local output="$1"
  local expected="$2"
  local test_name="$3"
  if echo "$output" | grep -q "$expected"; then
    echo "  PASS: $test_name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $test_name (expected '$expected' in output)"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Gemini Hook Handler Tests ==="

# Test 1: SessionStart produces valid JSON output
echo "--- Test 1: SessionStart event ---"
OUTPUT=$(echo '{"session_id":"test-123"}' | \
  GEMINI_SESSION_ID="test-session-1" \
  GEMINI_PROJECT_DIR="/tmp/test-project" \
  HARNESS_MEM_HOST="127.0.0.1" \
  HARNESS_MEM_PORT="99999" \
  bash "$HANDLER" SessionStart 2>/dev/null || true)
assert_contains "$OUTPUT" "{}" "Returns empty JSON"

# Test 2: Script is executable
echo "--- Test 2: Script permissions ---"
if [ -x "$HANDLER" ]; then
  echo "  PASS: Script is executable"
  PASS=$((PASS + 1))
else
  echo "  FAIL: Script is not executable"
  FAIL=$((FAIL + 1))
fi

# Test 3: Script passes bash syntax check
echo "--- Test 3: Syntax check ---"
if bash -n "$HANDLER" 2>/dev/null; then
  echo "  PASS: Bash syntax OK"
  PASS=$((PASS + 1))
else
  echo "  FAIL: Bash syntax error"
  FAIL=$((FAIL + 1))
fi

# Test 4: All event types are handled
echo "--- Test 4: Event type mapping ---"
for event in SessionStart SessionEnd AfterTool PreCompress BeforeAgent; do
  OUTPUT=$(echo '{}' | \
    GEMINI_SESSION_ID="test-$$" \
    GEMINI_PROJECT_DIR="/tmp/test" \
    HARNESS_MEM_HOST="127.0.0.1" \
    HARNESS_MEM_PORT="99999" \
    bash "$HANDLER" "$event" 2>/dev/null || true)
  assert_contains "$OUTPUT" "{}" "Event $event returns JSON"
done

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
