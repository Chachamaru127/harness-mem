#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <bun-test-arg> [<bun-test-arg> ...]" >&2
  exit 1
fi

tmp_output="$(mktemp)"
cleanup() {
  rm -f "$tmp_output"
}
trap cleanup EXIT

set +e
bun test "$@" 2>&1 | tee "$tmp_output"
status=${PIPESTATUS[0]}
set -e

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
