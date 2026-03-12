# AGENTS.md - harness-mem 開発ガイド

このファイルは、このリポジトリで作業するエージェント向けの repo 固有ルールです。

## プロジェクト概要

**harness-mem** は、Claude / Codex / Cursor / OpenCode / Gemini CLI など複数ツールで共有できる、local-first の記憶・検索・再開ランタイムです。

- 中核: `memory-server/`
- MCP / SDK: `mcp-server/`, `sdk/`, `python-sdk/`
- UI: `harness-mem-ui/`
- CLI / hooks / integration: `scripts/`, `hooks/`, `codex/`, `opencode/`, `gemini/`

## 最優先ルール

1. **`Plans.md` を正本にする**
   - 新しい作業は `Plans.md` に追加してから着手する。
   - 着手時に `cc:WIP`、完了時に `cc:完了` へ更新する。
2. **最小差分で直す**
   - 既存の CLI 契約、workspace isolation、privacy filter を壊さない。
   - 明示要件がない限り、互換レイヤーや複雑なフォールバックは増やさない。
3. **検証を先に閉じる**
   - 触った箇所に対応する `bun test` を必ず実行する。
   - テストの全体像は `docs/TESTING.md` を参照する。
4. **README と運用文書を同期する**
   - ユーザー向け挙動や開発フローを変えたら `README.md` / `README_ja.md` / `CHANGELOG*.md` の要否を確認する。

## 実装の見取り図

### `memory-server/`

- `src/core/`: 検索、session、ingest coordinator、visibility、privacy、workspace 境界の中核
- `src/ingest/`: Claude Code / Codex / Cursor / OpenCode / Antigravity などの履歴取り込み
- `tests/core-split/`: ドメイン単位の高速テスト
- `tests/integration/`: API 契約、検索品質、ingest 回帰

### `harness-mem-ui/`

- Mem UI の React/Vite 実装
- UI 変更は `vitest` / `playwright` の要否も確認する

### ルート / 補助領域

- `scripts/`: CLI, doctor, daemon restart, release 補助
- `tests/`: 契約テスト、CLI テスト、ベンチ補助
- `docs/`: セットアップ、運用、ベンチマーク証跡

## 標準フロー

1. `git status --short --branch` と `Plans.md` を確認する
2. 対象タスクを `cc:WIP` にする
3. 実装する
4. 変更箇所に対応するテストを実行する
5. `Plans.md` を `cc:完了` に戻し、必要なら補足を追記する

## よく使う検証コマンド

```bash
# 全体
bun test

# core-split
bun test memory-server/tests/core-split/

# integration
bun test memory-server/tests/integration/

# ルート契約テスト
bun test tests/

# UI
cd harness-mem-ui && npx vitest run
cd harness-mem-ui && npx playwright test
```

## 変更時の注意

- 履歴 ingest を触るときは、`latest interaction`、`session thread`、`search` の 3 点を回帰確認する
- 検索品質を触るときは、semantic relevance だけでなく recency / privacy / strict project を確認する
- setup / release まわりを触るときは、`package.json`, `VERSION`, `CHANGELOG.md`, `CHANGELOG_ja.md` の同期要否を確認する

## 参照先

- 実装計画の正本: `Plans.md`
- ユーザー向け概要: `README.md`, `README_ja.md`
- テストカタログ: `docs/TESTING.md`
- セットアップ詳細: `docs/harness-mem-setup.md`
