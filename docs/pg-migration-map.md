# PG Migration Map

> 作成日: 2026-03-04
> 目的: PostgreSQL 移行時に問題となる同期 DB 呼び出し（bun:sqlite の `.query().all()/.get()/.run()` / `.exec()`）を全て洗い出し、
> 対応する Repository メソッドへの移行パスを明確にする。

---

## 凡例

| 列 | 説明 |
|----|------|
| 行 | ソースコード内の行番号 |
| SQL概要 | 何をしているか |
| 現状 | 同期呼び出しパターン |
| 移行先 Repository メソッド | PG で使えるインターフェース |
| 新規作成要否 | 既存 = 既存インターフェースに対応あり / 新規 = 未定義・新規作成が必要 |

---

## observation-store.ts

| 行 | SQL概要 | 現状 | 移行先 Repository メソッド | 新規作成要否 |
|----|---------|------|--------------------------|------------|
| 246–248 | FTS 無効時のフォールバック: `mem_observations` から `id/title/content` を全件取得（lexical search） | `db.query(sql).all()` | `observationRepo.findMany(filter)` | 既存（ただし FTS フォールバック用の軽量フィルタ版として引数拡張が必要） |
| 280–282 | FTS インデックスを MATCH で BM25 lexical 検索 | `db.query(sql).all()` | 新規: `observationRepo.ftsSearch(query, filter, limit)` | 新規（FTS は PG では `tsvector/tsquery` に置き換え） |
| 339–341 | sqlite-vec を使ったベクトル ANN 検索（`mem_vectors_vec` JOIN） | `db.query(sql).all()` | 新規: `vectorRepo.annSearch(queryVector, filter, limit)` | 新規（PG では pgvector の `<->` 演算子を使う） |
| 386–392 | JS brute-force ベクトル検索: `mem_vectors JOIN mem_observations` 全件取得 | `db.query(q).all()` | `vectorRepo.findByObservationIds()` + JS 計算 または 新規 `vectorRepo.bruteForceCandidates(filter, limit)` | 新規（全件取得は PG でも動くが、専用メソッド化推奨） |
| 430–440 | フォールバックベクトルモデルを `mem_vectors` から探す（現行モデル以外でカウントが最大） | `db.query().get()` | 新規: `vectorRepo.findFallbackModel(currentModel)` | 新規 |
| 446–453 | ベクトル移行進捗: `mem_vectors` の総数 + 現行モデルカバレッジ取得 | `db.query().get()` | `vectorRepo.coverage(currentModel)` | 既存 |
| 520–556 | N-hop グラフ探索（BFS）: `mem_links JOIN mem_observations` forward + backward UNION | `db.query(sql).all()` | 新規: `linkRepo.expandByLinks(frontierIds, filter, limit)` | 新規（`ILinkRepository` 自体が未定義） |
| 762–767 | `exclude_updated` フィルタ: `mem_links WHERE relation='updates'` で上書き済み ID 取得 | `db.query().all()` | 新規: `linkRepo.findUpdatedObservationIds(candidateIds)` | 新規 |
| 839–846 | アクセス頻度加点: `mem_audit_log` で `search_hit` を observation_id 別に集計 | `db.query().all()` | 新規: `auditLogRepo.countSearchHits(ids)` | 新規 |
| 1055–1059 | search ヒット時に `mem_observations.access_count` + `last_accessed_at` をバッチ UPDATE | `db.query().run()` (transaction内) | 新規: `observationRepo.batchIncrementAccessCount(ids, now)` | 新規 |
| 1073–1077 | search ヒット時に `mem_audit_log` にバッチ INSERT | `db.query().run()` (transaction内) | 新規: `auditLogRepo.batchInsertSearchHits(hits)` | 新規 |
| 1224–1226 | `feed` API: `mem_observations LEFT JOIN mem_events` を条件付きで取得（カーソルページング） | `db.query(sql).all()` | 新規: `observationRepo.feedPage(filter, cursor, limit)` | 新規（feedPage はカーソルページング付き） |
| 1319–1327 | `searchFacets`: project 別カウント GROUP BY | `db.query().all()` | 新規: `observationRepo.countByProject(filter)` | 新規 |
| 1330–1339 | `searchFacets`: event_type 別カウント GROUP BY (LEFT JOIN mem_events) | `db.query().all()` | 新規: `observationRepo.countByEventType(filter)` | 新規 |
| 1343–1356 | `searchFacets`: 時間バケット集計（24h/7d/30d/older） CASE CASE | `db.query().all()` | 新規: `observationRepo.countByTimeBucket(filter)` | 新規 |
| 1359–1361 | `searchFacets`: 総件数 COUNT | `db.query().get()` | `observationRepo.count(filter)` | 既存 |
| 1365–1373 | `searchFacets`: tags を `json_each` で GROUP BY（PG では `jsonb_array_elements` が対応） | `db.query().all()` | 新規: `observationRepo.countByTag(filter)` | 新規 |
| 1460–1472 | `timeline` API: center の前の同 session/project 観察を `created_at < ?` で取得 | `db.query().all()` | 新規: `observationRepo.findTimelineBefore(centerProject, centerSession, centerCreatedAt, limit)` | 新規 |
| 1475–1488 | `timeline` API: center の後の同 session/project 観察を `created_at > ?` で取得 | `db.query().all()` | 新規: `observationRepo.findTimelineAfter(centerProject, centerSession, centerCreatedAt, limit)` | 新規 |
| 1677–1688 | `resumePack`: 最新セッションサマリーを `mem_sessions` から取得（correlation_id 条件分岐あり） | `db.query().get()` | 新規: `sessionRepo.findLatestSummary(project, correlationId?)` | 新規 |
| 1693–1719 | `resumePack`: correlation_id あり/なし で `mem_observations JOIN mem_sessions` を取得 | `db.query().all()` | 新規: `observationRepo.findResumePackRows(project, correlationId?, excludeSessionId?, limit)` | 新規 |
| 1824–1835 | `resumePack`: `mem_facts` からアクティブなファクト取得（merged/superseded 除外） | `db.query().all()` | 新規: `factRepo.findActiveFacts(project)` | 新規（`IFactRepository` 未定義） |
| 1921–1945 | `getSubgraph`: entity 名で起点観察 ID を取得（`mem_observation_entities JOIN mem_entities`） | `db.query().all()` | 新規: `entityRepo.findObservationIdsByEntityName(entityName, project?)` | 新規（`IEntityRepository` 未定義） |
| 1959–1966 | `getSubgraph` BFS: `mem_links` で forward/backward リンクを取得 | `db.query().all()` | 新規: `linkRepo.findLinksByObservationIds(ids)` | 新規 |
| 1992–1998 | `getSubgraph`: ノード詳細を `mem_observations` から取得 | `db.query().all()` | `observationRepo.findByIds(ids)` | 既存 |
| 2001–2008 | `getSubgraph`: エンティティ情報を `mem_observation_entities JOIN mem_entities` から一括取得 | `db.query().all()` | 新規: `entityRepo.findEntitiesByObservationIds(ids)` | 新規 |

---

## harness-mem-core.ts

| 行 | SQL概要 | 現状 | 移行先 | 新規作成要否 |
|----|---------|------|--------|------------|
| 572–588 | `migrateLegacyProjectAliases`: 全テーブルから DISTINCT project を収集 | `db.query().all()` | 新規: `adminRepo.findAllDistinctProjects()` または起動時限定処理として許容 | 新規（起動時初期化処理のためグレーリスト化可） |
| 590–596 | `migrateLegacyProjectAliases`: `mem_observations` で project 別 weight 取得 | `db.query().all()` | 新規: `observationRepo.countByProjectAll()` | 新規 |
| 718–751 | `migrateLegacyProjectAliases` transaction: 複数テーブルの project 列を一括 UPDATE | `db.transaction()` + `db.query().run()` (複数) + `db.query().all()` + `db.query().run()` | 新規: `adminRepo.migrateProjectAliases(aliasMap)` または移行専用スクリプトへ切り出し | 新規（PG では transaction は async 対応が必要） |
| 866–872 | `upsertSessionSummary`: `mem_sessions` の summary/ended_at を UPDATE | `db.query().run()` | `sessionRepo.finalize(input)` | 既存 |
| 881–886 | `writeAuditLog`: `mem_audit_log` に INSERT | `db.query().run()` | 新規: `auditLogRepo.insert(entry)` | 新規（`IAuditLogRepository` 未定義） |
| 895–899 | `processRetryQueue`: 処理対象キューアイテムを SELECT（`next_retry_at <= now`） | `db.query().all()` | 新規: `retryQueueRepo.findPendingItems(now, limit)` | 新規（`IRetryQueueRepository` 未定義） |
| 906 | `processRetryQueue`: 処理成功時に DELETE | `db.query().run()` | 新規: `retryQueueRepo.delete(id)` | 新規 |
| 912 | `processRetryQueue`: parse エラー時に DELETE | `db.query().run()` | 新規: `retryQueueRepo.delete(id)` | 新規（上と同一メソッド） |
| 919–925 | `processRetryQueue`: retry_count/next_retry_at を UPDATE | `db.query().run()` | 新規: `retryQueueRepo.updateRetry(id, retryCount, nextRetryAt)` | 新規 |
| 991 | `bulkDeleteObservations`: observation の `privacy_tags` を SELECT で確認 | `db.query().get()` | `observationRepo.findById(id)` | 既存 |
| 1000 | `bulkDeleteObservations`: `privacy_tags` を UPDATE（soft delete） | `db.query().run()` | `observationRepo.updatePrivacyTags(id, tagsJson)` | 既存 |
| 1038 | `exportObservations`: `mem_observations` を条件付きで全件 SELECT | `db.query(sql).all()` | `observationRepo.findMany(filter)` | 既存（export 用 content/privacy_tags カラム追加が必要な場合あり） |
| 1066–1069 | `health`: sessions/events/observations/retry_queue の COUNT を各テーブルから取得 | `db.query().get()` × 4 | `sessionRepo.count()` + `observationRepo.count()` + `retryQueueRepo.count()` + 新規 `eventRepo.count()` | 一部新規（`IEventRepository.count()` が未定義） |
| 1153–1160 | `metrics`: vectors/vec_map/observations カバレッジを集計 | `db.query().get()` | `vectorRepo.coverage(currentModel)` + `observationRepo.count()` | 既存（combinedで一発取得するか分割するか要検討） |
| 1162–1169 | `metrics`: retry_queue の count/max_retry_count | `db.query().get()` | 新規: `retryQueueRepo.stats()` | 新規 |
| 1171–1182 | `metrics`: consolidation_queue の pending/running/failed/completed 件数 | `db.query().get()` | 新規: `consolidationRepo.stats()` | 新規（`IConsolidationRepository` 未定義） |
| 1184–1192 | `metrics`: `mem_facts` の総数・merged 数 | `db.query().get()` | 新規: `factRepo.stats()` | 新規 |
| 1377–1382 | `createLink`: `mem_links` に INSERT OR IGNORE | `db.query().run()` | 新規: `linkRepo.createLink(input)` | 新規 |
| 1417 | `getLinks`: `mem_links` を observation_id + relation で SELECT | `db.query(sql).all()` | 新規: `linkRepo.findByObservationId(observationId, relation?)` | 新規 |
| 1548 | `shutdown`: `PRAGMA wal_checkpoint(TRUNCATE)` を実行（WAL の切り詰め） | `db.exec()` | PG では不要（WAL 管理は PG 側が担当）→ 削除でよい | 削除 |
| 1585–1599 | `compressMemory`: アクティブなファクト数を COUNT（project あり/なし 分岐） | `db.query().get()` | 新規: `factRepo.countActive(project?)` | 新規 |
| 1625–1633 | `compressMemory (prune)`: `mem_facts` の低 confidence ファクトを `valid_to` で UPDATE | `db.query().run()` | 新規: `factRepo.pruneByConfidence(threshold, project?)` | 新規 |
| 1643–1653 | `compressMemory (merge)`: 重複 fact_key を GROUP BY で特定 | `db.query().all()` | 新規: `factRepo.findDuplicateFactKeys(project?)` | 新規 |
| 1661–1670 | `compressMemory (merge)`: 保持するファクトの fact_id を SELECT | `db.query().get()` | 新規: `factRepo.findLatestByFactKey(factKey, latestAt, project?)` | 新規 |
| 1680–1689 | `compressMemory (merge)`: 重複ファクトを `merged_into_fact_id` で UPDATE | `db.query().run()` | 新規: `factRepo.mergeDuplicates(keepId, factKey, project?)` | 新規 |
| 1727–1735 | `knowledgeStats`: `mem_facts` を fact_type 別に GROUP BY | `db.query().all()` | 新規: `factRepo.countByType()` | 新規 |
| 1738–1744 | `knowledgeStats`: `mem_observations` を project 別に GROUP BY | `db.query().all()` | `observationRepo.countByProjectAll()` （上記と共通化） | 新規 |
| 1747–1761 | `knowledgeStats`: observations/facts/sessions/links の総数を一発 SELECT | `db.query().get()` | `observationRepo.count()` + `sessionRepo.count()` + `factRepo.countAll()` + `linkRepo.countAll()` | 一部新規 |

---

## 移行優先度サマリー

### グループA: 既存 Repository で対応可能（コード変更最小）

以下は既存インターフェースに対応するメソッドが存在し、呼び出し側を async/await に切り替えるだけで対応可能。

| ファイル | 行 | 移行先 |
|---------|-----|--------|
| observation-store.ts | 1359–1361 | `observationRepo.count(filter)` |
| observation-store.ts | 1992–1998 | `observationRepo.findByIds(ids)` |
| observation-store.ts | 446–453 | `vectorRepo.coverage(currentModel)` |
| harness-mem-core.ts | 866–872 | `sessionRepo.finalize(input)` |
| harness-mem-core.ts | 991 | `observationRepo.findById(id)` |
| harness-mem-core.ts | 1000 | `observationRepo.updatePrivacyTags(id, tagsJson)` |
| harness-mem-core.ts | 1038 | `observationRepo.findMany(filter)` |

### グループB: 既存インターフェースへの拡張で対応可能

既存インターフェースに引数やメソッドを追加することで対応。

| 新規メソッド | 追加先インターフェース |
|-------------|----------------------|
| `findMany` にカーソルページング対応 | `IObservationRepository` |
| `findResumePackRows(project, correlationId?, excludeSessionId?, limit)` | `IObservationRepository` |
| `batchIncrementAccessCount(ids, now)` | `IObservationRepository` |
| `feedPage(filter, cursor, limit)` | `IObservationRepository` |
| `findTimelineBefore / findTimelineAfter` | `IObservationRepository` |
| `countByProject / countByEventType / countByTimeBucket / countByTag` | `IObservationRepository` |
| `findLegacyObservationIds / bruteForceCandidates` | `IVectorRepository` |
| `annSearch(queryVector, filter, limit)` | `IVectorRepository` |
| `findFallbackModel(currentModel)` | `IVectorRepository` |
| `findLatestSummary(project, correlationId?)` | `ISessionRepository` |

### グループC: 新規 Repository インターフェースが必要

| 新規インターフェース | 担当ドメイン |
|---------------------|------------|
| `ILinkRepository` | `mem_links` の CRUD・グラフ探索 |
| `IFactRepository` | `mem_facts` の CRUD・統計・圧縮 |
| `IEntityRepository` | `mem_entities` / `mem_observation_entities` |
| `IAuditLogRepository` | `mem_audit_log` の INSERT・集計 |
| `IRetryQueueRepository` | `mem_retry_queue` の CRUD |
| `IConsolidationRepository` | `mem_consolidation_queue` の統計 |

### グループD: PG 移行で削除または特別対応が必要

| 箇所 | 理由 |
|------|------|
| `db.exec("PRAGMA wal_checkpoint(TRUNCATE)")` (core.ts:1548) | PG では不要。削除でよい |
| FTS (`mem_observations_fts MATCH ?`) (obs-store.ts:280–282) | PG では `tsvector/tsquery` に置き換え。`IFtsRepository` か `observationRepo.ftsSearch()` を新設 |
| sqlite-vec ANN 検索 (obs-store.ts:339–341) | PG では `pgvector` の `<->` ANN 演算子に置き換え |
| `db.transaction(...)` (core.ts:718–751) | PG では `await pool.connect()` + `client.query('BEGIN')` の非同期トランザクションに置き換え |

---

## 移行ステップ（推奨順）

1. **グループA**: 既存 repo 呼び出しへの差し替え（`observation-store.ts` / `harness-mem-core.ts` の関数を `async` 化）
2. **グループB**: 既存インターフェースを拡張し、SQLite 実装を追加 → テスト確認
3. **グループC**: 新規 Repository インターフェースを定義し、SQLite 実装を追加
4. **グループD**: PG 実装時に FTS / ANN / transaction を PG ネイティブ実装に置き換え
5. 全 Repository に PG 実装（`PgObservationRepository` 等）を追加
6. `adapter-factory.ts` で `PG` バックエンドが選択された際に PG リポジトリを注入

---

_このドキュメントはコード変更なし（調査のみ）で作成された設計資料です。_
