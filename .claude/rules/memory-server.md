---
paths:
  - "memory-server/**"
---

# Memory Server ルール

- ランタイム: **Bun** (Node.js ではない)
- tsconfig: `target: ES2022`, `module: ESNext`, `moduleResolution: Bundler`
- `bun-types` を型定義に使用。`Bun.serve` 等の Bun API を直接利用可
- strict mode 有効。any 型は禁止
- インポートパスに `.js` 拡張子は不要 (Bundler モジュール解決)
- ログ出力は `console.error` (stdout は API レスポンス用に確保)
- DB 層は `src/db/` に集約。SQL は prepared statement 必須
- ベクトル演算は `src/vector/` に分離
- 検索は 3 レイヤー設計: index → timeline → details (トークンコスト管理)
- シャットダウンは graceful に: `core.shutdown()` → `server.stop()`
