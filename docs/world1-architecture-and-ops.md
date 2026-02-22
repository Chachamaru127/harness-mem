# World-1 Architecture, Migration, and Operations

## Architecture

Harness-mem World-1 architecture is organized into seven runtime layers:

1. Ingestion layer: normalized `recordEvent` pipeline for Codex/OpenCode/Cursor/Claude/Antigravity.
2. Storage layer: SQLite tables for sessions/events/observations/vectors/facts/audit/queues.
3. Retrieval layer: hybrid lexical + vector scoring with optional reranker.
4. Progressive disclosure layer: `search -> timeline -> get_observations` with `meta.token_estimate`.
5. Consolidation layer: fact extractor + deduper + queue worker.
6. Adapter layer: MCP tools, Python SDK, LangChain adapter.
7. Operations layer: health/metrics/admin APIs + benchmark/chaos/security tests.

## Decision Lock

Phase1 Multi-Tool UX Superiority における判定基準・却下条件を固定する。
実装・テスト・レビューはすべてこの定義に準拠する。

### KPI / SLA

| 指標 | 基準値 |
|---|---|
| セットアップコマンド数 | 1コマンドで完結 |
| セットアップ所要時間 | 5分以内 |
| doctor チェック結果 | 全項目 green |
| 手編集の要否 | 手編集なし |
| クロスツール記憶共有レイテンシ | P95 3秒以内（準リアルタイム） |
| クロスツール記憶継続率（主 KGI） | 95%以上 |

### 記憶境界・プライバシー

- 記憶境界はワークスペース（フォルダ）単位で厳格分離。別フォルダ混入 0件必達。
- 全ツール共通 private 指定。保存時除外・検索デフォルト除外・監査ログを必須とする。

### 移行体験

- 1コマンドで `import → verify → cutover` を完結させる。
- ロールバック導線を必ず提供する。

### トレードオフ優先

記憶継続率（KGI）を最優先。その他指標との競合時も KGI を上位に置く。

### 対象ツール

Claude Code, Codex, Cursor

### 却下条件

Phase1 は以下のいずれかを満たさない場合、完了とみなさない。

- クロスツール記憶継続率 < 95%
- 導入に手編集が必要
- 導入に5分以上かかる
- doctor 全 green に到達しない
- P95 同期レイテンシ > 3秒
- 別フォルダのデータ混入が1件でも発生
- private データが検索デフォルトで出現
- 移行後のロールバック導線がない

---

## Migration

Recommended migration path from Claude-mem:

1. `harness-mem import-claude-mem --source <path>`
2. `harness-mem verify-import --job <job_id>`
3. `harness-mem cutover-claude-mem --job <job_id> --stop-now`

World-1 adds no mandatory DB migration step for embedding provider switching. Provider changes are handled at runtime and validated via integration tests.

## Operations

Daily operation checklist:

1. Check daemon and runtime state:
   - `harness-memd status`
   - `harness-mem-client health`
2. Check memory quality/coverage:
   - `harness-mem-client admin-metrics`
   - `harness-mem-client search-facets` (project scope)
3. Check consolidation state:
   - `harness-mem-client admin-consolidation-status`
   - `harness-mem-client admin-audit-log` (optional filters)
4. Run guardrails regularly:
   - `tests/test-memory-search-quality.sh`
   - `tests/test-memory-daemon-chaos.sh`
   - `bun test memory-server/tests/integration/security-hardening.test.ts`

Incident response order:

1. Confirm `/health` reachability and daemon PID consistency.
2. Verify privacy defaults with `include_private=false` search.
3. Reindex vectors only after coverage drift is confirmed.
4. Run manual consolidation (`admin-consolidation-run`) if queue stalls.
