#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <bun-test-arg> [<bun-test-arg> ...]" >&2
  exit 1
fi

tmp_output="$(mktemp)"
tmp_pipe="$(mktemp -u)"
cleanup() {
  rm -f "$tmp_output"
  rm -f "$tmp_pipe"
}
trap cleanup EXIT
mkfifo "$tmp_pipe"

bun_waited=0
status=0

stop_bun() {
  local pid="$1"
  kill "$pid" 2>/dev/null || true
  (
    sleep 1
    kill -KILL "$pid" 2>/dev/null || true
  ) &
  local killer_pid=$!
  wait "$pid" 2>/dev/null
  status=$?
  bun_waited=1
  kill "$killer_pid" 2>/dev/null || true
  wait "$killer_pid" 2>/dev/null || true
}

set +e
bun test "$@" >"$tmp_pipe" 2>&1 &
bun_pid=$!
saw_zero_fail=0
saw_panic=0
saw_crash_banner=0
known_post_pass_panic=0
panic_after_failure=0

while IFS= read -r line; do
  printf '%s\n' "$line"
  printf '%s\n' "$line" >> "$tmp_output"

  if [[ "$line" =~ ^[[:space:]]*0[[:space:]]fail$ ]]; then
    saw_zero_fail=1
  fi
  if [[ "$line" == *"panic(main thread): A C++ exception occurred"* ]]; then
    saw_panic=1
  fi
  if [[ "$line" == *"oh no: Bun has crashed. This indicates a bug in Bun, not your code."* ]]; then
    saw_crash_banner=1
  fi

  if [ "$saw_panic" -eq 1 ] && [ "$saw_crash_banner" -eq 1 ]; then
    if [ "$saw_zero_fail" -eq 1 ]; then
      known_post_pass_panic=1
    else
      panic_after_failure=1
    fi
    stop_bun "$bun_pid"
    break
  fi
done <"$tmp_pipe"

if [ "$bun_waited" -eq 0 ]; then
  wait "$bun_pid" 2>/dev/null
  status=$?
fi
set -e

if [ "$known_post_pass_panic" -eq 1 ]; then
  echo "[harness-mem][warn] Bun crashed after reporting 0 failing tests; treating this as known Bun runtime noise." >&2
  exit 0
fi

if [ "$panic_after_failure" -eq 1 ]; then
  exit 133
fi

if [ "$status" -eq 0 ]; then
  exit 0
fi

if grep -Fq "panic(main thread): A C++ exception occurred" "$tmp_output" \
  && grep -Fq "oh no: Bun has crashed. This indicates a bug in Bun, not your code." "$tmp_output" \
  && grep -Eq '^[[:space:]]*0 fail$' "$tmp_output"; then
  echo "[harness-mem][warn] Bun crashed after reporting 0 failing tests; treating this as known Bun runtime noise." >&2
  exit 0
fi

exit "$status"
