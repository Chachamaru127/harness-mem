---
paths:
  - "harness-mem-ui/**"
---

# Harness Mem UI ルール

- ランタイム: **Bun** (memory-server と同じ)
- フレームワーク: React + TypeScript
- バックエンド: `src/server.ts` (Bun.serve)
- コンポーネント: `src/components/` に配置、1 ファイル 1 コンポーネント
- カスタムフック: `src/hooks/` に配置
- UI ポート: 37901 (`http://127.0.0.1:37901`)
- Environment タブは V1 では read-only。機密値はマスク済みで表示
