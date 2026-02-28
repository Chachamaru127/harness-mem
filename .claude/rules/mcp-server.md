---
paths:
  - "mcp-server/**"
---

# MCP Server ルール

- ランタイム: **Node.js** (Bun ではない)
- tsconfig: `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`
- ビルド成果物は `dist/` へ出力 (`npx tsc`)
- インポートパスには `.js` 拡張子が必要 (NodeNext モジュール解決)
- `@modelcontextprotocol/sdk` を使用。`Server`, `StdioServerTransport` が基本
- ツール定義パターン: `tools/` 配下に `xxxTools: Tool[]` と `handleXxxTool()` をエクスポート
- ツール名の命名規則: `harness_session_*`, `harness_workflow_*`, `harness_mem_*`, `harness_status`
- 新しいツールカテゴリ追加時は `index.ts` の `allTools` 配列に登録
- stdin/stdout は MCP トランスポート用に確保。デバッグログは `console.error` へ
