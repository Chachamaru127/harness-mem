#!/usr/bin/env bash
# hook-common-db-path-unification.test.sh — §94
# Verify that hook-common.sh's hook_init_paths() does NOT auto-promote
# CLAUDE_PLUGIN_DATA into HARNESS_MEM_DB_PATH anymore (single-DB policy),
# while keeping backward compatibility for explicit HARNESS_MEM_DB_PATH.
#
# Root cause being regression-tested: before v0.14.1, hook-common.sh set
#   export HARNESS_MEM_DB_PATH="${CLAUDE_PLUGIN_DATA}/harness-mem.db"
# whenever CLAUDE_PLUGIN_DATA was set and HARNESS_MEM_DB_PATH was unset.
# Claude Code injects a *different* CLAUDE_PLUGIN_DATA per installed plugin
# slot (claude-code-harness-inline / codex-openai-codex / marketplace
# variants), so every plugin slot ended up writing to its own harness-mem.db.
# See Plans.md §94 for full context.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
HOOK_COMMON="${REPO_ROOT}/scripts/hook-handlers/lib/hook-common.sh"

if [ ! -f "$HOOK_COMMON" ]; then
  echo "FATAL: ${HOOK_COMMON} not found" >&2
  exit 2
fi

PASS=0
FAIL=0

assert_eq() {
  local expected="$1"
  local actual="$2"
  local name="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name"
    echo "    expected: $expected"
    echo "    actual:   $actual"
    FAIL=$((FAIL + 1))
  fi
}

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

# Create a fixture handler script that sources hook-common.sh from a realistic
# caller location. hook_init_paths relies on BASH_SOURCE[1] pointing at the
# caller, so we must invoke via an actual script file (not `bash -c`).
FIXTURE_DIR="$(mktemp -d)"
trap 'rm -rf "$FIXTURE_DIR"' EXIT

# Simulate a hook handler living under scripts/hook-handlers/.
mkdir -p "${FIXTURE_DIR}/scripts/hook-handlers"
cat > "${FIXTURE_DIR}/scripts/hook-handlers/run-case.sh" <<EOF
#!/usr/bin/env bash
set -uo pipefail
# Pick up hook-common.sh from the real repo (path passed via env).
# shellcheck disable=SC1090
source "\${HOOK_COMMON_PATH}"
hook_init_paths "false"
printf '%s\n' "\${HARNESS_MEM_DB_PATH:-}"
printf '%s\n' "\${PLUGIN_DATA_DIR:-}"
EOF
chmod +x "${FIXTURE_DIR}/scripts/hook-handlers/run-case.sh"

# Even though the fixture handler lives elsewhere, hook_init_paths walks
# upward looking for harness-mem-client.sh / harness-memd. It does not exit
# on failure; it just sets SCRIPT_DIR/PARENT_DIR to best-effort paths. The
# DB-path side-effect logic we care about is unconditional.

run_case() {
  # Pass env assignments as positional "KEY=val" args.
  env -i \
    HOME="$HOME" \
    PATH="$PATH" \
    HOOK_COMMON_PATH="$HOOK_COMMON" \
    "$@" \
    "${FIXTURE_DIR}/scripts/hook-handlers/run-case.sh"
}

run_case_stderr() {
  env -i \
    HOME="$HOME" \
    PATH="$PATH" \
    HOOK_COMMON_PATH="$HOOK_COMMON" \
    "$@" \
    "${FIXTURE_DIR}/scripts/hook-handlers/run-case.sh" 2>&1 >/dev/null
}

# ------------------------------------------------------------------
# Case 1: CLAUDE_PLUGIN_DATA is set, HARNESS_MEM_DB_PATH is unset.
# Expected: HARNESS_MEM_DB_PATH stays unset (no auto-promotion).
# ------------------------------------------------------------------
echo "Case 1: CLAUDE_PLUGIN_DATA set, HARNESS_MEM_DB_PATH unset — must NOT auto-promote"
out="$(run_case CLAUDE_PLUGIN_DATA=/tmp/fake-plugin-slot/data HARNESS_MEM_SUPPRESS_PLUGIN_DATA_WARN=1)"
db_path="$(printf '%s' "$out" | sed -n '1p')"
plugin_dir="$(printf '%s' "$out" | sed -n '2p')"
assert_eq "" "$db_path" "HARNESS_MEM_DB_PATH is not implicitly set from CLAUDE_PLUGIN_DATA"
assert_eq "/tmp/fake-plugin-slot/data" "$plugin_dir" "PLUGIN_DATA_DIR still reflects CLAUDE_PLUGIN_DATA (non-DB state)"

# ------------------------------------------------------------------
# Case 2: Explicit HARNESS_MEM_DB_PATH wins over CLAUDE_PLUGIN_DATA.
# (backward compatibility — custom DB path must still be respected)
# ------------------------------------------------------------------
echo "Case 2: explicit HARNESS_MEM_DB_PATH + CLAUDE_PLUGIN_DATA — explicit wins"
out="$(run_case \
  CLAUDE_PLUGIN_DATA=/tmp/fake-plugin-slot/data \
  HARNESS_MEM_DB_PATH=/custom/path/my.db \
  HARNESS_MEM_SUPPRESS_PLUGIN_DATA_WARN=1)"
db_path="$(printf '%s' "$out" | sed -n '1p')"
assert_eq "/custom/path/my.db" "$db_path" "explicit HARNESS_MEM_DB_PATH is preserved verbatim"

# ------------------------------------------------------------------
# Case 3: Neither env var set — HARNESS_MEM_DB_PATH stays unset
# so downstream getConfig() uses DEFAULT_DB_PATH (~/.harness-mem/harness-mem.db).
# ------------------------------------------------------------------
echo "Case 3: no CLAUDE_PLUGIN_DATA, no HARNESS_MEM_DB_PATH — fall through to default"
out="$(run_case HARNESS_MEM_SUPPRESS_PLUGIN_DATA_WARN=1)"
db_path="$(printf '%s' "$out" | sed -n '1p')"
assert_eq "" "$db_path" "HARNESS_MEM_DB_PATH remains unset so memory-server uses DEFAULT_DB_PATH"

# ------------------------------------------------------------------
# Case 4: Defensive warning fires (stderr) when CLAUDE_PLUGIN_DATA is set
# but HARNESS_MEM_DB_PATH is not.
# ------------------------------------------------------------------
echo "Case 4: warning on stderr when CLAUDE_PLUGIN_DATA set without explicit DB path"
warn_output="$(run_case_stderr CLAUDE_PLUGIN_DATA=/tmp/fake-plugin-slot/data)"
assert_contains "$warn_output" "CLAUDE_PLUGIN_DATA" "warning mentions CLAUDE_PLUGIN_DATA"
assert_contains "$warn_output" "~/.harness-mem/harness-mem.db" "warning points to unified DB path"
assert_contains "$warn_output" "§94" "warning references §94 for operator self-service"

# ------------------------------------------------------------------
# Case 5: HARNESS_MEM_SUPPRESS_PLUGIN_DATA_WARN silences the warning.
# ------------------------------------------------------------------
echo "Case 5: HARNESS_MEM_SUPPRESS_PLUGIN_DATA_WARN=1 silences the warning"
warn_output="$(run_case_stderr \
  CLAUDE_PLUGIN_DATA=/tmp/fake-plugin-slot/data \
  HARNESS_MEM_SUPPRESS_PLUGIN_DATA_WARN=1)"
if [ -z "$warn_output" ]; then
  echo "  PASS: stderr is empty when suppress env var is set"
  PASS=$((PASS + 1))
else
  echo "  FAIL: stderr is not empty when suppress env var is set"
  echo "    stderr: $warn_output"
  FAIL=$((FAIL + 1))
fi

echo
echo "Result: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
