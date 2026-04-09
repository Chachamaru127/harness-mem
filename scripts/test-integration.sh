#!/bin/bash
# §75 S75-030: E2E Integration Test for Go MCP Server
# Requires: memory daemon running on localhost:37888
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
GO_BIN="$REPO_ROOT/mcp-server-go/bin/harness-mcp-server"

echo "=== Harness Go MCP Server Integration Test ==="

# Build if needed
if [ ! -x "$GO_BIN" ]; then
  echo "Building Go binary..."
  cd "$REPO_ROOT/mcp-server-go" && make build-stripped
fi

# Check daemon health
DAEMON_URL="${HARNESS_MEM_REMOTE_URL:-http://127.0.0.1:37888}"
echo "Checking daemon at $DAEMON_URL/health ..."
if ! curl -sf --max-time 2 "$DAEMON_URL/health" > /dev/null 2>&1; then
  echo "SKIP: Memory daemon not running at $DAEMON_URL"
  echo "Start with: harness-mem daemon start"
  exit 0  # Soft skip — not a failure
fi
echo "Daemon healthy."

# Test 1: harness_mem_health
echo ""
echo "--- Test 1: harness_mem_health ---"
HEALTH_RESULT=$(printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"integration-test","version":"0.1"}}}\n{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"harness_mem_health","arguments":{}}}\n' \
  | HARNESS_MEM_REMOTE_URL="$DAEMON_URL" "$GO_BIN" 2>/dev/null \
  | sed -n '2p')

if echo "$HEALTH_RESULT" | python3 -c "import sys,json; r=json.load(sys.stdin); assert not r.get('error'), f'JSON-RPC error: {r[\"error\"]}'; content=r['result']['content'][0]['text']; d=json.loads(content); assert d.get('ok') or d.get('status'), f'Unexpected: {content}'; print('PASS: health ok')" 2>&1; then
  :
else
  echo "FAIL: harness_mem_health"
  echo "$HEALTH_RESULT"
  exit 1
fi

# Test 2: harness_mem_search
echo ""
echo "--- Test 2: harness_mem_search ---"
SEARCH_RESULT=$(printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"integration-test","version":"0.1"}}}\n{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"harness_mem_search","arguments":{"query":"integration test probe"}}}\n' \
  | HARNESS_MEM_REMOTE_URL="$DAEMON_URL" "$GO_BIN" 2>/dev/null \
  | sed -n '2p')

if echo "$SEARCH_RESULT" | python3 -c "import sys,json; r=json.load(sys.stdin); assert not r.get('error'), f'JSON-RPC error: {r[\"error\"]}'; content=r['result']['content'][0]['text']; d=json.loads(content); assert d.get('ok') is True, f'search not ok: {content}'; print(f'PASS: search returned {d[\"meta\"][\"count\"]} results')" 2>&1; then
  :
else
  echo "FAIL: harness_mem_search"
  echo "$SEARCH_RESULT"
  exit 1
fi

echo ""
echo "=== All integration tests passed ==="
