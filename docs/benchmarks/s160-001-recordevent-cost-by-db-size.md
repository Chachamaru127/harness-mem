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

**E2E の中央値は DB サイズに対して単調増加していない**（1gb: 30.348ms →
4.9gb: 26.769ms、4.9gb のほうが速い）。単調増加しているのは `auto_link` 単体
（表2、149倍）であって E2E 全体ではない。これは表2の `auto_supersedes` が
1gb で 14.461ms、4.9gb で 1.410ms と逆方向に大きく動いていることが相殺したため
（キャッシュ状態に左右される不安定な挙動、詳細は「なぜ auto_link が支配区間と
言えるか」参照）。p90 / max は 1gb → 4.9gb でも増加傾向を維持している
（p90: 41.852ms → 40.841ms でほぼ同水準、max: 57.078ms → 68.803ms で増加）。
**「DB サイズに比例して悪化する」と言えるのは `auto_link` という特定区間についてであり、
E2E 全体の挙動として単純な比例関係を主張しているわけではない。**

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
「DB 書き込みだけ」を分離測定した。

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

## この測定が確定していないこと

`auto_link` が行数に比例して悪化する支配区間であること、その機構が
`idx_mem_obs_project_session_created` の全件スキャンであることは、上記の
`EXPLAIN QUERY PLAN` 実測により確定している。一方で、以下の 3 点はこの測定
だけでは確定していない。

### (1) 本番の「tick 11 秒」との対応づけは未確認

§160 の起票根拠は Plans.md の実測「本番 4.9GB DB 稼働中の tick で `claude_code` が
11120ms のブロックを記録」。本測定の 4.9GB tier での E2E `recordEvent()` は
p50=26.769ms であり、3 桁（約 415 倍）の差がある。

この差は算術としては件数で説明がつく可能性がある: 11120ms ÷ 26.769ms ≈ 415 件。
`ingestClaudeCodeSessions()`（`memory-server/src/core/ingest-coordinator.ts`）は
1 tick で最大 `MAX_FILES_PER_POLL`（既定 50）ファイルを処理でき、かつ
「進捗保証」として **1 件目のファイルと 1 件目のスライスは budget
（既定 `HARNESS_MEM_INGEST_TICK_BUDGET_MS` = 200ms）を超過していても必ず処理する**
実装になっている（同ファイル 2680-2687 行「進捗保証」コメント直後の
`filesVisited > 0 &&` / 2725-2731 行の `slicesProcessed > 0 &&` という 2 箇所の
budget チェックを参照）。したがって、1 ファイル目の
1 スライス（既定 `MAX_BYTES_PER_FILE` = 512KB）に数百件のイベントが含まれる
catch-up シナリオでは、tick 全体が budget を大きく超えて 415 件規模の
`recordEvent` を連続実行することは**機構としては起こり得る**。

ただし、これは「起こり得る」という設計上の可能性の指摘であり、2026-07-28 に
実際に観測された 11120ms のブロックの中で何件の `recordEvent` が呼ばれていたかは
**確認していない**（該当 tick の production ログを本タスクでは参照していない）。
本測定が確定したのは「1 件あたりのコストが行数に比例して悪化する」ことであり、
「auto_link を直せば本番 tick 11 秒も同程度に短縮される」ことは**この測定単独では
言えない**。件数の対応づけが取れるかどうかは §160-002 着手前に production ログで
確認することを推奨する。

### (2) 効いている独立変数は「DB サイズ（バイト数）」ではなく「observation 行数」

`idx_mem_obs_project_session_created` の全件スキャンはインデックスのページ数、
つまり行数に比例するコストであり、DB ファイルのバイト数そのものに比例するわけ
ではない。本測定の 3 点は 55 行 / 80,157 行 / 377,055 行で、4.9GB の内訳は
377,055 行 × 約 13KB/行という本ベンチの合成データ固有の構成である
（`scripts/s160-001-gen-synthetic-db.ts` の 1 行あたりのペイロード生成量に依存）。

本番の 4.9GB DB が同じ「1 行あたり約 13KB」という比率を持つとは限らない
（vector 次元数、payload 長、nugget/entity/relation 等の副次テーブルの構成比が
異なれば同じバイト数でも行数は変わる）。本番 DB の実際の `mem_observations` 行数は
**未確認**（本番 DB への読み取りアクセスは §159 の合意により本タスクでは行っていない）。
本測定の結論を「DB サイズ」ではなく「observation 行数」に対する支配区間として
読むのが正確であり、本番のバイト数から行数への換算は別途確認が必要。

### (3) ページキャッシュの状態

4.9GB DB の生成・計測は、生成直後で OS ページキャッシュが温まった状態
（ホストの空きメモリに対して 5GB 程度のファイルは十分キャッシュに載り得る）で
行っている。本番の実運用では daemon 再起動直後やメモリ圧迫時にキャッシュが
冷えた状態で `auto_link` のインデックス全件スキャンが走る可能性があり、その場合は
本測定より更に悪化する（`pread` のコストが顕在化する）と考えられるが、これは
本測定では**検証していない**。真のコールドキャッシュ条件下の挙動は未確認。

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
