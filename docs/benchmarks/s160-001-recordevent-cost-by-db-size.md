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

`EXPLAIN QUERY PLAN` は、生成器の vec0 欠陥修正前に作った 4.9GB DB（377,055 行）
に対する実測である。このプランを取得した DB は測定後に削除済みで、以下の
表1〜3 の数値（vec0 サイドカーに実データが入った状態で取り直した別 run）とは
異なる DB を使っている:

```
SCAN mem_observations USING INDEX idx_mem_obs_project_session_created
USE TEMP B-TREE FOR ORDER BY
```

`idx_mem_obs_project_session_created` は `(project, session_id, created_at, id)`
の複合インデックスで、先頭列が `project`。このクエリは `project` を条件に
含めないため、SQLite は `session_id` 一致行を探すのにインデックスの**全ページを
先頭から末尾まで走査**する。表の行数が増えるほど走査ページ数が増える
= DB サイズに比例して遅くなる、という直接的な機構。この主張はテーブルの
インデックス構成（列順）とクエリプランに基づいており、以下の表のタイミング
測定がどの run のものであるかとは独立に成立する（インデックス定義自体は
run 間で変更していない）。

当初想定していた dedupe 探索 / FTS 挿入 / vector 書き込み / audit ログの区間は、
vec0 サイドカーに実データが入った状態で計測すると、表3の 5 区間すべてが
DB サイズに対して増加する（詳細は表3）。ただし増加後の絶対値は 4.9GB でも
0.150ms 〜 1.675ms の範囲にとどまり、`auto_link`（4.9GB で 31.459ms）とは
1〜2 桁小さい。「DB サイズ律速」の実体はこの区間群ではなく、auto-linker 系の
後処理（`autoLinkObservation` と、程度は小さいが `autoSupersedes`）にある。
この結論自体は変わらない。

## 実測表

計測環境: macOS arm64、bun 1.3.14、embedding provider は `fallback:local-hash-v3`
（ONNX 実モデルなし・ローカルハッシュ埋め込み。埋め込み計算コストは DB サイズに
依存しない定数項として扱う）。payload は 3 サイズ帯で固定（約 1.1KB、背景観測の
「payload サイズではなく DB サイズが効く」という前提に合わせて変数は DB サイズのみ）。
測定回数は測定系ごとに異なる。E2E（表1）と分離測定（表3、`isolated_segments`）は
21 回。内部区間（表2、`internal_segments`）は 31 回 — E2E ループの 21 回に加え、
audit ログ検証用の追加ループ（`privacy_tags: ["private"]` 付き 10 回）も同じ
`recordEvent` 経路を通るため合算される。`audit_log` 区間だけは後者の 10 回のみ。
いずれも中央値 (p50) を主指標として採用。実際の回数は
`docs/benchmarks/artifacts/s160-001-recordevent-cost-2026-07-29/*.json` の各区間の
`n` フィールドに記録されている。

DB サイズ 3 点はスクラッチ領域に合成生成（本番 DB は不使用）:

| ラベル | 実ファイルサイズ | observation 行数 |
|---|---|---|
| empty | 7,275,560 bytes (7.28MB、新規作成後、ウォームアップ済み) | 55 |
| 1gb | 1,031,273,032 bytes (1.03GB) | 71,055 |
| 4.9gb | 4,963,567,064 bytes (4.96GB) | 340,055 |

### 表1: E2E `recordEvent()` 実測（実際の本番コードパス、中央値 ms）

| DB サイズ | p50 | p90 | max | n |
|---|---|---|---|---|
| empty | 4.286 | 7.122 | 8.335 | 21 |
| 1gb | 13.392 | 27.530 | 36.432 | 21 |
| 4.9gb | 39.048 | 43.214 | 49.519 | 21 |

E2E の中央値は DB サイズに対して単調増加している（empty: 4.286ms → 1gb:
13.392ms → 4.9gb: 39.048ms、4.9gb/empty で 9.1 倍）。p90（7.122ms → 27.530ms →
43.214ms）、max（8.335ms → 36.432ms → 49.519ms）もいずれも単調増加している。
表2で見る `auto_link` 単体の伸び（551.9 倍）と方向が一致しており、E2E 全体の
増加は `auto_link` の増加でおおむね説明できる。

### 表2: recordEvent 内部の全区間（本番コードに計測フックを追加して実測、中央値 ms）

`memory-server/src/core/event-recorder.ts` の `recordEvent()` に
`measureSyncSegment()`（§159 consolidation 計測と同じパターン）を区間ごとに
巻いて実測した値。recordEvent 自体のロジックは変更していない。

| 区間 | empty | 1gb | 4.9gb | 4.9gb / empty |
|---|---:|---:|---:|---:|
| ensure_session | 0.015 | 0.037 | 0.049 | 3.3x |
| event_insert (mem_events INSERT) | 0.011 | 0.208 | 0.108 | 9.8x |
| dedupe_lookup (content_dedupe_hash SELECT) | 0.032 | 0.208 | 0.179 | 5.6x |
| observation_insert (INSERT + FTS トリガー同期発火) | 0.057 | 0.380 | 0.312 | 5.5x |
| tags_insert | 0.001 | 0.003 | 0.001 | 1.0x |
| vector_upsert (embedding 計算込み) | 0.216 | 0.524 | 0.427 | 2.0x |
| extract_entities | 0.015 | 0.021 | 0.021 | 1.4x |
| extract_graph_relations | 0.015 | 0.020 | 0.020 | 1.3x |
| **auto_link (autoLinkObservation)** | **0.057** | **5.828** | **31.459** | **551.9x** |
| auto_supersedes | 1.693 | 2.535 | 2.939 | 1.7x（後述） |
| semantic_auto_linker | 0.003 | 0.004 | 0.005 | 1.7x |
| insert_nuggets | 0.199 | 0.266 | 0.349 | 1.8x |
| audit_log (privacy_filter 発火時のみ, n=10) | 0.013 | 0.048 | 0.048 | 3.7x |

`auto_link` の E2E 中央値に対する寄与率: empty で 1.3%、1gb で 43.5%、
4.9gb で **80.6%**。DB が大きくなるほど `auto_link` が E2E コストの大半を
占めるようになる、という一貫した傾向が出ている。

表1〜表3 の全数値は、vec0 サイドカーに実データが入った状態で取られた
単一 run のものである。

### 表3: 当初想定していた 4 区間の分離測定（生 SQL を直接発行、中央値 ms）

`observation_insert` は FTS トリガーが同期発火するため、base insert と FTS 挿入の
コストが数値上は混ざる。これを分離するため、同一 DB 接続に対してトリガーを
一時的に落として base insert 単体を測り、トリガーが実行するのと同じ INSERT 文を
明示発行して FTS 単体を測った（トリガーは測定後に復元、対象 DB はベンチ専用の
使い捨てファイル）。vector も embedding 計算を含まない固定ベクトルで
「DB 書き込みだけ」を分離測定した。

| 区間 | empty | 1gb | 4.9gb | 4.9gb / empty |
|---|---:|---:|---:|---:|
| dedupe_lookup（分離） | 0.002 | 0.102 | 0.150 | 75.0x（絶対値は微小） |
| observation_insert_no_fts（分離、FTS 抜き） | 0.094 | 0.624 | 0.879 | 9.4x |
| fts_insert（分離） | 0.071 | 0.088 | 0.556 | 7.8x |
| vector_upsert_db_write（分離、embedding 計算抜き） | 0.129 | 0.231 | 1.675 | 13.0x |
| audit_log_insert（分離） | 0.023 | 0.048 | 0.545 | 23.7x |

5 区間すべてが DB サイズに対して増加しており、`observation_insert_no_fts` /
`fts_insert` / `audit_log_insert` の 3 区間も 4.9GB で 0.5ms 台まで上がっている。
それでも絶対値は 4.9GB でも最大 1.675ms（`vector_upsert_db_write`）にとどまる。
`dedupe_lookup` は比率としては 75.0 倍だが、
絶対値は 0.002ms → 0.150ms（増加分 0.148ms）で、E2E 全体（4.9GB で 39.048ms）
への寄与は無視できる。

合成 DB 生成スクリプト（`scripts/s160-001-gen-synthetic-db.ts`）には当初、
`configureBunCustomSqliteForSqliteVec()` を経由せず素の `new Database()` を
使っていたため sqlite-vec 拡張がロードされず、`upsertSqliteVecRow()` が内部の
catch で `false` を返して破棄されるという欠陥があった。この欠陥下で生成した
DB は vec0 サイドカーテーブルが空のまま合成されており、`vector_upsert_db_write`
の計測値は「空のテーブルへの書き込み」を測っていたに過ぎなかった（生成スクリプトは
この `false` を無視していたため、失敗は表面化しなかった）。

生成スクリプトを修正（`configureBunCustomSqliteForSqliteVec()` 呼び出し追加、
`upsertSqliteVecRow()` が `false` を返したら即座に例外を投げるよう変更）した上で
1gb（71,055 行）/ 4.9gb（340,055 行）tier を作り直し、生成後と測定後の両時点で
vec0 サイドカーテーブルの行数が `mem_observations` の行数と厳密に一致することを
確認した。表1〜表3 の数値はすべてこの修正後の DB に対する計測であり、
`vector_upsert_db_write` は empty 0.129ms → 1gb 0.231ms → 4.9gb 1.675ms
（4.9GB/empty で 13.0 倍）と DB サイズに対して明確に増加している。ただし絶対値は
`auto_link`（4.9GB で 31.459ms）より 1〜2 桁小さく、`auto_link` が支配区間である
という結論そのものは変わらない。

## なぜ auto_link が支配区間と言えるか

1. **絶対値と伸び率の両方で最大**: 4.9GB で p50=31.459ms、E2E 中央値 39.048ms の
   80.6%を占める。伸び率 551.9 倍、絶対増加量 +31.402ms（0.057ms→31.459ms）は
   いずれも全区間中で最大である。伸び率の次点は `dedupe_lookup`（表3の分離測定、
   75.0倍）だが、これは分母（empty での値 0.002ms）が極小なためで、絶対増加量は
   +0.148ms（0.002ms→0.150ms）にとどまる。`auto_link` の絶対増加量はこの
   約 212 倍にあたる。
2. **機構が実測で裏付けられている**: `EXPLAIN QUERY PLAN` で `SCAN ... USING INDEX
   idx_mem_obs_project_session_created`（全件スキャン）と確認済み（「結論」の
   節を参照。このプランは生成器修正前の DB で取得したものだが、インデックス
   定義自体は run 間で変えていないため結論は独立に成立する）。本測定（この
   run）でも行数が 340,055 のとき `auto_link` が 31.459ms、71,055 のとき
   5.828ms、55 のとき 0.057ms であり、インデックス走査対象の行数と単調に対応する。
3. **他の候補との違い**: `auto_supersedes` も同じ transaction 内で mem_observations
   を読むが、`EXPLAIN QUERY PLAN` は `SEARCH ... USING INDEX idx_mem_obs_project_team
   (project=?)` であり、インデックスシーク（対象行数の対数オーダー + LIMIT 50 で頭打ち）。
   実測でも empty 1.693ms → 1gb 2.535ms → 4.9gb 2.939ms と DB サイズに対して
   `auto_link` と同様に単調増加しているが、伸び率は 1.7 倍にとどまる。`SCAN`
   （`auto_link`）と `SEARCH`（`auto_supersedes`）というクエリプランの違いが、
   551.9 倍 対 1.7 倍という伸び率の差に対応している。

## この測定が確定していないこと

`auto_link` が行数に比例して悪化する支配区間であること、その機構が
`idx_mem_obs_project_session_created` の全件スキャンであることは、上記の
`EXPLAIN QUERY PLAN` 実測により確定している。一方で、以下の 5 点はこの測定
だけでは確定していない。

### (1) run 間の再現性: 同じ 4.9GB tier で行数が減っても実測値は上がった

同じコードと同じ生成器で作った 4.9GB tier に対して、生成器の vec0 欠陥修正前後で
2 回計測している。修正前（vec0 サイドカーが空のまま生成された DB、377,055 行）の
`auto_link` p50 は 19.082ms だった。修正後（vec0 に 340,055 行の実ベクトルが
入った DB、本ページの表1〜3 が使っている run）の `auto_link` p50 は
31.459ms だった。行数は
377,055 → 340,055 と約 9.8% 減っているにもかかわらず、所要時間は 19.082ms →
31.459ms へと約 1.65 倍に増えている。

`autoLinkObservation()` が全件スキャンするのは `mem_observations` テーブルの
インデックスであり、vec0 サイドカーテーブルとは別のファイル領域にある。行数だけ
から予測すれば `auto_link` の所要時間は下がるはずだが、実際には逆に増えた。
2 回の run 間の差は測定ノイズだけでは説明がつかず、DB の内容そのものが違う
（この run は vec0 サイドカーに 340,055 行分の実ベクトルデータが入っている）
ことと交絡している。この食い違いを「vec0 のページが OS のページキャッシュを
圧迫し、`mem_observations` のインデックスページがキャッシュから押し出された」
という仮説で説明することはできるが、**この仮説は検証していない**。

本文中の倍率（`auto_link` の 4.9gb/empty で 551.9 倍、E2E p50 の
4.9gb/empty で 9.1 倍など）は、いずれも 1 回の計測の p50 に基づく値である。
run 間変動を含めた精度では読めない。「`auto_link` が支配区間である」という相対的な
結論（他区間との差が 1〜2 桁あること）は 2 回の run を通じて揺らいでいないが、
倍率の桁未満の精度は主張できない。

### (2) 本番の「tick 11 秒」との対応づけは未確認

§160 の起票根拠は Plans.md の実測「本番 4.9GB DB 稼働中の tick で `claude_code` が
11120ms のブロックを記録」。本測定の 4.9GB tier での E2E `recordEvent()` は
p50=39.048ms であり、3 桁（約 285 倍）の差がある。

この差は算術上は件数で説明がつく可能性がある: 11120ms ÷ 39.048ms ≈ 285 件。

**この算術に対して機構的な説明を付けることは、本タスクではできなかった。**
前回のレビュー対応版では「先頭ファイル・先頭スライスは budget を超過していても
必ず処理されるため、1 スライスに数百件のイベントがあれば 415 件規模が 1 tick で
流れることは機構として起こり得る」と書いたが、これは実装を誤読していた。
`ingestClaudeCodeSessions()`（`memory-server/src/core/ingest-coordinator.ts`）を
読み直すと、以下 2 点が誤りだった。

- スライスサイズの既定は `READ_SLICE_BYTES`（`DEFAULT_INGEST_READ_SLICE_BYTES`,
  140行, 64KB）であって 512KB ではない。512KB は `MAX_BYTES_PER_FILE`
  （1 ファイルから 1 tick で読む**総量**の上限）であり別物。
- ファイル単位（2682行）とスライス単位（2726行）の budget チェックとは別に、
  `for (const entry of parsedChunk.events)` ループの**内側にも entry 単位の
  budget チェックがある**（2798-2807行、`entryIndex > 0 && 超過 なら break`）。
  budget 超過後に無条件で通過するのは「新しく開始したファイルの先頭スライスの
  先頭 entry」1 件だけであり、それ以降は entry ごとに budget を見て抜ける。
  「先頭スライスなら丸ごと処理される」という前回の記述は誤り。

正しい機構を本タスクの範囲で再構成すると 285 件規模の一括処理を導く経路は
見当たらず、11120ms のブロックが起きるとすれば「recordEvent 自体が 1 件あたり
数百 ms 〜 秒オーダーで遅く、budget 超過後も許容される少数件（ファイル/スライス/
entry それぞれ 1 件ずつの猶予分）の合算で説明する」等の別の仮説が必要になるが、
これも検証していない。

したがって、11120ms との対応づけは**算術の一致以上のことは言えず、機構は
未確認のまま**とする。本測定が確定したのは「1 件あたりのコストが行数に比例して
悪化する」ことであり、「auto_link を直せば本番 tick 11 秒も同程度に短縮される」
ことは**この測定単独では言えない**。対応づけの確認は §160-002 着手前に
production ログで行うことを推奨する。

### (3) 効いている独立変数は「DB サイズ（バイト数）」ではなく「observation 行数」

`idx_mem_obs_project_session_created` の全件スキャンはインデックスのページ数、
つまり行数に比例するコストであり、DB ファイルのバイト数そのものに比例するわけ
ではない。本測定の 3 点は 55 行 / 71,055 行 / 340,055 行で、4.9GB の内訳は
340,055 行 × 約 14.6KB/行という本ベンチの合成データ固有の構成である
（`scripts/s160-001-gen-synthetic-db.ts` の 1 行あたりのペイロード生成量に依存）。

本番の 4.9GB DB が同じ「1 行あたり約 14.6KB」という比率を持つとは限らない
（vector 次元数、payload 長、nugget/entity/relation 等の副次テーブルの構成比が
異なれば同じバイト数でも行数は変わる）。本番 DB の実際の `mem_observations` 行数は
**未確認**（本番 DB への読み取りアクセスは §159 の合意により本タスクでは行っていない）。
本測定の結論を「DB サイズ」ではなく「observation 行数」に対する支配区間として
読むのが正確であり、本番のバイト数から行数への換算は別途確認が必要。

### (4) ページキャッシュの状態

4.9GB DB の生成と計測は、生成直後で OS ページキャッシュが温まった状態
（ホストの空きメモリに対して 5GB 程度のファイルは十分キャッシュに載り得る）で
行っている。本番の実運用では daemon 再起動直後やメモリ圧迫時にキャッシュが
冷えた状態で `auto_link` のインデックス全件スキャンが走る可能性があり、その場合は
本測定より更に悪化する（`pread` のコストが顕在化する）と考えられるが、これは
本測定では**検証していない**。真のコールドキャッシュ条件下の挙動は未確認。
(1) で触れた「vec0 のページがページキャッシュを圧迫する」という仮説とも関連する
論点だが、そちらは DB の内容差そのものがキャッシュ使用量を変えるという主張で
あり、ここでの論点（キャッシュの温まり方が cold か warm か）とは区別する。

### (5) vector 書き込みが DB サイズに対して増加する機構は未確認

vec0 サイドカーへの書き込み（`vector_upsert_db_write_isolated`）が 4.9GB tier で
1.675ms（empty 比で約13倍）まで増加することは実測したが、`auto_link` について
行ったような `EXPLAIN QUERY PLAN` 相当の機構確認（sqlite-vec の vec0 仮想
テーブル内部でチャンク管理やシャドウテーブルへの追記コストがどう効くか）は
行っていない。この増加が行数に比例するのか、ある閾値でのみ発生するのか、
本測定より大きい DB サイズでどう推移するかは未検証。

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
- dedupe / FTS / vector 書き込み / audit の 4 区間はいずれも DB サイズに対して
  増加するが、4.9GB でも絶対値は 0.150ms 〜 1.675ms にとどまり、`auto_link`
  （4.9GB で 31.459ms）とは 1〜2 桁小さい。§160-002 の優先対象は絶対値の大きさで
  判断すべきで、「DB サイズに対して定数だから外してよい」という根拠は使えない
  （4 区間とも定数ではなく実際には増加している）。とはいえ絶対値が 1〜2 桁小さい
  以上、`auto_link` を差し置いて優先する理由もない。特に `vector_upsert_db_write`
  は empty 0.129ms → 1gb 0.231ms → 4.9gb 1.675ms（約13倍）と 4 区間の中で最も
  大きく増加しており、`auto_link` の対策後に次点として検討する候補になる。
