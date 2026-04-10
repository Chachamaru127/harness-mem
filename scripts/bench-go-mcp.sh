#!/usr/bin/env bash
# Benchmark the Go MCP server: cold start, RSS, binary size.
# Outputs reproducible JSON to docs/benchmarks/go-mcp-bench/<host>-<date>.json
#
# Usage: scripts/bench-go-mcp.sh [BIN_PATH] [RUNS]
#   BIN_PATH defaults to bin/harness-mcp-<os>-<arch>
#   RUNS defaults to 10

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Resolve bin path (mirrors _resolve_go_bin_name in scripts/harness-mem)
resolve_bin() {
  local os arch uname_s
  uname_s="$(uname -s)"
  case "$uname_s" in
    Darwin)                            os="darwin" ;;
    Linux)                             os="linux" ;;
    MINGW*|MSYS*|CYGWIN*|Windows_NT)   os="windows" ;;
    *)                                 os="$(printf '%s' "$uname_s" | tr '[:upper:]' '[:lower:]')" ;;
  esac
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64)   arch="amd64" ;;
    aarch64|arm64)  arch="arm64" ;;
  esac
  if [ "$os" = "windows" ]; then
    printf '%s\n' "bin/harness-mcp-${os}-${arch}.exe"
  else
    printf '%s\n' "bin/harness-mcp-${os}-${arch}"
  fi
}

BIN="${1:-$(resolve_bin)}"
RUNS="${2:-10}"

if [ ! -x "$BIN" ]; then
  echo "ERROR: binary not found or not executable: $BIN" >&2
  exit 1
fi

# Sample cold start (process spawn → initialize response complete)
COLD_RESULTS=()
for _ in $(seq 1 "$RUNS"); do
  ms=$(python3 - "$BIN" <<'PY'
import os, subprocess, sys, time
bin_path = sys.argv[1]
init = b'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"bench","version":"0.1"}}}\n'
t0 = time.perf_counter_ns()
p = subprocess.Popen([bin_path], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
p.stdin.write(init); p.stdin.flush()
# Read until newline (initialize response)
out = p.stdout.readline()
t1 = time.perf_counter_ns()
p.stdin.close()
p.wait(timeout=2)
print(round((t1 - t0) / 1e6, 3))
PY
  )
  COLD_RESULTS+=("$ms")
done

# Compute statistics in python
STATS_JSON=$(python3 - "${COLD_RESULTS[@]}" <<'PY'
import json, statistics, sys
values = [float(x) for x in sys.argv[1:]]
print(json.dumps({
    "runs": len(values),
    "min_ms": round(min(values), 3),
    "max_ms": round(max(values), 3),
    "mean_ms": round(statistics.mean(values), 3),
    "median_ms": round(statistics.median(values), 3),
    "stdev_ms": round(statistics.stdev(values), 3) if len(values) > 1 else 0.0,
    "samples_ms": values,
}))
PY
)

# Sample RSS during initialize + tools/list
RSS_KB=$(python3 - "$BIN" <<'PY'
import os, subprocess, sys, time
bin_path = sys.argv[1]
init = b'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"bench","version":"0.1"}}}\n'
toollist = b'{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n'
p = subprocess.Popen([bin_path], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
p.stdin.write(init); p.stdin.flush()
p.stdout.readline()
p.stdin.write(toollist); p.stdin.flush()
p.stdout.readline()
# Sample RSS now
try:
    out = subprocess.check_output(["ps", "-o", "rss=", "-p", str(p.pid)]).decode().strip()
    print(out)
except Exception:
    print("0")
finally:
    p.stdin.close()
    p.wait(timeout=2)
PY
)

BIN_BYTES=$(stat -f "%z" "$BIN" 2>/dev/null || stat -c "%s" "$BIN")
BIN_MB=$(python3 -c "print(round($BIN_BYTES / 1024 / 1024, 2))")

HOST_OS=$(uname -s)
HOST_ARCH=$(uname -m)
HOST_NAME=$(hostname -s 2>/dev/null || hostname)
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
PKG_VERSION=$(jq -r .version package.json 2>/dev/null || echo "unknown")

OUT_DIR="docs/benchmarks/go-mcp-bench"
mkdir -p "$OUT_DIR"
DATE_STAMP=$(date -u +"%Y-%m-%d")
HOST_OS_LOWER=$(echo "$HOST_OS" | tr '[:upper:]' '[:lower:]')
OUT_FILE="${OUT_DIR}/${HOST_OS_LOWER}-${HOST_ARCH}-${DATE_STAMP}.json"

python3 - "$STATS_JSON" "$RSS_KB" "$BIN_BYTES" "$BIN_MB" "$BIN" "$HOST_OS" "$HOST_ARCH" "$HOST_NAME" "$NOW" "$GIT_COMMIT" "$PKG_VERSION" "$OUT_FILE" <<'PY'
import json, sys
stats_json, rss_kb, bin_bytes, bin_mb, bin_path, host_os, host_arch, host_name, now, commit, version, out_file = sys.argv[1:13]
stats = json.loads(stats_json)
rss_kb_int = int(rss_kb) if rss_kb.isdigit() else 0
result = {
    "schema": "harness-mem.go-mcp-bench/v1",
    "version": version,
    "git_commit": commit,
    "measured_at": now,
    "host": {
        "os": host_os,
        "arch": host_arch,
        "name": host_name,
    },
    "binary": {
        "path": bin_path,
        "size_bytes": int(bin_bytes),
        "size_mb": float(bin_mb),
    },
    "cold_start": stats,
    "memory": {
        "rss_kb_after_initialize_and_tools_list": rss_kb_int,
        "rss_mb": round(rss_kb_int / 1024, 2),
    },
    "method": {
        "cold_start": "Spawn process, write initialize JSON-RPC, readline() until response, measured wall-clock with time.perf_counter_ns().",
        "rss": "ps -o rss= after initialize + tools/list completed.",
    },
    "notes": "Run via scripts/bench-go-mcp.sh. Raw samples included for reproducibility."
}
with open(out_file, "w") as f:
    json.dump(result, f, indent=2)
print(f"Written: {out_file}")
print(json.dumps(result, indent=2))
PY
