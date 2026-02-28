# harness-mem

Codex / OpenCode / Cursor / Claude Code で共通利用できる統合メモリランタイム。

## プロジェクト概要

@README_ja.md

## アーキテクチャ

```
memory-server/   ← コアメモリエンジン (Bun + TypeScript, SQLite/PostgreSQL)
mcp-server/      ← MCP サーバー (Node.js + TypeScript, @modelcontextprotocol/sdk)
harness-mem-ui/  ← Web ダッシュボード (React + TypeScript)
scripts/         ← CLI エントリポイント + hook-handlers (Bash)
hooks/           ← Claude Code hook 定義 (hooks.json)
codex/           ← Codex Agent Skill
opencode/        ← OpenCode プラグイン
python-sdk/      ← Python SDK
integrations/    ← LangChain 等の外部連携
```

## 開発コマンド

- `harness-mem doctor --fix` — 配線/稼働状態の検査・修復
- `harness-mem smoke` — E2E 最小検証
- `harness-memd restart` — デーモン再起動
- memory-server ビルド: `cd memory-server && bun install && bun run src/index.ts`
- mcp-server ビルド: `cd mcp-server && npm install && npx tsc`
- UI ビルド: `cd harness-mem-ui && bun install && bun run src/server.ts`

## コーディング規約

- 言語: TypeScript (strict mode), Bash (set +e でフック内は非中断)
- memory-server は Bun ランタイム (ESNext, Bundler モジュール)
- mcp-server は Node.js ランタイム (NodeNext モジュール, dist/ へビルド)
- コミットメッセージは英語、ドキュメントは日英併記
- テストは `tests/` 配下の Bash スクリプト + Bun テスト

## メモリシステム共存ポリシー

本プロジェクトでは Claude Code の **Auto Memory** と **harness-mem** を以下のように役割分担する:

- **Auto Memory** (Claude Code 組み込み): ユーザー個人のコーディング好み・パターン学習に利用。有効のまま運用。
- **harness-mem**: クロスツール記憶 (Codex/Cursor/OpenCode 間共有)、セッション復元、プロジェクトナレッジベース。
- **CLAUDE.md / .claude/rules/**: 静的なプロジェクト規約。チーム共有。人間がキュレーション。
- 自動生成される子ディレクトリの CLAUDE.md (`<claude-mem-context>` タグ) は harness-mem のセッション履歴記録用。Auto Memory とは別レイヤー。

## 主要ポート

| サービス | ポート |
|---------|-------|
| memory-server (harness-memd) | 37888 |
| harness-mem-ui | 37901 |
