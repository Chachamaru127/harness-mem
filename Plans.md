# Harness-mem 実装マスタープラン

最終更新: 2026-03-03（§31 競合ベンチマーク首位奪還プラン策定）
実装担当: Codex / Claude（本ファイルを唯一の実装計画ソースとして運用）

> **アーカイブ**: §0-21 → [`docs/archive/Plans-2026-02-26.md`](docs/archive/Plans-2026-02-26.md)
> §22 → [`docs/archive/Plans-s22-2026-02-27.md`](docs/archive/Plans-s22-2026-02-27.md)
> §23-26 → [`docs/archive/Plans-s23-s26-2026-03-02.md`](docs/archive/Plans-s23-s26-2026-03-02.md)
> §27 → [`docs/archive/Plans-s27-2026-03-02.md`](docs/archive/Plans-s27-2026-03-02.md)
> §28P1 CQRS + ReviewR1 + FIX-001 + §27.1 → [`docs/archive/Plans-s28-review-2026-03-03.md`](docs/archive/Plans-s28-review-2026-03-03.md)
> §29 競合ベンチマーク改善 (10/10完了, 119→128/140) → [`docs/archive/Plans-s29-2026-03-03.md`](docs/archive/Plans-s29-2026-03-03.md)
> §30 アーキテクチャ改善 (19/19完了, 908テスト) → [`docs/archive/Plans-s30-2026-03-03.md`](docs/archive/Plans-s30-2026-03-03.md)
> **テストケース設計**: [`docs/test-designs-s22.md`](docs/test-designs-s22.md) / [`docs/test-designs-s27.1.md`](docs/test-designs-s27.1.md)

---

## 凡例

`[P]` = 並列可 / `cc:TODO` / `cc:WIP` / `cc:完了` / `blocked`

---

## §31. 競合ベンチマーク首位奪還 — 4領域改善（115→120+/140）

**背景**: v6 ベンチマーク（コード実査ベース）で harness-mem は 115/140（3位）に後退。
supermemory/mem0 が 119/140 で同率首位。+5pt 以上で首位奪還。

**対象4領域**:
| 領域 | 現在 | 目標 | Delta | 根拠 |
|------|:----:|:----:|:-----:|------|
| Graph / Relations | 7 | 9 | +2 | expandByLinks を全 relation + 双方向 + 設定可能 depth に拡張 |
| Storage Flexibility | 8 | 9 | +1 | Pg*Repository 3クラス実装で PG async 本稼働 |
| Multi-user / Team | 7 | 8 | +1 | Team CRUD + メンバー管理 API + member ロール適用 |
| Benchmark / Eval | 8 | 9 | +1 | LoCoMo ベースライン生成 + CI ゲート fail 条件追加 |

**テスト**: 908テスト全通過を維持 + 新規テスト追加

---

### Phase 0: Graph 連鎖推論の強化（4タスク, 3並列可）

目的: expandByLinks の制約解消（4種→8種 relation、双方向、depth 設定可能）。
前提: なし（即着手可）。getSubgraph の BFS 5ホップは実装済み。

- [x] `cc:完了 [P]` **GRAPH-001**: expandByLinks の relation フィルタを全8種に拡張
  - `observation-store.ts` L524 の IN 句に `contradicts/causes/part_of/updates` 追加
  - DoD: 8種全 relation が検索展開対象。テスト4件追加

- [ ] `cc:TODO [P]` **GRAPH-002**: expandByLinks を双方向探索に拡張
  - `to_observation_id IN (frontierIds)` も探索対象に追加（L494-568）
  - DoD: 双方向リンクが検索展開で辿られる。テスト3件追加

- [ ] `cc:TODO [P]` **GRAPH-003**: expandByLinks の MAX_DEPTH を設定可能化
  - `config.graphMaxHops` で上書き可能に（デフォルト3、上限5）
  - DoD: `HARNESS_MEM_GRAPH_MAX_HOPS=5` で5ホップ探索動作。テスト2件追加

- [ ] `cc:TODO` **GRAPH-004**: 既存 getLinks に depth パラメータ追加 + OpenAPI/MCP 更新
  - `server.ts` L1007 の既存エンドポイント修正。`depth`(1-5, default 1) → BFS 探索
  - DoD: depth=3 動作 + `openapi.yaml` + `mcp-openapi-consistency.test.ts` 更新。テスト3件追加

---

### Phase 1: LoCoMo CI ゲート統合（3タスク, 2並列可）

目的: LoCoMo CI 回帰検知の有効化。前提: なし（Phase 0 と並列可）。
現状: regression-gate.ts 実装済みだがベースライン未生成。locomo-benchmark.yml に fail 条件なし。

- [x] `cc:完了` **LOCO-001**: LoCoMo ベースラインファイル生成・コミット
  - `locomo-baseline.json` + `longmemeval-baseline.json` を `results/` にコミット
  - DoD: `regression-gate.ts` がベースラインと比較可能

- [x] `cc:完了` **LOCO-002**: locomo-benchmark.yml に fail 条件追加
  - `locomo-gate-check.ts` 作成。F1 前回比 -5% 超で exit 1（LLM Judge 不要）
  - DoD: F1 回帰で CI fail。テスト2件追加

- [x] `cc:完了` **LOCO-003**: Runbook 閾値と CI 設定の同期（LOCO-002 完了後）
  - `LOCOMO_F1_THRESHOLD` 環境変数でカスタマイズ可能に
  - DoD: Runbook と CI が同じ閾値を参照

---

### Phase 2: PostgreSQL async 本稼働（7タスク, 3並列可）

目的: Pg*Repository 実装で PG 本稼働。前提: なし（並列可）。
§30 で Repository IF(async-first) + SQLite 実装完成済み。AsyncStorageAdapter の PG メソッド6つ動作済み。
**注意**: ObservationStore が `this.deps.db.query(sql).all()` を同期呼び出ししている箇所あり → PG-000 で解消。

- [x] `cc:完了` **PG-000**: sync/async 境界の設計調査と移行パス策定
  - ObservationStore 内の `db.query().all()` 同期呼び出し箇所を洗い出し
  - Repository 経由に移行済みの箇所と未移行の箇所を分類
  - PG 動作に必要な最小限の async 化範囲を特定
  - DoD: 移行対象の SQL 一覧 + 対応 Repository メソッドのマッピング表
  - 成果物: `docs/pg-migration-map.md` に全 sync 呼び出しマッピング表を作成

- [ ] `cc:TODO` **PG-001**: POSTGRES_INIT_SQL に後付けカラム追加
  - `ObservationRow` 全フィールドと `POSTGRES_INIT_SQL` の `mem_observations` を比較
  - 不足: user_id, team_id, signal_score, access_count, last_accessed_at, cognitive_sector, memory_type
  - `mem_sessions`/`mem_events` の user_id, team_id も追加
  - ObservationRow に不足フィールド(access_count/last_accessed_at/cognitive_sector/workspace_uid)も追記
  - DoD: ObservationRow/SessionRow 型定義と PG スキーマが1:1対応。テスト2件追加

- [ ] `cc:TODO [P]` **PG-002**: PgObservationRepository 実装
  - IObservationRepository を implements。`adapter.runAsync()`/`queryAllAsync()` 経由
  - `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`、LIKE → PG 互換に変換
  - DoD: 全メソッド実装。テスト10件以上

- [ ] `cc:TODO [P]` **PG-003**: PgSessionRepository 実装
  - `db/repositories/PgSessionRepository.ts` を新規作成
  - ISessionRepository を implements
  - DoD: 全メソッド実装。テスト8件以上

- [ ] `cc:TODO [P]` **PG-004**: PgVectorRepository 実装
  - `db/repositories/PgVectorRepository.ts` を新規作成
  - IVectorRepository を implements
  - `vector_json TEXT` → `embedding vector` 型のマッピング
  - `pgvectorSearchAsync()` の統合
  - DoD: 全メソッド実装。テスト8件以上

- [ ] `cc:TODO` **PG-005**: adapter-factory の PG ファクトリー対応
  - `managed` モードで PostgresStorageAdapter + Pg*Repository を生成
  - 環境変数 `HARNESS_MEM_PG_URL` で PG 接続を自動検出
  - Repository を DI で ObservationStore / SessionManager に注入
  - DoD: `HARNESS_MEM_PG_URL=postgres://...` 指定時に PG で動作。テスト3件追加

- [ ] `cc:TODO` **PG-006**: PG 統合テスト（pgvector Docker CI 連携）
  - `pgvector-integration.yml` を更新して Pg*Repository のテストを追加
  - Docker Compose で PostgreSQL + pgvector を起動
  - E2E: 記録→検索→セッション→チェックポイントの往復テスト
  - DoD: CI で PG 統合テスト全 pass。テスト5件追加

---

### Phase 3: Team Management API（6タスク, 2並列可）

目的: チーム CRUD + メンバー管理 + 権限制御。前提: TEAM-001 の postgres-schema.ts 変更は PG-001 完了後。
DB カラム(user_id/team_id)・AuthConfig・アクセスフィルタは実装済み。チーム実体テーブル+管理 API が未実装。

- [ ] `cc:TODO` **TEAM-001**: チーム関連 DB テーブルの追加
  - `mem_teams` (team_id, name, description, created_at, updated_at)
  - `mem_team_members` (team_id, user_id, role, joined_at)
  - `mem_team_invitations` (id, team_id, invitee_identifier, role, token, expires_at, status)
  - `schema.ts` の `initSchema` と `migrateSchema` に追加
  - `postgres-schema.ts` の `POSTGRES_INIT_SQL` にも追加
  - DoD: テーブル作成 + マイグレーション動作。テスト3件追加

- [ ] `cc:TODO` **TEAM-002**: TeamRepository インターフェース + SQLite 実装
  - `ITeamRepository` (create/findById/findAll/update/delete/addMember/removeMember/getMembers)
  - `SqliteTeamRepository` 実装
  - DoD: 全メソッド実装。テスト10件以上

- [ ] `cc:TODO [P]` **TEAM-003**: Team CRUD エンドポイント（5本: POST/GET/GET:id/PUT/DELETE `/v1/admin/teams`）
  - 全て admin 認証必須。DoD: 5エンドポイント動作。テスト5件追加

- [ ] `cc:TODO [P]` **TEAM-004**: メンバー管理エンドポイント（4本: POST/DELETE/PATCH/GET `/v1/admin/teams/:id/members`）
  - DoD: 4エンドポイント動作。テスト4件追加

- [ ] `cc:TODO` **TEAM-005**: server.ts の member ロール適用
  - `resolveRequestIdentity()` の結果を全エンドポイントに伝播
  - member ロールの ResolvedIdentity → buildAccessFilter() → SQL フィルタ
  - `/v1/search`, `/v1/feed`, `/v1/sessions/*` で member スコープが機能
  - DoD: member トークンでアクセス時に自分のデータのみ返る。テスト5件追加

- [ ] `cc:TODO` **TEAM-006**: SDK に Team API を追加
  - TS SDK: `client.teams.create()`, `client.teams.list()`, `client.teams.addMember()` 等
  - Python SDK: 同等のメソッド追加
  - OpenAPI スキーマに Team エンドポイントを追加
  - DoD: TS/Python SDK から Team 管理が可能。テスト4件追加

---

### §31 完了判定

| Phase | タスク数 | 並列度 | 主な成果物 | ベンチマーク影響 |
|-------|:-------:|:------:|-----------|:---------------:|
| Phase 0 | 4 | 3 | Graph 全 relation 双方向 multi-hop | +2pt (7→9) |
| Phase 1 | 3 | 1 | LoCoMo CI ゲート | +1pt (8→9) |
| Phase 2 | 7 | 3 | PG async 本稼働 | +1pt (8→9) |
| Phase 3 | 6 | 2 | Team Management API | +1pt (7→8) |
| **合計** | **20** | | | **+5pt (115→120)** |

```
Phase 0 (3並列):              Phase 1 (順次):
  GRAPH-001〜003 [P]            LOCO-001→002→003
  GRAPH-004
Phase 2:                      Phase 3 (PG-001完了後):
  PG-000→001→002〜004 [P]      TEAM-001→002→003〜004 [P]
  └→PG-005→PG-006              TEAM-005→006
```

**§31 DoD（全体完了条件）**:
1. expandByLinks が **8種 relation** を **双方向** で探索し depth が **設定可能**
2. LoCoMo CI が **F1 回帰 -5% で fail**（ベースラインファイル存在）
3. `HARNESS_MEM_PG_URL` 指定で **PostgreSQL 本稼働**（全 Repository 動作）
4. Team CRUD + メンバー管理 **9エンドポイント** が動作
5. member ロールで **自分のデータのみアクセス可能**
6. テスト **908件以上** 全 pass（新規テスト追加分含む）
7. v7 ベンチマーク再評価で **120/140 以上**
