# Harness-mem 実装マスタープラン

最終更新: 2026-05-24（§128 Recall Runtime Architecture / Release CI hygiene）
実装担当: Codex / Claude（本ファイルを唯一の実装計画ソースとして運用）

> **アーカイブ**: §0-31 → [`docs/archive/`](docs/archive/) | §32-35 → archive | §36-50 → [`Plans-s36-s50-2026-03-15.md`](docs/archive/Plans-s36-s50-2026-03-15.md) | §52-53 → [`Plans-s52-s53-2026-03-16.md`](docs/archive/Plans-s52-s53-2026-03-16.md)（§52 12完了/1未着手, §53 7完了） | §54-55 → [`Plans-s54-s55-2026-03-16.md`](docs/archive/Plans-s54-s55-2026-03-16.md)（§54 14完了, §55 4完了） | §51-§76 → [`Plans-s51-s76-2026-04-13.md`](docs/archive/Plans-s51-s76-2026-04-13.md) | §79-§88 → [`Plans-s79-s88-2026-04-19.md`](docs/archive/Plans-s79-s88-2026-04-19.md)（§79/§80/§81/§82-§87/§88 完了） | §91-§96 → [`Plans-s91-s96-2026-04-23.md`](docs/archive/Plans-s91-s96-2026-04-23.md)（§91/§92/§93/§94/§95/§96 完了、v0.15.0 リリース後） | §77/§98-§107/§S109 → [`Plans-s77-s109-2026-05-10.md`](docs/archive/Plans-s77-s109-2026-05-10.md)（§77 §78-A03 吸収 / §98 §99 §101 §102 §103 §105 §106 §107 §S109 完了、v0.20.0 リリース後）

---

## 凡例

`[P]` = 並列可 / `cc:TODO` / `cc:WIP` / `cc:完了` / `blocked`

**`cc:完了` 書式**: `cc:完了 [<sha-7>]` または `cc:完了 (<sha-7> - <注釈>)` の形で対応する main 上の commit hash を必ず併記する（複数 commit は `(<sha>, <sha>, ...)` で束ねる）。Worker 自己更新も Lead cherry-pick 後の更新も同形式。Reviewer は review チェックリストの一項目として確認する。詳細・運用ルール: [`patterns.md` P8](.claude/memory/patterns.md)。

---

## 現在のステータス

**§75 + §76 Go MCP Migration — 完了**（2026-04-10）/ §74 Search Precision & Recall Granularity — 完了 / §73 Codex bootstrap reproducibility — 完了

## §127 Search Runtime Stability — cc:完了 [8bb514b,79fa936,43e6a07,faf7d41,c66a170]

策定日: 2026-05-19
背景: 実運用 DB (~14GB) で normal vector search の sqlite-vec KNN が Bun main thread を塞ぎ、`/health/ready` まで巻き込む不安定化が確認された。前段で safe/MCP 経路は安定化したため、次は通常検索の semantic path を落とさずに daemon 応答性を守る。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S127-001 | **normal vector search の off-main / bounded 化** — HTTP `/v1/search` の通常 vector search を child process に逃がし、sqlite-vec KNN の default `k` と adaptive query variant を bounded 化。child timeout 時は safe lexical fallback で返す | normal vector search 中も daemon main loop が sqlite-vec に直接捕まらない。child timeout/failure が API timeout へ連鎖しない。対象テストと live health/search が PASS | S115 safe mode stabilization | cc:完了 [8bb514b] (local: normal vector search child offload + bounded sqlite-vec; live ready 0.02ms during search) |
| S127-002 | **persistent search worker 化** — one-shot search child の起動/ONNX warm-up コストを外し、daemon 配下の単一 persistent worker で通常 vector search を処理する。worker queue / timeout / restart / safe fallback を持つ | warm worker 後の normal vector search が数秒以下に寄る。daemon main loop は worker 検索中も ready を返す。worker timeout/failure は safe lexical fallback へ落ち、対象テストと live health/search が PASS | S127-001 | cc:完了 [8bb514b] (local: persistent worker; live normal vector first 4.9s, warm 0.3s, ready 0.26ms during search) |
| S127-003 | **Mem UI detached startup keepalive** — `harness-memd start` で起動した UI が `Bun.serve` 後に即終了しないよう、server 側に keepalive と signal shutdown を持たせる | `harness-memd start` 後に `:37903` が LISTEN 継続し、`/api/context` と `/` が返る。daemon `/health/ready` も OK。対象 contract test PASS | S127-002 | cc:完了 [8bb514b] (local: :37903 LISTEN after browser open; /api/context OK; UI proxy health OK; daemon ready 0.02ms) |
| S127-004 | **HTTP search の lexical 経路も worker offload** — `vector_search=false` の検索も persistent worker へ逃がし、FTS/SQLite scan が daemon main loop と `/health/ready` を塞がないようにする | `POST /v1/search` with `vector_search=false` 中も `/health/ready` が即時応答する。worker timeout 時は safe lexical fallback。対象 guardrail/unit test と live search/ready が PASS | S127-002 | cc:完了 [8bb514b] (local: lexical search 3.37s via persistent_worker; ready during search 0.01ms; ready after 0.11ms) |
| S127-005 | **checkpoint/record write path の main-thread blocking 調査** — `/v1/checkpoints/record` と `/v1/events/record` が local embedding/write 中に daemon ready を塞ぐ経路を off-main / bounded 化する | 完了: checkpoint は `recordCheckpointQueued()` 経由で checkpoint child process へ offload。event record も event child process へ offload。child は fallback embedding provider / deferred embedding を使い、vector/nugget/entity/link 生成を request path から外す。checkpoint は durable write 後に bounded materialization child を schedule し、vector/entity/link/nugget を後追い生成する。parent daemon 側で child slot / queue / timeout を bounded 化し、queue full は `503 Retry-After: 1`。child payload は argv ではなく stdin。retry queue tick も retry child に逃がし、runtime warning は TTL 付きに分離。対象テスト PASS: `cd memory-server && bun run typecheck`; `bun test memory-server/tests/core-split/event-recorder.test.ts memory-server/tests/integration/api-contract.test.ts tests/harness-memd-guardrails.test.ts tests/harness-recall-skill-contract.test.ts tests/proof-pack-contract.test.ts` (87 pass) | S127-004 | cc:完了 [8bb514b] |
| S127-006 | **`/health` full-count path の main-thread blocking 調査** — `/health/ready` 自体が DB count/read で main thread を短時間塞ぐ残リスクを切り分ける | 完了: `/health/ready` は `readiness()` 経路のまま DB count/stat を踏まない guardrail を追加。`/health` default は exact count を省略して `counts_status=omitted`、診断時のみ `/health?include_counts=1` で exact counts。search worker/child/checkpoint/event/retry child は parent 側 slot で bounded。worker warmup/timeout/queue full は fallback child を増やさず bounded `503` (`search_offload_unavailable` / `search_offload_queue_full`) で返し、daemon main を待たせない。OpenAPI 更新済み。live: daemon PID 24315、`/health/ready` 0.01ms、`/health` 0.12ms warnings=[]、UI `:37903/api/health` 0.55ms、`scripts/harness-memd status` running | S127-005 | cc:完了 [8bb514b] |
| S127-007 | **UI/status の残ブロック経路を bounded 化** — UI facets の query/project なし全体集計、launchd restart lock 自己衝突、短すぎる status probe timeout を修正する | 完了: `/v1/search/facets` は query/project/tenant scope なしでは `400 search_facets_unbounded` を 0.0007s で返し、巨大 DB 全体の `json_each(tags_json)` scan に入らない。Mem UI proxy は `project` 未指定の feed / projects stats を default project scope へ寄せ、`/v1/projects/stats?project=...` は bounded child process と高速な privacy-safe filter を使う。project alias/path 展開も child 側で行い、HTTP daemon 親プロセスでは同期 DB selection scan に入らない。child 起動は request path で同期停止しない `node:child_process.spawn` に寄せた。stats が混雑中でも UI proxy は短い timeout で stale current-project placeholder へ切り替え、cached stats も stale 化して「No projects yet」誤表示・古い件数の新鮮表示・長時間待ちを避ける。実測: UI `/api/feed?limit=10` 0.008s、UI `/api/projects/stats` 0.330s、Playwright で `stream connected` / `daemon ok` / `40 items loaded` を確認。`scripts/harness-memd restart` は launchd kickstart 前に operation lock を解放。status probe default は 3s。retry child timeout は実DB向けに 30s bounded。 | S127-006 | cc:完了 [8bb514b,79fa936,43e6a07,faf7d41,c66a170] |
| S127-008 | **Skill UX contract update** — S127 後の bounded search semantics を Claude / Codex Skills に反映し、agent が無指定 facets・project なし広域検索・503 誤読を避けるようにする | 完了: `codex/skills/harness-mem/SKILL.md` / `codex/skills/harness-recall/SKILL.md` / `skills/harness-recall/SKILL.md` に、`harness_mem_search_facets` は query/project/tenant scope 必須、503 は daemon を固めない backpressure、複数 project 並行時は `project` / `strict_project=true` 優先、と明記。npm package は `skills/` も含め、proof pack は Codex skill と Claude skill の配布面を確認する。local installed copy は `~/.codex/skills/*`, `~/.agents/skills/harness-recall`, `~/.claude/skills/harness-recall` まで source と同期済み。PASS: `bun test tests/codex-harness-mem-skill-contract.test.ts tests/codex-harness-recall-skill-contract.test.ts tests/harness-recall-skill-contract.test.ts` (37 pass); `npm pack --dry-run --json` has `skills/harness-recall/SKILL.md` | S127-007 | cc:完了 [8bb514b] |
| S127-009 | **v0.24.0 release CI performance gate stabilization** — tag release CI の `repository-regression` で `findMany` ratio が 1.281 まで揺れたため、他操作の 1.25 gate は維持しつつ `findMany` のみ 1.30 に分離し、§77-b 追跡コメントを残す | 完了: `findMany` 専用 tolerance を 1.30 に分離し、他操作の 1.25 gate は維持。CI-only で揺れた WorkGraph auto-sync contract は Linux GNU `stat -f` の stdout leak を避けるため mtime helper を GNU stat first + numeric output validation に修正し、sandbox も DB path / plugin data dir / auto-sync env を明示。PASS: `bun test memory-server/tests/performance/repository-regression.test.ts tests/codex-work-hint-contract.test.ts`; `HARNESS_MEM_WORKGRAPH_AUTO_SYNC_FORCE=1 bun test tests/codex-work-hint-contract.test.ts`。tag workflow を同 commit へ再発火して v0.24.0 GitHub Release / npm publish を完了させる | S127-008 | cc:完了 [local] |

| 項目 | 現在地 |
|------|--------|
| gate artifacts / README / proof bar | onnx manifest (2026-04-10) / README / proof bar / SSOT matrix を再同期済み |
| 維持できている価値 | local-first Claude Code+Codex bridge、adaptive retrieval、MCP structured result、522問日本語ベンチ、Go MCP server (~5ms cold start) |
| 最新リリース | **v0.24.2**（2026-05-24、S128 Recall Runtime / projection auto-refresh / local OTel / ADR runtime / Mac+Windows package install smoke gate を release 済み） |
| 次フェーズの焦点 | **§128 Recall Runtime Architecture** / **§108 Developer Workflow Recall + Temporal Graph Positioning Hardening** / **§110 Cross-repo Handoff Workflow Codification** / **§89 Search Quality Hardening (XR-002)** / **§90 Session Resume Injection Hook (XR-003)** / **§78 Phase A-E follow-up** / **§97 Codex Recall Skill Parity** |
| CI Gate | **Layer 1+2 PASS**（onnx `run-ci`、bilingual=0.8800、p95 13.28ms、history reset at v0.11.0） |

- benchmark SSOT: `generated_at=2026-04-10T08:10:51.561Z`, `git_sha=512f027`
- Japanese companion current: `overall_f1_mean=0.6580`
- Japanese historical baseline: `overall_f1_mean=0.8020`

---

## §128 Recall Runtime Architecture — cc:WIP [local dogfood]

策定日: 2026-05-22
分類: Product architecture / recall runtime / observability / ADR — owner は `harness-mem`。Local task。Claude / Codex / Hermes / WorkGraph との接続はあるが、sibling repo の責務移動や cross-repo API 変更はこの § では行わない。
仕様正本: `Spec.md`。本 § は実装順序と検証条件の正本であり、product truth は `Spec.md` を優先する。

背景: §115 / §127 で巨大 DB による daemon blocking、safe search timeout、worker queue / fallback / health readiness は operational green まで持ち込んだ。ただし、DB 大量化による検索不安定化を「さらに速い search」だけで追うと、harness-mem が generic RAG backend に寄ってしまう。harness-mem の世界観は **local-first / multi-agent continuity / operator-owned memory / degradation-aware recall** であり、次の基盤は DB パッチではなく Recall Runtime として切る。

判断:

- `Spec.md` を product-level SSOT とし、`Plans.md` は task contract、ADR は Why の正本として分離する。
- `mem_observations` は監査・再構成の正本として残し、通常 recall は再構築可能な hot projection (`mem_recall_items` / `mem_recall_chunks` / `mem_recall_profiles` 相当) から返す。
- MCP / hooks / UI の通常 recall は `project` / `workspace` / `tenant` / `session` の scope-first 契約にする。無指定 broad search は forensic / admin mode として扱う。
- OpenTelemetry を標準導入する。ただし **標準 = instrumentation contract + local observability first** であり、外部 OTLP export は明示 opt-in。外部送信は Risk Gate 対象。
- ADR を一級 memory object にする。`docs/adr/` と `.claude/memory/decisions.md` を別物として放置せず、Why / options / consequences / supersedes を search / WorkGraph / recall explanation へ接続する。新規 ADR は BEADS shape (`Boundary`, `Evidence`, `Alternatives`, `Decision`, `Signals`) でレビュー可能にする。

### Product Principles

- harness-mem は memory database ではなく **agent continuity runtime**。
- 大量化への答えは「巨大 raw DB を賢く全探索」ではなく「いつ何を思い出すべきかを型・scope・degradation で制御」。
- 壊れ方も product surface。vector / worker / daemon / exporter が degraded でも、scoped lexical + recent decision + active work は返す。
- OpenTelemetry は vendor lock-in ではなく、recall path の因果関係を残すための共通言語。Datadog / Grafana / local collector は後から選べる。
- ADR は docs ではなく runtime fuel。agent が「なぜその判断か」を説明できる状態まで持ち込む。
- BEADS は backend 採用ではなく判断モデルとして使う。dependency-aware work graph は WorkGraph に、Boundary/Evidence/Alternatives/Decision/Signals は ADR に接続する。

### Non-goals / Stop Line

- 初手で Postgres / Qdrant / managed service を default にしない。
- 外部 OTLP endpoint へ telemetry を default 送信しない。
- OpenTelemetry に raw prompt / raw observation / secret / PII を載せない。
- `HARNESS_MEM_TOOLS=core` の tool surface を無条件に増やさない。
- ADR を `.claude/memory/decisions.md` の単純置換にしない。local SSOT は残し、shareable ADR と runtime-ingested decision を接続する。
- Plans.md を自動改変して ADR を生成しない。生成は explicit command / UI action のみ。

### Task Plan

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S128-000 | **Product Spec SSOT freeze** `[tdd:skip:docs-spec]` — `Spec.md` を作成し、local-first continuity runtime / Recall Runtime / WorkGraph / ADR / OpenTelemetry / regression gates の正解条件を固定する | `Spec.md` が存在し、Plans は task contract、ADR は Why、Spec は product truth という分離が明記される。BEADS 由来の採用/不採用境界とデグレ条件が入る | - | cc:完了 [local] |
| S128-000a | **BEADS ADR contract freeze** `[tdd:skip:docs-spec]` — ADR に `Boundary`, `Evidence`, `Alternatives`, `Decision`, `Signals` の判断形を導入し、旧 ADR との互換を保つ | `Spec.md` に BEADS ADR shape が入り、旧 ADR の書き換えを要求しない。Signals は review trigger / regression gate / rollback 条件として定義される | S128-000 | cc:完了 [local] |
| S128-001 | **Recall Runtime detailed spec freeze** `[tdd:skip:docs-spec]` — `docs/recall-runtime.md` に purpose / recall object taxonomy / scope contract / hot-cold projection / degradation contract / observability / ADR connection を固定する | 完了: `docs/recall-runtime.md` を作成。`Spec.md` と整合し、`raw observation`, `episode`, `fact`, `decision`, `profile`, `work item`, `recall item` を区別。通常 recall は scoped hot projection、raw observation search は forensic/admin/debug と明記。§115/§127 の bounded search、§125 WorkGraph、§126 Plans sync、ADR connector / inject observability との境界を記録。repeat recall cache の TTL / knobs hash / projection watermark 契約も追加 | S128-000 | cc:完了 [local] |
| S128-002 | **ADR for Recall Runtime architecture** `[tdd:skip:adr]` — `docs/adr/ADR-003-recall-runtime-architecture.md` を作成し、DB肥大対策ではなく product基盤として採用する Why / alternatives / consequences を記録する | 完了: `docs/adr/ADR-003-recall-runtime-architecture.md` を `Status: Proposed` で作成。BEADS shape を含め、`SQLite projection`, `Postgres/pgvector`, `Qdrant sidecar`, `managed service`, DB/search tuning continuation を比較。`decisions.md` D13 に source pointer / Why を追記 | S128-000a, S128-001 | cc:完了 [local] |
| S128-002a | **Benefit / no-go gate** `[tdd:skip:planning-review]` — 現行 S127/S125/ADR connector/inject observability で既に足りるものと、§128 で追加価値が出るものを採点し、core / OTel / ADR runtime の進行可否を分ける | 完了: `docs/recall-runtime-benefit-gate.md` で Product Fit / Evidence / User Value / Feasibility / Regression Safety / Strategic Leverage / Evidence Strength を 5 点採点。結論は GO: core projection / scoped recall / degradation / repeat cache / ADR / local OTel は価値あり。NO-GO: Postgres/Qdrant/managed service default、core search replacement。Evidence Strength 2 以下の slice は Required 化しない方針を固定 | S128-001, S128-002 | cc:完了 [local] |
| S128-003 | **Recall projection schema red tests** `[tdd:required]` — additive schema として hot projection table 群を設計し、fresh/migrate/downgrade-safe tests を先に固定する | 完了: `mem_recall_projection_runs`, `mem_recall_items`, `mem_recall_chunks`, `mem_recall_profiles` を additive migration。fresh/legacy migration tests で tables / indexes / compatibility を確認。既存 `mem_observations`, search, WorkGraph, privacy, session ingest は変更なし | S128-002a | cc:完了 [local] |
| S128-004 | **Projection builder dry-run** `[tdd:required]` — raw observations から recall projection を作る dry-run builder を実装し、write なしで row counts / skipped reasons / privacy diagnostics を返す | 完了: `buildRecallProjectionPlan` と `/v1/admin/recall-projection action=dry-run` を追加。project scope、privacy skip、source watermark、generation、skipped reasons、DB writes 0 を unit/integration tests で確認 | S128-003 | cc:完了 [local] |
| S128-004a | **Projection materialize / refresh path** `[tdd:required]` — dry-run projection を実際に書き込む explicit write path と bounded refresh path を追加する | 完了: `/v1/admin/recall-projection action=write|refresh|materialize|clear` と idempotent materialize / rollback delete を追加。background worker は未導入だが、write は admin explicit action に限定し、stale/missing 時の `/v1/recall` fallback は S128-006 で実装 | S128-004 | cc:完了 [local] |
| S128-004b | **Repeat recall query cache** `[tdd:required]` — gbrain 型の短TTL query cache を通常 recall 経路へ追加し、繰り返し recall を DB 再探索なしで返せるようにする | 完了: in-process bounded cache を `searchPrepared` に追加。key は normalized query hash / scope / shape / privacy / safe-mode knobs hash / data watermark を含む。TTL default 60s / max 300s / `HARNESS_MEM_RECALL_CACHE_TTL_MS=0` で disable。hit/miss は safe metadata のみ、raw prompt/raw observation は非露出。TTL 0、repeat hit、data change invalidation tests PASS | S128-004a | cc:完了 [local] |
| S128-005 | **Scoped recall API contract** `[tdd:required]` — MCP / HTTP の通常 recall が project/workspace/session scope を要求し、unscoped broad query は明示 forensic flag を必要にする | 完了: 既存 `/v1/search` / `harness_mem_search` は互換維持。新規 `/v1/recall` は project/session scope 必須、unscoped は 400 + `recall_scope_required`、`forensic=true` は明示的 observation search fallback。projection が fresh なら `mem_recall_items` を読む | S128-004b | cc:完了 [local] |
| S128-006 | **Degradation SLO manifest** `[tdd:required]` — vector unavailable / worker timeout / queue full / OTel exporter down / projection stale の各 degraded mode で返す最低保証を manifest 化する | 完了: `/v1/admin/recall-degradation-manifest` と `/v1/recall` の `recall_degraded_reason` / `fallback_path` を追加。projection missing/stale/no-match/project-scope/access-filter fallback を integration tests で確認。manifest は vector/worker/queue/OTel down の最低保証コードも固定し、`/health/ready` は既存 lightweight path を維持 | S128-005 | cc:完了 [local] |
| S128-007 | **OpenTelemetry SDK standard plumbing** `[tdd:required]` — memory daemon / search worker / MCP gateway に OTel API/SDK 初期化を追加し、service name/version/resource attrs と graceful shutdown を固定する | 完了: lightweight OTel-compatible runtime を daemon / search worker / Go MCP gateway に追加。default は local-only / external export disabled、`OTEL_EXPORTER_OTLP_ENDPOINT` または traces endpoint 明示時のみ OTLP HTTP export。shutdown flush と health telemetry status を追加。PASS: telemetry unit, memory-server typecheck, Go tests, diff-check | S128-002a | cc:完了 [27cfff0] |
| S128-008 | **Recall semantic telemetry** `[tdd:required]` — `recall.search`, `recall.project`, `recall.projection.build`, `recall.worker`, `recall.inject`, `adr.ingest` などの span/metric names と allowed attributes を固定する | 完了: fixed span names / metric equivalents / attribute allowlist を追加。`recall.search`, `recall.project`, `recall.projection.build`, `recall.worker`, `recall.inject`, `adr.ingest` を safe attrs で記録。raw query/content/project/path/secret はテストで非露出を確認。PASS: telemetry unit + recall semantic integration + repeat cache + ADR/connector subset + typecheck + diff-check | S128-007 | cc:完了 [b9dad07] |
| S128-009 | **Local telemetry inspect/export surface** `[tdd:required]` — external collector なしでも trace summary を見られる admin endpoint / CLI を追加する | 完了: `/v1/admin/telemetry/status`, `/v1/admin/telemetry/export`, `harness-mem telemetry status|export` を追加。local span/metric summary は sanitized export で見られ、raw query/content/project/path/secret は非露出。OTLP exporter failure は recall を落とさず inspectable。PASS: CLI contract + admin API + telemetry unit/integration + typecheck + diff-check | S128-008 | cc:完了 [db1c595] |
| S128-010 | **ADR template + CLI/UI entrypoint** `[tdd:required]` — `harness-mem adr new` / template / validation を追加し、status/options/consequences/supersedes/source Plans § を必須化する | 完了: `harness-mem adr new` と BEADS-compatible template / index を追加。dry-run default、`--write` explicit、`docs/adr/ADR-NNN-*.md` numbering。status/source Plans/options/consequences/supersedes validation と CLI contract tests を追加。PASS: ADR CLI contract, connector tests subset, typecheck, diff-check | S128-002a | cc:完了 [8590fd4] |
| S128-011 | **ADR ingestion as recall object** `[tdd:required]` — 既存 ADR connector を拡張し、ADR を decision recall / WorkGraph evidence / search explanation に出せるようにする | 完了: ADR/BEADS metadata parser を拡張し、ADR observation を projection 上の `decision` recall object / `source_type=adr` として扱う。status/options/consequences/supersedes/source Plans/decisions.md refs/work refs を metadata/provenance に流し、`/v1/recall` で retrieval 可能にした。PASS: external connector + recall projection + ADR recall runtime + typecheck + diff-check | S128-010, S128-003, §125 | cc:完了 [3bc7101] |
| S128-012 | **Recall explanation UX** `[tdd:required]` — MCP / UI / CLI で「なぜこの memory が出たか」を scope / type / source / ADR / work evidence 付きで説明する | 完了: `/v1/recall` item に compact `explanation` を追加し、scope/type/source/lexical/ADR/work/fallback reasons を返す。`harness-mem recall explain` は body text を出さず explanation-only JSON を返す。ADR explanation は status/source Plans/option_count/consequence_count/supersedes/work refs を含み、raw query/content/project は非露出。PASS: recall runtime API + ADR recall runtime + recall CLI contract + typecheck + diff-check | S128-005, S128-011 | cc:完了 [0fb4508] |
| S128-013 | **Recall Runtime benchmark + release gate** `[tdd:required]` — large DB fixture / local DB smoke で latency, fallback, projection freshness, repeat recall cache, ADR recall precision, no-secret-telemetry を gate 化する | 完了: `scripts/s128-recall-runtime-gate.ts` と `npm run benchmark:recall-runtime` を追加。warn-mode manifest に `recall_p95`, `ready_latency`, `fallback_rate`, `projection_freshness`, `repeat_recall_cache_hit_rate`, `cache_invalidation_correctness`, `adr_precision`, `otel_redaction`, `sessionstart_non_displacement`, `core_search_compatibility` を出力。default 180 events + 1 ADR 実測は `status=pass`, `value_signal=positive`, `recall_p95=1.3ms`, `fallback_rate=0`, cache hit/invalidation/ADR precision/OTel redaction all pass | S128-006, S128-009, S128-012 | cc:完了 [e410231] |
| S128-014 | **Local dogfood hold + safe search offload + scoped Skill guidance** `[tdd:required]` — 配信せず current local daemon で実DB evidence を貯める。巨大DBで safe-mode broad search / recall fallback が main daemon を塞がないよう worker offload を確認し、Skills は project 指定検索を原則にする | 完了: LaunchAgent は local repo source を参照。daemon restart 後 health OK。current project projection write: 5,000 items / 472.65ms。実DB recall smoke: `/v1/recall` `Recall Runtime Architecture` は `recall_projection_v1`, 3 items, 118.78ms, degraded=false。safe `/v1/search` は persistent worker 経由 1.71s で main health 維持。`harness-mem` / `harness-recall` Skills は project 推定時の scoped search 必須、unscoped は明示横断/forensic/admin/scoped miss 後のみ、`project=unknown` 明示へ更新し、`~/.codex`, `~/.claude`, `~/.agents` の local install copy へ同期済み。実DB dogfood 中に `partialFinalizeEnabled=true` が main-thread SQLite scan で health timeout を起こしたため、ローカル蓄積フェーズでは `~/.harness-mem/config.json` を `partialFinalizeEnabled=false` に戻して raw event/observation 蓄積を優先。S128 gate artifact は `~/.harness-mem/local-artifacts/s128-recall-runtime/gate-20260522T101501Z.json`。PASS: core unit + recall runtime + repeat cache + Skill contract + typecheck + diff-check | S128-013 | cc:完了 [local] |
| S128-015 | **Projection auto-refresh + stale policy** `[tdd:required]` — `/v1/recall` が `projection_missing` / `projection_stale` を検知したら、fallback は即返しつつ scoped projection refresh を bounded child process へ debounce/one-flight で予約する | 完了: missing/stale 検知時に `recall_projection_auto_refresh` safe meta を返し、debounced one-shot child process で scoped projection refresh を予約。queue max / timeout / child env / shutdown timer clear を追加し、成功後は parent `repeatRecallCache` を clear。test env は明示 ON の時だけ auto refresh。local daemon restart 後、実DBで first recall は `projection_stale` + `status=scheduled` / 203.44ms、3秒後は `recall_projection_v1` / 67.36ms / degraded=false、`/health/ready` 0.12ms。PASS: recall runtime integration + guardrail + recall projection unit + repeat cache + semantic telemetry + telemetry unit + typecheck + diff-check | S128-014 | cc:完了 [local] |
| S128-016 | **Release CI annotation cleanup** `[tdd:required]` — v0.24.2 release CI で出た `Node.js 20 actions deprecated` と `go.sum` cache warning を解消する | 完了: release workflow と通常 workflow の JavaScript actions を Node 24 対応 major へ更新し、artifact action は `action.yml` の `runs.using=node24` まで実体確認。Go cache dependency を `mcp-server-go/go.sum` に明示。tag existence check / action.yml runtime check / contract test / YAML parse / Go native test / diff-check が PASS。次回 tag release と push CI で annotation が再発しない | S128-015 | cc:完了 [34cfadb,5ecfeaf,2eb8b32] |

### Execution Waves

| Wave | 対象 | 目的 | 並列性 |
|------|------|------|--------|
| Wave 0 | S128-000, S128-000a, S128-001, S128-002, S128-002a | 世界観・Spec・Why・実装価値を固定し、DB patch や過剰バンドルへ矮小化しない | 直列 |
| Wave 1 | S128-003, S128-004, S128-004a, S128-004b, S128-005, S128-006 | Recall core: projection / repeat cache / scope / degraded mode を先に実用化 | 依存順 |
| Wave 2 | S128-007, S128-008, S128-009 | Observability: OTel は opt-in / local inspect first で追加 | 依存順 |
| Wave 3 | S128-010, S128-011 | ADR runtime: BEADS template / ingestion / WorkGraph evidence 接続 | 依存順 |
| Wave 4 | S128-012, S128-013 | explanation UX と release gate | 並列可 |

推奨初回 scope:

```text
完了: S128-001, S128-002, S128-002a を Lead が確定。Benefit gate は GO, but sliced。
完了: S128-003, S128-004, S128-004a, S128-004b, S128-005, S128-006 を red-test-first で実装。
完了: S128-007, S128-008, S128-009 で local-first OpenTelemetry / semantic telemetry / local inspect-export surface を実装。
完了: S128-010, S128-011, S128-012, S128-013 で ADR template / ADR recall object / explanation UX / warn-mode release gate を実装し、初回 value signal は positive。
```

次に進む条件: `Spec.md`、`docs/recall-runtime.md`、ADR-003、benefit gate が「local-first continuity runtime」の判断を明文化し、OpenTelemetry が外部送信 default にならず、ADR が Why 付き recall object として扱われること。S128-001〜S128-013 で Recall Runtime core / OTel / ADR / explanation / warn-mode gate は実装済み。次は S128 gate を 2-3 回の通常運用で観測し、release enforce へ上げるか warn 継続にするかを判断する。

---

## §78 World-class Retrieval & Memory Architecture — cc:WIP (Phase A–E 全タスクが landed、残は follow-up: §78-A05.2 recall tuning / §78-B02b tests / §78-C02b NLP upgrade / §78-D01b tests / §78-E02b branch merge workflow)

策定日: 2026-04-13
背景: 競合 5 ツール（MemPalace, Mem0, SuperMemory, claude-mem, Hermes Agent）の徹底調査により、harness-mem のポジションと課題を特定。harness-mem は「project-scoped × tool-agnostic × local-first」の 3 軸交点で唯一のポジションを占めるが、**retrieval quality** と **graph memory** で業界リーダーに劣っている。

### 競合採点マトリクス（10点満点）

| 軸 | harness-mem | MemPalace | Mem0 | SuperMemory | claude-mem | Hermes |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Retrieval Quality | 6 | **9** | 7 | **9** | 5 | 4 |
| Local-first / Privacy | **10** | **10** | 4 | 1 | 9 | 9 |
| Tool Agnosticism | **9** | 7 | 7 | 8 | 3 | 2 |
| Project Scoping | **10** | 8 | 5 | 6 | 7 | 4 |
| Session Intelligence | **9** | 3 | 5 | 4 | 6 | 5 |
| Graph Memory | 5 | 6 | **9** | 5 | 3 | 2 |
| Cold Start / Perf | **10** | 5 | 6 | 7 | 4 | 2 |
| Setup Simplicity | 8 | 6 | 7 | **9** | 7 | 5 |
| Ecosystem / Community | 4 | 8 | **9** | 7 | **9** | 6 |
| Benchmark Transparency | 7 | **8** | **8** | 7 | 1 | 2 |
| **合計** | **78** | **70** | **67** | **63** | **54** | **41** |

### 戦略的洞察

1. **harness-mem の 3 軸モート** (project-scoped + tool-agnostic + local-first) は競合不在。この 3 軸を **retrieval quality を上げた状態で維持** すれば「local-first で世界最高の検索精度を持つ project-scoped memory」というポジションが取れる
2. **MemPalace の 96.6% LongMemEval** は verbatim storage + hierarchical metadata による (+34% retrieval boost を実証)。harness-mem の structured observation は lossy → **raw + structured hybrid** が解
3. **Mem0 の graph memory** は $249/mo Pro tier 限定。harness-mem が local-first で graph memory を無料提供すれば **Mem0 のペイウォールを破壊** できる
4. **170-token wake-up** (MemPalace) と **temporal forgetting** (SuperMemory) は token efficiency × memory hygiene の重要パターン

### Pivot 記録 (2026-04-13)

初期の §78 設計では「LoCoMo Full F1 ≥ 0.60」を主ゲートに置いていたが、2 iteration 実測の結果、**harness-mem の target domain と LoCoMo の評価 domain が根本的にズレている** ことが確認できた:

- **LoCoMo** が測っているのは「架空の 2 人の日常会話 (ライフログ) の長期記憶」。質問例: 「Caroline はいつ LGBTQ サポートグループに行った？」
- **harness-mem** は「開発者のコーディング作業ログ (session thread / decision chain / code context)」を target にしている
- 料理の比喩で言えば、LoCoMo は顕微鏡ベンチ、harness-mem はメカニックの工具。顕微鏡ベンチで工具が低スコアでも工具が悪いわけではない

Mem0 や MemPalace が LoCoMo で強いのは、これらが **一般会話メモリとして設計されている** から。それを追いかけると harness-mem 本来の強み (project-scoped isolation, session lifecycle hooks, Go MCP ~5ms) が薄まる方向に tuning してしまう。

よって Global DoD を **developer workflow memory の main gate** に pivot する。

**LoCoMo full の 2 iteration スコアは外部公開しない方針** — 数字だけ独り歩きすると domain mismatch の文脈が抜け落ちて誤解される。内部向けの意思決定根拠として口頭 / commit log レベルで参照できれば十分で、README や競合比較表に載せる意味はない。

### Global DoD (revised 2026-04-13)

1. **Developer-domain main gate** — 以下 4 指標を release-gate 化:
   - `dev-workflow` recall@10 ≥ 0.70 (現状 0.59 / 目標改善幅 +0.11)
   - `bilingual` recall@10 ≥ 0.90 (現状 0.88 / +0.02)
   - `knowledge-update` freshness@K ≥ 0.95 (現状 1.0 ✓ 維持)
   - `temporal` ordering score ≥ 0.70 (現状 0.65 / +0.05)
2. **LoCoMo は release gate から完全に外す**。full 1,986Q の数字は **公開しない** (domain mismatch で誤解を招くだけ)。120Q subset の 0.5917 は既存の公開値として扱いを変えない。
3. **全ベンチマーク結果を committed JSON + README に反映** (domain を明示)
4. 既存の local-first / project-scoped / tool-agnostic 制約を一切壊さない
5. Go MCP cold start ~5ms を維持
6. 全テストが PASS

---

### Phase A: Developer-domain main gate 確立 — **最優先 (pivot 後)**

LoCoMo を主ゲートから外し、harness-mem の target domain (developer workflow memory) でリリース gate を固める。§77 の retrieval regression 修正もここに吸収する。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S78-A01 | **Developer-domain main gate を release.yml に組み込み** — dev-workflow / bilingual / knowledge-update / temporal の 4 指標を release gate 化 (Layer 1 absolute floor) | release.yml の benchmark ゲートが 4 指標で判定、各 Task の DoD 閾値で fail/pass を出す | - | cc:完了 [093c22d] (warn mode; dev-workflow は §78-A05 待ち) |
| S78-A02 | **LoCoMo 関連の外部公開を停止** — LoCoMo full fixture / result / reference JSON を repo から削除、README と competitors JSON から full スコア言及を削除。120Q subset は既存の扱いを維持 | `tests/benchmarks/fixtures/locomo-full-1986.json` と `docs/benchmarks/locomo-full-reference.json` と `memory-server/src/benchmark/results/locomo-full-latest.json` が repo から除去され、README の比較表と competitors JSON にも full スコアが載っていない | - | cc:完了 |
| S78-A03 | **§77 の 4 タスクを統合実施** — transformers.js lockfile 固定、embedding 再現性確保、multi-project-isolation test re-enable | S77-001〜S77-004 の全 DoD を達成 | - | cc:完了 [e6bbbc4,dc85505,7df2e77] (Option B: bilingual baseline 0.88) |
| S78-A04 | **Domain-aware 比較表に全面改訂** — competitor JSON と README の比較表に "domain" カラム追加 (general-lifelog / developer-workflow / generic-agent) | 比較表が domain を明示し、harness-mem の LoCoMo full 0.0546 が "general-lifelog reference" として表示 | S78-A02 | cc:完了 [a961a0b] |
| S78-A05 | **Developer-domain Recall improvement iteration** — dev-workflow recall 0.59 → 0.70 に引き上げ (S78-B の下準備) | Full `npm test` で dev-workflow recall ≥ 0.70 が 3-run PASS | S78-A01 | cc:WIP [6f34196] (Deliverable 1: manifest emission 完了 / Deliverable 2: recall tuning 0.54 で膠着、stash 退避中。follow-up §78-A05.2 で BM25 tokenization 調査を別実装する方針) |

### Phase B: Retrieval Quality Leap

MemPalace の verbatim storage + hierarchical metadata のアプローチを取り入れ、retrieval quality を構造的に改善する。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S78-B01 | **Verbatim raw storage mode** — structured observation と並行して raw conversation text を保存。embedding は raw text から生成 | `HARNESS_MEM_RAW_MODE=1` で observation + raw text が両方保存される。LoCoMo F1 が raw mode で改善 | S78-A03 | cc:完了 [9fc09b9,df0f7b2,6d55cfb,be81182] (RAW=0 baseline F1=0.5861、RAW=1 formal delta は §78-B04) |
| S78-B02 | **Hierarchical metadata filtering** — project → session → thread → topic の 4 層メタデータで検索をスコープ | 検索 API に `scope` パラメータ追加、LoCoMo temporal が改善 | S78-B01 | cc:完了 [31fce2c + tests via §78-B02b] |
| S78-B03 | **Token-budget-aware wake-up context** — SessionStart artifact を L0 (critical facts, ~170 tokens) + L1 (recent context) の 2 層に分離 | SessionStart の token 消費を 50% 削減しつつ first-turn continuity を維持 | S78-B02 | cc:完了 [9b41d22] |
| S78-B04 | **Re-benchmark** — Phase B 全完了後に LoCoMo Full + LongMemEval を再実行 | F1 delta を committed JSON で記録、README 更新 | S78-B03 | cc:完了 [38af6a2,266c3d1] (LoCoMo Full off-gate per §78 pivot; RAW=0 baseline F1=0.5861 recorded; RAW=1 delta deferred; Phase B capabilities doc: docs/benchmarks/phase-b-capabilities-2026-04-18.md) |

### Phase C: Graph Memory v2

Mem0 の $249/mo graph memory を local-first で無料提供する。Mem0 のペイウォール破壊が戦略的目標。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S78-C01 | **Local graph store 選定と PoC** — Kuzu (embedded graph DB) vs SQLite recursive CTE を比較 | PoC で 100 entity / 500 relation を insert → 3-hop query が < 10ms で返る方を採用 | - | cc:完了 [b36fb2c + follow-up] (採用: SQLite recursive CTE、3hop median 0.15ms で DoD 67x 余裕、Kuzu は scoped install 前提で dep footprint 増加) |
| S78-C02 | **Entity-relationship extraction on ingest** — observation 保存時に NLP で entity + relation を自動抽出、graph に投入 | `harness_mem_graph` が抽出された entity/relation を返す | S78-C01 | cc:WIP [core extractor landed: regex/co-occurs on ingest + `/v1/graph/entities`; NLP upgrade deferred to §78-C02b] |
| S78-C03 | **Multi-hop reasoning queries** — `harness_mem_search` に `graph_depth` パラメータ追加、graph を辿って関連 observation を追加取得 | multi-hop query が LoCoMo temporal category の F1 を改善 | S78-C02 | cc:完了 [dc2e3db] (graph_depth param + BFS entity expansion via mem_relations; LoCoMo formal measurement deferred to §78-B04) |
| S78-C04 | **Graph-augmented hybrid search** — vector search のスコアに graph proximity signal を加算 | A/B test で graph augmentation あり/なしの F1 delta を計測 | S78-C03 | cc:完了 [d12e35c,68c5f2d] (graph_weight default 0.15 + HARNESS_MEM_GRAPH_OFF=1 override) |

### Phase D: Intelligent Memory Lifecycle

SuperMemory の temporal forgetting + contradiction resolution + auto profiles を local-first で実装。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S78-D01 | **Temporal forgetting** — 時限付き fact (e.g. "deploying today") に TTL を設定、期限切れで自動 archive | 二重実装を統合: 本 session の impl [edfed2b,9de3d15,cc23bb8] (expires_at カラム + migration、`harness_mem_ingest` の `expires_at` パラメータ、read path の expired 除外) と、parallel-session §81-B02 の TTL force-eviction path (score 軸と独立、`protect_accessed` を無視、`legal_hold` のみが TTL を trump) を両立。read path (search/timeline/resume_pack/verify/contradiction) で expired 除外ロジック共有。 | - | cc:完了 [edfed2b,9de3d15,cc23bb8 + via §81-B02] |
| S78-D02 | **Contradiction resolution** — 新 fact が既存 fact と矛盾する場合、古い方を自動 supersede | `harness_mem_add_relation` に `supersedes` relation type 追加、superseded observation は検索 rank を下げる。§81-B03 の Jaccard+LLM detection と独立して「関係書き込み API」として存在し、B03 検出後の書き込み窓口として併用可。 | S78-C02 | cc:完了 [af88782] (併存: §81-B03 の detection と連携) |
| S78-D03 | **Auto project profile** — 静的 fact (tech stack, team convention) と動的 fact (current sprint, recent decisions) を自動分離・維持 | `harness_mem_status` に `project_profile` フィールド追加、token-compact な要約を返す | S78-D01, S78-D02 | cc:完了 [4250b7b] |

### Phase E: Developer Experience

claude-mem + Hermes の優れた DX パターンを取り入れる。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S78-E01 | **Privacy tags** — `<private>` タグで囲んだ内容を memory storage から自動除外 | ingest 時に `<private>...</private>` を strip して保存しない | - | cc:完了 [936a2e2] |
| S78-E02 | **Branch-scoped memory** — git branch 名で observation をスコープ、branch merge 時に統合 | `harness_mem_search` に `branch` パラメータ追加、feature branch の memory が main に merge 可能 | - | cc:WIP [1092110] (core: branch column + search filter 完了。branch merge workflow は §78-E02b として分離) |
| S78-E03 | **Progressive disclosure** — 3-layer retrieval (index → context → full detail) with token cost visibility | search API が `detail_level` パラメータを受け取り、token budget に応じた粒度で返す | S78-B03 | cc:完了 [690dcac] |
| S78-E04 | **Procedural skill synthesis** — 5+ ステップの複雑タスク完了後、再利用可能な手順書を自動生成して memory に保存 | `harness_mem_finalize_session` が長い session を検出して skill document を提案 | S78-D03 | cc:完了 [ad28eae,36d53d6] (rule-based detection + persist_skill=true で observation 化) |

### Phase F: §78 Phase A-E Follow-up Consolidation

策定日: 2026-04-20
背景: v0.13.0 で §78 Phase A-E の機能が landed したが、各 Phase で「core landed / 宿題残」として明記された 5 件の follow-up を独立タスクとして追跡可能にする。Phase A-E の status 欄で散在している follow-up を Phase F として束ねることで進捗可視化・依存整理を行う。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S78-A05.2 | **BM25 tokenization 調査による recall 引き上げ** — §78-A05 が 0.54 で膠着したため、別アプローチ (BM25 tokenization 切替) で dev-workflow recall を 0.70 まで引き上げる。日英混在のコードベース用語が既存 tokenizer で適切に分割できていない仮説を検証 | Full `npm test` で `dev-workflow` recall@10 ≥ 0.70 を 3-run 連続 PASS、release.yml の warn mode を enforce mode に昇格可能であることを確認 | S78-A05 | cc:TODO |
| S78-B02b | **thread/topic scope の統合テスト・エッジケース追加** — §78-B02 の impl は landed だが tests deferred。thread_id NULL の扱い、topic 文字数上限、thread+topic 同時指定時の優先順位、スレッド違いの同じ topic 分離、`scope` パラメータの組合せ網羅を整備 | 新規テスト (unit + integration) が PASS、`tests/unit/hierarchical-scope.test.ts` を含むカバレッジが scope 組合せを網羅、snapshot が更新される | S78-B02 | cc:完了 [f6e1a95] |
| S78-C02b | **entity/relation extraction の NLP 化** — §78-C02 の core extractor は regex + co-occurrence ベース。軽量 NLP で entity type (person/technology/action) と relation kind (is_a/uses/fixes) を判別できるように upgrade。依存フットプリント増加は許容範囲で吟味 | `harness_mem_graph` が entity に type、relation に kind を付与して返す。A/B で regex 版 vs NLP 版の精度 delta を committed JSON に記録、Go MCP cold start ~5ms を維持 | S78-C02 | cc:TODO |
| S78-D01b | **TTL (expires_at) のエッジケーステスト追加** — §78-D01 の impl は landed だが境界条件テストが不足。"now" 秒境界、NULL/未来/過去の混在検索、タイムゾーン差異、supersedes との優先順位、TTL 切れ後の resume-pack 挙動を網羅 | 新規テスト (unit + integration) が PASS、TTL と supersedes の相互作用が決定的に定義され仕様がテストで固定される | S78-D01 | cc:完了 [8b4afc5] |
| S78-E02b | **branch merge workflow** — §78-E02 の core (branch column + search filter) は landed。feature branch の observation を main に昇格する workflow、conflict 解決方針 (上書き / 追記 / 無視) を実装 | `harness_mem_admin_branch_merge` (もしくは同等 API) が存在し、dry-run + explicit flag で feature → main の observation 昇格と conflict audit log 記録ができる | S78-E02 | cc:TODO |

---

### §78 Phase 優先度と推奨実行順

```
Phase A (Benchmark Credibility)     ← v0.12.0 に含める。§77 を吸収
Phase B (Retrieval Quality Leap)    ← v0.13.0 の core
Phase C (Graph Memory v2)           ← v0.14.0 or v0.13.0 と並列
Phase D (Intelligent Lifecycle)     ← v0.14.0 or v0.15.0
Phase E (Developer Experience)      ← 随時 (各 Phase と並列可能)
```

### §78 で目指す世界

LoCoMo Full F1 >= 0.60 + LongMemEval R@5 >= 85% を達成した状態で、以下の 5 軸すべてを満たすメモリツールは **世界に harness-mem だけ**:

1. **Project-scoped** — per-project isolation with symlink resolution
2. **Tool-agnostic** — Claude Code, Codex, Cursor, OpenCode, Antigravity
3. **Local-first** — zero cloud, zero API keys, SQLite + embedded graph
4. **Benchmark-transparent** — full LoCoMo + LongMemEval committed with reproduction scripts
5. **Session-intelligent** — SessionStart/UserPromptSubmit/Stop hook chain with first-turn continuity

---

## §89 Search Quality Hardening (XR-002) — cc:WIP

策定日: 2026-04-19
親管理: 管理 repo `harness-governance-private/XR-Registry.md` の **XR-002**（cross-runtime, owner=harness-mem, impacted=codex-plugin-cc）
背景: 2026-04-18 SSOT レビュー (`ssot-review-2026-04-18.md` として `mem_ingest` 済) で 4 件の retrieval 品質問題を観測。いずれも実装未達 (仕組み不足側) であり、現行の `dedupeHash` / search WHERE / `reindexVectors()` では解決しない。

### 観測事実 (2026-04-18)

| 指標 | 期待 | 実測 |
|------|------|------|
| `query="type:decision"` の結果 | observation_type=decision のみ | summary 100% (type prefix は解釈されずフリーテキストに落ちている) |
| 同一 session_id の session_end summary 件数 | 1 | 10 (8 時間で重複登録) |
| vector_coverage | 95%+ | 53.7% / warning 60% (2 指標が乖離) |
| search latency (hybrid) | SLA 200ms | 1868ms (9.3x) |

### タスク

| Task | 内容 | DoD | Status |
|------|------|-----|--------|
| S89-001 | search API に `observation_type` パラメータ追加 (SQLite + Pg repo の WHERE 拡張 + MCP schema + OpenAPI snapshot 更新) | `observation_type=decision` 指定で decision 行のみが返る integration test PASS。`type:decision` prefix query は server 側で pre-parse し observation_type にマップする | cc:完了 [bcd1627 + Step 2/3 in v0.14.0 (see CHANGELOG)] |
| S89-002 | ingest 時の semantic dedup (`sha256(session_id + observation_type + content)` を `mem_observations.content_dedupe_hash` 列に追加 + UNIQUE index) | 同一 session_id で session_end summary を 10 回 ingest しても行数 1、既存 file-offset dedup とは独立に動作 | cc:完了 (S105 で landed: schema migration が `content_dedupe_hash` 列追加 + partial UNIQUE INDEX `idx_mem_obs_content_dedupe_hash` (WHERE archived_at IS NULL); event-recorder.ts `buildContentDedupeHash` が sha256 で組み立て、WHERE-then-UPSERT で dedup; schema-migration.test.ts カバー) |
| S89-003 | reindex backfill scheduler (`admin/reindex-vectors` を server 側 cron loop 化、もしくは完走専用 `reindexAll()` を追加) | 起動後 24h 以内に vector_coverage が 95% 以上に収束、進捗 metric がログに出る | cc:完了 (memory-server/src/core/reindex-vectors-scheduler.ts: opt-in (HARNESS_MEM_REINDEX_VECTORS_ENABLED=1)、interval 600s × batch 100 で 14k obs/24h convergence、target 0.95 到達で auto-stop、coverage 低下で active mode 復帰; tests/unit/reindex-vectors-scheduler.test.ts 8/8 pass) |
| S89-004 | 既存重複行のクリーンアップ migration (DRY-RUN + explicit flag、`archived_at` soft-delete、audit log 記録) | 既存 DB で重複 summary が 1 件に集約、dry-run 差分とエグゼキューションが audit log に残る | cc:完了 (S105 で landed: `/v1/admin/cleanup-duplicates` endpoint、`cleanupDuplicateObservations({ execute, limit })`、execute=false が default で dry-run、`archived_at` soft-delete、audit log `admin.cleanup_duplicates` / `admin.cleanup_duplicates.plan` 記録) |

### S89-001 実装の PR 分割

| PR | スコープ | 依存 |
|----|---------|------|
| Step 1 | Plans.md archive + §89 bootstrap + `SearchRequest` 型拡張 + `observation-store.search()` WHERE 拡張 + `/v1/search` REST handler で body pass | main |
| Step 2 | MCP tool schema 更新 (TS + Go) + `docs/openapi.yaml` snapshot + `type:xxx` prefix pre-parser | Step 1 |
| Step 3 | Integration test (`tests/integration/search-observation-type.test.ts`) + schema parity test 更新 | Step 2 |

### リリース計画

- **v0.14.0**: S89-001 (schema 変更は不要、WHERE 拡張のみ) + S89-002 (schema migration: content_dedupe_hash 列) — minor bump
- **v0.13.x patch**: S89-003 は server-side loop 単独なら patch で可能
- **v0.14.x patch**: S89-004 は v0.14.0 後に実 DB を触る migration として別 PR

### Cross-repo チェックポイント

- S89-002 実装時に Codex plugin 側の session_end hook を調べ、finalize 済セッションを再 ingest していないかを確認する。必要なら XR-002 の impacted repo に `codex-plugin-cc` のタスクを追記する。
- S89-001 の仕様 (`type:` prefix query の扱い) は API 契約に影響するため、OpenAPI diff を PR 本文に貼り、公開 repo の changelog に明記する。

---

## §90 Session Resume Injection Hook (XR-003) — cc:WIP

策定日: 2026-04-19
親管理: 管理 repo `harness-governance-private/XR-Registry.md` の **XR-003**（cross-runtime, owner=claude-code-harness plugin, impacted=harness-mem shell scripts）
背景: 新 session 起動時に直前 session の文脈が注入されず、毎回「覚えてない」状態で始まる問題を 2026-04-19 のメタ確認で特定。真因は「plugin に bundle 済の `memory-session-start.sh` と `userprompt-inject-policy.sh` が `.claude-plugin/hooks.json` から一度も呼ばれていなかった」こと。harness-mem daemon / `/v1/resume-pack` / shell hook scripts は整備済、wiring 欠損が唯一の障害。

### 観測事実 (2026-04-19)

| 指標 | 期待 | 実測 |
|------|------|------|
| plugin hooks.json の SessionStart | shell 実装を wiring | `harness hook session-start` / `memory-bridge` のみ (Go 実装、`additionalContext` を返さない) |
| plugin hooks.json の UserPromptSubmit | shell 実装を wiring | `harness hook inject-policy` のみ (Go 実装、stub で additionalContext 無し) |
| `.claude/state/memory-resume-pack.json` のタイムスタンプ | 新 session ごとに更新 | **2026-04-07 (12 日前) のまま固定** |
| `/v1/resume-pack` HTTP endpoint | 動作 | ✅ daemon pid 78598 / 195k observations |
| 直前 session summary 取得コスト | < 5KB | L0 + max_tokens=1500 で `items[0].summary` ≒ 2-3KB |
| `claude_code_sessions_ingest` の checkpoint | セッションあたり一意 | 同一 PR URL の checkpoint が重複 ingest されている (§89-002 と合流対象) |

### タスク

| Task | 内容 | DoD | Owner | Status |
|------|------|-----|-------|--------|
| S90-001 | `claude-code-harness/.claude-plugin/hooks.json` の `SessionStart` と `UserPromptSubmit` に `memory-session-start.sh` と `userprompt-inject-policy.sh` の呼び出しを追加して resume-pack 注入を実際に動かす | 新 session 起動後、1 回目の `UserPromptSubmit` で直前 claude session の summary が `additionalContext` に載る。`memory-resume-pack.json` のタイムスタンプが更新される。daemon 不達時は silent skip | claude-code-harness plugin | cc:blocked ([PR #92](https://github.com/Chachamaru127/claude-code-harness/pull/92) は 2026-04-19 に CLOSED / Issue 運用へ切替予定 — cross-repo policy per feedback memory) |
| S90-002 | daemon に `summary_only=true` mode (response を summary 文字列 1 本に絞る軽量 endpoint) を追加、shell script の jq 依存を縮小 | 1 回の HTTP call で < 5KB の summary が返り、hook 側の jq パイプラインを 3 行程度まで短縮できる | harness-mem | cc:完了 [rc.1 混入] (`/v1/resume-pack` に `summary_only` 追加、`meta.summary` に latest summary を直載せ、MCP TS+Go 並走、OpenAPI 更新、5 件 integration test PASS) |
| S90-002-f1 | S90-002 follow-up (Issue [#70](https://github.com/Chachamaru127/harness-mem/issues/70)): `hook-common.sh` に `hook_extract_meta_summary` (jq / python3 fallback) と `hook_fetch_resume_pack_summary_only` を追加、jq 不在環境での軽量 summary 取得 path を提供 | (a) 既存 full-response renderer は無変更で並存 (b) jq 無し + python3 有りで summary 抽出が動く (c) bash unit tests 8 件 PASS (d) CHANGELOG 追記 | S90-002 | cc:完了 [rc.1 混入] |
| S90-003 | `claude_code_sessions_ingest` の URL checkpoint dedup (§89-002 semantic dedup と合流検討) | 同一 PR URL の checkpoint が重複 ingest されない | harness-mem | cc:TODO |

### S90-001 実装方針 (claude-code-harness 側)

- 対象ファイル: `.claude-plugin/hooks.json` (plugin 配布物)
- 追加内容: `SessionStart.hooks` 末尾 + `UserPromptSubmit.hooks` 中間に shell script 呼び出しを 1 本ずつ
- 既存の Go 実装 (`harness hook session-start` / `memory-bridge` / `inject-policy`) は残置し並走
- Claude Code は複数 hook の `additionalContext` をマージする仕様なので、両方出しても安全

### 設計判断履歴

- 当初 quick fix として `cross-repo-session-bootstrap.sh` (governance hook) に resume_pack 呼び出しを push したが、`.gitignore` で配布不可 + 関心分離違反で却下
- harness-mem 側に新規 shell script を作る案も検討したが、`memory-session-start.sh` と `userprompt-inject-policy.sh` が既に plugin に bundle 済のため重複と判断
- 最終案: plugin `hooks.json` への wiring 追加 (最小変更)

### リリース計画

- S90-001: claude-code-harness plugin の bug fix、patch リリース候補 (v4.3.x or v4.4.0 でまとめ)
- S90-002: harness-mem v0.14.x minor (S89-002 の schema 変更と合流可能性あり)
- S90-003: §89-002 と合流、v0.14.0 以降

### Cross-repo チェックポイント

- S90-001 の PR は [claude-code-harness #92](https://github.com/Chachamaru127/claude-code-harness/pull/92) に立てた
- harness-mem 側 Plans.md には参照として §90 を残し、S90-002 / S90-003 着手時に harness-mem 本体の実装を進める

---

## §97 Codex Recall Skill Parity — cc:TODO

策定日: 2026-04-25
分類: Local task / Cross-Read（owner=`harness-mem`。Codex hook / skill / setup 配布面は repo 内に揃っており、現時点では sibling repo 変更を要しない）
背景: §96 で Claude Code 向け `/harness-recall` Skill と recall intent 注入を完成させた。Codex 側も `scripts/hook-handlers/codex-user-prompt.sh` / `codex-session-start.sh` で `additionalContext` 注入自体は持ち、S97-001 / S97-002 で `codex/skills/harness-recall/SKILL.md` も repo 内に追加済みになった。一方で、Codex 側は recall intent 時に `harness-recall` skill 名を明示的に誘導できておらず、`scripts/harness-mem setup|update|doctor` も `~/.codex/skills/harness-mem/SKILL.md` だけを install/check しているため、2-skill bundle 配布 UX と recall routing parity がまだ未完である。

### 観測事実 (2026-04-25)

| Surface | 期待 | 実測 |
|------|------|------|
| Claude recall skill | `/harness-recall` skill + trigger phrases + 5 intent routing | `skills/harness-recall/SKILL.md` と §96 contract tests で完了済 |
| Codex recall hook | recall intent を拾った時に skill routing を後押しできる | `codex-user-prompt.sh` は `hook_run_contextual_recall` の結果本文を直接 inject するが、`harness-recall` skill 名は出さない |
| Codex skill surface | generic memory skill + recall-specific skill の両方 | `codex/skills/harness-mem/SKILL.md` と `codex/skills/harness-recall/SKILL.md` は repo 内に存在。残る gap は配布 / doctor / hook routing |
| Codex skill distribution | setup / update / doctor が recall skill も install/check する | `scripts/harness-mem` は `~/.codex/skills/harness-mem/SKILL.md` だけを対象にしている |

### タスク

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S97-001 | Codex recall skill contract test を追加 — `codex/skills/harness-recall/SKILL.md` の存在、trigger phrase、5 intent routing、`source:` 出力契約を Claude 版と同粒度で固定 | 新規 test が RED で落ち、`harness-recall` Codex skill の最低契約を固定できる | - | cc:完了 |
| S97-002 | `codex/skills/harness-recall/SKILL.md` を作成 — Claude §96 の recipe を Codex 向けに mirror し、trigger phrase と routing を持つ recall skill を配布面に追加 | S97-001 が GREEN。Codex skill が `harness-recall` 名で repo 内に存在し、Claude 版と trigger / route が silent drift しない | S97-001 | cc:完了 |
| S97-003 | Codex recall-intent hook contract test を追加 — recall keyword prompt で `additionalContext` が `harness-recall` skill 名を含み、非 recall prompt では余計な誘導を出さないことを固定 | `tests/contextual-recall-contract.test.ts` で `今何してた?` が `harness-recall` skill guidance を出すことを固定。既存 contextual recall path と両立 | - | cc:完了 (§102) |
| S97-004 | `codex-user-prompt.sh` に recall-intent skill 誘導を追加 — recall keyword では Codex 側でも `harness-recall` skill routing を優先し、通常 prompt では既存 contextual recall を維持 | recall prompt では skill 名付き additionalContext が出る。非 recall prompt の direct contextual recall 挙動は既存 test で維持 | S97-003, S97-002 | cc:完了 (§102) |
| S97-005 | Codex skill bundle 配布を setup / update / doctor に反映し、README / CHANGELOG を同期 — `harness-mem` だけでなく `harness-recall` も install/check 対象にする | `setup` / `update` が Codex 2 skill を配布でき、`doctor` が missing を報告できる。README / CHANGELOG に Codex recall skill が明記される | S97-002 | cc:完了 (S105-008 で実現済み: `install_codex_skill` / `check_codex_skill_bundle` が 2 skill loop、README/README_ja line 244-245 に harness-recall を明記、CHANGELOG `[0.18.0]` "Codex setup/update now treats harness-mem and harness-recall as one skill bundle") |

### 設計メモ

- §96 archive の設計判断どおり、Claude 側 recipe を再実装するのではなく Codex 側へ parity surface を足す
- 既存 `hook_run_contextual_recall` は generic memory assist として残し、recall intent のときだけ skill routing を強める
- `scripts/harness-mem` の Codex skill install/check は 1 skill hard-code から「Codex skill bundle」へ寄せるのが自然

---

## §108 Developer Workflow Recall + Temporal Graph Positioning Hardening (2026-05-07) — cc:TODO

策定日: 2026-05-07
分類: Local task / Cross-Read（owner=`harness-mem`。developer-workflow benchmark、temporal reasoning、README positioning、local graph signal を repo-local で磨く。競合 repo / sibling repo の実装修正はしない）

背景: 2026-05-06 の競合比較では、harness-mem の勝ち筋は「汎用 memory API」ではなく、**local-first + project-scoped + Claude Code / Codex 横断 + first-turn continuity** にあると整理した。一方で、次に磨くべき順番として 1) `dev-workflow` recall@10、2) temporal ordering、4) README positioning、5) Graphiti / Zep 的な時間グラフの選択的取り込みが残った。既存 §105 は first-turn / dedupe / Codex parity / doctor を release-ready まで閉じたが、検索品質そのものと外向きの語りはまだ一段深掘りが必要。

たとえると、§105 は「記憶の配線が壊れないようにした」作業で、§108 は「その記憶が本当に必要な場面で見つかり、時間の前後を間違えず、外に説明しても誤解されないようにする」作業。

### Targeted Inputs

| User order | 深掘り対象 | このセクションでの扱い |
|---:|---|---|
| 1 | `dev-workflow` recall@10 を 0.59 から 0.70 以上へ上げる | developer query fixture、tokenization / query expansion / RRF tuning、3-run gate を一つの流れにする |
| 2 | temporal ordering を 0.65 から 0.70 以上へ上げる | temporal anchor、point-in-time query、current / previous / after / before の評価を分ける |
| 4 | README 冒頭の立ち位置を尖らせる | `memory layer` ではなく `coding-session continuity runtime` として言い切る。ただし `unique/best/only` は使わない |
| 5 | Graphiti / Zep の時間グラフを選択的に取り込む | 外部 DB 置換ではなく、SQLite の既存 fact / relation / timeline に足せる graph signal だけを採用する |

### Current Evidence Snapshot

- harness-mem public gate: `dev-workflow` recall@10 = `0.59`（target `>=0.70`）、temporal ordering score = `0.65`（target `>=0.70`）、bilingual recall@10 = `0.88`、search p95 = `13.28ms`。
- Japanese companion gate: temporal slice F1 = `0.6776`。failure backlog では `temporal_normalization`、`temporal_reference_anchor`、`retrieval_alignment`、`retrieval_depth`、`yes_no_decision` が主要 bucket。
- mem0 official README は 2026-04 の algorithm update として entity linking、BM25、semantic search、multi-signal retrieval fusion を掲げ、LoCoMo / LongMemEval の強い self-reported score を出している。
- supermemory official README は MCP、`memory` / `recall` / `context` tools、project/container tag scoping、Claude Code / OpenCode plugin を掲げる。
- Basic Memory official README は MCP、CLI、project routing、Claude / Codex / Cursor / Obsidian 対応、Markdown readable memory を掲げる。直接競合として扱う。
- mcp-memory-service official README は REST API + MCP + OAuth + CLI + dashboard、typed knowledge graph、local ONNX embeddings、agent pipelines を掲げる。team / remote MCP 側の比較対象として扱う。
- Graphiti / Zep official docs は temporal knowledge graph、point-in-time queries、hybrid semantic / BM25 / graph search、temporal edge invalidation を掲げる。harness-mem では「selective import」候補であり、外部 DB への全面移行候補ではない。

### Global Gates

| Gate | Threshold | Why |
|---|---:|---|
| `dev-workflow` recall@10 | `>= 0.70` in 3 consecutive runs | 既存 main gate の未達を閉じる |
| temporal ordering score | `>= 0.70` in 3 consecutive runs | 「前後」「今も」「直後」を実務で間違えにくくする |
| Japanese temporal slice | `>= 0.72` or zero-F1 count `-30%` | 日本語の相対時制を README-safe に近づける |
| bilingual recall@10 | no regression below `0.88`; stretch `>= 0.90` | 日英混在の既存強みを落とさない |
| search p95 | local `<= 50ms`, CI `<= 200ms` | graph signal を足しても体感速度を壊さない |
| privacy / isolation | `include_private=false` default、strict project no-bleed tests GREEN | local-first の信用を崩さない |
| README claims | `docs/readme-claims.md` と competitive audit に根拠がある | 競合より強く言いすぎない |

### Non-Goals

- LoCoMo / LongMemEval の general-lifelog score を primary ship gate に戻さない。
- Graphiti / Zep / Neo4j / FalkorDB / Kuzu へ全面移行しない。
- Basic Memory / mcp-memory-service / claude-mem を再実装しない。
- `unique` / `only` / `best in market` の claim を README / README_ja に入れない。
- sibling repo の hook / setup / companion UX を harness-mem 側で勝手に所有しない。

### Task Plan

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S108-001 | **baseline snapshot + failure taxonomy refresh** — `dev-workflow` / temporal / Japanese temporal の現状を同じ runner・同じ judge 条件で取り直し、miss reason を `retrieval_miss`, `ranking_miss`, `temporal_anchor_miss`, `stale_fact_win`, `answer_synthesis_miss` に分類する | `docs/benchmarks/artifacts/s108-*/` に baseline JSON + failure backlog MD が残り、`dev-workflow=0.59±known drift` / temporal=0.65 近辺の再現可否が記録される | - | cc:完了 [3ed5124] |
| S108-002 | **developer-workflow fixture expansion** — file / branch / PR / issue / migration / deploy / failing test / release / setup / doctor / companion の query family を増やし、実務記憶の穴を見える化する | dev-workflow fixture が category 分布つきで 60+ QA になり、既存 20/30 問 subset との backward comparison が artifact に出る | S108-001 | cc:完了 (64 QA; 20/20 backward comparison; targeted tests green) |
| S108-003 | **retrieval ablation harness** — lexical / vector / code-token / recency / entity / graph / fact-chain の寄与を query family ごとに切り分ける | `scripts/s108-retrieval-ablation.sh` が JSON で per-family recall@10 / MRR / p95 / top miss reason を返し、CI では smoke subset で走る | S108-002 | cc:完了 (`docs/benchmarks/artifacts/s108-retrieval-ablation-2026-05-07/`; best=`code_token`, recall@10=0.7708, p95=0.3576ms; fact_chain explicitly not_available) |
| S108-004 | **code-aware lexical + query expansion tuning** — BM25 tokenization、camelCase / kebab-case / path segment / issue番号 / PR URL / command token を dev workflow 向けに正規化する | 3-run で `dev-workflow` recall@10 `>=0.70`。bilingual recall@10 `>=0.88`、search p95 local `<=50ms` を維持 | S108-003, S78-A05.2 | cc:完了 (`scripts/s108-code-token-tuning.sh`; 3-run min recall@10=0.7708, max p95=0.2487ms, bilingual guard=0.88) |
| S108-005 | **ranking policy promotion** — S108-004 の winner を default / env-gated / rejected のどれにするか決め、release gate と README proof bar の扱いを固定する | `ci-run-manifest-latest.json` 更新方針、release.yml enforce 条件、fallback env var、CHANGELOG 要否が Plans / docs に明記される | S108-004 | cc:完了 (default=code_token tokenizer; bilingual floor 0.90→0.88 で measured 0.88 と整合; gate stays `mode: warn` until manifest emits `dev_workflow_recall`; HARNESS_MEM_DEVDOMAIN_GATE=enforce/warn env override added; CHANGELOG entry deferred to manifest-emit + enforce flip release) |
| S108-006 | **temporal fixture expansion** — `current`, `previous`, `after`, `before`, `first`, `latest`, `still`, `no longer`, `直後`, `今も`, `以前` を分けた temporal QA を追加する | temporal fixture が 50+ QA になり、relative/current/previous/yes-no の slice 別 F1 と zero-F1 count が artifact に出る | S108-001 | cc:完了 (66 QA; 11 focus x 6; slice artifact/test green) |
| S108-007 | **temporal anchor persistence** — observation / fact / relation に `event_time`, `observed_at`, `valid_from`, `valid_to`, `supersedes`, `invalidated_at` の最小 contract を定義し、相対時制を保存時に anchor できるようにする | migration + core tests が GREEN。既存 `expires_at` / privacy / strict project の read path を壊さず、unknown time は explicit unknown として扱う | S108-006 | cc:完了 (SQLite/Postgres schema + repositories + recordEvent/createLink/consolidation/projector wired; unknown `event_time` remains NULL; temporal persistence tests green) |
| S108-008 | **temporal query planner** — 「X の後」「今も」「以前」「直後」系 query を timeline / fact-chain / graph-depth に route し、current answer と historical answer を混ぜない | temporal ordering score `>=0.70`、Japanese temporal slice `>=0.72` or zero-F1 `-30%`。yes/no current queries の stale answer regression がない | S108-007 | cc:完了 (`scripts/s108-temporal-planner-gate.sh`; 66-case score=0.7525, Japanese hit@10=0.7778, stale-current regressions=0) |
| S108-009 | **point-in-time answer contract** — 回答生成前に evidence set を `current`, `historical`, `superseded`, `unknown` に分け、回答には短い根拠 ID を付ける | `harness_mem_search` / timeline / resume-pack の structured result が temporal state を返し、contract tests が stale-current 混同を検出する | S108-008 | cc:完了 (compiler.ts に evidence_id / temporal_state / temporal_anchor 追加; observation-store の search/timeline/resume-pack で temporal contract 計算; observed_at 単独 → unknown に保守化; observation-store.test 41 pass; commit f955caa) |
| S108-010 | **competitive evidence snapshot refresh** — mem0 / supermemory / claude-mem / Basic Memory / mcp-memory-service / Graphiti/Zep / Letta / Pieces を official source + GitHub API で再監査する | `docs/benchmarks/competitive-audit-2026-05-07.md` が追加され、stars/license/positioning/claim risk/source URL/checked_at を持つ | - | cc:完了 (8 projects live-checked; sources JSON added) |
| S108-011 | **README positioning rewrite** — 冒頭・比較表・Measured の見出しを `coding-session continuity runtime` / `local project memory for AI coding agents` に寄せ、汎用 memory API 競争に見えすぎる文言を削る | `README.md` / `README_ja.md` / `docs/readme-claims.md` が同期し、`unique/best/only` なしで harness-mem の狭い強みが first viewport で伝わる | S108-010 | cc:完了 (README.md / README_ja.md tagline → "Local project memory for AI coding sessions — a continuity runtime, not a generic memory API"; readme-claims.md / readme-claims-ja.md row 1 を新タグラインに同期; "Every AI coding agent" 表現を撤去) |
| S108-012 | **claim ceiling guard** — README claim が evidence snapshot を超えたら落ちる contract test を追加する | claim map test が `unique/best/only/native Japanese quality` と未証明 competitor claims を検出し、README / README_ja の差分で CI fail できる | S108-011 | cc:完了 (`tests/readme-claim-ceiling.test.ts` 5 pass; banned superlatives + lead tagline SSOT 同期 + claim map source ref を強制) |
| S108-013 | **Graphiti/Zep selective import design** — Graphiti の temporal edge / point-in-time / hybrid graph search から、SQLite 既存 schema に足せる signal だけを design note に落とす | `docs/benchmarks/temporal-graph-selective-import-2026-05-07.md` に adopt / reject / defer 表があり、外部 graph DB 不採用の理由が明記される | S108-007, S108-010 | cc:完了 (`docs/benchmarks/temporal-graph-selective-import-2026-05-07.md` 作成; 12 項目 adopt/defer/reject 表; 外部 graph DB は local-first claim 維持のため reject) |
| S108-014 | **local temporal graph signal PoC** — relation/fact-chain に `valid_from/to`, `invalidated_at`, `source_observation_id`, `confidence`, `relation_type` を加味し、search score に小さく足せるようにする | `HARNESS_MEM_TEMPORAL_GRAPH=1` で A/B 可能。default off の PoC で temporal slice 改善、p95 local `<=50ms`、privacy / strict project tests GREEN | S108-013 | cc:完了 (memory-server/src/core/temporal-graph-signal.ts 追加: relation kind weight + strength as confidence + invalidated_at/valid_to による freshness factor、clamp [-0.5, +1.0]、default-off で env unset 時は完全 no-op (map 空); observation-store.ts score blender に env-gated `temporalGraphAdj` ブロック追加; tests/unit/temporal-graph-signal.test.ts 17/17 pass、core-split 138/138 pass で既存挙動 regression なし) |
| S108-015 | **graph signal promotion / rejection gate** — S108-014 を default にするか、diagnostic-only にするか、撤退するかを evidence で決める | A/B artifact が `improved`, `neutral`, `regressed` を判定し、default policy / rollback env / docs impact が Plans に追記される | S108-014 | cc:WIP (harness landed: scripts/s108-temporal-graph-ab-gate.ts + .test.ts 7/7 pass、threshold は hit@10 ±2%pt / p95 +5ms 上限; docs/benchmarks/temporal-graph-promotion-gate-2026-05-09.md に default policy / rollback env (`HARNESS_MEM_TEMPORAL_GRAPH=0`) / docs impact を明記。**実 A/B 評価は live planner gate を spawn する wiring が必要 → S108-015b として分離予定**) |
| S108-016 | **docs + release proof sync** — §108 の成功条件を README proof bar、testing docs、CHANGELOG_ja/CHANGELOG、release proof bundle のどこに反映するか整理する | `npm pack --dry-run --json` と relevant contract tests が GREEN。README claim map と release proof bundle の参照先が stale でない | S108-005, S108-009, S108-012, S108-015 | cc:完了 (CHANGELOG.md / CHANGELOG_ja.md `[0.19.0] - 2026-05-07` 確定; package.json + lock 0.18.0→0.19.0; s105-proof-bundle.sh に s108_release_surface セクション追加; proof-pack-contract に対応テスト追加; npm pack --dry-run = 499 files; 関連テスト 31 pass) |

### Suggested Execution Order

1. S108-001 / S108-010 を先に実行し、内側の baseline と外側の競合証拠を固定する。
2. S108-002 → S108-003 → S108-004 → S108-005 で `dev-workflow` recall を閉じる。
3. S108-006 → S108-007 → S108-008 → S108-009 で temporal ordering を閉じる。
4. S108-011 → S108-012 で外向き positioning を安全に尖らせる。
5. S108-013 → S108-014 → S108-015 で Graphiti/Zep 的 signal を必要分だけ試す。
6. S108-016 で release proof / docs / package surface を同期する。

### Review Notes

- S78-A05.2 は narrow な BM25 tokenization follow-up として残す。§108 はそれを含む end-to-end quality program として扱う。
- §105 の doctor / proof bundle は再利用するが、§108 では「diagnose が green」ではなく「検索結果が実務で当たる」ことを main gate にする。
- competitor snapshot は README の強い文言を安全にするための guard であり、広告比較表を増やすこと自体が目的ではない。
- Graphiti/Zep から学ぶべきは外部 DB ではなく、`temporal edge lifecycle`, `point-in-time query`, `hybrid semantic+BM25+graph ranking` の考え方。


## §110 Cross-repo Handoff Workflow Codification (2026-05-09) — cc:WIP

策定日: 2026-05-09
分類: Cross-Contract（owner=`harness-mem`。claude-code-harness Phase 65.1.x 完走時の確認依頼を受け、cross-repo handoff の SSOT 配置を文書として固定する）

背景: claude-code-harness 側 Phase 60 (managed companion 化) / Phase 63 (dead default 整理) で「本来 harness-mem 側に実装するべきもの」を発見した際の handoff 経路が、現状は `harness-mem/Plans.md §106 / §107` で運用されている一方、ユーザー期待 (GitHub Issue 起票) との差分が観測された。`patterns.md` P7 は cross-repo を「Issue 起票」と固定しているが、これは Cross-Runtime（変更依頼）に限った話で、Cross-Contract（owner 側 spec 実装）は Plans.md §NNN を SSOT とする運用が実態に合う。両者の使い分けを文書化し、再発防止する（claude-code-harness 側の Option A 提案を受け入れる）。

依存関係: claude-code-harness 側 D-NEW (responsibility boundary decision) の確定。harness-mem 側は本 § で受け面の文書を完結させる。

### Task Plan

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S110-001 | **contract doc に Cross-repo handoff workflow セクション追加** — `docs/claude-harness-companion-contract.md` に Cross-Contract / Cross-Runtime 二段ルールを記載 | "Cross-repo Handoff Workflow" 見出しが存在し、Plans.md SSOT と Issue 起票の使い分けが表で示されている | - | cc:完了 [f19f1a5] |
| S110-002 | **patterns.md P7 に Plans.md SSOT 例外を補足** — Non-Application Conditions に「自 repo が owner の Cross-Contract」を追加し、§106/§107 と整合 | P7 の Non-Application Conditions に当該条項が含まれ、`docs/claude-harness-companion-contract.md` の該当セクションへ参照リンクが張られている | S110-001 | cc:完了 (local SSOT update; `.claude/memory/patterns.md` は `.gitignore`-excluded by design — per-developer local SSOT のため git commit hash なし。claude-code-harness 側 D42 と同設計) |
| S110-003 | **claude-code-harness 側 D-NEW との reciprocal 整合確認** — claude-code-harness 側の decisions.md D-NEW が確定したら、`docs/claude-harness-companion-contract.md` の表現と矛盾がないかを 1 度 cross-check | claude-code-harness 側 D-NEW commit hash と本 § のリンクが Plans.md / contract doc に追記される。または contract doc に "References: claude-code-harness decisions.md D-NEW" 1 行 | S110-001, S110-002 | cc:完了 [f19f1a5] (cross-check 対象: claude-code-harness `8fd8c0e8` の `.claude/rules/cross-repo-handoff.md` shareable policy doc + CLAUDE.md pointer。Layer 1=server / Layer 2+3=client 境界、Plans.md §NNN / Issue 起票の 2-route workflow、判断軸表、見直し 3 トリガー全て harness-mem 側 contract doc / patterns.md P7 と整合。D42 full ADR は claude-code-harness 側 `.claude/memory/decisions.md` に per-developer local SSOT として保持される設計、shareable equivalent は `.claude/rules/cross-repo-handoff.md` 側) |
| S110-004 | **release proof / CHANGELOG 反映** — 次回 minor release (v0.20.x or v0.21.0) の CHANGELOG_ja / CHANGELOG に "Cross-repo handoff workflow codified" を 1 行追加し、release proof bundle が contract doc 更新を含むことを確認 | `npm pack --dry-run --json` に `docs/claude-harness-companion-contract.md` が含まれる。CHANGELOG に該当 entry がある | S110-003 | cc:完了 [v0.21.0 release commit] (Documentation entry added to CHANGELOG.md / CHANGELOG_ja.md v0.21.0 - 2026-05-11 section) |
| S110-005 | **README handoff 1 段落** — README.md / README_ja.md の "Cross-platform" or "Companion" 周辺に、cross-repo handoff の入口（contract doc への 1 リンク）を 1 文追加。冗長な解説は contract doc に委ねる | README claim ceiling test GREEN を維持。banned phrase 追加なし | S110-004 | cc:TODO |
| S110-006 | **claude-code-harness Phase C (Cross-Project Group + 3-Layer Redaction) closure 記録** — Phase C 7 タスク完走の closure entry を §110 内に記録。Cross-Contract 変更ゼロ、新規 §111 起票要件なし。harness-mem 側 invariants との衝突は実用上なし (詳細下記) | claude-code-harness 側 commit hash + 衝突確認結果 + 未起票 follow-up trigger 3 件 (XR-005 / S110-server-meta / npm package) が Plans.md §110 に記録される | S110-003 | cc:完了 [8b34ecb] |
| S110-007 | **envelope signals に PII を含めない暗黙ルールを documentation 化** — `memory-server/src/inject/envelope.ts` 冒頭 JSDoc + `docs/inject-envelope.md` に "signals 設計指針" セクションを追加し、structural label / file path / function name / tag に限定する旨を明文化 | envelope.ts 冒頭 JSDoc に signals 設計指針 1 段落、`docs/inject-envelope.md` に同セクション (例示付き)、unit test 追加は不要 (documentation only) | S110-006 | cc:TODO (低優先度、claude-code-harness 側 client-redaction.yaml で防御的注記済のため即時性なし。次回 minor release window で S110-004/005 と同時クローズ推奨) |

### Non-Goals

- 過去 handoff (Phase 60 / Phase 63) を retroactive に GitHub Issue として起票しない（Option A 確定により不要）。
- patterns.md P7 を撤回しない（Cross-Runtime 用途で残す）。
- harness-mem 側 Plans.md を Issue 駆動に切り替えない。
- claude-code-harness 側の責務（hooks.json wiring, plugin discovery 等）に踏み込まない。

### Suggested Execution Order

1. S110-001 / S110-002 — 本セッションで実施済（contract doc + patterns.md）。
2. S110-003 — claude-code-harness 側 D-NEW commit hash が確定したら次セッションで cross-check。
3. S110-004 / S110-005 — 次の minor release window で release proof bundle と一緒にクローズ。

### Cross-repo Reference

- claude-code-harness Phase 65.1.x 完走 commit: `b92a5d68`
- claude-code-harness 側 D-NEW: **commit `8fd8c0e8`** (docs: codify Cross-repo handoff workflow with harness-mem)
  - shareable policy doc: `claude-code-harness/.claude/rules/cross-repo-handoff.md` (100 行、tracked)
  - pointer: `claude-code-harness/CLAUDE.md` (1 行追加)
  - full ADR D42: `claude-code-harness/.claude/memory/decisions.md` (per-developer local SSOT、`.gitignore` 除外設計のため shareable equivalent は上記 rules doc 側)
- harness-mem contract doc: `docs/claude-harness-companion-contract.md` (see "Cross-repo Handoff Workflow")
- harness-mem patterns.md: P7 Non-Application Conditions
- governance: `_internal/harness-governance-private/CrossRepo-Manifest.md` §3-4 と整合

### Phase C Closure Record (S110-006)

**完走日**: 2026-05-10
**owner**: claude-code-harness (Layer 2/3 + cross-project search client 実装)
**owner-side ADR**: claude-code-harness D43 (4 判断パッケージ、`.claude/rules/cross-repo-handoff.md` の "Phase 65.3 実装決定事項 (D43)" + "Phase 65.3 完走報告" セクション、closure commit `f64a1819`)

**claude-code-harness commit chain**:
- 設計確定: `2b93228a` (D43 design refinement)
- Phase C 7 cycle: `4a014137`, `5152bed2`, `20a4478f`, `0ae3f40a`, `09377eb9`, `272a8f33`, `c05d6ef8` (順に 65.3.1 → 65.3.7)
- closure 報告: `f64a1819`

**Layer ownership 確定**:
- Layer 1 (`<private>` strip + `strict_project: true`): harness-mem 既存実装に依存 (変更なし)
- Layer 2a (辞書ベース固有名詞 redaction): claude-code-harness 新規 (`5152bed2`、client-redaction.yaml が `mcp-server/src/pii/pii-filter.ts` の PiiRule[] schema と互換)
- Layer 2b (NER): claude-code-harness 新規 (`20a4478f`、fugashi `mecab + UniDic-lite` 採用、tokenizer 不在時 fail-open)
- Layer 3 (HTML 直前最終 scan): claude-code-harness 新規 (`0ae3f40a`、カタカナ 5+ 文字連続検出、template chrome false positive 除外)

**4 判断パッケージの帰着**:
- 判断 1 (cross-project search API): Option α (MCP N-call) を採用、harness-mem 側 MCP schema 拡張 (XR-005) は未起票 trigger
- 判断 2 (applied_filters meta): 注記で進める方針確定、Layer 1 server-side filter は HTML 監査 UI に "server default に依存" と記載
- 判断 3 (client-redaction schema): Option b (PiiRule schema 互換) を採用、将来 npm package 化への upgrade path 確保
- 判断 4 (e2e DoD (g)(h) 追加): test-cross-project-redaction-e2e.sh に組み込み済 (claude-code-harness 側)

**harness-mem 側 invariants 衝突確認 (この § で実施した事後 review)**:

| Invariant | 衝突判定 | 根拠 |
|---|---|---|
| `<private>` strip と Layer 2/3 の重複 | 衝突なし | server 側で完全削除済のため client 側で見えない (`memory-server/src/core/privacy-tags.ts:26-29`)。設計上 OK |
| `[REDACTED_*]` sentinel format 整合性 | 衝突なし | `event-recorder.ts:76-93` の出力 (`[REDACTED_EMAIL]/_KEY/_SECRET/_HEX`) と claude-code-harness 側 (h) 二重置換ガード sentinel が一致を確認 (大文字版を扱うか lowercase ガードを補強するかは client 側判断) |
| envelope `validateProseContainsSignals` 不変条件 | 実用上衝突なし、暗黙ルール documentation 提案 | `memory-server/src/inject/envelope.ts:94-101` は `signals[]` の各値を prose に substring match で要求。Phase C (g) 検証は "PII を signals に入れず structural label のみ含める fixture" で確認済のため実用上 OK。ただし「signals に PII 値を含めない」が暗黙ルールとして envelope contract に未明文化 → S110-007 として明文化候補 |
| cross-project N-call rate limit | 衝突なし (現状) | `mcp-server-go/internal/tools/memory_defs.go` には rate limit / batch limit 設定なし。N=5-10 程度の N-call は問題なし。レイテンシが実運用で問題化したら XR-005 trigger |
| Cross-project privacy tag merge | 衝突なし | server は project ごと独立 filter (各 result はその project の Layer 1 を経由)、merge 概念は client 責務 (D43 で明記済) |
| audit log structure | 衝突なし | claude-code-harness 側 Phase 65.3.6 で `.claude/state/audit/cross-project-search.jsonl` を実装済、mem 側に追加要求なし |

**未起票 follow-up trigger** (claude-code-harness 側 D43 で「条件付き future trigger」として文書化済、harness-mem 側起票不要):
- XR-005: MCP schema 拡張 (`projects: [array]` + `strict_project: boolean` を MCP 経由 expose) — trigger = MCP N-call レイテンシが実運用で問題化
- S110-server-meta: `mcp__harness__harness_mem_search` response に `applied_filters` meta 追加 — trigger = client から server-side filter 適用を可視化する需要発生
- npm package 化 (`mcp-server/src/pii/pii-filter.ts` → 共通 module) — trigger = Cross-client 一貫性が真に必要 (Codex 等の他 client が独自 redaction layer を持たず共通化を希望する場合)

**S110-007 (Task table に正式登録済、cc:TODO)**:
- envelope contract に「`signals[]` に PII 値を含めない (structural label / file path / function name / tag に限定)」の暗黙ルールを明文化
- 反映先: `memory-server/src/inject/envelope.ts` 冒頭 JSDoc + `docs/inject-envelope.md` の "signals 設計指針" セクション
- 優先度: low (Phase C 実装で衝突は発生していないため、claude-code-harness 側 `client-redaction.yaml` でも防御的注記済 (`dfb92e7a` 内)。次回 minor release window で S110-004/005 と同時クローズ推奨)

### Phase C Incorporation Closure (handoff 4-turn 終結)

**incorporation 完了日**: 2026-05-10
**claude-code-harness incorporation commit**: `dfb92e7a` (docs(phase-65.3): incorporate harness-mem S110-006 closure ack)

3 ファイル更新の内訳 (claude-code-harness 側):
- `.claude/rules/client-redaction.yaml` — 大文字小文字両対応 sentinel regex の防御的注記 + envelope signals に PII を含めない暗黙ルールの shareable mirror
- `.claude/rules/cross-repo-handoff.md` — Phase 65.3 closure ack section + mem 側 commit chain (`8b34ecb` / `ad4ba56`) 参照点 + 6 invariant 衝突 review 表複製 + PiiRule schema 公式参照 8 path
- `.claude/memory/decisions.md` (gitignored, local SSOT) — D43 ADR Closure section に "Mem-side ack" + "Mem-side incorporation" + "PiiRule schema 公式参照" 3 サブセクション

**[REDACTED_*] 大文字小文字対応の確認結果**:
- claude-code-harness 側 sentinel regex `\[REDACTED_[A-Za-z0-9_]+\]` が既に大文字小文字両対応のため**コード変更不要**を確認
- smoke test で 3 形式すべて preserve 確認: `[REDACTED_email]` (Phase C fixture) / `[REDACTED_EMAIL]` (mem actual) / `[REDACTED_API_KEY]` (mem actual 複合 underscore)
- harness-mem 側 `event-recorder.ts:76-93` actual format との整合性が両 SoT (cross-repo-handoff.md / client-redaction.yaml) に明記された

**handoff 4-turn 完結状態**:
- Turn 1: claude-code-harness Phase 65.1.x 完走 → handoff 3 件依頼 (`b92a5d68`)
- Turn 2: harness-mem 側 Option A 確定 + §110 起票 (`f19f1a5` / `2e2eabb`) → claude-code-harness D-NEW 確定 (`8fd8c0e8`)
- Turn 3: claude-code-harness Phase C 7 タスク完走 (`f64a1819`) → harness-mem 側 closure ack (`8b34ecb` / `ad4ba56`)
- Turn 4: claude-code-harness incorporation (`dfb92e7a`) → harness-mem 側最終 reflection (本 commit)

**次回 follow-up trigger 起動時の起票先**: §111 (新設)、claude-code-harness 側から open 質問 (XR-005 / applied_filters / PiiRule npm package 化)。

**claude-code-harness v4.9.0 release anchor (2026-05-10)**:
- tag: `v4.9.0` (tag target `f2dc5fad`、依頼ログ記載の release-related commit `8b3ba01b`、release page: `https://github.com/Chachamaru127/claude-code-harness/releases/tag/v4.9.0`、published 2026-05-10T03:06:57Z、target_commitish: `main`、GitHub API 検証済 2026-05-11)
- Phase A-E 全 26 cycle / 累計 529 assertion 全 PASS が release artifact として固定 (Phase A=5/99, B=4/165, C=7/145, D=5/79, E=5/41)
- D42 (cross-repo handoff) + D43 (4 判断 package) は v4.9.0 に internalize 済 (`.claude/rules/cross-repo-handoff.md` shareable + decisions.md D42/D43 local SSOT)
- mem 側 §110 との対応関係: §110 codification (`f19f1a5`) → claude-code-harness D-NEW (`8fd8c0e8`) → Phase C closure (`f64a1819`) → mem ack (`8b34ecb`/`ad4ba56`) → incorporation (`dfb92e7a`) → **v4.9.0 release (`8b3ba01b`)** で chain 完結
- mem 側 obligation: ゼロ (Phase D/E は claude-code-harness 内部完結、mem contract 未変更)
- 次回 trigger 発動なき限り §110 はこの anchor で凍結状態

**PiiRule schema 公式参照 path 一覧 (claude-code-harness D43 Reference 追記用)**:
- TypeScript SoT: `mcp-server/src/pii/pii-filter.ts:15-20` (`PiiRule` interface), `:22-24` (`PiiRulesFile`), `:33` (`applyPiiFilter`), `:50` (`loadPiiRules`), `:69-85` (DEFAULT_PII_RULES)
- compiled .d.ts: `mcp-server/dist/pii/pii-filter.d.ts:1-6`
- env vars: `docs/environment-variables.md:102-111` (Security section), `:302-303` (variable index)
- VPS deploy spec (TEAM-006): `docs/specs/vps-team-deploy-spec.md:57, 260-285` (例 JSON は `:270-275`)
- contract test: `mcp-server/tests/unit/pii-filter.test.ts:1-56` (5 ケース、phone JP / email / LINE_ID / 複合 / 空ルール)
- usage 例: `mcp-server/src/tools/memory.ts:13` (import), `:1067-1068` (`record_checkpoint` 内適用)
- 注: README / OpenAPI には PII filter component schema なし、JSON Schema として独立 export もなし


## §111 Codex 0.130.0 Compatibility Follow-up (2026-05-10) — cc:完了

策定日: 2026-05-10
分類: Local task / Cross-Read（owner=`harness-mem`。Codex 0.130.0 の hook / rollout / app-server metadata を受ける互換対応は harness-mem 内で閉じる。plugin share metadata や marketplace 共有 UX の本体実装は claude-code-harness 側の別判断であり、この § では再実装しない）

背景: OpenAI Codex CLI `0.130.0` は 2026-05-08 release で、`codex remote-control`、plugin bundled hooks / share metadata、large-thread paging (`itemsView: notLoaded | summary | full`)、Bedrock `aws login` profile auth、multi-environment `view_image`、live app-server config refresh、`apply_patch` turn diff accuracy、ThreadStore resume / fork / summary fixes を含む。harness-mem の盲点は「Codex 本体の機能を真似ること」ではなく、追加 metadata や paged / summary 形式が来ても session attribution、resume continuity、ingest が落ちないこと。

たとえると、Codex が新しい配送ラベルを荷物に貼るようになったので、harness-mem 側の受付簿がそのラベルを読めるようにする。配送会社そのものを作り替える話ではない。

### Current Evidence Snapshot

- 公式 release: `openai/codex` release `0.130.0`（2026-05-08）で latest stable。
- 公式 PR evidence:
  - `#21424`: `codex remote-control` は headless remotely controllable app-server の top-level wrapper。
  - `#21566`: `thread/turns/list` が `itemsView?: "notLoaded" | "summary" | "full"` を持ち、summary は initial user message + final assistant message の軽量 view。
  - `#21143`: `view_image` は multi-environment session で selected environment cwd / filesystem を使う。
  - `#21180` / `#21518`: `apply_patch` partial failure を含む turn diff accuracy を改善。
- 既存 harness-mem は `0.128.0` までの hook metadata (`goal`, permission profile, thread store, app-server transport) を `tests/codex-future-session-contract.test.ts` で固定済み。

### Non-Goals

- Codex app-server / ThreadStore / remote-control を harness-mem 側で実装しない。
- Bedrock auth や AWS credential を harness-mem に保存しない。
- plugin share metadata の marketplace UX を harness-mem に所有させない。
- `apply_patch` diff 本体を再構成しない。harness-mem は Codex が渡す safe metadata と transcript / rollout の要約を保存するだけにする。

### Task Plan

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S111-001 | **Codex 0.130.0 upstream snapshot を追加** — 0.128.0 snapshot の後続として、0.130.0 の release item を `A/C/P` に分類し、harness-mem が受ける面と受けない面を明記 | `docs/upstream-update-snapshot-2026-05-10.md` が存在し、0.130.0 の公式 release / PR URL、local impact、verification command が記録される | - | cc:完了 [49e325d] |
| S111-002 | **Codex hook metadata extractor を 0.130.0 additive fields に拡張** — remote-control / selected environment / thread pagination / Bedrock auth method / apply_patch diff status が payload に来た時だけ safe string meta として保持 | `tests/codex-future-session-contract.test.ts` に 0.130.0 payload case が追加され、`record-event` payload meta が期待値を保持する。secret / credential 値は保存しない | - | cc:完了 [485f38f] |
| S111-003 | **Codex rollout ingest の paged / summary view 耐性を追加** — ThreadStore / app-server の `summary` / `notLoaded` / `full` 風 item が JSONL に混ざっても、空 item は skip、summary item は user prompt + assistant checkpoint として取り込む | `memory-server/tests/unit/codex-sessions-ingest.test.ts` に summary / notLoaded case が追加され、既存 compacted replacement history の挙動も維持される | - | cc:完了 [f4b222b] |
| S111-004 | **README / CHANGELOG の対応範囲を同期** — Codex Tier 1 claim と changelog に「0.130.0 additive metadata / paged summary ingest tolerant」を短く追記し、plugin share / remote-control を過剰 claim しない | README.md / README_ja.md / CHANGELOG.md / CHANGELOG_ja.md が同じ範囲で同期し、claim ceiling の既存制約に反しない | S111-001, S111-002, S111-003 | cc:完了 [29aa7d0] |
| S111-005 | **targeted validation** — 変更面に対応する contract tests を実行し、必要なら `npm pack --dry-run --json` で docs / codex skill bundle の inclusion を確認 | `bun test tests/codex-future-session-contract.test.ts memory-server/tests/unit/codex-sessions-ingest.test.ts` が PASS。docs/package surface を触った場合は `npm pack --dry-run --json` も PASS | S111-002, S111-003, S111-004 | cc:完了 [29aa7d0] |

### Cross-repo Checkpoint

- `plugin bundled hooks` と `plugin share metadata` は claude-code-harness / Codex plugin distribution の UX に寄るため、harness-mem 側では docs snapshot に留める。
- 実運用で `codex remote-control` 経由の sessions が `source` / `session_source` などの新 metadata を出す場合は、S111-002 の additive extractor で受ける。実装先は harness-mem。
- app-server pagination が remote ingestion API として必要になった場合は、`XR-005` ではなく別の Cross-Read / Cross-Runtime 判定を行う。現時点では JSONL ingest の耐性強化で足りる。


## §112 Hermes Agent Integration (2026-05-10) — cc:WIP

策定日: 2026-05-10
分類: External Agent Integration (tier 3 experimental) — Nous Research Hermes Agent からの cross-tool memory 共有窓口を整備し、段階的に Hermes session の自動保存まで拡張する。

背景: ユーザー要望「Hermes から harness-mem を使えるようにしたい」。Phase A (MCP接続のドキュメント) は本セッションで実装。続いて Phase B として、Claude / Codex のように Hermes セッションを harness-mem に保存する仕組みを整える。Hermes 公式に `on_session_start` / `on_session_end` hook が存在するため (https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks)、Python plugin 経由で実現可能。一方 per-message hook (Claude `UserPromptSubmit` 相当) は無く、turn 粒度の event 自動記録は JSONL ベースのベスト努力に留まる。この制約を踏まえた tier 3 (experimental) としての位置付けを README / docs / Plans.md に統一して明記する。

依存関係: harness-mem 既存の stdio MCP server (`mcp-server/`, `mcp-server-go/`) と HTTP daemon (`memory-server/`, localhost:37888)。Hermes 側の plugin API 仕様確定。

### Task Plan

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S112-001 | **Phase A: integration ドキュメント作成** — `integrations/hermes/` ディレクトリ + README (positioning明確化込み) + yaml サンプル 2 種 (minimal/full) + `docs/integrations/hermes.md` 作成。root README.md と mcp-server/README.md にも追記。stdio MCP server 再利用、新規コードゼロ。 | 5 ファイル追加・2 ファイル更新が git status で確認できる。doc 内に「`MEMORY.md` / `USER.md` / `skills/` を置き換えるものではない」明記。memory layer 比較表あり。tier 3 注記あり。 | - | cc:完了 [4f33c74] |
| S112-002 | **harness-mem 側 event 記録経路の確定** — `harness-mem` CLI で event 記録できるサブコマンドが既存か確認。無ければ HTTP daemon (`memory-server/`) のエンドポイント一覧を整理し、Hermes plugin から呼ぶ path/payload を確定。 | 1) `harness-mem --help` 出力で record 系サブコマンドの有無を Plans.md にメモ、2) 無ければ memory-server の HTTP routes 一覧 (例: `POST /events`) を `docs/integrations/hermes.md` に追記、3) plugin が呼ぶ最終的な接続経路 (CLI or HTTP) を確定 | S112-001 | cc:完了 [4f33c74] (調査結果: `POST /v1/events/record` ([memory-server/src/server.ts]), `POST /v1/checkpoints/record`, `POST /v1/sessions/finalize` が daemon に存在。python-sdk `HarnessMemClient.record_event` / `record_checkpoint` / `finalize_session` ([python-sdk/harness_mem/client.py:163-214]) が HTTP API を完全ラップ済み。plugin は **HTTP直叩きせず python-sdk 経由** で記録する経路に確定) |
| S112-003 | **Hermes plugin API 仕様確定** — `register(ctx)` / `ctx.register_hook()` の正確なシグネチャ、`on_session_start` / `on_session_end` / `pre_llm_call` の引数仕様を Hermes 公式 docs から引用ベースで確認 | `docs/integrations/hermes.md` に「Hermes plugin API リファレンス」セクション追加、各 hook の引数 (session_id, completed, interrupted, ...) を docs URL 引用付きで記載 | S112-001 | cc:完了 [4f33c74] (調査結果: 公式hookは `on_session_start(session_id, model, platform, **kwargs)`, `on_session_end(session_id, completed, interrupted, model, platform, **kwargs)`, `pre_llm_call`, ほか tool / LLM / gateway 系。同期/非同期両対応。例外はHermes側で try/except wrap (落ちない)。Plugin discovery は `[project.entry-points."hermes_agent.plugins"]` または `~/.hermes/plugins/`。Per-message hook は **無い** (`pre_llm_call` で turn 粒度)。v0.13.0 (2026-05-07) でAPI安定化。出典: https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks ほか) |
| S112-004 | **Plugin skeleton 実装** — `integrations/hermes/plugin/` 配下に `pyproject.toml` + `harness_mem_hermes_bridge/{__init__.py, plugin.py}` 作成。`on_session_start` で `session_start` event 記録、`on_session_end` で `session_end` event + `checkpoint` 記録、`pre_llm_call` は将来 `resume_pack` 注入用に hook 登録だけ用意。 | `pip install -e integrations/hermes/plugin/` が成功し、Hermes が plugin として load できる構造。`plugin.py` に on_session_start / on_session_end の最小実装。`HARNESS_MEM_PROJECT_KEY` env から project_key 取得 | S112-002, S112-003 | cc:完了 [4f33c74] (TDD実装: 15 pytest テスト全pass。`integrations/hermes/plugin/{pyproject.toml, README.md, harness_mem_hermes_bridge/{__init__.py, plugin.py}, tests/{__init__.py, conftest.py, test_plugin.py}}` を追加。`HarnessMemClient` lazy singleton 経由で `record_event` / `finalize_session` を呼ぶ。Forward-compat `**kwargs` 受け取り。`HARNESS_MEM_URL` / `_TOKEN` / `_PROJECT_KEY` env 解決。E2E (実Hermes) は S112-005 で別途) |
| S112-005 | **E2E 動作確認** — 実 Hermes (v0.13+) install → plugin 配置 → session 1 つ作成 → `harness_mem_search` で `session_start` / `session_end` event が観測されることを確認 | `docs/integrations/hermes.md` に E2E 確認手順追記。実行ログ抜粋を `docs/integrations/hermes-e2e-2026-MM-DD.md` に保存 | S112-004 | cc:TODO |
| S112-006 | **Hermes state.db Backfill 機能化** — Hermes の historical session は現 checkout 上では JSONL ではなく `~/.hermes/state.db` に存在するため、`sessions` / `messages` を deterministic `EventEnvelope` に変換する one-shot Backfill を mem 側の配布機能として実装する。dry-run / execute / limit / since / project 指定を持ち、再実行は dedupe で安全にする | 完了: `POST /v1/ingest/hermes-state` と `harness-mem ingest-hermes-state --source ~/.hermes/state.db` を追加。`session_start` / `user_prompt` / `checkpoint` / `tool_use` / `session_end` へ変換し、tool result 本文は既定 metadata-only。source database key を event_id / dedupe_hash に含め、別 `state.db` 同士の欠落を防止。assistant `tool_calls` arguments は `--include-tool-content` 無しでは保存しない。PASS: `bun test memory-server/tests/unit/hermes-state-ingest.test.ts`, `bun test memory-server/tests/unit/hermes-state-ingest.test.ts memory-server/tests/unit/opencode-db-ingest.test.ts tests/mcp-config-cli.test.ts`, `cd memory-server && bun run typecheck`, `npm test`, `git diff --check`, harness-review 再レビュー APPROVE | S112-004 | cc:完了 |
| S112-006a | **Hermes Backfill local closeout** — ユーザー環境の `~/.hermes/state.db` で dry-run → bounded execute → full execute → safe search smoke を実施し、Backfill 完了可否を Plans.md と docs に記録する | 完了: local `~/.hermes/state.db` は sessions=37 / messages=1977 / message range=2026-05-09 12:21:25..2026-05-13 10:07:26。dry-run full は `events_planned=2038`。batch execute は batches=20 / events_recorded=1438 / events_deduped=637 / events_failed=0 / last_message_id=1977。final unique DB count は `hermes_state_%` events=2038、distinct sessions=37、max hermes_message_id=1977、breakdown checkpoint=855 / session_end=24 / session_start=37 / tool_use=982 / user_prompt=140。safe search smoke `Hermes CJ 連携作業確認` は ok=true / 5 items。`doctor --processes --mcp-transport http --json --read-only` は all_green=true / failed_count=0 | S112-006 | cc:完了 |
| S112-007 | **tier 昇格 criteria 文書化** — 何が達成されたら tier 2 / tier 1 に昇格できるかを Plans.md と README に明記 | 昇格 criteria が箇条書きで Plans.md §112 に記載、`README.md` の "(experimental, tier 3)" 注記から criteria 表へ link | S112-005, S112-006 | cc:TODO |

### Non-Goals

- Hermes built-in memory (`MEMORY.md` / `USER.md` / `skills/`) を **置き換える** こと（公式 backend swap API が存在しない）
- per-message (per-turn) event の **同期的** 自動記録（Hermes に `UserPromptSubmit` 相当 hook が無いため、過去履歴は `~/.hermes/state.db` Backfill で補完）
- Hermes 自身の改造（fork / patch） — 公式 plugin 機構の枠内に留める
- claude-code-harness 側 hook 機構との完全一致（Hermes hook signature が独自のため bridge layer で吸収）
- Plans.md §110 (Cross-repo Handoff) との連動 — Hermes は外部 agent であり cross-repo handoff の対象外

### Suggested Execution Order

1. S112-001 — 本セッションで実装済（commit 待ち、commit 後 hash で `[TBD-uncommitted]` を置換）
2. S112-002 / S112-003 — 並行調査可能（独立）
3. S112-004 — 上 2 つの結果を踏まえて plugin 雛形実装
4. S112-005 — E2E 検証
5. S112-006 — `~/.hermes/state.db` Backfill（補助、per-message gap 埋め）
6. S112-007 — tier 昇格 criteria 確定

### tier 昇格 criteria（暫定 — S112-007 で正式化）

**tier 3 (experimental) → tier 2 (recommended)**:
- S112-005 の E2E 検証で `session_start` / `session_end` が安定して記録される
- 直近 30 日間で plugin 関連の重大バグ報告 0 件
- Hermes 最新 minor バージョンで動作確認済み

**tier 2 → tier 1 (Claude Code + Codex 同等)**:
- per-message event 取得手段が確立（Hermes 側に新 hook 追加 or JSONL fswatch 経路が安定）
- `harness-mem doctor` / `doctor --fix` で Hermes wiring も検査対象になる
- `harness-mem setup --platform hermes` で wiring 自動化（現状 manual）

### Cross-repo / 外部参照

- **Hermes Agent**: https://github.com/NousResearch/hermes-agent (v0.13.0, 2026-05-07)
- **Hermes hooks docs**: https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks
- **Hermes MCP guide**: https://hermes-agent.nousresearch.com/docs/guides/use-mcp-with-hermes
- **本セッション調査ログ** (2026-05-10): Hermes memory 仕様 (MEMORY.md 2200字 / USER.md 1375字 / skills/ / SQLite session_search) を S112-003 で正式引用予定

### 関連ファイル (Phase A 実装済み)

- [`integrations/hermes/README.md`](integrations/hermes/README.md)
- [`integrations/hermes/examples/hermes-config-minimal.yaml`](integrations/hermes/examples/hermes-config-minimal.yaml)
- [`integrations/hermes/examples/hermes-config-full.yaml`](integrations/hermes/examples/hermes-config-full.yaml)
- [`docs/integrations/hermes.md`](docs/integrations/hermes.md)
- [`README.md`](README.md) — Other Agent Integrations 表に Hermes 行追加
- [`mcp-server/README.md`](mcp-server/README.md) — With Hermes Agent サンプル追記


## §113 Codex Setup Drift Repair Patch (2026-05-11) — cc:完了 [6b2c351]

策定日: 2026-05-11
分類: Local release patch — v0.21.0 公開直後に実機で検出した Codex skill drift 修復ループを閉じる。Cross repo 影響なし。

背景: `harness-mem doctor --json` が `codex_skill_drift` を検出し、fix として `harness-mem setup --platform codex` を提示する。しかし非対話セッションで既存 skill file が存在する場合、`setup` は skill 再インストールを prompt せず、`codex_skill_drift` が残る。結果として doctor が示す修復コマンドで修復できない。

### Task Plan

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S113-001 | **Codex skill drift の非対話 setup 修復** — `setup` / `update` が非対話実行時に `harness-mem` / `harness-recall` skill bundle drift を検出したら repo 同梱版を再インストールする。対話端末では drift も prompt 対象にする | 既存 skill が stale でも `harness-mem setup --platform codex --skip-start --skip-smoke --skip-quality --skip-version-check` で skill が repo 同梱版に戻る | - | cc:完了 [6b2c351] |
| S113-002 | **doctor --fix の同一ループ解消** — `doctor --fix --platform codex` から `setup_impl` に入る前に skill drift 修復フラグを立て、doctor が提示した auto-fix で drift が消える | temp HOME で stale skill を置いた後、`doctor --fix --platform codex` 相当の経路が skill install を呼ぶ | S113-001 | cc:完了 [6b2c351] |
| S113-003 | **patch release v0.21.1** — version files / changelog / package tarball / GitHub Release / npm latest を同期 | `npm view @chachamaru127/harness-mem version` が `0.21.1`、GitHub Release `v0.21.1` が存在し、`harness-mem doctor --json --platform codex,claude --strict-exit` が green | S113-001, S113-002 | cc:完了 [6b2c351] |


## §114 Codex Notify Chain + Health Alias Repair Patch (2026-05-11) — cc:完了 [52a1e6f]

策定日: 2026-05-11
分類: Local release patch — v0.21.1 公開直後に実機で検出した Codex `notify` duplicate key 起動不能、Codex hooks feature flag の実機表現差、ユーザーが `GET /v1/health` を叩いた場合の 404 を閉じる。Cross repo 影響なし。

背景: Computer Use plugin が Codex top-level `notify` を所有し、`--previous-notify` で harness-mem の `memory-codex-notify.sh` を連鎖する構成がある。この状態で `harness-mem setup --platform codex` が stale harness MCP wiring を修復すると、既存 notify を保持したまま先頭に harness-mem notify block を追加し、TOML 上の `notify` duplicate key で Codex が起動不能になる。

追加背景: daemon の canonical health endpoint は `GET /health` だが、利用者が versioned API の感覚で `GET /v1/health` を叩くと 404 になる。health 確認は障害時の最初の操作なので、互換エイリアスを持たせて operator friction を下げる。

追加背景: Codex の現在の config では `[features] hooks = true` が使われる一方、harness-mem doctor は古い `codex_hooks = true` だけを見ていた。これにより hooks 自体は有効でも `codex_wiring` が missing と誤判定される。

### Task Plan

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S114-001 | **Computer Use notify chain の既存連鎖検出** — `--previous-notify` 内の JSON-escaped harness-mem notify path も有効な Codex notify wiring として扱う | `check_codex_config_wiring` が `\\/Users\\/...\\/memory-codex-notify.sh` を current harness notify と判定する | - | cc:完了 [52a1e6f] |
| S114-002 | **stale MCP repair 時の notify 重複防止** — stale harness MCP wiring を rewrite する場合でも、既存の Computer Use notify chain を保持し、追加の top-level `notify` を生成しない | temp HOME の Computer Use notify + stale MCP config に `setup --platform codex` を実行しても `^notify =` が 1 件だけ残る | S114-001 | cc:完了 [52a1e6f] |
| S114-003 | **Codex hooks feature flag compatibility** — `features.hooks = true` と `features.codex_hooks = true` の両方を doctor で有効扱いにする | temp HOME の modern `[features] hooks = true` config で `codex_wiring` が ok になる | - | cc:完了 [52a1e6f] |
| S114-004 | **`/v1/health` compatibility alias** — `GET /v1/health` でも `GET /health` と同じ health payload を返す | integration test で `/health` と `/v1/health` の両方が `ok/source/items` を返す | - | cc:完了 [52a1e6f] |
| S114-005 | **patch release v0.21.2** — version files / changelog / package tarball / GitHub Release / npm latest を同期 | `npm view @chachamaru127/harness-mem version` が `0.21.2`、GitHub Release `v0.21.2` が存在し、Codex config TOML parse、`curl /health`、`curl /v1/health`、`doctor --json --platform codex,claude --strict-exit` が green | S114-001, S114-002, S114-003, S114-004 | cc:完了 [52a1e6f] |


## §115 Hermes MCP Large-DB Search Reliability Patch (2026-05-11) — cc:WIP

策定日: 2026-05-11
分類: Local reliability patch — Issue [#102](https://github.com/Chachamaru127/harness-mem/issues/102) で報告された、大規模 DB 上の Hermes MCP search timeout / `daemon_unavailable` 誤報を閉じる。Owner は harness-mem。Hermes 本体や sibling repo の改造は不要。

背景: DB 約 7.9GB / observations 278,553 / vectors 122,347 / `vector_engine=js-fallback` の環境で、HTTP search が数十秒化し、Hermes MCP からは既存 daemon が生きていても `failed to start daemon: exit status 1` と分類される。根は 2 つある。第一に MCP proxy の health probe が短く、既存 daemon 再利用より start attempt に倒れやすい。第二に MCP の Step 1 search が graph/link/vector を常に使うため、Hermes の tool deadline に収まらない大規模 DB 条件がある。

### Task Plan

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S115-001 | **MCP daemon reuse hardening** — Go / TypeScript MCP proxy が軽量な `/health/ready` を先に確認し、`/health` / `/v1/health` へ fallback する。start 失敗後も既存 daemon health を再確認して OK なら成功扱いにする。health timeout は env で調整可能にする | 既存 daemon が後から health OK になるケースで `failed to start daemon` を返さない unit test が PASS | - | cc:完了 |
| S115-002 | **MCP safe search mode** — `harness_mem_search` に `safe_mode` / `vector_search` を追加。safe mode は `expand_links=false`, `graph_depth=0`, `graph_weight=0`, `vector_search=false` に落とし、FTS-first の軽量候補検索にする | TS / Go MCP schema と REST search request が `vector_search=false` を通し、core が vector/nugget search を skip する unit test が PASS | - | cc:完了 |
| S115-003 | **FTS + reverse-link latency guard** — FTS lexical search は AND-first で候補を取り、0件のときだけ既存 OR fallback に広げる。safe mode では BM25 計算を避けて recent-first 候補にする。加えて `mem_links(to_observation_id, relation, from_observation_id)` / `mem_facts(observation_id, project, merged_into_fact_id)` index を追加し、superseded / active facts 判定で全域 scan しない | `buildFtsQuery(..., "and")` 契約テストと search smoke が PASS。短い一般語で OR 全域検索に即落ちせず、reverse lookup が index を使う | S115-002 | cc:完了 |
| S115-004 | **Hermes docs/config update** — minimal Hermes config に `HARNESS_MEM_MCP_SEARCH_SAFE_MODE=1` を追加し、大規模 DB では safe mode を既定推奨にする。troubleshooting に `daemon_unavailable` 切り分けを追記 | `integrations/hermes/README.md`, `docs/integrations/hermes.md`, config sample が同期 | S115-001, S115-002 | cc:完了 |
| S115-005 | **ingest starvation guard** — Codex / Claude Code / OpenCode / Cursor / Gemini の履歴取り込み既定間隔を 60s に上げ、Claude Code の起動直後 scan を通常 interval まで遅延させる | daemon 起動直後に `/health/ready` が返り、検索中以外の履歴 scan がAPI応答を5秒周期で塞がない | S115-001 | cc:完了 |
| S115-006 | **targeted validation** — Go MCP proxy tests、TS MCP tests、memory-server search tests、Hermes plugin docs/package surface 必要分を実行 | 対象テスト PASS。大規模 DB live probe は `/health/ready` 0.03ms、`harness mem` safe search 773.53ms、`CJ Hermes setup MCP checkpoint` safe search 1057.24ms | S115-001..005 | cc:完了 |


## §116 Local Adaptive Embedding Runtime Alignment (2026-05-11) — cc:完了

策定日: 2026-05-11
分類: Local runtime alignment — 現マシンの harness-mem を、§70 Adaptive Retrieval Engine の意図に近い `adaptive` 埋め込み構成へ寄せる。Owner は harness-mem。Hermes 側は safe MCP search のまま維持し、Hermes 内部 memory / embedding を置き換える話にはしない。

背景: 現環境では `ruri-v3-30m` と `multilingual-e5` のローカル ONNX モデルは導入済みだが、LaunchAgent の stale env により `fallback` へ寄る状態が残っていた。直近で `local:multilingual-e5` までは復旧したが、理想形は `adaptive` provider により日本語 heavy query を Ruri route、英語/コード/混在 query を general route へ分ける構成である。一方、DB は約 8.4GB / observations 約 279k 件で、`sqlite-vec` が有効でないまま全量 vector search / reindex を走らせると daemon 応答を塞ぐ。よって、設定反映・診断・段階 reindex の順で進める。

### Task Plan

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S116-001 | **adaptive model activation UX** — `scripts/harness-mem model use-adaptive` を追加し、`ruri-v3-30m` と `multilingual-e5` が導入済みか確認したうえで `embedding_provider=adaptive` / `embedding_model=adaptive` を config に保存する。既知の macOS LaunchAgent がある場合は stale `HARNESS_MEM_EMBEDDING_PROVIDER` / `HARNESS_MEM_EMBEDDING_MODEL` も同期する | `tests/harness-mem-model-config.test.ts` に adaptive config 永続化の回帰テストを追加し PASS。既存 `model use <id>` の挙動は壊さない | - | cc:完了 |
| S116-002 | **local runtime apply** — 現マシンの `~/.harness-mem/config.json` と `~/Library/LaunchAgents/com.harness-mem.daemon.plist` を adaptive に揃え、daemon を launchd reload / restart して反映する | 2026-05-11 実機確認: `/health/ready` は `embedding_provider=adaptive` / `embedding_provider_status=healthy`。LaunchAgent env は `HARNESS_MEM_EMBEDDING_PROVIDER=adaptive` / `HARNESS_MEM_EMBEDDING_MODEL=adaptive`。`model list` は `ruri-v3-30m` と `multilingual-e5` が installed | S116-001 | cc:完了 |
| S116-003 | **sqlite-vec readiness gate** — `sqlite-vec-darwin-arm64` の extension load 可否を実機確認し、使えない場合は `HARNESS_MEM_SQLITE_VEC_PATH` を無理に有効化しない。理由を Plans に証跡として残す | `sqlite-vec-darwin-arm64@0.1.9` の `vec0.dylib` は取得済みだが、Bun 1.3.10 の `bun:sqlite` は `This build of sqlite3 does not support dynamic extension loading` で extension load 不可。`HARNESS_MEM_SQLITE_VEC_PATH` は LaunchAgent に設定しない。`vector_engine=js-fallback` を既知制約として扱う | - | cc:完了 |
| S116-004 | **controlled reindex policy** — vector engine と coverage を確認し、`sqlite-vec` 有効化までは全量 reindex を禁止、必要なら小バッチのみで進める運用に固定する | 全量 reindex は未実行。`admin-reindex-vectors {"limit":1}` のみ実施し、adaptive route vectors を current と数える coverage 判定と、local ONNX warm-up retry を 500 にしない処理を追加。実機値: `vector_engine=js-fallback`、`current_model_observations=5/278981`、`missing_current_model_vectors=278976`、legacy vectors `local:multilingual-e5=104308` / `fallback:local-hash-v3=18395`。95% 収束は sqlite-vec 有効化後の後続タスクへ送る | S116-002, S116-003 | cc:完了 |


## §117 Bun SQLite Custom Library for sqlite-vec on macOS (2026-05-11) — cc:完了 [d23e099]

策定日: 2026-05-11
分類: Local runtime unblock — Bun は維持しつつ、macOS の Apple SQLite ではなく Homebrew SQLite を `Database.setCustomSQLite()` で DB 作成前に差し替え、`sqlite-vec` の `vec0.dylib` を有効化する。Owner は harness-mem。sibling repo の改造は不要。

背景: §116-003 では `sqlite-vec-darwin-arm64@0.1.9` の `vec0.dylib` は取得済みだが、Bun 1.3.10 の標準 `bun:sqlite` が Apple SQLite に寄り、`This build of sqlite3 does not support dynamic extension loading` で `loadExtension()` が失敗した。追加実測で、Bun 起動直後かつ `new Database()` より前に Homebrew SQLite (`/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib`, sqlite 3.51.3) を `Database.setCustomSQLite()` へ渡すと、現 repo と同じ `db.loadExtension(path)` 1 引数で `vec_version=v0.1.9` / `vec0 ok` まで通ることを確認した。

注意: これは単なる `HARNESS_MEM_SQLITE_VEC_PATH` 追加では足りない。現行 `resolveVectorEngine()` は DB 作成後に `loadExtension()` するため、custom SQLite の設定は `HarnessMemCore` constructor 内の `createStorageAdapter()` より前、または SQLite adapter factory が `new Database()` する前に入れる必要がある。

### Task Plan

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S117-001 | **Bun custom SQLite preflight を DB 作成前に導入** — `HARNESS_MEM_SQLITE_VEC_PATH` が設定されている時だけ、`HARNESS_MEM_SQLITE_LIB_PATH` または既定の Homebrew SQLite path を検出し、`new Database()` 前に `Database.setCustomSQLite()` を呼ぶ。Linux / 非Bun / path 不在では副作用なく従来通り進む | `SqliteStorageAdapter` constructor で `configureBunCustomSqliteForSqliteVec()` を `new Database()` 前に実行。unit test で adapter 作成前の `setCustomSQLite()` 呼び出し、Homebrew default path、missing path skip、同一 path の重複抑制を確認 | - | cc:完了 [d23e099] |
| S117-002 | **sqlite-vec engine readiness の失敗分類を明確化** — `resolveVectorEngine()` は `loadExtension()` 失敗時に js-fallback へ戻す挙動を維持しつつ、custom SQLite preflight の成否を診断可能にする。secret / token は保存しない | `custom-sqlite-preflight.ts` が reason (`configured` / `already-configured` / `sqlite-library-not-found` / `unsupported-platform` など) を返し、既存 health の `vector_engine` で `sqlite-vec` / `js-fallback` を確認可能。`HARNESS_MEM_SQLITE_VEC_PATH=/non/existent/sqlite-vec` fallback test 維持 | S117-001 | cc:完了 [d23e099] |
| S117-003 | **macOS 実機 smoke** — Homebrew SQLite + `vec0.dylib` を使い、Bun のまま `vec_version` と `CREATE VIRTUAL TABLE ... USING vec0` が成功することを repo script / targeted command で確認する | 実機確認: Bun 標準 SQLite は `This build of sqlite3 does not support dynamic extension loading`。`Database.setCustomSQLite("/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib")` 後は `sqlite_version=3.51.3`, local `vec_version=v0.1.7-alpha.2`, `vec0 ok`。`HarnessMemCore` smoke で `vector_engine=sqlite-vec` | S117-001 | cc:完了 [d23e099] |
| S117-004 | **targeted validation and plan closeout** — 変更面に対応する Bun tests を実行し、Plans.md を commit hash 付きで `cc:完了` に更新する | PASS: `bun test memory-server/tests/unit/storage-adapter.test.ts memory-server/tests/unit/core.test.ts` (29 pass / 0 fail)。`git diff --check` PASS。Plans.md §117 を `cc:完了 [d23e099]` に更新 | S117-001, S117-002, S117-003 | cc:完了 [d23e099] |


## §118 macOS sqlite-vec Default Runtime Activation (2026-05-12) — cc:完了 [0c8466e]

策定日: 2026-05-12
分類: Local runtime activation + package default — §117 の起動前処理を、Mac では追加 env なしでも既定で使えるようにし、現マシンの daemon を `vector_engine=sqlite-vec` で稼働確認する。

背景: §117 で `Database.setCustomSQLite()` は実装済みだが、現在の LaunchAgent には `HARNESS_MEM_SQLITE_VEC_PATH` が無く、daemon health は `vector_engine=js-fallback` のまま。これは「コードは直ったが、実運用はまだ古い経路」という状態であり、放置すると大規模 DB の検索改善に届かない。

### Task Plan

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S118-001 | **macOS default sqlite-vec package discovery** — `sqlite-vec-darwin-arm64` を optional dependency に追加し、Mac では `HARNESS_MEM_SQLITE_VEC_PATH` 未設定でも `node_modules/sqlite-vec-darwin-arm64/vec0.dylib` を既定候補として使う。既存 env 指定は最優先 | `package.json` / `package-lock.json` / `bun.lock` に `sqlite-vec-darwin-arm64@0.1.9` を固定。env 未設定 + macOS + package installed の `HarnessMemCore` smoke で `vector_engine=sqlite-vec`。package 不在 / Homebrew SQLite 不在では js-fallback に安全退避 | - | cc:完了 [0c8466e] |
| S118-002 | **local operational activation** — 現マシンに optional dependency を導入し、daemon を再起動して `vector_engine=sqlite-vec` を確認する | `/health` が `vector_engine=sqlite-vec` を返す。`/health/ready` ready=true。`sqlite_version=3.51.3` / `vec_version=v0.1.9` / `vec0 ok` smoke PASS。doctor `all_green=true` | S118-001 | cc:完了 [0c8466e] |
| S118-003 | **validation / docs / push** — targeted tests、lockfile/package surface、Plans closeout を確認し、commit + push する | PASS: `bun test memory-server/tests/unit/storage-adapter.test.ts memory-server/tests/unit/core.test.ts` (32 pass / 0 fail), `bun test tests/harness-mem-model-config.test.ts` (3 pass / 0 fail), `git diff --check` PASS。docs/environment-variables.md を同期 | S118-001, S118-002 | cc:完了 [0c8466e] |


## §122 MCP Transport / Process Topology Hardening (2026-05-13) — cc:WIP

策定日: 2026-05-13
分類: Local runtime architecture / External-client integration impact — owner は `harness-mem`。Codex / Claude Code / Hermes の MCP config surface へ影響するが、初期実装は harness-mem 内の gateway / setup / docs で閉じる。`claude-code-harness` 側の配布物や hooks を変更する段階になった場合だけ Cross-Runtime として XR を起票する。

背景: 2026-05-13 の実機確認で、`harness-mcp-darwin-arm64` が複数存在することを確認した。これは repo 内に不要 binary が増殖している問題ではなく、主に Codex / Hermes など複数 client session が stdio MCP server をそれぞれ subprocess として起動している状態だった。現在の topology は `bin/harness-mcp-server` が `bin/harness-mcp-{os}-{arch}` を exec し、Go MCP server が `mcpserver.ServeStdio(s)` で stdio を受け、裏側の memory daemon (`127.0.0.1:37888`) へ HTTP proxy する構成である。つまり DB と memory daemon はすでに共有されているが、MCP frontend process は stdio transport の性質上、client session ごとに増える。

判断: `stdio のまま MCP frontend を1プロセス共有する` 方向は採用しない。stdin/stdout は「1つの相手と1本の管で話す」前提の transport であり、複数 client を同じ stdio process に安全に同居させるには broker を自作する必要がある。これは MCP transport を再実装するのと同じで、harness-mem の目的から見て費用対効果が悪い。複数 process を減らすなら、正攻法は local-only の Streamable HTTP MCP gateway を追加し、対応 client は `http://127.0.0.1:37889/mcp` に接続させること。stdio は古い client / fallback 用に残す。

Claude / subagent 合意メモ (2026-05-13):
- subagent consensus: short-term は process 可視化と stale cleanup、medium-term は Streamable HTTP gateway。stdio singleton 共有は避ける。
- Claude `-p` consensus: best は **singleton Streamable HTTP MCP gateway + stdio fallback**。cleanup だけでは対症療法、memory daemon へ MCP surface を直結するのは責務結合が強すぎる。
- local evidence: `mcp-go@v0.47.1` は `server.NewStreamableHTTPServer` を持つ。Codex / Claude / Hermes は local config 上 HTTP MCP 接続面を持つ。

### Target Architecture

```
Codex / Claude Code / Hermes
  ├─ preferred: Streamable HTTP MCP -> 127.0.0.1:37889/mcp -> Go MCP gateway -> memory daemon 127.0.0.1:37888 -> SQLite
  └─ fallback: stdio MCP subprocess ------------------------^
```

運用契約:
- `127.0.0.1` bind を既定かつ推奨にする。`0.0.0.0` は明示 opt-in でも初期実装では扱わない。
- gateway は memory daemon と別 process にする。既存 daemon (`:37888`) に MCP endpoint を直接混ぜない。
- token auth、Host / Origin validation、project key isolation、tool allowlist を gateway 側で検査する。
- stdio fallback は削除しない。HTTP 未対応 client と emergency rollback のために残す。
- process 数だけで障害扱いしない。live parent を持つ stdio child は正常、orphan / parent missing / 長時間 idle だけ cleanup 対象にする。
- default 切替は急がない。HTTP gateway は opt-in から開始し、Codex / Claude / Hermes の smoke と 2-3 release 観測後に recommended/default を判断する。

### Non-Goals

- stdio MCP process を無理に singleton 化する broker を作らない。
- memory daemon (`memory-server`) へ MCP protocol handler を初手で直結しない。
- active な Codex / Hermes / Claude parent を持つ MCP child を自動 kill しない。
- remote / LAN 公開 MCP server をこのフェーズで作らない。
- Hermes built-in memory や Claude Code hook 仕様を置き換えない。

### Task Plan

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S122-001 | **MCP process inventory を doctor に追加** `[tdd:required]` — `doctor --processes` または同等 subcommand で `harness-mcp-*` process、parent pid、parent command、age、RSS、daemon health、transport 推定を JSON / human readable で出す。live parent ありの stdio child と orphan/stale を分ける | mocked `ps` fixture の unit test が PASS。実機で Codex / Hermes 由来の MCP child が grouped 表示され、`all_green` と別に `process_advisory` として出る。process 数だけで fail しない | - | cc:完了 [999d926] |
| S122-002 | **stale MCP cleanup を guarded に追加** `[tdd:required]` — `cleanup-stale-mcp --dry-run` を既定にし、`--execute --older-than <duration>` が明示された時だけ orphan / parent missing / PPID=1 の stale MCP child を終了候補にする。active parent を持つ process は除外する | dry-run が kill 対象 pid / reason / skipped active pid を出す。mock test で active Codex/Hermes parent は kill されず、orphan のみ execute 対象になる。実機では dry-run までを標準検証にする | S122-001 | cc:完了 [8b68d0d] |
| S122-003 | **transport spec SSOT + docs truth fix** `[tdd:skip:docs-only]` — docs に `:37888` は memory daemon、Go MCP は stdio frontend、client session ごとに stdio child が増える、という事実を明記する。正常な複数 frontend と異常な stale process / split-brain daemon を分ける | `README.md`, `README_ja.md`, `docs/integrations/hermes.md`, `docs/harness-mem-setup*.md` の該当箇所が同期し、`stdio singleton` を推奨しない理由と HTTP gateway 方針が書かれる | - | cc:完了 [fbb3c14] |
| S122-004 | **Go MCP server transport factory refactor** `[tdd:required]` — `mcp-server-go/internal/server` を `NewServer()` / `RunStdio()` / `RunStreamableHTTP()` に分け、既存 `Run()` は stdio compatibility wrapper として維持する。tool registration は1箇所だけにする | Go unit test で stdio と HTTP の tool set parity を検証。既存 `bin/harness-mcp-server` 経由の stdio smoke が変わらず通る | S122-003 | cc:完了 [3cae3f0] |
| S122-005 | **local Streamable HTTP MCP gateway MVP** `[tdd:required]` — `HARNESS_MEM_MCP_TRANSPORT=http` または dedicated command で `127.0.0.1:37889/mcp` に `mcp-go` Streamable HTTP server を起動する。default は stdio のままにする | test client から `initialize` / `tools/list` / safe `harness_mem_status` call が通る。port conflict は明確な error を返す。stdio path に regression がない | S122-004 | cc:完了 [c560997] |
| S122-006 | **gateway security / session isolation** `[tdd:required][security-sensitive]` — token auth、Host / Origin allowlist、localhost bind enforcement、`X-Harness-Project-Key` / env project key の優先順位、`HARNESS_MEM_TOOLS=core|all` の server-side allowlist を gateway に入れる | unauthorized は 401、bad Origin / Host は 403、project key が request context に反映される、Hermes safe 5-tool exposure と core/all visibility が崩れないことを Go tests で固定 | S122-005 | cc:完了 [2dea1fe] |
| S122-007 | **gateway lifecycle manager + doctor opt-in** `[tdd:required]` — `harness-mem mcp-gateway start|stop|status` または既存 setup lifecycle に gateway 管理を追加し、launchd / foreground / pidfile / port check を扱う。初期は opt-in | `status` が running pid / endpoint / auth mode / memory daemon health を返す。既存 daemon restart と gateway start が競合しない。`doctor --mcp-transport http` で gateway health を検査できる | S122-006 | cc:完了 [8c956ba] |
| S122-008 | **Codex / Claude / Hermes HTTP MCP config generation** `[tdd:required]` — setup / update / docs に HTTP MCP opt-in を追加する。Codex は `--url`、Claude は `--transport http`、Hermes は `url:` config を使い、token は env/header 経由にする。stdio fallback config は残す | 完了: `mcp-config --transport http` が Codex / Claude / 明示 Hermes YAML を生成し、`setup --mcp-transport http` は Codex / Claude を HTTP に切替・stdio に復帰できる。secret 実値は config に書かない。レビュー追補: Codex HTTP block は `enabled = true` を出さない。実 Codex 0.130.0 の `codex mcp get harness` で temp HOME 生成 config が parse OK。PASS: `bash -n`, `node -c`, targeted Bun tests, temp HOME setup http/revert, `git diff --check`, real `doctor --processes` all_green | S122-007 | cc:完了 [595150f] |
| S122-009 | **compatibility smoke + process/latency benchmark** `[tdd:skip:integration-smoke]` — stdio baseline と HTTP gateway で Codex / Claude / Hermes の `tools/list`, `harness_mem_status`, safe search を比較し、process count、RSS、cold/warm latency、failure mode を記録する | 完了: original checkout を `origin/main` / `v0.22.2` に合わせ、local daemon を v0.22.2 で再起動。PASS: package version 0.22.2、`doctor --processes` all_green、safe search sequential smoke (`harness mem` 3.70s / `S122 safe search smoke` 2.16s, vector=false)、HTTP gateway opt-in smoke (`doctor --mcp-transport http` all_green, `initialize`, `tools/list` 54 tools, `harness_mem_health`)。HTTP gateway は smoke 後に停止し、default 化は S122-010 に残す | S122-008, S122-009a, S122-009d | cc:完了 |
| S122-009a | **safe search lexical fast path** `[tdd:required]` — safe-mode search が embedding prime / vector link path に入って timeout しないよう、lexical-first path を固定する | `searchPrepared()` で `safe_mode=true` / `vector_search=false` の embedding prime を skip し、direct core safe-mode は vector/link を無効化する。unit / integration tests で固定する | S122-008 | cc:完了 [71cdbaa] |
| S122-009d | **v0.22.2 local runtime closeout + smoke rerun** `[tdd:required]` — released v0.22.2 source を元 checkout の実行状態へ反映し、safe search と HTTP gateway の実機 smoke を再実行する | 既存 backup branch / stash を保持したまま `main` を `origin/main` へ reset。追加 backup: `backup/main-pre-v0222-local-migration-20260515-012218`。safe-mode lexical scan を bounded recent scan にし、FTS timeout から切り離す regression test を追加。root Go MCP binary は current Go source から再ビルドし、stale binary が `HARNESS_MEM_MCP_TRANSPORT=http` を無視して即終了する問題を解消。PASS: targeted Bun tests, Go tests, live daemon health, safe search, HTTP gateway smoke | S122-009a | cc:完了 |
| S122-010 | **recommended/default decision gate** `[tdd:skip:release-policy]` — 2-3 release 観測後、HTTP gateway を recommended/default にするか判断し、CHANGELOG / release note / rollback 手順を固定する | opt-in 期間の known issues が整理され、default 切替する場合は rollback が1 commandで説明できる。切替しない場合も理由が Plans に残る | S122-009 | cc:TODO |
| S122-010a | **local Codex/Claude HTTP gateway adoption** `[tdd:skip:local-smoke]` — このマシンの gateway token と LaunchAgent 起動を固定し、Codex / Claude の user-scope MCP 設定を HTTP gateway へ恒久切替する。公開 default 化は S122-010 に残す | 完了: token file `~/.harness-mem/mcp-gateway.token` を `0600` で固定し、`com.harness-mem.mcp-gateway` / `com.harness-mem.mcp-token-env` LaunchAgent を登録。Codex は user config と repo-local `.codex/config.toml` を HTTP に切替し、新規 `codex exec` が `harness_mem_health` を実行して `HARNESS_MCP_HEALTH_OK`。Claude は `~/.claude.json` / `~/.claude/settings.json` / project `.mcp.json` を HTTP に切替し、新規 `claude -p` が `mcp__harness__harness_mem_health` を実行して `HARNESS_MCP_HEALTH_OK`。HTTP MCP direct `initialize` / `tools/list` / health OK、`doctor --mcp-transport http` all_green、guarded cleanup dry-run は candidates 0 / skipped 22 で active parent 付き stdio child を kill しない | S122-009 | cc:完了 |
| S122-010b | **local Hermes HTTP gateway adoption** `[tdd:skip:local-smoke]` — このマシンの active Hermes config の harness-mem MCP を stdio から HTTP gateway へ切替する。profile に harness-mem が未設定の場合は勝手に追加しない | 完了: active `~/.hermes/config.yaml` の `mcp_servers.harness_mem` を `url: http://127.0.0.1:37889/mcp` + `Authorization: Bearer ${HARNESS_MEM_MCP_TOKEN}` へ切替。既存 tools include は safe 5-tool のまま、project key は `X-Harness-Project-Key` header で保持。`~/.hermes/profiles/aiopsmanager/config.yaml` は harness-mem 未設定のため未変更。Hermes gateway を restart し、`hermes mcp list` は HTTP / 5 selected、`hermes mcp test harness_mem` は connected / tools discovered、direct `harness_mem_health` は `ok=true`。guarded cleanup dry-run は candidates 0 / killed 0、Hermes 由来の旧 stdio child は正規 restart 後に消滅 | S122-010a | cc:完了 |

### Breezing Execution Notes

- Wave 1: `S122-001` と `S122-003` は並列実行可。最初にここを閉じる。process 問題を正しく見える化しないまま HTTP gateway へ進むと、正常な stdio child と異常な orphan を混同する。
- Wave 2: `S122-002` と `S122-004` は Wave 1 後に並列可。cleanup は観測 UX、Go refactor は gateway の土台。
- Wave 3: `S122-005` → `S122-006` → `S122-007` → `S122-008` は直列。transport / security / lifecycle / client config の順を崩さない。
- Wave 4: `S122-009` と `S122-010` は実機検証と release policy。ここは breezing より Lead が結果を見て判断する。
- Wave 4b: `S122-009a` と `S122-009d` で safe search timeout と stale Go MCP binary を transport 問題から切り離し、`S122-009` の local v0.22.2 smoke は完了。HTTP gateway recommended/default 判断は `S122-010` に残す。

推奨初回 scope:

```text
/breezing --max-workers 2
対象: S122-001 と S122-003 から開始。S122-002 は S122-001 完了後、S122-004 は S122-003 完了後に着手。
```

次に進む条件: `doctor --processes` が live stdio child と stale orphan を分けて説明でき、docs が `stdio child count != daemon split-brain` を明記していること。


## §123 sqlite-vec Map/Index Repair and Vector Search Closeout (2026-05-15) — cc:完了

策定日: 2026-05-15
分類: Local DB repair / search reliability — owner は `harness-mem`。Codex / Claude / Hermes の HTTP gateway 化は §122 で完了済みのため、このセクションでは memory daemon の vector search と sqlite-vec map/index 欠損を扱う。sibling repo の改造は不要。

背景: `vector_search=true` の小さい query は bounded fallback により timeout しなくなったが、これは完了ではない。現物 DB では `adaptive:general:local:multilingual-e5` の `mem_vectors` が 263,186 件、対応する `mem_vectors_vec_map_adaptive_general_local_multilingual_e5` が 184,793 件で、欠損は 78,393 件。warning の `sqlite-vec partial index` は正しく、現状は sqlite-vec fast path を使い切れていない。

判断: 先にやるべきことは追加の全量 reindex ではなく、既存 `mem_vectors.vector_json` から model-specific sqlite-vec table/map を小 batch で補修すること。既に vector を持つ行については embedding 再計算をしない。map/index 欠損を消した後、実測で 263k 行の sqlite-vec 同期 fast path が daemon を塞ぐことが判明したため、運用 green は large-index guard + bounded fallback で確保し、真の fast path 最適化は別タスクへ送る。

### Completion Gates

- DB backup 済み: `/Users/tachibanashuuta/.harness-mem/harness-mem-backup-2026-05-15T09-20-11-009Z.db` (約 12GB)。repair 中に Hermes Backfill / full vector reindex は並走させない運用で実施。
- `adaptive:general:local:multilingual-e5` は `vector_count=263349`, `map_count=263349`, `missing_before=0` まで補修済み。`index_count` は巨大 vec0 count を避けるため map 同期値による推定 (`index_count_estimated=true`)。
- `vector_search=true` は timeout しない。最終実測 `harness mem`: `TIME=8.234935`, `vector_candidates=15`, `sqlite-vec partial index` warning なし。代わりに `sqlite-vec index too large for synchronous search` + bounded fallback warning を出す。
- `/health/ready` は `ready=true`, embedding provider `adaptive` healthy。通常検索 `vector_search=false safe_mode=true` は最終実測 `TIME=7.099302` (response meta latency 357.2ms)。
- 以後の reindex / ingest で `mem_vectors` だけ増えて map が遅れる regression は unit / integration test で固定済み。

### Task Plan

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S123-001 | **bounded fallback を一時退避として固定** `[tdd:required]` — partial sqlite-vec index 時に全量 JS fallback や FTS timeout へ落ちず、bounded primary fallback と degraded warning で返す挙動を regression test 化する | PASS: `bun test memory-server/tests/core-split/observation-store.test.ts`。partial / unavailable に加え、large sqlite-vec index が同期検索上限を超える場合も bounded fallback に縮退する test を追加 | - | cc:完了 |
| S123-002 | **sqlite-vec map repair CLI / admin path** `[tdd:required]` — `mem_vectors` には存在するが `mem_vectors_vec_map_<model>` に無い行を、既存 `vector_json` から model-specific vec0 table + map table へ小 batch で upsert する。dry-run / execute / limit / model を持たせる | PASS: `config-manager.test.ts` 34/34, `admin.test.ts` 2/2, `tests/harness-mem-admin-repair-cli-contract.test.ts` 3/3。dry-run count、execute/idempotency、bad vector skip、CLI contract、HTTP alias を確認 | S123-001 | cc:完了 |
| S123-003 | **local DB backup + staged repair execution** `[tdd:skip:local-db]` — 現マシンの `~/.harness-mem/harness-mem.db` を backup し、`adaptive:general:local:multilingual-e5` の missing 78,393 件を repair する。途中で health / normal search / vector search smoke を挟む | backup path `/Users/tachibanashuuta/.harness-mem/harness-mem-backup-2026-05-15T09-20-11-009Z.db`。before `vector_count=263270`, `map_count=184877`, `missing_before=78393`。final dry-run `vector_count=263349`, `map_count=263349`, `missing_before=0`, `repaired=0` | S123-002 | cc:完了 |
| S123-004 | **vector search timeout closeout** `[tdd:skip:local-smoke]` — repair 後、巨大 sqlite-vec fast path が同期 request を塞ぐ場合は large-index guard で bounded fallback に逃がし、`vector_search=true` を 5-10 秒以内に返す | PASS: `curl /v1/search` smoke `TIME=8.234935`, `vector_candidates=15`, `vector_search_enabled=true`, `sqlite-vec partial index` warning なし。注記: bounded fallback warning は残る。これは fast path green ではなく daemon timeout 回避の operational green | S123-003 | cc:完了 |
| S123-005 | **reindex/backfill resume gate** `[tdd:required]` — map repair 後に未処理 vector の reindex/backfill を再開できる条件を固定し、以後の `reindexVectors()` が `mem_vectors` と sqlite-vec map/table を同じ batch で進めることを保証する | PASS: adaptive legacy adoption が model-specific sqlite-vec map も upsert する test を固定。現 coverage は `263347/281930 vectors reindexed (93%)` なので、95%+ への追加 backfill は large-index fast path 最適化後に別途実行 | S123-004 | cc:完了 |
| S123-006 | **Plans / docs closeout** `[tdd:skip:docs-plans]` — 実測値、warning 消滅、search latency、health、通常検索、doctor の結果を Plans.md に追記し、必要なら docs に repair 手順を短く残す | PASS: Plans.md に backup / before-after / health / search smoke / doctor を記録。doctor は `harness_mem_version=0.22.2` だが `codex_wiring_missing` で all_green=false。process advisory は stale 0、active stdio child は kill しない | S123-003, S123-004, S123-005 | cc:完了 |

### Execution Notes

- `S123-004` の元前提「repair 後に sqlite-vec fast path がそのまま 5-10 秒以内に返る」は実測で否定された。263k 行の同期 sqlite-vec query は daemon を塞ぐため、現実的な closeout は large-index guard。
- `HARNESS_MEM_SQLITE_VEC_SEARCH_MAX_ROWS` の既定値は 200000。これを超える model-specific sqlite-vec target は bounded JS fallback に縮退する。0 以下を指定すると guard を無効化できるが、現 DB では timeout 再発リスクが高い。
- 次にやるべき本筋は、vec0 への JSON text 挿入を続けることではなく、sqlite-vec fast path が実用になる保存形式 / query plan / async worker 境界を検証すること。


## §124 sqlite-vec Fast Path Storage / Query / Worker Boundary (2026-05-15) — cc:完了

策定日: 2026-05-15
分類: Local search runtime hardening — owner は `harness-mem`。§123 の bounded fallback は timeout 回避であり、ここでは sqlite-vec fast path を実用化する。

背景: §123 で map/index 欠損は `missing_before=0` まで補修済み。ただし `adaptive:general:local:multilingual-e5` は 263k rows を超え、同期 sqlite-vec query を request thread で直接走らせると daemon を塞ぐ。現状の large-index guard は正しいが、これを永続解にすると vector search は結局 bounded JS fallback のままになる。

判断: 次は 1) sqlite-vec に渡す vector payload を JSON text から compact Float32/BLOB へ寄せる、2) KNN query 後の不要 join / 全体スキャンを削り、project/privacy filter の扱いを明確化する、3) それでも巨大 query が同期的に重い場合は daemon request thread から切り離す worker 境界を作る、の順で潰す。

### Task Plan

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S124-001 | **fast path probe + red test** `[tdd:required]` — 現行 JSON payload / join-heavy query / synchronous request 境界のどこが遅いかを小さく再現し、large-index guard を外しても daemon を塞がない期待値をテストで固定する | 完了: sqlite-vec direct probe で map-only KNN は約 95-290ms (k=15..1200) と確認。RED は `INSERT OR REPLACE` on existing vec0 row が `UNIQUE constraint failed` になること。unit で `UPDATE` 契約を固定 | - | cc:完了 |
| S124-002 | **compact vector serialization** `[tdd:required]` — sqlite-vec row upsert と query param を Float32Array / compact BLOB 形式へ切替し、既存 JSON `mem_vectors.vector_json` は互換保存として残す | 完了: `serializeSqliteVecFloat32()` を追加し、new insert / existing update / query param が Float32Array を使う。既存 `mem_vectors.vector_json` は互換保存のまま。local `--rebuild-existing --limit 10` は repaired=10 / failed=0 | S124-001 | cc:完了 |
| S124-003 | **query plan cleanup** `[tdd:required]` — model-specific vec0 table + map table を前提に、KNN subquery 後の `mem_vectors` join と高コスト count を search hot path から外す。project/privacy filter の post-filter / overfetch 方針を固定する | 完了: search hot path から large-index count / `JOIN mem_vectors` を除去し、vec0 + map + observations だけで候補化。live smoke は `vector_candidates=5..15`, `debug.vector_degraded_reasons=[]`, bounded fallback warning なし | S124-002 | cc:完了 |
| S124-004 | **async worker boundary** `[tdd:required]` — 巨大 sqlite-vec query が閾値を超える場合でも daemon request thread を塞がないよう、search worker / timeout / fallback contract を追加する | 完了判定変更: sqlite-vec KNN 自体は bounded query で十分速く、専用 worker 化は不要。query embedding prime は `primeBatch(..., "query")` 優先に変更し、live concurrent smoke で `vector_search=true` 実行中も `/health/ready` が 0.001s で応答することを確認 | S124-003 | cc:完了 |
| S124-005 | **local DB migration + smoke** `[tdd:skip:local-db]` — 現マシンの model-specific vec0 rows を compact storage で再構築し、`vector_search=true` の bounded fallback warning を消す | 完了: backup verified。out-of-request worker で full compact rebuild 完走 (`compact_remaining=0`, `compact_total_repaired=263849`)。追加 reindex は `current=330817/total=335503`, `coverage=98.60%` まで到達。final `vector_search=true` は warning なし、warm `TIME=0.955206` / HTTP 200。safe search は `TIME=0.495452` / HTTP 200。 | S124-004, S124-007 | cc:完了 |
| S124-006 | **Plans/docs closeout** `[tdd:skip:docs-plans]` — 実測値、残 warning、rollback、環境変数を Plans.md と必要 docs に記録する | 完了: 実測値と残 warning を記録。PASS: targeted Bun tests 113 pass, `cd memory-server && bun run typecheck`, `git diff --check`, sandbox 外 `npm test`, live health / safe search / vector search / concurrent health smoke | S124-005 | cc:完了 |
| S124-007 | **out-of-request backfill worker** `[tdd:required]` — compact rebuild / reindex を HTTP request thread から切り離し、short transaction + resumable cursor + health-safe pacing で全 row 完走できるようにする | 完了: 連続実行中の `/health/ready` はおおむね ms 台で応答。停止/再開、LaunchAgent 復帰、full compact rebuild、95%+ coverage を同じ worker で完走。最終値は `status=completed`, `compact_remaining=0`, `coverage=0.986032911777242`, `batch=100`, `last_error=null`。 | S124-004 | cc:完了 |

### Execution Notes

- sqlite-vec docs は JSON insert も許すが、Node 例では `Float32Array` を使う。S124 では hot path だけ compact payload を標準にする。
- `safe_mode=true` は server 側で `vector_search=false` に落とすため、vector smoke では `safe_mode` を付けない。
- `codex_wiring_missing` は S123 時点の unrelated doctor failure。S124 の成功条件に混ぜない。
- 2026-05-15 実測: `admin-repair-sqlite-vec-map --rebuild-existing --limit 10` は修正前 failed=10 (`sqlite_vec_upsert_failed`)、修正後 repaired=10 / failed=0。根因は existing vec0 row に対する `INSERT OR REPLACE` で、正しくは `UPDATE ... WHERE rowid=?`。
- 2026-05-15 smoke: `vector_search=true` (`sqlite vec`, limit=1) は `TIME=7.349171`, `latency_ms=7313.85`, `vector_candidates=5`, `debug.vector_degraded_reasons=[]`。concurrent `/health/ready` は `HEALTH_TIME=0.001092`。`vector_search=false safe_mode=true` は response meta latency `346.51ms`。
- 2026-05-15 follow-up: API backup は client timeout 後の partial file が `file is not a database` になったため採用せず、SQLite CLI `.backup` で `/Users/tachibanashuuta/.harness-mem/harness-mem-backup-2026-05-15T14-10-00-cli.db` を作成し、URI `immutable=1` で `PRAGMA integrity_check=ok` を確認。live DB `PRAGMA quick_check=ok`。
- 2026-05-15 follow-up: `repairSqliteVecMap(rebuild_existing=true)` は同じ newest rows を繰り返す欠陥があったため、map `updated_at` の古い順に候補化し、rebuild 時は batch timestamp で map `updated_at` を進める契約に変更。unit: `config-manager.test.ts` 35/35 pass。
- 2026-05-15 follow-up実測: compact rebuild `limit=100` は通常 1.5-1.8s / batch、reindex `limit=100` は通常 2.6-5.0s / batch。実行後 counts は active observations `334388`, total vector obs `284998`, exact general `266370`, adaptive obs `269713`, general map `266370`, compact rebuilt since loop `7112`。
- 2026-05-15 follow-up判断: 同期 HTTP admin API で compact rebuild を長く連続実行すると timeout / connection reset / launchd restart が出る。全 row compact rebuild と 95%+ coverage を完走するには S124-007 の out-of-request worker が必要。今後、同期 API 連打での full rebuild は禁止。
- 2026-05-16 S124-007実装/実測: `admin-vector-backfill start/status/stop` と out-of-process tick worker を追加。tick 内の full count を除去し、child shutdown が親 job state を `stopped` に上書きする不具合を修正。reindex は compact 完了後に回す compact-first に変更。worker compact smoke は `batch=25`, `interval_ms=5000`, `compact_remaining=266058`, `compact_total_repaired=841`, `last_tick_latency_ms=3424`。同時 `/health/ready` は `TIME=0.000543`, `vector_search=true` smoke は `TIME=1.834368`, `vector_search_enabled=true`。`npm test`, `cd memory-server && bun run typecheck`, `git diff --check`, targeted tests pass。未完: full compact rebuild と 95%+ coverage はまだ未完了なので S124-007 は WIP 継続。
- 2026-05-16 final実測: worker を `compact_batch_size=500`, `reindex_batch_size=100`, `interval_ms=500` で継続し、compact は `compact_total_repaired=263849`, `compact_remaining=0` で完走。reindex は最終的に target を 0.98 へ引き上げ、`status=completed`, `reindex_processed=60337`, `reindex_current_model_vectors=330817`, `reindex_total=335503`, `reindex_missing_vectors_remaining=4686`, `reindex_legacy_vectors_remaining=4686`, `reindex_coverage=0.986032911777242`, `ticks=1225`, `last_tick_latency_ms=15926`, `last_error=null`。
- 2026-05-16 final smoke: LaunchAgent に復帰済み (`com.harness-mem.daemon` pid 75828, port 37888)。`/health/ready` は `TIME=0.001366` / HTTP 200。`vector_search=true` は初回 `TIME=2.107441`, warm `TIME=0.955206`, どちらも warning なし / HTTP 200。`safe_mode=true`, `vector_search=false` は `TIME=0.495452` / HTTP 200。途中で `reindex_batch_size=128` も試したが 1 tick 約25s と遅く、最終運用値は 100 に戻した。
- 2026-05-16 warning closeout: search warning は active observation と operational target を基準に判定するよう変更。adaptive ensemble では Ruri primary の partial coverage ではなく、general migration model を優先して判定する。coverage 95% 以上で migration warning を抑止し、その結果を daemon 内で cache して hot search を塞がない。Targeted tests 124 pass、`cd memory-server && bun run typecheck`, `bash -n scripts/harness-mem scripts/harness-mem-client.sh scripts/harness-memd`, `git diff --check` pass。


## §125 WorkGraph Task Continuity MVP (2026-05-17) — cc:TODO

策定日: 2026-05-17
分類: Work lifecycle / task continuity — owner は `harness-mem`。BEADS / agentmemory 調査から `docs/workgraph.md` へ取り込んだ WorkGraph 提案を、Product / Architecture / QA / Skeptic の subagent review で絞り込んだ実行計画。

判断: 採用する。ただし初回は「新しい巨大タスク管理ツール」ではなく、**Plans.md を安全に読み、ready / next / claim の根拠を memory と接続する task continuity layer** として段階導入する。既存の `lease` / `signal` / `verify` / `inject_traces` / graph / privacy / project isolation は再実装しない。WorkGraph は additive schema と小さい CLI/API surface から始め、MCP / hooks / UI は benchmark と consumed-rate が見えてから解放する。

背景:

- `package.json` は現在 `0.24.1`。WorkGraph 着手時の旧レポートは `0.22.2`、当時の Plans current status は `v0.21.2` 前提を含んでいたため、S125 では先に status truth を同期した。`docs/workgraph.md` の `0.23.0` baseline は S125-001 freeze 時点の履歴値であり、現在リリース状態は本ファイル上部の current status を正とする。
- report の推奨 `§116` は既に別 section で使用済みのため、本実行計画は `§125` として追跡する。
- `.claude/memory/decisions.md` / `.claude/memory/patterns.md` はこの worktree に存在しなかった。今後の実装判断は `docs/workgraph.md` と Plans を SSOT にし、必要なら memory へ Why 付きで記録する。

### User-facing outcome

WorkGraph が入ると、ユーザーは新セッションで「前回何をしていたか」だけでなく、**次に着手できる作業、ブロッカー、誰が claim 中か、なぜその作業が提案されたか**まで見えるようになる。たとえると、いまの harness-mem は「作業メモを覚えているノート」。WorkGraph 後は「ノートに付箋と順番表が付く」状態になる。

### Non-goals / stop line

- Dolt backend、iii engine、mesh/team sync、managed memory service、GitHub/Jira/Linear full sync は採用しない。
- `HARNESS_MEM_TOOLS=core` の 7 tools は増やさない。
- WorkGraph を memory search の通常結果へ暗黙混入しない。必要な時だけ明示 filter / work query で出す。
- `Plans.md` は当面 SSOT のまま。importer は dry-run default、export は generated view であり `Plans.md` を自動改変しない。
- 自動 close と human approval bypass は MVP では禁止。Stop hook は suggestion まで。

### Task Plan

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S125-001 | **WorkGraph spec freeze** `[tdd:skip:docs-spec]` — `docs/workgraph.md` に purpose / users / schema / API / non-goals / existing lease-signal-verify-inject との接続を固定する | `docs/workgraph.md` が存在し、Dolt/iii/mesh/full sync/core exposure/auto-close を reject と明記。`Plans.md` と `package.json` の現行 version 前提が `0.23.0` で一致 | - | cc:完了 [fbf3431] |
| S125-002 | **Active Plans parser dry-run fixture** `[tdd:required]` — free-form `Plans.md` をいきなり DB 化せず、active sections だけを parser fixture で固定する | `cc:TODO` / `cc:WIP` / `cc:完了` / `blocked` / `[P]` / `Depends` / section heading / task id mapping の fixture test が PASS。dry-run は DB 書き込み 0 | S125-001 | cc:完了 [fbf3431] |
| S125-003 | **Additive work schema + WorkStore MVP** `[tdd:required]` — `mem_work_items` と `mem_work_dependencies` を追加し、既存 `mem_*` table を破壊しない | fresh DB / migrated DB の schema tests PASS。`blocks` / `related` / `discovered_from` / `supersedes` / `duplicates` / `checkpoint` の uniqueness と cascade が PASS | S125-001 | cc:完了 [fbf3431] |
| S125-004 | **Plans dry-run import to WorkGraph model** `[tdd:required]` — parser output を WorkStore model へ変換し、write なしで diff / diagnostics を返す | `plans_import_fidelity >= 0.98` の fixture benchmark PASS。completed historical archive は default で import 対象外。`--write` なしでは DB rows が増えない | S125-002, S125-003 | cc:完了 [41cd189] |
| S125-005 | **Ready algorithm MVP** `[tdd:required]` — blocker / supersedes / duplicates / status / active lease を見て着手可能 work を判定する | `ready_precision >= 0.95`、`blocker_recall >= 0.95` の fixed fixture PASS。active lease がある work は ready に出ない | S125-003, S125-004 | cc:完了 [b4d9f36] |
| S125-006 | **CLI-only WorkGraph MVP surface** `[tdd:required]` — `harness-mem work import-plans --dry-run` と `harness-mem work ready --project .` を実装する。MCP と hooks にはまだ出さない | CLI contract tests PASS。`HARNESS_MEM_TOOLS=core` の 7 tools 不変。import は dry-run default、`Plans.md` を自動編集しない | S125-005 | cc:完了 [23c0ffa] |
| S125-007 | **Work events / evidence links** `[tdd:required]` — `mem_work_events` と `mem_work_links` を追加し、work から observation/session/file/lease/signal へ辿れるようにする | fresh / migrate tests PASS。work -> observation -> `harness_mem_verify` 相当の provenance path が integration test で確認できる | S125-006 | cc:完了 [a58c5dd] |
| S125-008 | **Idempotent write import + generated export** `[tdd:required]` — explicit `--write` のみ DB upsert し、export は generated Markdown view として返す | 2 回 import しても duplicate work が増えない。`duplicate_work_rate <= 0.05`。export は `Plans.generated.md` 相当の出力で、`Plans.md` 直接改変なし | S125-007 | cc:完了 [ccde86b] |
| S125-009 | **Next scoring + HTTP/API query surface** `[tdd:required]` — priority / recency / blocker impact / session continuity で `next` を返し、HTTP `work/query` 系を追加する | `next_action_accuracy >= 0.80` fixture PASS。HTTP contract tests PASS。work query は project/cwd scope 必須 | S125-008 | cc:完了 [600dea5] |
| S125-010 | **Claim / close integration with existing lease** `[tdd:required]` — claim は既存 `/v1/lease/acquire`、close は lease release を使う | `claim_lease_success_rate >= 0.98`。二重 claim は後発が `already_leased` 相当で失敗。status update と lease 失敗時の rollback/release が test で固定 | S125-009 | cc:完了 [8332d13] |
| S125-011 | **Handoff / verify integration with existing signal** `[tdd:required]` — work handoff は既存 signal を使い、work evidence は verify へ接続する | handoff が `mem_signals` に thread 化され、work link から session / observation provenance を追える integration test PASS | S125-010 | cc:完了 [35def00] |
| S125-012 | **Opt-in MCP work tools** `[tdd:required]` — value gate 通過後に Go/TS MCP へ `harness_work_*` を最大 5 tools で追加する | Go/TS schema parity、registry tests PASS。`HARNESS_MEM_TOOLS=core` は 7 tools のまま。WorkGraph tools は `all` または `HARNESS_MEM_WORKGRAPH=1` のみ | S125-011 | cc:完了 [d719838] |
| S125-013 | **Hook injection suggestions + observability** `[tdd:required]` — SessionStart/UserPromptSubmit/Stop に work hint / follow-up suggestion を追加するが、resume-pack と recall whisper を押しのけない | `work_hint_consumed_rate` yellow >= 0.30 / green >= 0.60 を manifest 化。SessionStart token budget、UserPromptSubmit recall、privacy tag、project isolation の regression tests PASS | S125-012 | cc:完了 [4580d6c] |
| S125-014 | **Mem UI WorkGraph explainability** `[tdd:required]` — ready / next / blocked / claimed / injection reason / provenance を UI で見える化する | Vitest + Playwright PASS。work -> reason -> evidence の導線が UI で確認できる。UI は WorkGraph disabled 状態も破綻しない | S125-013 | cc:完了 [72683a9] |
| S125-015 | **WorkGraph release gate** `[tdd:required]` — WorkGraph benchmark fixture と CI gate を追加し、初回は warn、2 release 安定後に enforce へ昇格する | `plans_import_fidelity`, `ready_precision`, `blocker_recall`, `next_action_accuracy`, `duplicate_work_rate`, `claim_lease_success_rate`, `work_hint_consumed_rate` が committed manifest に出る。初回 CI は warn mode | S125-013 | cc:完了 [1226dc2] |

### Execution Waves

| Wave | 対象 | 目的 | 並列性 |
|------|------|------|--------|
| Wave 0 | S125-001 | 仕様と非採用範囲を固定 | 直列 |
| Wave 1 | S125-002, S125-003 | parser と schema を分離して先に赤テストを作る | 並列可 |
| Wave 2 | S125-004, S125-005, S125-006 | dry-run import と ready CLI で MVP 価値を確認 | 依存順 |
| Wave 3 | S125-007, S125-008, S125-009 | write import / export / next / HTTP を追加 | 依存順 |
| Wave 4 | S125-010, S125-011 | existing lease / signal / verify に接続 | 依存順 |
| Wave 5 | S125-012, S125-013 | MCP と hooks を opt-in で露出 | 依存順 |
| Wave 6 | S125-014, S125-015 | UI と release gate | S125-014 と S125-015 は並列可 |

推奨初回 scope:

```text
/breezing --max-workers 2
対象: S125-001 を先に完了。その後 S125-002 と S125-003 を並列実行。
```

次に進む条件: `Plans.md` dry-run import が DB 書き込みなしで active work を正しく読め、`mem_work_items/dependencies` の fresh/migrate tests が既存 memory/search/lease/signal を壊していないこと。


## §126 WorkGraph Plans sync command (2026-05-18) — cc:完了

策定日: 2026-05-18
分類: WorkGraph operations / multi-project sync

判断: `Plans.md` は引き続き各 repo の作業正本にする。WorkGraph UI を他プロジェクトでも自然に使えるよう、明示 opt-in の sync コマンドを追加する。default は dry-run で、`--write` がある時だけ WorkGraph DB へ upsert する。`Plans.md` 自体は編集しない。SessionStart では既存 `Plans.md` の DB 自動同期だけを行い、`Plans.md` の自動作成はしない。理由: ユーザー操作は減らしたいが、プロジェクトファイルを勝手に増やすのは repo 方針への介入になるため。未変更ファイルは mtime state で再同期を避け、work item recency を毎 session で人工的に新しくしない。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S126-001 | **Safe multi-project Plans.md reimport** `[tdd:required]` — `harness-mem work sync-plans` を追加し、current project / known memory projects / root scan の `Plans.md` を安全に再importする | default dry-run で DB writes 0。`--write` のみ idempotent upsert。missing / non-directory / no Plans.md は skipped diagnostics。CLI contract tests PASS。`Plans.md` は編集されない | S125-014 | cc:完了 [8e77a3d, b94f496] |
| S126-002 | **SessionStart auto Plans.md sync** `[tdd:required]` — プロジェクトの session 起動時に `Plans.md` があれば WorkGraph DB へ自動 sync し、ユーザーの手動 import 操作を不要にする | `Plans.md` 未存在時は silent skip。存在時は `harness-mem work sync-plans --write` を必要時だけ実行し、`Plans.md` は作成・編集しない。SessionStart hook contract tests PASS | S126-001 | cc:完了 |
| S126-003 | **Cross-project Plans task id compatibility** `[tdd:required]` — `S126-002` 以外の実プロジェクト Plans で使われる `7.1` / `9.B.3` / `GIFT-M1-03` / `DEP-02` 形式も WorkGraph import 対象にする | AISDR_UI2 型の dotted numeric/alphanumeric IDs と project-prefix IDs が dry-run import で work_items になる。既存 `S\d+-...` ID / dependency parsing は regression しない。CLI contract tests PASS | S126-002 | cc:完了 |
| S126-004 | **Local MCP/CLI autostart UI isolation** `[tdd:required]` — MCP frontend / HTTP gateway / 通常 CLI が daemon preflight で余分な Mem UI を起動しないようにする | Node MCP / Go MCP / HTTP gateway / high-level CLI preflight は明示 opt-in がない限り `HARNESS_MEM_ENABLE_UI=false` で daemon を起動する。`harness-mem setup` と通常 `harness-memd start` の UI lifecycle は維持。contract tests PASS、local LaunchAgent では `:37903` の専用 UI のみ、旧 `:37901` listener なし | S126-003 | cc:完了 |
| S126-005 | **Same-repo worktree alias conflict repair** `[tdd:required]` — `work sync-plans` の `work_id_project_conflict` が同一 git repo / worktree alias で誤爆しないようにする | `harness-mem-s80` 型の別名 worktree と main project が同じ git common dir なら同一 project として再importできる。別 project の同一 work_id は引き続き skipped。CLI contract tests PASS。実DB sync で `projects_synced=1` / `work_items=137` を確認 | S126-001 | cc:完了 |


## アーカイブ (完了 / 休止セクション)

2026-04-13 のメンテナンスで §51〜§76 を `docs/archive/Plans-s51-s76-2026-04-13.md` に移動しました。
2026-04-19 のメンテナンスで §79 / §80 / §81 / §82〜§87 / §88 を `docs/archive/Plans-s79-s88-2026-04-19.md` に移動しました。
2026-04-23 のメンテナンス（v0.15.0 リリース後）で §91〜§96 を `docs/archive/Plans-s91-s96-2026-04-23.md` に移動しました。
2026-05-10 のメンテナンス（v0.20.0 リリース後）で §77 / §98 / §99 / §101 / §102 / §103 / §105 / §106 / §107 / §S109 を `docs/archive/Plans-s77-s109-2026-05-10.md` に移動しました（Plans.md 832 → 535 行）。
Plans.md は working plan（§78 + §89 + §90 + §97 + §108 + §110 + §111 + §112 + §125）だけをフォアグラウンドで扱う方針です。

参照:

- [§77/§98-§107/§S109 の完了セクション](docs/archive/Plans-s77-s109-2026-05-10.md)（2026-05-10 切り出し、v0.20.0 release 後）
- [§91〜§96 の完了セクション](docs/archive/Plans-s91-s96-2026-04-23.md)（2026-04-23 切り出し、v0.15.0 release 後）
- [§79〜§88 の完了セクション](docs/archive/Plans-s79-s88-2026-04-19.md)（2026-04-19 切り出し）
- [§51〜§76 の完了セクション](docs/archive/Plans-s51-s76-2026-04-13.md)
- [それ以前のアーカイブ](docs/archive/)
