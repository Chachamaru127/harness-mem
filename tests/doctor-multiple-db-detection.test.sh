#!/usr/bin/env bash
# doctor-multiple-db-detection.test.sh — §93
# Unit tests for check_multiple_db_candidates() in scripts/harness-mem.
#
# Sources just the helper function from scripts/harness-mem (no daemon spawn,
# no network). Uses a temp HOME so the known candidate paths resolve to
# fixture files under test control.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS_BIN="${SCRIPT_DIR}/../scripts/harness-mem"

if [ ! -f "$HARNESS_BIN" ]; then
  echo "FATAL: ${HARNESS_BIN} not found" >&2
  exit 2
fi

PASS=0
FAIL=0

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local name="$3"
  if echo "$haystack" | grep -qF -- "$needle"; then
    echo "  PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name"
    echo "    needle:   $needle"
    echo "    haystack: $haystack"
    FAIL=$((FAIL + 1))
  fi
}

assert_not_contains() {
  local haystack="$1"
  local needle="$2"
  local name="$3"
  if echo "$haystack" | grep -qF -- "$needle"; then
    echo "  FAIL: $name"
    echo "    forbidden needle: $needle"
    echo "    haystack:         $haystack"
    FAIL=$((FAIL + 1))
  else
    echo "  PASS: $name"
    PASS=$((PASS + 1))
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

# Extract the check_multiple_db_candidates() function (plus its local helpers
# via function scope) from the harness-mem bash script and source it in a
# fresh subshell-safe block. We avoid sourcing the whole script because it
# has top-level side effects (arg parse, logging, ...). awk prints only the
# target function body, terminated at the next top-level function.
extract_fn() {
  local name="$1"
  awk -v fn="$name" '
    $0 ~ "^"fn"\\(\\)" { capture = 1 }
    capture { print }
    capture && /^}$/ { exit }
  ' "$HARNESS_BIN"
}

FN_BODY="$(extract_fn check_multiple_db_candidates)"
if [ -z "$FN_BODY" ]; then
  echo "FATAL: could not extract check_multiple_db_candidates from $HARNESS_BIN" >&2
  exit 2
fi

# Minimal stubs required by the helper.
warn() { echo "[harness-mem][warn] $*" >&2; }
ui_is_en() { return 1; } # default JA output path; either is fine for assertions

# shellcheck disable=SC1090
eval "$FN_BODY"

# Temp HOME sandbox so ${HOME}/.harness-mem/... resolves to fixtures.
SANDBOX="$(mktemp -d -t harness-mem-s93-XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT
export HOME="$SANDBOX"
# Explicitly override XDG_STATE_HOME so it points inside sandbox too.
export XDG_STATE_HOME="${SANDBOX}/.local/state"
unset HARNESS_MEM_DB_PATH || true

mkdir -p "${HOME}/.harness-mem"
mkdir -p "${HOME}/.claude/plugins/data/claude-code-harness-inline"
mkdir -p "${XDG_STATE_HOME}/harness-mem"

CURRENT_DB="${HOME}/.harness-mem/harness-mem.db"
PLUGIN_DB="${HOME}/.claude/plugins/data/claude-code-harness-inline/harness-mem.db"
XDG_DB="${XDG_STATE_HOME}/harness-mem/harness-mem.db"

echo "=== §93 check_multiple_db_candidates tests ==="

# --- Test 1: single DB, no other candidates -> no WARN ---
: > "$CURRENT_DB"
printf 'data' > "$CURRENT_DB"
OUT="$(check_multiple_db_candidates "$CURRENT_DB" 2>&1 || true)"
assert_empty "$OUT" "single DB produces no warning"

# --- Test 2: plugin-scoped legacy DB exists -> WARN ---
printf 'legacy plugin contents bigger content' > "$PLUGIN_DB"
OUT="$(check_multiple_db_candidates "$CURRENT_DB" 2>&1 || true)"
assert_contains "$OUT" "additional harness-mem.db detected" "plugin legacy DB triggers WARN"
assert_contains "$OUT" "$PLUGIN_DB" "WARN body mentions plugin path"
assert_contains "$OUT" "$CURRENT_DB" "WARN body mentions current path"

# --- Test 3: legacy XDG DB exists in addition -> both listed ---
printf 'xdg contents here' > "$XDG_DB"
OUT="$(check_multiple_db_candidates "$CURRENT_DB" 2>&1 || true)"
assert_contains "$OUT" "$PLUGIN_DB" "WARN lists plugin path when both exist"
assert_contains "$OUT" "$XDG_DB" "WARN lists XDG path when both exist"

# --- Test 4: zero-byte "other" DB is ignored ---
rm -f "$PLUGIN_DB" "$XDG_DB"
: > "$PLUGIN_DB" # 0 bytes
OUT="$(check_multiple_db_candidates "$CURRENT_DB" 2>&1 || true)"
assert_empty "$OUT" "zero-byte candidate does not trigger WARN"

# --- Test 5: current == candidate -> not reported as "other" ---
# Point current at the plugin path itself and put content there; the default
# ~/.harness-mem/harness-mem.db should still be picked up from Test 1.
printf 'plugin is now current' > "$PLUGIN_DB"
OUT="$(check_multiple_db_candidates "$PLUGIN_DB" 2>&1 || true)"
# current = plugin, so plugin must NOT appear as "other:"
assert_not_contains "$OUT" "other:   $PLUGIN_DB" "current path never appears as other"
assert_contains    "$OUT" "other:   $CURRENT_DB" "default path appears as other when not current"

# --- Test 6: HARNESS_MEM_DB_PATH override is deduplicated with default ---
# env-var candidate equals the default path — dedup prevents it from being
# double-listed. We set it to the default and make both the plugin legacy and
# a separate standalone dir have content.
rm -f "$PLUGIN_DB"
printf 'plugin back' > "$PLUGIN_DB"
export HARNESS_MEM_DB_PATH="$CURRENT_DB"
OUT="$(check_multiple_db_candidates "$CURRENT_DB" 2>&1 || true)"
# plugin DB should appear once; current should NOT appear as other.
PLUGIN_LINES="$(echo "$OUT" | grep -cF "other:   $PLUGIN_DB" || true)"
if [ "$PLUGIN_LINES" = "1" ]; then
  echo "  PASS: plugin DB listed exactly once (dedup works)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: plugin DB should appear once (got $PLUGIN_LINES)"
  FAIL=$((FAIL + 1))
fi
unset HARNESS_MEM_DB_PATH

echo ""
echo "=== summary ==="
echo "  pass: $PASS"
echo "  fail: $FAIL"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
