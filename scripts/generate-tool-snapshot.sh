#!/bin/bash
# Generate normalized tools/list snapshot from Go MCP server
set -euo pipefail
cd "$(dirname "$0")/../mcp-server-go"
mkdir -p testdata
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}\n' \
  | go run ./main.go 2>/dev/null \
  | sed -n '2p' \
  | python3 -c "
import sys, json
data = json.load(sys.stdin)
tools = data['result']['tools']
tools.sort(key=lambda t: t['name'])
for t in tools:
    if 'inputSchema' in t and 'properties' in t['inputSchema']:
        t['inputSchema']['properties'] = dict(sorted(t['inputSchema']['properties'].items()))
print(json.dumps(tools, indent=2, sort_keys=False, ensure_ascii=False))
" > testdata/expected_tools.json
echo "Generated testdata/expected_tools.json with $(python3 -c "import json; print(len(json.load(open('testdata/expected_tools.json'))))" ) tools"
