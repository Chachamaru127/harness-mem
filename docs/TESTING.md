# TESTING.md — テストカタログと実行ガイド

> 更新日: 2026-03-02

## フレームワーク使い分け

| フレームワーク | 用途 | ファイル数 | 実行コマンド |
|---|---|---|---|
| `bun:test` | memory-server / SDK / MCP / 契約テスト / ベンチマーク | 87 | `bun test` |
| `vitest` | harness-mem-ui コンポーネントテスト + 一部契約テスト | 8 | `cd harness-mem-ui && npx vitest run` |
| `@playwright/test` | harness-mem-ui E2E テスト | 2 | `cd harness-mem-ui && npx playwright test` |

### 使い分けルール

- **`bun:test`**: デフォルト。memory-server, SDK, MCP サーバー, CLI 契約テスト, ベンチマークすべてに使用
- **`vitest`**: harness-mem-ui（React/Vite プロジェクト）のコンポーネントテストに使用。React Testing Library / jsdom 環境が必要なため
- **`@playwright/test`**: harness-mem-ui の E2E テスト。ブラウザ上の実動作を検証

---

## テストディレクトリ構造

### memory-server/tests/

| ディレクトリ | カテゴリ | テスト数 | 説明 |
|---|---|---|---|
| `unit/` | ユニットテスト | ~21ファイル | 個別モジュールの単体テスト（パーサー、アダプタ、ユーティリティ） |
| `core-split/` | ドメインユニットテスト | 5ファイル (87テスト) | 分割モジュール（ConfigManager, EventRecorder, ObservationStore, SessionManager, IngestCoordinator）の直接テスト |
| `integration/` | 統合テスト | ~22ファイル | HarnessMemCore 経由の E2E 的テスト（API 契約、検索品質、インジェスト） |
| `benchmark/` | ベンチマーク | 1ファイル | LoCoMo recall 計測 |

### tests/ (ルート)

| ディレクトリ/パターン | カテゴリ | テスト数 | 説明 |
|---|---|---|---|
| `benchmarks/` | ベンチマーク | ~17ファイル | LoCoMo ワークフロー、パフォーマンス 100k、リランク品質ゲート |
| `*-contract.test.ts` | 契約テスト | ~14ファイル | CLI/MCP/UI の外部契約（ファイル存在、JSON スキーマ等） |

### sdk/tests/

| ファイル | カテゴリ | 説明 |
|---|---|---|
| `client.test.ts` | ユニットテスト | TS SDK クライアントの fetch モックテスト |

### vscode-extension/tests/

| ファイル | カテゴリ | 説明 |
|---|---|---|
| `client.test.ts` | ユニットテスト | VS Code 拡張のクライアントテスト |

### harness-mem-ui/tests/

| ディレクトリ | フレームワーク | 説明 |
|---|---|---|
| `ui/` | vitest | React コンポーネントテスト（merge, project-label, feed-panel, etc.） |
| `e2e/` | Playwright | ブラウザ E2E テスト（feed, environment） |

---

## テスト実行方法

### 全テスト（bun:test）

```bash
bun test
```

### 特定ディレクトリ

```bash
# ユニットテストのみ
bun test memory-server/tests/unit/

# core-split テスト（ドメインモジュール単体）
bun test memory-server/tests/core-split/

# 統合テスト
bun test memory-server/tests/integration/

# SDK テスト
bun test sdk/tests/

# 契約テスト
bun test tests/

# ベンチマーク（手動実行推奨）
bun test tests/benchmarks/
bun test memory-server/tests/benchmark/
```

### UI テスト

```bash
# コンポーネントテスト
cd harness-mem-ui && npx vitest run

# E2E テスト（サーバー起動が必要）
cd harness-mem-ui && npx playwright test
```

### 特定ファイル

```bash
bun test memory-server/tests/unit/postgres-adapter.test.ts
```

---

## テストファイル一覧

### memory-server/tests/unit/ (bun:test)

| ファイル | テスト対象 |
|---|---|
| `core.test.ts` | HarnessMemCore 基本動作 |
| `postgres-adapter.test.ts` | PostgresStorageAdapter SQL 変換 + async API |
| `storage-adapter.test.ts` | StorageAdapter ファクトリ |
| `embedding-provider.test.ts` | 埋め込みプロバイダー |
| `reranker.test.ts` | リランカー |
| `retrieval-router.test.ts` | 検索ルーター |
| `answer-compiler.test.ts` | 回答コンパイラー |
| `token-budget.test.ts` | トークン予算 |
| `signal-extraction.test.ts` | シグナル抽出 |
| `shadow-sync.test.ts` | シャドウ同期 |
| `workspace-boundary.test.ts` | ワークスペース境界 |
| `mem-links-relation.test.ts` | リンク関係 |
| `derives-links.test.ts` | derives リンク推論 |
| `audn-consolidation.test.ts` | 統合処理 |
| `external-connectors.test.ts` | 外部コネクタ |
| `knowledge-connector.test.ts` | ナレッジコネクタ |
| `codex-sessions-ingest.test.ts` | Codex セッションパーサー |
| `opencode-db-ingest.test.ts` | OpenCode DB パーサー |
| `opencode-storage-ingest.test.ts` | OpenCode ストレージパーサー |
| `cursor-hooks-ingest.test.ts` | Cursor フックパーサー |
| `antigravity-files-ingest.test.ts` | Antigravity ファイルパーサー |
| `antigravity-logs-ingest.test.ts` | Antigravity ログパーサー |

### memory-server/tests/core-split/ (bun:test)

| ファイル | テスト数 | テスト対象 |
|---|---|---|
| `config-manager.test.ts` | 24 | ConfigManager（委譲 + SQL 直接実行） |
| `event-recorder.test.ts` | 11 | EventRecorder（ストリームバッファ、書き込みキュー） |
| `observation-store.test.ts` | 17 | ObservationStore（検索、フィード、タイムライン） |
| `session-manager.test.ts` | 19 | SessionManager（セッション管理、チェックポイント、ファイナライズ） |
| `ingest-coordinator.test.ts` | 16 | IngestCoordinator（委譲パターン検証） |

### memory-server/tests/integration/ (bun:test)

| ファイル | テスト対象 |
|---|---|
| `api-contract.test.ts` | HTTP API 契約 |
| `admin.test.ts` | 管理 API |
| `consolidation.test.ts` | 統合処理 E2E |
| `consolidation-admin-api.test.ts` | 統合管理 API |
| `embedding-provider.test.ts` | 埋め込みプロバイダー統合 |
| `environment-api.test.ts` | 環境 API |
| `feed-stream.test.ts` | フィード・ストリーム |
| `import-claude-mem.test.ts` | claude-mem インポート |
| `managed-mode-wiring.test.ts` | マネージドモード |
| `postgres-adapter-integration.test.ts` | PostgreSQL アダプタ統合 |
| `resume-pack-behavior.test.ts` | resume-pack 動作 |
| `resume-pack-cache-sections.test.ts` | resume-pack キャッシュ |
| `search-quality.test.ts` | 検索品質 |
| `search-rerank.test.ts` | 検索リランキング |
| `security-hardening.test.ts` | セキュリティ硬化 |
| `shadow-sync-measurement.test.ts` | シャドウ同期計測 |
| `token-estimate-meta.test.ts` | トークン見積もりメタ |
| `ingest-codex-sessions.test.ts` | Codex セッションインジェスト |
| `ingest-cursor-hooks.test.ts` | Cursor フックインジェスト |
| `ingest-opencode-db.test.ts` | OpenCode DB インジェスト |
| `ingest-opencode-storage.test.ts` | OpenCode ストレージインジェスト |
| `ingest-antigravity-files.test.ts` | Antigravity ファイルインジェスト |
| `ingest-antigravity-logs.test.ts` | Antigravity ログインジェスト |

---

## CI での実行方針

| ステージ | 対象 | トリガー |
|---|---|---|
| **unit** | `memory-server/tests/unit/` + `core-split/` + `sdk/` | 全 PR |
| **contract** | `tests/*-contract.test.ts` | 全 PR |
| **integration** | `memory-server/tests/integration/` | 全 PR |
| **ui** | `harness-mem-ui/tests/` | UI 変更 PR |
| **benchmark** | `tests/benchmarks/` + `memory-server/tests/benchmark/` | スケジュール or 手動 |
