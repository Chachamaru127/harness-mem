#!/usr/bin/env bash
set -euo pipefail

BASH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SAFE_RUNNER="${BASH_DIR}/run-bun-test-safe.sh"

if [ ! -x "$SAFE_RUNNER" ]; then
  echo "safe runner not executable: $SAFE_RUNNER" >&2
  exit 1
fi

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <path-or-file> [<path-or-file> ...]" >&2
  exit 1
fi

BATCH_SIZE="${HARNESS_MEM_BUN_TEST_BATCH_SIZE:-1}"

if ! [[ "$BATCH_SIZE" =~ ^[0-9]+$ ]] || [ "$BATCH_SIZE" -lt 1 ]; then
  echo "HARNESS_MEM_BUN_TEST_BATCH_SIZE must be a positive integer" >&2
  exit 1
fi

declare -a files=()

collect_test_files() {
  local target="$1"

  if [ -d "$target" ]; then
    while IFS= read -r file; do
      files+=("$file")
    done < <(find "$target" -type f \( -name '*.test.ts' -o -name '*.test.js' \) | sort)
    return
  fi

  files+=("$target")
}

for target in "$@"; do
  collect_test_files "$target"
done

if [ "${#files[@]}" -eq 0 ]; then
  echo "no test files found" >&2
  exit 1
fi

for ((i = 0; i < ${#files[@]}; i += BATCH_SIZE)); do
  batch=("${files[@]:i:BATCH_SIZE}")
  "$SAFE_RUNNER" "${batch[@]}"
done
