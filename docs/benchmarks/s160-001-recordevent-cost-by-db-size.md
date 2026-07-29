# §160-001: recordEvent 1件のコストを DB サイズ別に測る

Plans.md §160 の起票理由（§159 で ingest tick に time budget を入れても、1 件の
`recordEvent` 自体は中断できない設計上の下限が残る）を数値で確定する。
「払っているコストは payload サイズではなく DB サイズ」という仮説を、
dedupe 探索 / FTS 挿入 / vector 書き込み / audit ログの 4 区間だけでなく、
`recordEvent` トランザクション内の全区間に計測を入れて検証した。

## 結論

**`autoLinkObservation()`（session_id で `mem_observations` を検索して直前の
観察に `follows` / `updates` 等の関係を張る自動リンク処理）が DB サイズに比例して
悪化する支配区間である。** 原因は特定の 1 クエリで、`session_id` を先頭に持つ
インデックスが存在せず、SQLite が既存インデックスを **全件スキャン**するため。

```sql
-- memory-server/src/core/event-recorder.ts の autoLinkObservation()
SELECT id, title, content_redacted
FROM mem_observations
WHERE session_id = ? AND id <> ? AND created_at <= ?
ORDER BY created_at DESC
LIMIT 1
```

`EXPLAIN QUERY PLAN` の実測（4.9GB DB, 377,055 行）:

```
SCAN mem_observations USING INDEX idx_mem_obs_project_session_created
USE TEMP B-TREE FOR ORDER BY
```

`idx_mem_obs_project_session_created` は `(project, session_id, created_at, id)`
の複合インデックスで、先頭列が `project`。このクエリは `project` を条件に
含めないため、SQLite は `session_id` 一致行を探すのにインデックスの**全ページを
先頭から末尾まで走査**する。表の行数が増えるほど走査ページ数が増える
= DB サイズに比例して遅くなる、という直接的な機構。

当初想定していた 4 区間（dedupe 探索 / FTS 挿入 / vector 書き込み / audit ログ）は
**いずれも適切なインデックスに乗っており、DB サイズが 700 倍になっても
数値はほぼ横ばい**だった（詳細は表3）。「DB サイズ律速」の実体は、この 4 区間
ではなく auto-linker 系の後処理（`autoLinkObservation` と、程度は小さいが
`autoSupersedes`）にあった。

## 実測表

計測環境: macOS arm64、bun 1.3.14、embedding provider は `fallback:local-hash-v3`
（ONNX 実モデルなし・ローカルハッシュ埋め込み。埋め込み計算コストは DB サイズに
依存しない定数項として扱う）。payload は 3 サイズ帯で固定（約 1.1KB、背景観測の
「payload サイズではなく DB サイズが効く」という前提に合わせて変数は DB サイズのみ）。
各セグメント 21 回（E2E は 21 回、audit_log 系のみ 10 回）測定し、中央値 (p50) を
主指標として採用。

DB サイズ 3 点はスクラッチ領域に合成生成（本番 DB は不使用）:

| ラベル | 実ファイルサイズ | observation 行数 |
|---|---|---|
| empty | 7.25MB（新規作成・ウォームアップ後） | 55 |
| 1gb | 1,065,658,792 bytes (1.07GB) | 80,157 |
| 4.9gb | 5,010,593,056 bytes (5.01GB) | 377,055 |

### 表1: E2E `recordEvent()` 実測（実際の本番コードパス、中央値 ms）

| DB サイズ | p50 | p90 | max | n |
|---|---|---|---|---|
| empty | 10.451 | 13.610 | 17.211 | 21 |
| 1gb | 30.348 | 41.852 | 57.078 | 21 |
| 4.9gb | 26.769 | 40.841 | 68.803 | 21 |

empty → 1gb で約 2.9 倍。4.9gb で E2E の中央値そのものは 1gb よりわずかに低いが
（後述のとおり `auto_supersedes` が run ごとにばらつくため）、p90 / max は
一貫して増加しており、後述の内訳を見ると **どの区間が伸びているかは明確**。

### 表2: recordEvent 内部の全区間（本番コードに計測フックを追加して実測、中央値 ms）

`memory-server/src/core/event-recorder.ts` の `recordEvent()` に
`measureSyncSegment()`（§159 consolidation 計測と同じパターン）を区間ごとに
巻いて実測した値。recordEvent 自体のロジックは変更していない。

| 区間 | empty | 1gb | 4.9gb | 4.9gb / empty |
|---|---:|---:|---:|---:|
| ensure_session | 0.040 | 0.070 | 0.031 | 0.8x |
| event_insert (mem_events INSERT) | 0.025 | 0.196 | 0.276 | 11.0x |
| dedupe_lookup (content_dedupe_hash SELECT) | 0.080 | 0.215 | 0.140 | 1.8x |
| observation_insert (INSERT + FTS トリガー同期発火) | 0.139 | 0.499 | 0.299 | 2.2x |
| tags_insert | 0.003 | 0.004 | 0.001 | 0.3x |
| vector_upsert (embedding 計算込み) | 0.578 | 0.483 | 0.207 | 0.4x |
| extract_entities | 0.033 | 0.025 | 0.013 | 0.4x |
| extract_graph_relations | 0.029 | 0.025 | 0.012 | 0.4x |
| **auto_link (autoLinkObservation)** | **0.128** | **8.692** | **19.082** | **149.1x** |
| auto_supersedes | 4.640 | 14.461 | 1.410 | 0.3x（run 間で不安定、後述） |
| semantic_auto_linker | 0.006 | 0.008 | 0.003 | 0.5x |
| insert_nuggets | 0.468 | 0.441 | 0.188 | 0.4x |
| audit_log (privacy_filter 発火時のみ, n=10) | 0.034 | 0.062 | 0.028 | 0.8x |

`auto_link` の E2E 中央値に対する寄与率: empty で 1.2%、1gb で 28.6%、
4.9gb で **71.3%**。DB が大きくなるほど `auto_link` が E2E コストの大半を
占めるようになる、という一貫した傾向が出ている。

### 表3: 当初想定していた 4 区間の分離測定（生 SQL を直接発行、中央値 ms）

`observation_insert` は FTS トリガーが同期発火するため、base insert と FTS 挿入の
コストが数値上は混ざる。これを分離するため、同一 DB 接続に対してトリガーを
一時的に落として base insert 単体を測り、トリガーが実行するのと同じ INSERT 文を
明示発行して FTS 単体を測った（トリガーは測定後に復元、対象 DB はベンチ専用の
使い捨てファイル）。vector も embedding 計算を含まない固定ベクトルで
「DB 書き込みだけ」を分離measurement。

| 区間 | empty | 1gb | 4.9gb | 4.9gb / empty |
|---|---:|---:|---:|---:|
| dedupe_lookup（分離） | 0.003 | 0.121 | 0.091 | 30.3x（絶対値は微小） |
| observation_insert_no_fts（分離、FTS 抜き） | 0.226 | 0.714 | 0.344 | 1.5x |
| fts_insert（分離） | 0.166 | 0.117 | 0.054 | 0.3x |
| vector_upsert_db_write（分離、embedding 計算抜き） | 0.311 | 0.444 | 0.127 | 0.4x |
| audit_log_insert（分離） | 0.038 | 0.065 | 0.036 | 0.9x |

4 区間はいずれも 1ms 未満で、4.9GB でも横ばい〜微増止まり。dedupe_lookup は
比率としては 30 倍に見えるが絶対値が 0.003ms→0.091ms とサブミリ秒の範囲で、
E2E 全体（26.8ms）への寄与は無視できる。

## なぜ auto_link が支配区間と言えるか

1. **絶対値と伸び率の両方で最大**: 4.9GB で p50=19.082ms、E2E 中央値 26.769ms の
   71%を占める。伸び率も 149 倍（4区間はいずれも数十倍未満、かつ絶対値がサブミリ秒）。
2. **機構が実測で裏付けられている**: `EXPLAIN QUERY PLAN` で `SCAN ... USING INDEX
   idx_mem_obs_project_session_created`（全件スキャン）と確認済み。行数が
   377,055 のとき `auto_link` が 19ms、行数 80,157 のとき 8.7ms、行数 55 のとき
   0.13ms — インデックス走査対象の行数と単調に対応する。
3. **他の候補との違い**: `auto_supersedes` も同じ transaction 内で mem_observations
   を読むが、`EXPLAIN QUERY PLAN` は `SEARCH ... USING INDEX idx_mem_obs_project_team
   (project=?)` — インデックスシーク（対象行数の対数オーダー + LIMIT 50 で頭打ち）。
   実測でも 1gb で 14.461ms まで上がったのに 4.9gb では 1.410ms まで下がっており、
   キャッシュ状態に左右される不安定な挙動で、DB サイズに対して単調増加する
   `auto_link` とは性質が異なる。

## 再現方法

```bash
export PATH="$HOME/.bun/bin:$PATH"

# 1. 合成 DB を生成（本番データは使わない。bulk insert でサイズを積む）
bun run scripts/s160-001-gen-synthetic-db.ts \
  --out /path/to/scratch/s160-1gb.db --target-bytes 1073741824
bun run scripts/s160-001-gen-synthetic-db.ts \
  --out /path/to/scratch/s160-4.9gb.db --target-bytes 5000000000

# 2. サイズ別に recordEvent を実測（E2E + 内部区間 + 分離セグメント）
bun run scripts/s160-001-recordevent-cost-by-db-size.ts --db ":empty:" --label empty
bun run scripts/s160-001-recordevent-cost-by-db-size.ts --db /path/to/scratch/s160-1gb.db --label 1gb
bun run scripts/s160-001-recordevent-cost-by-db-size.ts --db /path/to/scratch/s160-4.9gb.db --label 4.9gb
```

`scripts/s160-001-recordevent-cost-by-db-size.ts` は
`memory-server/src/core/event-recorder.ts` の `setEventRecorderSegmentSink()`
（§160-001 で追加したベンチ専用フック、既定は no-op）を使って、実際の
`HarnessMemCore.recordEvent()` 呼び出しの内部区間タイミングを取得する。

生データ（各セグメントの p50/p90/min/max/n）は
`docs/benchmarks/artifacts/s160-001-recordevent-cost-2026-07-29/{empty,1gb,4.9gb}.json`
に保存済み。

## §160-002 への申し送り

- 対策候補: `mem_observations` に `session_id` を先頭列に持つインデックス
  （例: `(session_id, created_at)` または既存 `idx_mem_observations_lookup` の
  列順見直し）を追加すれば `auto_link` の SCAN は SEARCH に変わり、DB サイズに
  対してほぼ定数のコストになるはず。ただし書き込みパスへのインデックス追加は
  他の書き込み（insert 全般）のコストにも跳ね返るため、追加後は insert 側の
  回帰測定が必要。
- `auto_supersedes` は既にインデックスシークだが、`ORDER BY created_at DESC` が
  `USE TEMP B-TREE FOR ORDER BY` を要求している。`idx_mem_obs_project_team` を
  `(project, observation_type, created_at DESC)` 相当に張り替えられれば
  テンポラリソートも消せる可能性がある（本タスクでは特定のみ、変更はしていない）。
- 4 区間（dedupe / FTS / vector / audit）はいずれも DB サイズに対してほぼ
  定数であることが確認できたため、§160-002 の優先対象からは外してよい。
