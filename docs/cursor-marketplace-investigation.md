# Cursor sandbox.json 互換性 + Marketplace 対応調査

Sprint: S52 | Date: 2026-03-15

## 1. sandbox.json 対応

Cursor はバージョン 0.47+ で `sandbox.json` を導入し、AI エージェントのネットワークアクセスとファイルシステムアクセスを制御する。

### 作成した `.cursor/sandbox.json`

harness-mem が必要とするアクセス:

- **ネットワーク**: `localhost:37888` / `127.0.0.1:37888` — harness-memd (memory daemon) との通信
- **ファイルシステム**:
  - `${workspaceFolder}/**` — プロジェクトファイルの読み書き
  - `${HOME}/.harness-mem/**` — SQLite DB、設定ファイル
  - `${HOME}/.config/harness-mem/**` — 設定ディレクトリ

### 注意事項

- `HARNESS_MEM_REMOTE_URL` を使用したリモートモードの場合、追加のネットワークアクセス許可が必要（ユーザーが手動で設定）
- `HARNESS_MEM_PORT` をデフォルト以外に変更した場合も同様

## 2. Cursor Marketplace 調査

### 現状

Cursor Marketplace は 2026-03 時点でクローズドベータ段階にある。

### 配布可否の評価

| 項目 | 状況 |
|------|------|
| MCP サーバーとしての配布 | Cursor は `mcp.json` / `mcpServers` 経由で MCP サーバーをサポート。harness-mem は既に MCP サーバーとして動作するため技術的には互換性あり |
| hooks.json との統合 | Cursor hooks は `.cursor/hooks.json` で定義。harness-mem は既にサンプル（`.cursor/hooks.json.example`）を提供済み |
| Marketplace パッケージ形式 | Cursor のプラグインパッケージ形式は Claude Code の `.claude-plugin/` とは異なる。Cursor は `package.json` の `cursor` フィールドまたは専用マニフェストを使用 |
| デーモン起動要件 | harness-mem は `harness-memd` デーモンの起動が必要。Marketplace の自動インストールフローでデーモンのセットアップは現時点で制限あり |

### SKILL.md / AGENT.md 対応要否

| ファイル | 対応要否 | 理由 |
|---------|---------|------|
| SKILL.md | 不要 | Cursor は SKILL.md を参照しない。`.cursorrules` または `AGENTS.md` を使用 |
| AGENT.md | 対応推奨 | Cursor は `AGENTS.md` をサポート。既に `AGENTS.md` はリポジトリルートに存在 |
| .cursorrules | 検討中 | Cursor 固有の指示ファイル。必要に応じて追加可能だが、`AGENTS.md` と内容が重複するため現時点では不要 |

### 推奨アクション

1. **短期**: sandbox.json テンプレートの提供（完了）+ ドキュメント化
2. **中期**: Cursor Marketplace がオープンになり次第、パッケージ形式を調査して対応
3. **長期**: `.cursorrules` の自動生成を検討（AGENTS.md からの変換）
