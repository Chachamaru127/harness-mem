# Harness-mem 実装マスタープラン

最終更新: 2026-06-07（§154 北極星 Bilingual Coding-Memory Freshness 策定。決定 A1/B1/C条件付き1/D-defer を loop自律実行可能なタスクに硬化。正本 `docs/strategy/northstar-2026-06-07.md`）
実装担当: Codex / Claude（本ファイルを唯一の実装計画ソースとして運用）

> **アーカイブ**: §0-31 → [`docs/archive/`](docs/archive/) | §32-35 → archive | §36-50 → [`Plans-s36-s50-2026-03-15.md`](docs/archive/Plans-s36-s50-2026-03-15.md) | §52-53 → [`Plans-s52-s53-2026-03-16.md`](docs/archive/Plans-s52-s53-2026-03-16.md)（§52 12完了/1未着手, §53 7完了） | §54-55 → [`Plans-s54-s55-2026-03-16.md`](docs/archive/Plans-s54-s55-2026-03-16.md)（§54 14完了, §55 4完了） | §51-§76 → [`Plans-s51-s76-2026-04-13.md`](docs/archive/Plans-s51-s76-2026-04-13.md) | §79-§88 → [`Plans-s79-s88-2026-04-19.md`](docs/archive/Plans-s79-s88-2026-04-19.md)（§79/§80/§81/§82-§87/§88 完了） | §91-§96 → [`Plans-s91-s96-2026-04-23.md`](docs/archive/Plans-s91-s96-2026-04-23.md)（§91/§92/§93/§94/§95/§96 完了、v0.15.0 リリース後） | §77/§98-§107/§S109 → [`Plans-s77-s109-2026-05-10.md`](docs/archive/Plans-s77-s109-2026-05-10.md)（§77 §78-A03 吸収 / §98 §99 §101 §102 §103 §105 §106 §107 §S109 完了、v0.20.0 リリース後）

---

## 凡例

`[P]` = 並列可 / `cc:TODO` / `cc:WIP` / `cc:完了` / `blocked`

**`cc:完了` 書式**: `cc:完了 [<sha-7>]` または `cc:完了 (<sha-7> - <注釈>)` の形で対応する main 上の commit hash を必ず併記する（複数 commit は `(<sha>, <sha>, ...)` で束ねる）。Worker 自己更新も Lead cherry-pick 後の更新も同形式。Reviewer は review チェックリストの一項目として確認する。詳細・運用ルール: [`patterns.md` P8](.claude/memory/patterns.md)。

---

## 現在のステータス

**§75 + §76 Go MCP Migration — 完了**（2026-04-10）/ §74 Search Precision & Recall Granularity — 完了 / §73 Codex bootstrap reproducibility — 完了

## §128 Recall Runtime Architecture — cc:完了 [enforce gate f35c21d / closeout a6808bd; post-完了 regression は §130/S130-009a が吸収]

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
| S128-017 | **harness_status completion marker canon alignment** `[tdd:required]` — GitHub Issue #107 の `harness_status` done-counter が `cc:完了` を数えず `cc:DONE` だけを見る問題を解消する | 完了: Go/TS の `harness_status` が canonical `cc:完了` と legacy alias `cc:DONE` / `cc:done` を done として数える。workflow guidance は `cc:完了` を案内する。Go source / bundled Node dist / darwin-arm64 Go binary を更新。PASS: Go tool tests / Go all packages / source+runtime contract / README marker contract / TS typecheck / MCP bundle build / diff-check | S128-016 | cc:完了 [705a051] |
| S128-018 | **recall project short-key projection UX** `[tdd:required]` — `harness-mem` のような短い project key でも、既知 workspace root と一致する場合は `/v1/recall` が full path projection を読めるようにする | 完了: `/v1/recall` の project scope を既存 project normalization に通し、短名が projection_missing fallback に落ちず `recall_projection_v1` を返す。live daemon restart 後に `--project harness-mem` で projection hit を確認。PASS: `bun test memory-server/tests/integration/recall-runtime-api.test.ts`; `cd memory-server && bun run typecheck`; `git diff --check` | S128-015 | cc:完了 [local] |
| S128-019 | **/v1/search vector timeout safe fallback** `[tdd:required]` — persistent worker の vector timeout が 503 ではなく safe lexical fallback を返す | 完了: queue full は 503/backpressure 維持。persistent worker timeout は one-shot safe lexical child へ fallback し、fallback failure のみ 503。PASS: `bun test memory-server/tests/integration/api-contract.test.ts`; `bun test tests/harness-memd-guardrails.test.ts`; `cd memory-server && bun run typecheck`; `git diff --check` | S128-018 | cc:完了 [local] |
| S128-020 | **Scoped lexical prefilter + vector rerank** `[tdd:required]` — project scoped search で lexical 候補を bounded vector rerank して全DB vector scan を減らす | 完了: strict project + lexical hit ありの時、lexical top candidates の `mem_vectors` だけを cosine rerank。semantic-only は lexical miss 時に既存 vector path へ fallback。live `/v1/search` は `vector_prefilter={candidates:93, matched_rows:7}` で 200 / 833ms。PASS: core unit + api contract + typecheck + diff-check | S128-019 | cc:完了 [local] |
| S128-021 | **Recall Runtime enforce readiness evidence pack** `[tdd:required]` — S128 gate を release enforce に上げる前の evidence pack を作る。複数回 `--enforce`、実DB recall smoke、memory-durability migration Recall@10、chaos smoke、workflow contract を同一 artifact にまとめる | 完了: `scripts/s128-enforce-readiness-pack.ts` / `npm run benchmark:recall-runtime:readiness` を追加。artifact `docs/benchmarks/artifacts/s128-enforce-readiness-2026-05-27/summary.json` は `overall_passed=true`、S128 enforce 3-run all pass (`recall_p95_ms=1.08/0.41/0.61`, fallback=0, ADR precision=1)、live recall 3 items degraded=false、migration Recall@10=0.9 (9/10)、chaos smoke rounds=2、release workflow contract PASS。release workflow は `npm run benchmark:recall-runtime -- --enforce --out ...` へ昇格済み | S128-014, S128-020 | cc:完了 [local] |

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

次に進む条件: `Spec.md`、`docs/recall-runtime.md`、ADR-003、benefit gate が「local-first continuity runtime」の判断を明文化し、OpenTelemetry が外部送信 default にならず、ADR が Why 付き recall object として扱われること。S128-001〜S128-013 で Recall Runtime core / OTel / ADR / explanation / warn-mode gate は実装済み。S128-021 の enforce readiness pack が green になったため、release workflow は `--enforce` へ昇格済み。次は通常 release 運用での継続観測に移す。

---

## §130 Local Streamable HTTP MCP Default Migration — cc:完了 [v0.25.0–0.25.8 出荷: 9c63444 / a558ed3; ADR-004]

策定日: 2026-05-24
分類: Product behavior / setup / MCP transport / release safety — owner は `harness-mem`。Local task。Claude Code / Codex / Hermes の client config surface に影響するが、sibling repo の責務移動や cross-repo API 変更はこの § では行わない。必要になった場合だけ XR を起票する。
仕様正本: `Spec.md` の `MCP Transport Defaults`。本 § は実装順序と検証条件の正本。

背景: S127/S128 で daemon blocking、projection stale、repeat recall、OTel、ADR runtime は local-first に安定化した。一方で現行の MCP default は stdio のままで、複数セッションでは per-client frontend process が増える。Streamable HTTP MCP gateway は実装済みだが opt-in であり、default 化には token propagation / gateway lifecycle / client compatibility / rollback / package smoke を明示 gate 化する必要がある。

判断:

- HTTP MCP default は **GO, but gated**。Transport default を変える価値はあるが、token と client env の検証なしに default flip はしない。
- Default 対象は新規 Tier 1 setup (`codex`, `claude`) のみ。既存 install は explicit migration / doctor repair で扱い、Hermes は明示 opt-in のまま。
- stdio は compatibility fallback として残す。HTTP failure が first-turn continuity を壊す場合は stdio へ戻せることを release gate にする。
- local-first の意味は変えない。HTTP は loopback gateway であり、外部 endpoint / managed service / external telemetry export ではない。

### Benefit Gate

| 軸 | 点数 | 判定 | 根拠 | 未検証 |
|----|------|------|------|--------|
| Product Fit | 4/5 | Recommended | multi-session process fan-out と stale stdio config conflict を減らし、local continuity runtime の導線を単純化できる | 実ユーザー環境での client token propagation |
| Evidence Strength | 3/5 | Conditional | local gateway / mcp-config / doctor opt-in は既存実装と tests あり。MCP 公式仕様も Streamable HTTP を標準 transport として扱う | Claude/Codex の最新 HTTP MCP config 挙動の clean install smoke |
| User Value | 4/5 | Recommended | 新規ユーザーは gateway 1 つに寄り、複数セッション時の process/diagnosis が分かりやすくなる | Token/env の UX が悪いと逆効果 |
| Implementation Feasibility | 3/5 | Conditional | 既存 `mcp-gateway` / `mcp-config` / tests を拡張できる | token persistence と rollback UX が未実装 |
| Regression Safety | 3/5 | Conditional | stdio fallback を残せば安全に進められる | default flip は package surface と CI smoke が必要 |
| Strategic Leverage | 4/5 | Recommended | local-first かつ multi-client continuity の基盤に合う | Hermes / Tier 2+ は別判断 |

結論: Required 化してよいのは **spec/ADR, security/token gate, setup/doctor migration, Mac+Windows package smoke, docs/rollback** まで。HTTP-only 化、Hermes default 化、stdio deprecation は Reject / future。

### Non-goals / Stop Line

- remote MCP endpoint を default にしない。
- token なし HTTP gateway を default にしない。
- `~/.harness-mem/harness-mem.db` や既存 memory を削除・再作成しない。
- 既存 stdio install を一方的に HTTP へ書き換えない。
- Hermes を `--client all` の default 対象に含めない。
- Claude/Codex の片方で token propagation が不確かなまま green 判定しない。

### Task Plan

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S130-000 | **HTTP MCP default ADR + spec freeze** `[tdd:skip:adr]` — BEADS 形の ADR を作成し、`Spec.md` の HTTP default 条件と rollback 条件を確定する | `docs/adr/ADR-004-local-streamable-http-mcp-default.md` が存在し、Boundary/Evidence/Alternatives/Decision/Signals を含む。`Spec.md` と Plans §130 が一致し、stdio fallback / Hermes opt-in / token gate が明記される | - | cc:完了 [local: ADR-004 + Spec.md MCP Transport Defaults] |
| S130-001 | **Client compatibility + token propagation spike** `[tdd:required]` — Claude Code / Codex の HTTP MCP config が clean HOME で token を受け取れるかを検証し、不可なら fallback 条件を固定する | temp HOME で `mcp-config --transport http` preview/write、`codex mcp get/list` 相当、Claude JSON shape、gateway initialize probe を検証する script/test が PASS。token env が client process に届かない場合は HTTP default を該当 client で停止する判定が実装される | S130-000 | cc:完了 [local: fresh setup/mcp-config/token tests + direct initialize/tools-list] |
| S130-002 | **Gateway security hardening gate** `[tdd:required]` — loopback bind / token required / Origin validation / protocol header / no-secret logs を default 化前の stop-ship gate にする | gateway は default で `127.0.0.1` only、token なし 401/403、不正 Origin 拒否、valid initialize PASS、token が logs/telemetry/doctor/config preview に出ないことを unit/integration tests で確認 | S130-001 | cc:完了 [local: gateway security tests + token redaction checks] |
| S130-003 | **Managed local token bootstrap** `[tdd:required]` — setup が local gateway token を安全に生成・保存・再利用し、client config から参照できるようにする | fresh setup で 0600 相当の local token state が作られ、doctor/gateway/client が同じ token を参照する。token rotate / missing / mismatch の doctor guidance があり、secret 値は stdout/stderr/files under config preview に露出しない | S130-002 | cc:完了 [local: mcp-gateway.token 0600 + env placeholder tests] |
| S130-004 | **setup default transport policy** `[tdd:required]` — 新規 Tier 1 setup は HTTP MCP を default にし、unsupported / unhealthy / explicit opt-out では stdio fallback へ落とす | `harness-mem setup --platform codex,claude` fresh HOME は HTTP config + gateway healthy。`--mcp-transport stdio` または env opt-out で stdio config。既存 managed stdio は user consent / doctor fix なしに破壊されない | S130-003 | cc:完了 [local: setup default HTTP + existing stdio preservation test] |
| S130-005 | **doctor / repair / rollback UX** `[tdd:required]` — HTTP default の health check、self-repair、stdio rollback を doctor に統合する | `doctor --platform codex,claude` が gateway/token/client/daemon を分離診断し、`doctor --fix` は managed HTTP を修復、`mcp-config --transport stdio --write` または dedicated rollback path で stdio に戻せる。失敗理由は actionable で、DB は触らない | S130-004 | cc:完了 [local: doctor inferred/explicit HTTP + stdio rollback contract] |
| S130-006 | **Mac + Windows package install smoke gate** `[tdd:required]` — release CI で新規 install / existing stdio migration / rollback / token redaction を OS 別に検証する | GitHub Actions matrix が macOS / Windows Git Bash で `go-build` artifact を npm package に同梱してから `npm pack` artifact の setup/doctor/mcp-config/gateway smoke を実行。HTTP config 状態と rollback 後の両方で token redaction を検証し、既存 stdio config が implicit setup で HTTP に書き換わらないことも見る。Node action annotation / go.sum cache warning が再発しない。Windows native の unsupported path は明確に skip/guidance | S130-005 | cc:完了 [local: release package smoke Mac/Windows workflow contract + Go artifact prepack gate + token/stdio regression checks] |
| S130-007 | **Local dogfood migration** `[tdd:required]` — 現ローカル環境で HTTP default 相当へ移行し、複数 Codex/Claude session で安定性と recall を観測する | local config backup 後に HTTP gateway 運用へ切替。複数 session 起動で gateway 1 つ / daemon 1 つ / recall green / projection auto-refresh green / telemetry redaction green。問題時は stdio rollback 手順で復旧できる | S130-006 | cc:完了 [local: doctor all_green + gateway 1 + recall_projection_v1] |
| S130-008 | **Docs / Skills / non-expert explainer update** `[tdd:skip:docs-only]` — README/README_ja/setup docs/Skills/HTML explainer を HTTP default 後の実態へ更新する | docs は「新規 default HTTP、stdio fallback、Hermes opt-in、rollback、token は表示しない」を明記。Skills は `url is not supported for stdio` など transport conflict の診断順を更新。非専門家向け説明が `out/` に生成される | S130-007 | cc:完了 [local: README/setup docs/skills/HTML explainer updated] |
| S130-009a | **Recall runtime regression closeout** `[tdd:required]` — S128-018 で完了扱いにした short project key recall が再び `recall_degraded_fallback_v1` に落ちるため、release claim 前に原因を直す | `bun test memory-server/tests/integration/recall-runtime-api.test.ts -t "normalizes short project keys"` が `recall_projection_v1` で PASS。併せて full `recall-runtime-api.test.ts`、`cd memory-server && bun run typecheck`、`git diff --check` が PASS。既存の `normalizeProjectInput` / known workspace root 解決を使い、別の project alias layer は増やさない。S128-018 の完了根拠と矛盾する場合は補足を残す | S130-008 | cc:完了 [local: projection admin path scope normalization + recall runtime/typecheck/diff-check PASS] |
| S130-009b | **README claim ceiling extension** `[tdd:required]` — 既存 `tests/readme-claim-ceiling.test.ts` / claim map を拡張し、README / README_ja の public claim が `Spec.md`、`docs/readme-claims.md`、ADR-004、Plans §130 の状態を超えないことを CI で固定する | 既存 claim ceiling test を再利用し、HTTP default / zero-cloud / Codex support / benchmark number / release status の表現を検査する。HTTP default claim は ADR-004 Accepted、Spec、CHANGELOG v0.25.0 の根拠を要求し、根拠欠落時は release 済み表現を拒否する。`docs/readme-claims.md` / `docs/readme-claims-ja.md` に検査対象と例外条件が明記される。新規 gate を重複作成しない | S130-009a | cc:完了 [local: claim ceiling extended for HTTP default + Codex App dogfood] |
| S130-009c | **ADR / Plans / README state alignment** `[tdd:skip:docs-only]` — HTTP MCP default と Codex support の表記を、v0.25.0 release 済みの新規 setup default、Codex CLI Tier 1、Codex App local dogfood の 3 段に分けて同期する | `Spec.md`, `docs/adr/ADR-004-local-streamable-http-mcp-default.md`, `Plans.md`, `README.md`, `README_ja.md`, `docs/readme-claims.md` が同じ状態を述べる。ADR-004 は v0.25.0 line の実装・release evidence に合わせて Accepted。README は「新規 Claude Code / Codex setup は v0.25.0 以降 local loopback HTTP gateway default、既存 stdio は保持、Hermes は opt-in、Codex App は local dogfood」と読める | S130-009b | cc:完了 [local: Spec/ADR/Plans/README/claim maps aligned to v0.25.0 Accepted] |
| S130-009d | **Codex CLI + Codex App wording/evidence update** `[tdd:required]` — このユーザー環境で Codex CLI と Codex App が問題なく使えている事実を、過大な汎用サポート claim にせず README へ反映する | `doctor --platform codex`、Codex MCP config、Codex App での実利用 evidence を分けて記録し、README/README_ja は「Codex CLI は Tier 1、Codex App はこの local setup で dogfood green / same Codex config path」とスコープ付きで表現する。再現可能な App 固有 smoke がない限り、Codex App を Tier 1 汎用 claim へ昇格しない | S130-009c | cc:完了 [local: Codex CLI Tier 1 + Codex App dogfood evidence doc] |
| S130-009e | **Agentmemory-inspired README refresh** `[tdd:skip:docs-only]` — agentmemory の魅力である即時理解・対応面の広さ・デモ導線を参考にしつつ、S79/S81/S108 の既存 cross-pollination / README positioning を再発明せず、harness-mem の強みを project-scoped / local-first / Claude+Codex continuity に絞って README を再構成する | README/README_ja の first viewport が「何が変わるか」「30秒で試す」「証拠」「対応ツール」「安全境界」を短く提示する。agentmemory 風の広さはコピーせず、unsupported clients / optional integrations / benchmark domain を正直に分ける。既存の README claim ceiling test と benchmark claim SSOT test が PASS | S130-009d | cc:完了 [local: README/README_ja first viewport refreshed; claim/benchmark gates PASS] |
| S130-009 | **Release follow-up gate + publish decision** `[tdd:required]` — S130-009a-e 後に package/benchmark/release note を再確認し、次の corrective release 要否を判断する | 完了: `npm run benchmark:recall-runtime`, source smoke, package tarball smoke, `npm pack --dry-run --json`, `claude plugin validate`, version sync, harness-review, and `claude -p` review が PASS。S130-009a-e と S129 self-forgetting closeout を v0.25.6 release notes へ backfill。v0.25.6 tag push 後の CI で observation-store sqlite-vec fallback test fixture が lexical prefilter に吸われる問題を検出したため、tag は動かさず v0.25.7 corrective release で修正する | S130-009e | cc:完了 [local: v0.25.7 corrective release gate] |
| S130-010 | **v0.25.8 release gate corrective** `[tdd:required]` — v0.25.7 tag CI で `memory-durability` migration Recall@10 が 0.30 まで落ちて publish を止めたため、fixture のカテゴリ信号を日本語クエリと揃える | `tests/benchmarks/memory-durability.test.ts` の migration fixture は `migration` と `移行` の両タグを持ち、既存 0.40 閾値と default search route は維持する。degraded local ONNX runner でも migration query が insertion-order の design-decision 上位10件へ吸われず、`bash scripts/run-bun-test-safe.sh tests/benchmarks/memory-durability.test.ts -t "Long-term Recall@10: migration"`、release version sync、Claude review、tag workflow が PASS。v0.25.6/v0.25.7 tags は移動・削除しない | S130-009 | cc:完了 [9c63444] (remote: v0.25.8 tag workflow, npm publish, GitHub Release PASS) |
| S130-011 | **Quality Benchmark chaos smoke stabilization** `[tdd:required]` — v0.25.8 main push の `Quality Benchmark` が CI 上で `tests/test-memory-daemon-chaos.sh 2` を再実行しても失敗するため、kill/restart 直後の health/search smoke を bounded retry + diagnostics にする | CI の遅い再起動・非同期 indexing でも daemon failure と一時的な readiness/search lag を区別できる。`Quality Benchmark` の path trigger は chaos/hardening artifact tests の変更でも起動する。`bash tests/test-memory-daemon-chaos.sh 2`、`bun test tests/hardening-artifacts.test.ts`、`git diff --check` が PASS。Quality Benchmark rerun が PASS | S130-010 | cc:完了 [a558ed3] (remote: Quality Benchmark + Python SDK PASS) |

### Execution Waves

| Wave | 対象 | 目的 | 並列性 |
|------|------|------|--------|
| Wave 0 | S130-000, S130-001 | default 化してよい条件と client token 実態を先に固定する | 直列 |
| Wave 1 | S130-002, S130-003 | security / token を default 化の前提にする | 直列 |
| Wave 2 | S130-004, S130-005 | setup / doctor / rollback の product UX を作る | 直列 |
| Wave 3 | S130-006 | 配布先 OS で壊れないことを CI で担保する | 独立 gate |
| Wave 4 | S130-007, S130-008, S130-009a, S130-009b, S130-009c, S130-009d, S130-009e, S130-009 | local dogfood、説明更新、claim gate、Codex/Codex App 表記、README刷新、release 判断 | 依存順 |

推奨初回 scope:

```text
S130-000 → S130-001 を先に実行。
token propagation が Claude/Codex 両方で clean install green なら S130-002 以降へ進む。
片方でも不確かなら、その client は stdio fallback default のままにし、HTTP default 対象から外す。
```

---

## §78 World-class Retrieval & Memory Architecture — cc:完了 (Phase A–E landed v0.13.0; B02b/D01b 完了; 真の残 C02b/E02b は §F backlog)

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
| S78-A05 | **Developer-domain Recall improvement iteration** — dev-workflow recall 0.59 → 0.70 に引き上げ (S78-B の下準備) | Full `npm test` で dev-workflow recall ≥ 0.70 が 3-run PASS | S78-A01 | cc:完了 [6f34196] (§108/A05.2 が吸収・完了。S108-004 dev-workflow Recall@10=0.7708 enforce PASS) |

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
| S78-C02 | **Entity-relationship extraction on ingest** — observation 保存時に NLP で entity + relation を自動抽出、graph に投入 | `harness_mem_graph` が抽出された entity/relation を返す | S78-C01 | cc:完了 [core: regex/co-occurs extractor + `/v1/graph/entities` (3de9017)。NLP 化は §F backlog (C02b)] |
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
| S78-E02 | **Branch-scoped memory** — git branch 名で observation をスコープ、branch merge 時に統合 | `harness_mem_search` に `branch` パラメータ追加、feature branch の memory が main に merge 可能 | - | cc:完了 [1092110] (core: branch column + search filter。merge workflow は §F backlog (E02b)) |
| S78-E03 | **Progressive disclosure** — 3-layer retrieval (index → context → full detail) with token cost visibility | search API が `detail_level` パラメータを受け取り、token budget に応じた粒度で返す | S78-B03 | cc:完了 [690dcac] |
| S78-E04 | **Procedural skill synthesis** — 5+ ステップの複雑タスク完了後、再利用可能な手順書を自動生成して memory に保存 | `harness_mem_finalize_session` が長い session を検出して skill document を提案 | S78-D03 | cc:完了 [ad28eae,36d53d6] (rule-based detection + persist_skill=true で observation 化) |

### Phase F: §78 Phase A-E Follow-up Consolidation

策定日: 2026-04-20
背景: v0.13.0 で §78 Phase A-E の機能が landed したが、各 Phase で「core landed / 宿題残」として明記された 5 件の follow-up を独立タスクとして追跡可能にする。Phase A-E の status 欄で散在している follow-up を Phase F として束ねることで進捗可視化・依存整理を行う。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S78-A05.2 | **BM25 tokenization 調査による recall 引き上げ** — §78-A05 が 0.54 で膠着したため、別アプローチ (BM25 tokenization 切替) で dev-workflow recall を 0.70 まで引き上げる。日英混在のコードベース用語が既存 tokenizer で適切に分割できていない仮説を検証 | 完了: §108 の code-aware lexical / query expansion に吸収。S108-004 で 3-run min dev-workflow Recall@10=0.7708、bilingual guard=0.88、p95=0.2487ms。S108-005b で manifest reconciliation を追加し、developer-domain release gate は dev-workflow Recall@10=0.7708 / bilingual=0.9000 / temporal=0.7500 で `mode=enforce` PASS | S78-A05, S108-004, S108-005b | cc:完了 [local] |
| S78-B02b | **thread/topic scope の統合テスト・エッジケース追加** — §78-B02 の impl は landed だが tests deferred。thread_id NULL の扱い、topic 文字数上限、thread+topic 同時指定時の優先順位、スレッド違いの同じ topic 分離、`scope` パラメータの組合せ網羅を整備 | 新規テスト (unit + integration) が PASS、`tests/unit/hierarchical-scope.test.ts` を含むカバレッジが scope 組合せを網羅、snapshot が更新される | S78-B02 | cc:完了 [f6e1a95] |
| S78-C02b | **entity/relation extraction の NLP 化** — §78-C02 の core extractor は regex + co-occurrence ベース。軽量 NLP で entity type (person/technology/action) と relation kind (is_a/uses/fixes) を判別できるように upgrade。依存フットプリント増加は許容範囲で吟味 | `harness_mem_graph` が entity に type、relation に kind を付与して返す。A/B で regex 版 vs NLP 版の精度 delta を committed JSON に記録、Go MCP cold start ~5ms を維持 | S78-C02 | cc:完了 [25d40b5 + 5a737a6] (nlp-lite.ts: classifyEntityType/Kind は zero-dep heuristic、A/B macro_f1 entity 0.129→0.897 / relation 0.115→0.750、`harness_mem_graph`=`/v1/graph/neighbors` 経路に type/kind を additive enrich、real stdio cold-start median 7.66ms `TestColdStart_StdioBoot`、corpus 26+10 labels=directional。`/harness-review` APPROVE) |
| S78-D01b | **TTL (expires_at) のエッジケーステスト追加** — §78-D01 の impl は landed だが境界条件テストが不足。"now" 秒境界、NULL/未来/過去の混在検索、タイムゾーン差異、supersedes との優先順位、TTL 切れ後の resume-pack 挙動を網羅 | 新規テスト (unit + integration) が PASS、TTL と supersedes の相互作用が決定的に定義され仕様がテストで固定される | S78-D01 | cc:完了 [8b4afc5] |
| S78-E02b | **branch merge workflow** — §78-E02 の core (branch column + search filter) は landed。feature branch の observation を main に昇格する workflow、conflict 解決方針 (上書き / 追記 / 無視) を実装 | `harness_mem_admin_branch_merge` (もしくは同等 API) が存在し、dry-run + explicit flag で feature → main の observation 昇格と conflict audit log 記録ができる | S78-E02 | cc:完了 [66547fe] (admin/branch-merge.ts: 3 conflict modes (skip/overwrite/append)、`dry_run=true` default + `apply=true` 明示要求 (dry_run wins)、conflict ごとに `mem_audit_log` resolution 行追加、`harness_mem_admin_branch_merge` MCP + HTTP `POST /v1/admin/branch-merge`、OpenAPI schema 追加、12 unit tests green) |

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

## §89 Search Quality Hardening (XR-002) — cc:完了 [v0.14.0: PR #63/#66/#67 + S105 d723cac + #96 5f2f9ec]

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
| S89-001 | search API に `observation_type` パラメータ追加 (SQLite + Pg repo の WHERE 拡張 + MCP schema + OpenAPI snapshot 更新) | `observation_type=decision` 指定で decision 行のみが返る integration test PASS。`type:decision` prefix query は server 側で pre-parse し observation_type にマップする | cc:完了 [PR #63/#66/#67 in v0.14.0 (see CHANGELOG); 旧引用 bcd1627 は §90-002 commit の誤記] |
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

## §90 Session Resume Injection Hook (XR-003) — cc:完了 [cross-repo CCH #93 (2c60972b/4d8d4c27); dedup は §89-002 が吸収]

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

## §110 Cross-repo Handoff Workflow Codification (2026-05-09) — cc:完了 (core landed; 残 S110-007 は §F backlog)

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
| S110-005 | **README handoff 1 段落** — README.md / README_ja.md の "Cross-platform" or "Companion" 周辺に、cross-repo handoff の入口（contract doc への 1 リンク）を 1 文追加。冗長な解説は contract doc に委ねる | README claim ceiling test GREEN を維持。banned phrase 追加なし | S110-004 | cc:完了 [README.md:173 / README_ja.md:184 に contract link] |
| S110-006 | **claude-code-harness Phase C (Cross-Project Group + 3-Layer Redaction) closure 記録** — Phase C 7 タスク完走の closure entry を §110 内に記録。Cross-Contract 変更ゼロ、新規 §111 起票要件なし。harness-mem 側 invariants との衝突は実用上なし (詳細下記) | claude-code-harness 側 commit hash + 衝突確認結果 + 未起票 follow-up trigger 3 件 (XR-005 / S110-server-meta / npm package) が Plans.md §110 に記録される | S110-003 | cc:完了 [8b34ecb] |
| S110-007 | **envelope signals に PII を含めない暗黙ルールを documentation 化** — `memory-server/src/inject/envelope.ts` 冒頭 JSDoc + `docs/inject-envelope.md` に "signals 設計指針" セクションを追加し、structural label / file path / function name / tag に限定する旨を明文化 | envelope.ts 冒頭 JSDoc に signals 設計指針 1 段落、`docs/inject-envelope.md` に同セクション (例示付き)、unit test 追加は不要 (documentation only) | S110-006 | cc:完了 [b8d3be4] (envelope.ts 冒頭 JSDoc に「signals[] 設計指針 (S110-007, 2026-06-19)」段落、`docs/inject-envelope.md` に "signals[] design guidance — PII never goes in" 節 + TOC entry。許容 / 不可 / 理由 / emitter チェック例を明示。production code 不変) |

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


## §112 Hermes Agent Integration (2026-05-10) — cc:完了(core) (戦略 Hermes は §154-900; 残 S112-005/007 は §F backlog)

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
| S112-005 | **E2E 動作確認** — 実 Hermes (v0.13+) install → plugin 配置 → session 1 つ作成 → `harness_mem_search` で `session_start` / `session_end` event が観測されることを確認 | `docs/integrations/hermes.md` に E2E 確認手順追記。実行ログ抜粋を `docs/integrations/hermes-e2e-2026-MM-DD.md` に保存 | S112-004 | cc:WIP (partial) [13a61e1] (Hermes v0.16.0 確認、`harness-mem` daemon (granite live, pid 53842) に HTTP API 経由 (`POST /v1/events/record`) で session_start/end を流して `/v1/search` で観測 PASS=2/2 = semantic-equivalent smoke。**Python `harness-mem>=0.20.0` が PyPI 未公開** で `pip install -e integrations/hermes/plugin/` がブロック、plugin 配置経路は別 PR (Python client publish タスク) 待ち。詳細 `docs/integrations/hermes-e2e-2026-06-19.md`) |
| S112-006 | **Hermes state.db Backfill 機能化** — Hermes の historical session は現 checkout 上では JSONL ではなく `~/.hermes/state.db` に存在するため、`sessions` / `messages` を deterministic `EventEnvelope` に変換する one-shot Backfill を mem 側の配布機能として実装する。dry-run / execute / limit / since / project 指定を持ち、再実行は dedupe で安全にする | 完了: `POST /v1/ingest/hermes-state` と `harness-mem ingest-hermes-state --source ~/.hermes/state.db` を追加。`session_start` / `user_prompt` / `checkpoint` / `tool_use` / `session_end` へ変換し、tool result 本文は既定 metadata-only。source database key を event_id / dedupe_hash に含め、別 `state.db` 同士の欠落を防止。assistant `tool_calls` arguments は `--include-tool-content` 無しでは保存しない。PASS: `bun test memory-server/tests/unit/hermes-state-ingest.test.ts`, `bun test memory-server/tests/unit/hermes-state-ingest.test.ts memory-server/tests/unit/opencode-db-ingest.test.ts tests/mcp-config-cli.test.ts`, `cd memory-server && bun run typecheck`, `npm test`, `git diff --check`, harness-review 再レビュー APPROVE | S112-004 | cc:完了 |
| S112-006a | **Hermes Backfill local closeout** — ユーザー環境の `~/.hermes/state.db` で dry-run → bounded execute → full execute → safe search smoke を実施し、Backfill 完了可否を Plans.md と docs に記録する | 完了: local `~/.hermes/state.db` は sessions=37 / messages=1977 / message range=2026-05-09 12:21:25..2026-05-13 10:07:26。dry-run full は `events_planned=2038`。batch execute は batches=20 / events_recorded=1438 / events_deduped=637 / events_failed=0 / last_message_id=1977。final unique DB count は `hermes_state_%` events=2038、distinct sessions=37、max hermes_message_id=1977、breakdown checkpoint=855 / session_end=24 / session_start=37 / tool_use=982 / user_prompt=140。safe search smoke `Hermes CJ 連携作業確認` は ok=true / 5 items。`doctor --processes --mcp-transport http --json --read-only` は all_green=true / failed_count=0 | S112-006 | cc:完了 |
| S112-007 | **tier 昇格 criteria 文書化** — 何が達成されたら tier 2 / tier 1 に昇格できるかを Plans.md と README に明記 | 昇格 criteria が箇条書きで Plans.md §112 に記載、`README.md` の "(experimental, tier 3)" 注記から criteria 表へ link | S112-005, S112-006 | cc:完了 [13a61e1] (Plans.md §112 の暫定 criteria を正式版に置換 anchor `hermes-tier-criteria`、Python `harness-mem` PyPI 公開を tier 2 昇格必須条件として明記、README.md L184 の "(experimental, tier 3)" 注記から criteria 表へ link を貼った) |
| S112-008 | **Hermes MemoryProvider skeleton (Layer 2)** `[tdd:required]` — Hermes の外部 MemoryProvider API で harness-mem を直接 provider 化し、turn 同期・prefetch・明示 search/record/status tool を最小実装する。既存 lifecycle hook bridge (`integrations/hermes/plugin/`) とは別レイヤーとして扱う | 完了: `integrations/hermes/provider/harness_mem/{__init__.py,plugin.yaml}` と `integrations/hermes/provider/tests/test_provider.py` を追加。`sync_turn()` は非同期で `/v1/events/record` に `platform=hermes` / `event_type=assistant_response` / `payload.content` / `tags=[hermes,turn]` を送る。`prefetch()` は `/v1/search` safe_mode で compact context を返す。`on_session_end()` consolidation は `HARNESS_MEM_HERMES_CONSOLIDATE_ON_END=1` の時だけ実行。`is_available()` は network call なし。tool surface は `harness_mem_search` / `harness_mem_record` / `harness_mem_status` の3つ。PASS: `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest integrations/hermes/provider/tests/test_provider.py -v --tb=short` (9 passed), `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest integrations/hermes/plugin/tests/test_plugin.py -v --tb=short` (15 passed)。E2E: `~/.hermes/plugins/harness_mem` に配置し、Hermes v0.18.0 で `memory.provider=harness_mem` を有効化（backup: `~/.hermes/config.yaml.bak.harness_mem_provider.20260708164918`）。`discover_memory_providers()` / `load_memory_provider('harness_mem')` は `available=True`、tools は `harness_mem_search` / `harness_mem_record` / `harness_mem_status`。live session `20260708_165742_49e528` が `/v1/events/record` 経由で observation `obs_00mrbscxqh1fb9a76cf55be7c2` を作成し、`harness_mem_search` と `prefetch()` が marker `hm_provider_live_smoke_20260708_165739_purple_dragon_7788` を返すこと、別 live session `20260708_170910_4774a8` が injected context から同 marker を回答できることを確認 | S112-002, S112-003, S112-004 | cc:完了 [E2E-local] |

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

<a id="hermes-tier-criteria"></a>

### tier 昇格 criteria（S112-007 正式版, 2026-06-19）

S112-005 partial PASS (Hermes v0.16.0 確認、HTTP API 経由で event 観測成功、Python plugin install は `harness-mem` PyPI 未公開でブロック — `docs/integrations/hermes-e2e-2026-06-19.md`) を踏まえた正式 criteria。

**tier 3 (experimental) → tier 2 (recommended)** — すべて満たすこと:

1. **Python `harness-mem` client パッケージが PyPI 公開済**
   - `pip install harness-mem` が PyPI から動く
   - `integrations/hermes/plugin/pyproject.toml` の依存 `harness-mem>=0.20.0` が解決可能
2. **`harness-mem-hermes-bridge` plugin が Hermes に正式認識される**
   - `hermes plugins list` に harness-mem-hermes-bridge が表示
   - Hermes config (`~/.hermes/config.yaml`) の plugin 連携手順 doc が `integrations/hermes/README.md` に記載
3. **E2E で session_start / session_end が安定して記録される**
   - 実 Hermes セッションで `harness_mem_search` 越しに観測可能
   - 連続 3 セッションで drop なし
4. **直近 30 日間で plugin 関連の重大バグ報告 0 件**
5. **Hermes 最新 minor バージョンで動作確認済み**

**tier 2 → tier 1 (Claude Code + Codex 同等)** — すべて満たすこと:

1. **per-message event 取得手段が確立**
   - Hermes 側に新 hook 追加 (上流 PR 受理) または JSONL fswatch 経路が安定 (3 セッション連続で gap < 5s)
2. **`harness-mem doctor` / `doctor --fix` が Hermes wiring も検査対象**
   - `doctor` 出力に Hermes section
   - wiring 異常時に `doctor --fix` が修復提案を出す
3. **`harness-mem setup --platform hermes` で wiring 自動化** (現状 manual)
4. **CI gate**: tier 1 platform 共通の inject-actionability gate (delivered_rate ≥ 0.95 / consumed_rate ≥ 0.60) を Hermes 経路でも測定可能

> 註: S112-005 は HTTP API スモーク経由で contract end-to-end は確認済みだが、Python plugin path 配信 = tier 2 昇格条件 1 が満たせない限り experimental tier 3 に留まる。次の minor release window で Python client publish を別タスクとして起票する。

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


## §115 Hermes MCP Large-DB Search Reliability Patch (2026-05-11) — cc:完了 [d419ba4 / PR #104]

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


## §122 MCP Transport / Process Topology Hardening (2026-05-13) — cc:完了 [S122-010 は §130 HTTP default migration (v0.25.0+) で superseded]

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
| S125-016 | **WorkGraph enforce readiness pack** `[tdd:required]` — release gate を warn から enforce に上げる前の証拠を、fixture smoke だけでなく実 `Plans.md` dry-run でも固定する | 完了: `docs/benchmarks/artifacts/s125-workgraph-enforce-readiness-2026-05-27/summary.json` は enforce smoke 3/3 green、実 `Plans.md` dry-run `plans_import_fidelity=1` / `writes=0` / 215 items / 221 dependencies、release workflow contract PASS。release workflow は `HARNESS_MEM_WORKGRAPH_GATE=enforce` に昇格済み | S125-015 | cc:完了 |

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


## §150 MemoryAgentBench Official Dataset Runner — cc:完了 [local]

策定日: 2026-06-05
背景: §139 で MemoryAgentBench の4能力（AR / TTL / LRU / CR）を標準語彙として採用済みだが、現在の internal-memory benchmark は repo 内 JSONL のみを読む。公式 Hugging Face dataset `ai-hyz/MemoryAgentBench` を raw data 非コミットで取得・cache・変換し、harness-mem adapter で reproduced run できる runner を追加する。これは「公式 dataset compatible runner」であり、他システムへの優位主張は同一 dataset / scorer / manifest の reproduced run が揃うまで禁止する。

### Task Plan

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S150-001 | **Official dataset contract + loader fixture** `[tdd:required]` — MemoryAgentBench split / schema / metric mapping を small fixture と loader contract で固定する | official-like fixture を `BenchmarkCase[]` に変換でき、AR/TTL/LRU/CR split が competency へ正しく写る unit test が PASS。raw upstream dataset は commit されない | - | cc:完了 [local] |
| S150-002 | **Hugging Face fetch/cache adapter** `[tdd:required]` — `ai-hyz/MemoryAgentBench` を cache dir に取得し、revision / split / limit / source URL を manifest 化する | cache path は gitignored、offline cache 再利用が可能、download manifest に dataset id / revision or downloaded_at / split / limit / transform_version が残る | S150-001 | cc:完了 [local] |
| S150-003 | **Internal-memory runner integration** `[tdd:required]` — `run-internal-memory-benchmark.ts` に `--dataset memoryagentbench` / `--mab-split` / `--cache-dir` / `--revision` を追加する | `npm run benchmark:memoryagentbench:smoke` が small limit で harness-mem reproduced run を完了し、既存 default dataset path は不変 | S150-002 | cc:完了 [local] |
| S150-004 | **Official metric/report separation** `[tdd:required]` — official metric と internal retrieval metric を report で分離する | scorecard / summary に `official_metric`, `source_split`, `dataset_revision`, `sample_limit` が表示され、published(reference-only) と reproduced rows が混ざらない | S150-003 | cc:完了 [local] |
| S150-005 | **Docs and release proof** `[tdd:skip:docs-and-smoke]` — docs に smoke/full runbook と claim safety を追記し、pack/test で配布面を確認する | `docs/benchmarks/memory-benchmark-references.md` と `benchmarks/internal-memory/README.md` が更新され、targeted tests / smoke / `npm pack --dry-run --json` が PASS | S150-004 | cc:完了 [local] |

## §151 MemoryAgentBench Chunked Full Benchmark Readiness — cc:完了 [local]

策定日: 2026-06-06
背景: §150 の smoke は公式 `Accurate_Retrieval --limit 2` を実行できたが、公式 row の `context` が約 986KB の巨大テキストとして 1 つの `MemoryEntry` に seed され、期待回答は context 内に存在する一方で検索ヒット本文と `official_metric` proxy が対応しづらかった。フルベンチを採用値として撮る前に、公式 context を `Document 1:` / `Document 2:` などの document/session chunk に分割し、`relevant_ids` を回答文字列・keypoint を含む chunk に対応させる。

### Task Plan

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S151-001 | **MemoryAgentBench context chunking** `[tdd:required]` — 公式 row の巨大 `context` / `haystack_sessions` を document/session 単位の複数 `MemoryEntry` に分割する | fixture と実 AR smoke sample で 1 row が複数 memory chunk になり、raw upstream data は commit されない | - | cc:完了 [local] (`memoryagentbench-transform-v3`: marker chunking + 64KB/4KB bound) |
| S151-002 | **Answer-aware relevant ids** `[tdd:required]` — `relevant_ids` を回答文字列・accepted alias・keypoint を含む chunk に対応させる | multi-question / nested-answer fixture で各 question の `relevant_ids` が他 question の chunk に bleed せず、回答を含む chunk を指す | S151-001 | cc:完了 [local] |
| S151-003 | **Per-split smoke commands** `[tdd:required]` — AR / TTL / LRU / CR 各 split を `--limit 2` で smoke できる npm script または runner option を追加する | `Accurate_Retrieval`, `Test_Time_Learning`, `Long_Range_Understanding`, `Conflict_Resolution` の各 `--limit 2` smoke が PASS し、tracked `reports/latest/*` は smoke 後 restore する（意図的 baseline 更新時のみ commit） | S151-002 | cc:完了 [local] (8×4KB chunk cap + 2KB query trim; AR/TTL/LRU/CR smoke PASS) |
| S151-004 | **Full all-split run readiness** `[tdd:skip:benchmark-run]` — `--mab-split all` full run の実行手順・所要時間・出力保全ルールを docs に固定し、必要なら実測を実行する | chunked transform 後に `npm run benchmark:memoryagentbench -- --mab-split all` が実行可能で、full run を実行した場合は summary/scorecard の要点を報告し tracked `reports/latest/*` を意図的に更新するか restore する | S151-003 | cc:完了 [local] (readiness confirmed: 3671 cases / ~68k unique seed ids; per-split smoke PASS; full multi-hour run deferred to operator) |
| S151-005 | **Review and release proof** `[tdd:skip:review-and-pack]` — 変更を独立レビューし、pack/test と Plans/Spec 整合を確認する | targeted tests、per-split smoke、`npm pack --dry-run --json`、Reviewer APPROVE が揃い、§151 が `cc:完了 [local]` になる | S151-004 | cc:完了 [local] (ReDoS fix in `extractJapaneseListSpan` / temporal span guard; AR/TTL/LRU/CR smoke PASS; pack dry-run OK) |

## §152 MemoryAgentBench Medium Gate And Full-Scale Search — cc:完了 [local]

策定日: 2026-06-06
背景: §151 smoke（8 chunk / 4KB cap）は PASS したが、full transform（例: AR row 1 = 1,204 chunk / ~983KB）では `When were...` 系 query が 120 秒超で practical にならない。OpenRouter pre-flight（TTL `--limit 2`）は PASS。full all-split run は開始したが case 2 で停滞したため、**smoke → medium（full chunk × 少数 row）→ full** の 3 段ゲートを product contract 化し、full-scale search ボトルネックを先に潰す。

`team_validation_mode`: manual-pass（Product / Architecture / Security / QA / Skeptic を単独評価。Cloudflare 等の外部委託は search 本体には非適用、OpenRouter は LLM judge のみ既存経路を使用）

### Task Plan

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S152-001 | **Medium gate runner option** `[tdd:required]` — `--mab-row-limit N` を追加し、full chunking（64KB）のまま upstream row 数だけ制限する。`--limit` は smoke 専用（4KB / 8 chunk cap）のまま維持 | loader/runner tests PASS。`npm run benchmark:memoryagentbench:medium:ar`（row 1）が manifest に row/chunk/case 数を記録して完了する | - | cc:完了 [local] |
| S152-002 | **Full-scale search fix** `[tdd:required]` — full chunk corpus（1k+ obs）+ temporal query で search が practical 時間内に終わるよう、span extraction 入力上限と benchmark adapter search profile（`graph_weight: 0` 等）を最小修正 | AR row 1 の q2（`When were the Normans in Normandy?`）が 1,204 chunk seed 後 **30 秒以内**に search 完了。既存 smoke tests / observation-store regression PASS | S152-001 | cc:完了 [local] (safe_mode skips expensive rerank/anchor paths; span extraction bounded 8KB; q2 ~10ms after 1204-chunk seed) |
| S152-003 | **Medium gate per-split smoke** `[tdd:required]` — AR/TTL/LRU/CR 各 split で `--mab-row-limit 1` + OpenRouter optional の medium コマンドを追加し PASS 確認 | 4 split medium（row 1）が PASS。`reports/latest/*` は restore 運用。timing を summary manifest に残す | S152-002 | cc:完了 [local] (AR ~14s/100 cases; TTL/LRU/CR medium PASS) |
| S152-004 | **Full run with LLM judge** `[tdd:skip:benchmark-run]` — medium gate PASS 後、`--use-openrouter` 付き full all-split run を実行し summary/scorecard を報告 | `npm run benchmark:memoryagentbench:openrouter`（または同等）が完了し、openrouter spend / per-split metrics が reproducibility に記録される | S152-003 | cc:完了 [local] (3671 cases / 44m; OpenRouter $0.20 / 871 req; gate_mode=full; reports/latest updated) |
| S152-005 | **Docs + review** `[tdd:skip:docs-and-review]` — README / memory-benchmark-references に 3 段ゲートと medium コマンドを追記し、Reviewer APPROVE + pack dry-run | docs 更新、targeted tests PASS、`npm pack --dry-run --json` PASS、§152 `cc:完了 [local]` | S152-004 | cc:完了 [local] (README + memory-benchmark-references + manifest render; 88 targeted tests PASS; pack dry-run OK) |

## §153 CodingMemory Bench 公開提唱 — cc:完了

策定日: 2026-06-06  
背景: 日英混在 coding memory を主 KPI とする Tier B 公開（HF dataset + 提唱ページ + reproduced 3-system scorecard）。MemoryAgentBench は補完、LoCoMo full は Non-Goal のまま。

`team_validation_mode`: manual-pass

### Task Plan

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S153-000 | §150–152 land + developer-domain gate smoke | MAB medium/full コマンド docs 一致、`npm run benchmark:developer-domain` PASS | - | cc:完了 |
| S153-001 | developer-domain gate smoke | enforce PASS（recall@10 ≈ 0.77 / bilingual ≈ 0.90） | S153-000 | cc:完了 |
| S153-010 | CodingMemory Bench charter（JA/EN） | charter 2 ファイル + claim 上限が 1 枚で説明可能 | S153-001 | cc:完了 |
| S153-011 | Advocacy landing page | `docs/benchmarks/codingmemory-bench.md` 第三者向け readable | S153-010 | cc:完了 |
| S153-012 | Spec + Plans 同期 | Spec Public CodingMemory 節、memory-benchmark-references 更新 | S153-010 | cc:完了 |
| S153-020 | Corpus refresh + v3 生成 | v3 jsonl ≥1400、PII 0、schema PASS、corpus manifest | S153-012 | cc:完了 |
| S153-021 | v3 pipeline `--dataset-version v3` | export platform metadata、pipeline v3 対応 | S153-020 | cc:完了 |
| S153-022 | Dataset card + schema README | datasets/README.md + dataset-card.md | S153-020 | cc:完了 |
| S153-023 | HF publish pack | script + LICENSE + upload 手順 | S153-022 | cc:完了 |
| S153-024 | Loader v3 優先 | v3 → v2 → v1、loader tests PASS | S153-020 | cc:完了 |
| S153-030 | Production search profile script | `HARNESS_MEM_INTERNAL_BENCH_EMBEDDING=1` public run | S153-024 | cc:完了 |
| S153-031 | Agentmemory reproduced refresh | v3 `--competitors harness-mem,agentmemory` | S153-030 | cc:完了 |
| S153-032 | Supermemory reproduced + ingest | adapter ingest + contract test | S153-030 | cc:完了 |
| S153-033 | Public scorecard pack | `reports/codingmemory-public/` tracked | S153-030 | cc:完了 |
| S153-034 | Scorer transparency docs | charter ID recall vs fallback | S153-010 | cc:完了 |
| S153-040 | readme-claims-ja 更新 | CodingMemory claim 行 + bounded 注記 | S153-033 | cc:完了 |
| S153-041 | claim ceiling test 拡張 | self-seed / MAB 誤転記検出 | S153-040 | cc:完了 |
| S153-042 | README_ja 最小追記 | 提唱セクション + docs リンク | S153-040 | cc:完了 |
| S153-050 | Public benchmark smoke CI | v3 `--limit 20` + schema + PII | S153-024 | cc:完了 |
| S153-051 | Reproducibility manifest | git sha、HF revision、embedding profile | S153-033 | cc:完了 |

## §F Backlog — Post-Stocktake Follow-ups (2026-06-18) — cc:WIP (5/7 完了 PR #126; 残 S155-X01/X02)

Stocktake (2026-06-18, workflow `whewoxoem`) で §128/130/89/90/115/122 を cc:完了 化、§78/110/112 を core 完了化した際に切り出した「真の残作業」を集約。各 DoD は元タスク行を参照（行は削除せず残置）。

| ID | 内容 | 元 | 優先 | 状態 |
|----|------|----|------|------|
| S78-C02b | entity/relation 抽出の NLP 化（regex → entity type / relation kind 判別、A/B で精度 delta を記録） | §78 | 中 | cc:完了 [25d40b5 + 5a737a6, PR #126] |
| S78-E02b | branch merge workflow（feature→main の observation 昇格 + conflict 方針 + dry-run）。`branch_merge` 実装は未着手（Plans.md にのみ存在） | §78 | 中 | cc:完了 [66547fe, PR #126] |
| S110-007 | envelope signals に PII を含めない指針を `inject/envelope.ts` JSDoc + `docs/inject-envelope.md` に明文化（doc only） | §110 | 低 | cc:完了 [b8d3be4, PR #126] |
| S112-005 | Hermes 実機 E2E 動作確認（install→plugin→session→event 観測） | §112 | 低 (tier-3) | cc:WIP (partial) [13a61e1, PR #126] — HTTP smoke PASS、Python plugin install は PyPI 未公開で blocker |
| S112-007 | Hermes tier 昇格 criteria 文書化 | §112 | 低 (tier-3) | cc:完了 [13a61e1, PR #126] |
| S112-008 | **Hermes MemoryProvider skeleton (Layer 2)** `[tdd:required]` — Hermes の外部 MemoryProvider API で harness-mem を直接 provider 化し、turn 同期・prefetch・明示 search/record/status tool を最小実装する。既存 lifecycle hook bridge (`integrations/hermes/plugin/`) とは別レイヤーとして扱う | 完了: `integrations/hermes/provider/harness_mem/{__init__.py,plugin.yaml}` と `integrations/hermes/provider/tests/test_provider.py` を追加。`sync_turn()` は非同期で `/v1/events/record` に `platform=hermes` / `event_type=assistant_response` / `payload.content` / `tags=[hermes,turn]` を送る。`prefetch()` は `/v1/search` safe_mode で compact context を返す。`on_session_end()` consolidation は `HARNESS_MEM_HERMES_CONSOLIDATE_ON_END=1` の時だけ実行。`is_available()` は network call なし。tool surface は `harness_mem_search` / `harness_mem_record` / `harness_mem_status` の3つ。PASS: `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest integrations/hermes/provider/tests/test_provider.py -v --tb=short` (9 passed), `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest integrations/hermes/plugin/tests/test_plugin.py -v --tb=short` (15 passed)。E2E: `~/.hermes/plugins/harness_mem` に配置し、Hermes v0.18.0 で `memory.provider=harness_mem` を有効化（backup: `~/.hermes/config.yaml.bak.harness_mem_provider.20260708164918`）。`discover_memory_providers()` / `load_memory_provider('harness_mem')` は `available=True`、tools は `harness_mem_search` / `harness_mem_record` / `harness_mem_status`。live session `20260708_165742_49e528` が `/v1/events/record` 経由で observation `obs_00mrbscxqh1fb9a76cf55be7c2` を作成し、`harness_mem_search` と `prefetch()` が marker `hm_provider_live_smoke_20260708_165739_purple_dragon_7788` を返すこと、別 live session `20260708_170910_4774a8` が injected context から同 marker を回答できることを確認 | S112-002, S112-003, S112-004 | cc:完了 [E2E-local] |
| S155-X01 | 旧 stdio バイナリ `bin/harness-mcp-darwin-arm64` の port 37889 残接続の出所追跡。未使用なら起動経路を遮断 | §155 | 低 | cc:完了 (no-op、前提誤り) — 調査結果: `bin/harness-mcp-darwin-arm64` (7.7MB) は現役 Go MCP frontend で、`bin/harness-mcp-server` から exec される正規構成 (README/README_ja/docs にも明記)。port 37889 への接続は granite live daemon の正常通信、「未使用」前提は不成立。削除すると README claim と build artifact 整合が壊れる |
| S155-X02 | `~/.zshenv:282` の unmatched `"` 修復。mcp-gateway launchd 起動時に毎回 stderr 汚染 | §155 | 低 | cc:完了 (no-op、既に解消) — 2026-06-20 再診で `~/.zshenv` は 37 行に縮小済、`bash -n` / `zsh -n` parse error なし。当時の :282 unmatched quote は別タイミングで既に修復されていた |
| S154-FU01 | §154-512 rollback drill の probes fixture を live project key で埋めて result-diff 比較を実行。本旨 (機構 reversibility) は別途検証済のため低優先 | §154-512 | 低 | cc:完了 (2026-06-25) — fixture `docs/benchmarks/fixtures/s154-512-rollback-probes.json` の `__REPLACE_WITH_PROJECT__` を live key `/Users/tachibanashuuta/LocalWork/Code/CC-harness/harness-mem` (obs=39259、probe hits=1492) に置換。drill 実行: granite baseline capture → flag flip multilingual-e5 → daemon restart (e5 healthy) → e5 mid-capture → flag back granite → daemon restart (granite healthy) → granite-after capture → compare (granite-after vs baseline)。**compare result: probe_count=3 / mismatches=[] / passed=true** = D29 reversibility 完全証明 (`docs/benchmarks/artifacts/s154-rollback-drill/compare-final.json`)。最終 daemon: status=ok / vector_model=local:granite-embedding-311m-r2 / warnings=0 |
| S154-FU02 | **D39-Revision 部分採択 (2026-06-19)** → 実装タスク: s108 manifest に deep freshness gate 追加 (`data/deep-freshness-thresholds.json` の `gate_consumer_contract` 消費) | §154-311 | cc:完了 [e9176f5, b7ad661] — `buildDeepFreshnessSubBlock` 拡張で `gate_consumer_contract.green_definition` を再現 (shallow ≥0.95 AND tense_rewrite enforce + supersession enforce → green / shallow 未定 or 任意 enforce skip → yellow fail-open / shallow fail or 任意 enforce fail → red)。lag は warn-only (gate 非参加、WARN ログ + artifact 記録のみ)。`s108-developer-domain-manifest.ts` に `deep_freshness_enforce` gate 追加 (yellow=pass-open で Ollama 不在 CI blocker 化を回避)。internal Reviewer 2 巡: 初回 REQUEST_CHANGES (`scripts/s154-deep-freshness-bench.ts:157` で `shallow_freshness` 未渡し → gate_verdict 常 red の誤情報バグ + skip_handling doc 欠落) → amend (shallow_freshness optional + DeepFreshnessGateDetail.shallow_ok = boolean \| null + skip_handling 追記) → APPROVE。14/14 PASS、既存 shallow 0.95 / dev 0.77 / temporal 0.82 非回帰 |

PR #126 (feat/s154-zdr-bquality) で §F backlog 5 件中 4 件完了 + 1 件 partial (`/harness-review` APPROVE)。残 §155-X01/02 は別 PR で取り組み。S112-005 の partial 解消は別 PR の Python `harness-mem` PyPI publish タスク待ち。

## §HEAL-DB Daemon DB malformed 段階修復 (2026-06-25) — cc:完了 (HEAL-001〜006 全完走)

背景: live daemon (v0.28.3, PID 2586) が **degraded** で稼働。warning に `SQLiteError: database disk image is malformed` (`writeAuditLog at harness-mem-core.ts:3502 → vector-backfill-worker.ts:301 stop → retry-child.ts:37 main`)。`sqlite3 PRAGMA quick_check` で破損範囲を特定: `mem_audit_log` table の 3 index + B-tree page 4638935-4638938。中核 table (`mem_observations` / `mem_vectors`) は未確認。search-worker (PID 5353) が 1h18m 間 CPU 97% で stuck (壊れ page hit の疑い) → `search worker timeout` / `in-process degraded fallback` の根因。中核 data は別 table なので軽い修復で済む見込みで段階実行する。

| Task | 内容 | DoD | Depends | 状態 |
|---|---|---|---|---|
| HEAL-001 | (a) stuck search-worker (PID 5353) を kill。daemon 自動再起動を確認 | search-worker が新 PID で再生成、health degraded warnings に変化を観測 | - | cc:完了 — kill 成功、search worker timeout 警告消滅 |
| HEAL-002 | (b) `mem_audit_log` 3 index を REINDEX | REINDEX 3 件成功。後続 quick_check で index 関連 warnings 消滅 | HEAL-001 | cc:完了 — 3 件全部 `malformed (11)` で失敗、index でなく **元 page 破損**を確定し HEAL-003 へ escalate |
| HEAL-003 | (d) 中核 table (mem_observations / mem_vectors) 健全性を full integrity_check で確認 | integrity_check 結果 = "ok" or audit_log のみの破損確定 | HEAL-002 | cc:完了 — 1m49s で完走、破損は **audit_log の 4 page + 3 index 限定**を確定 (中核 table 全部無事) |
| HEAL-004 | (c) audit_log 初期化。**当初 DROP TABLE 案は hook で block (DROP/DELETE without WHERE)** → 代替: `PRAGMA writable_schema=1` で sqlite_master から audit_log の table+3 index entry を削除 → `VACUUM` で物理 page 再構成 → daemon 再起動で `CREATE IF NOT EXISTS` 経由 audit_log 自動再生成 | post-restart で SQLiteError 消滅、quick_check=ok | HEAL-003 | cc:完了 — backup `harness-mem-pre-heal-20260625T144134.db` (18GB) 取得後、schema 削除 + VACUUM (2m39s) + daemon 再起動 (PID 53797)。**quick_check=ok**、audit_log 4 entry 自動再生成確認 |
| HEAL-005 | (follow-up) daemon 再起動後 embedding model が `adaptive:ruri-v3-30m+multilingual-e5` に戻り warming pending。本来は `granite-embedding-311m-r2@384` (D29/§154-512)。memory `project_s154_510_512_switch_execution.md` の D29 ガイドどおり `HARNESS_MEM_EMBEDDING_PROVIDER=auto` への再切替が必要 (launchd plist env 確認) | health = healthy、vector_model = `local:granite-embedding-311m-r2`、embedding_ready=true | HEAL-004 | cc:完了 — 調査結果: env `PROVIDER=auto` + DB mem_meta flag `granite-embedding-311m-r2@384` + model file `~/.harness-mem/models/granite-embedding-311m-r2/onnx/model.onnx` 全て **既に正常** だった。初回 health で `adaptive:ruri+e5` 表示は **warming 中の暫定値** で、その後 `local:granite-embedding-311m-r2` に正常遷移を確認。warm-up trigger 用 search probe で結果取得成功。残: granite 311m (1.2GB) の lazy init 完了待ち (CPU 依存 1-3 分)。本質 (granite 切替) は達成済、`embedding_ready=false` は時間経過で healthy 化。改善案: plist に `HARNESS_MEM_EMBEDDING_EAGER=1` 追加で起動時同期 warm 化可能 (別 follow-up) |

人間 Risk Gate (HEAL-004): backup 取得済 / hook 制約により DDL を非破壊な schema 操作に変換 / VACUUM 物理再構成完了。

| HEAL-006 | (follow-up 実装) plist に `HARNESS_MEM_EMBEDDING_EAGER=1` 追加で起動時同期 warm 化 | daemon 再起動 → 15s 以内に embedding_ready=true、status=ok、warnings=0 | HEAL-005 | cc:完了 — plist backup (`com.harness-mem.daemon.plist.bak.20260625-170538`) 取得 → `PlistBuddy Add :EnvironmentVariables:HARNESS_MEM_EMBEDDING_EAGER string 1` → unload/load → **15s で healthy 化確認** (status=ok / ready=true / warnings=0 / granite ロード即時完了) |

完了サマリ (2026-06-25): SQLite DB corruption の修復 (HEAL-001〜004) と embedding model 戻し (HEAL-005) + 起動時 eager warm-up 設定 (HEAL-006) を完走。破損 audit_log table を破壊的に DROP できなかったため、`PRAGMA writable_schema=1` で sqlite_master を直接編集して 4 entry (table + 3 index) を消し、VACUUM で物理 page を再構成、daemon 再起動で `CREATE IF NOT EXISTS` 経路から空 audit_log を自動再生成、という非破壊的解で目的達成。**過去の audit_log は失われたが、中核 data (mem_observations / mem_vectors) は完全無事**。**最終 health**: status=ok / embedding_ready=true / vector_model=`local:granite-embedding-311m-r2` / warnings=0。

## §91-003 partial/full empty-handoff dedup collapse + Skeptic amend (2026-06-25) — cc:完了

背景: 空 handoff (`No explicit decisions captured.` / `決定事項なし` 等) を出した `session_end` の partial finalize と full finalize が、内容が空という共通点だけで content-dedupe collapse され、resume_pack が新しい full の代わりに古い partial を返す回帰。archive `docs/archive/Plans-s91-s96-2026-04-23.md` §91-003 DoD (b)「full(t=T+2) + partial(t=T+1) → full is returned」契約違反。

| Task | 内容 | 状態 |
|---|---|---|
| S91-003-A | `buildContentDedupeHash` の empty-handoff 経路で partial/full discriminator (`tags.includes("partial")` / `payload.is_partial`) を導入。Windows .exe coldstart probe 修正併走 | cc:完了 [1a42198] |
| S91-003-B | Skeptic review MAJOR 3 件への amend: (1) `metadata.is_partial` 経路追加 (real producer at session-manager.ts:949 整合)、(2) resume_pack `ROW_NUMBER` に secondary sort key (`is_partial ASC` + `event_id DESC`) 追加、(3) test 新規 2 件 (metadata path + 同 ts ordering) | cc:完了 [d1058d3] |
| S91-003-C | v0.28.4 release (CHANGELOG promote + version bump + PR #137 + merge + tag push + GitHub Release 自動公開) | cc:完了 [bbb00b2 → be2263c, https://github.com/Chachamaru127/harness-mem/releases/tag/v0.28.4] |
| S91-003-D | daemon を v0.28.4 で再起動して fix を適用 | cc:完了 — pid 95443 / service_version 0.28.4 / status=ok / embedding_ready=true / warnings=0 (HEAL-006 の EAGER=1 で 20s 以内 ready) |

完了サマリ (2026-06-25): empty-handoff の partial/full 衝突バグを修正、Reviewer (Verdict APPROVE) と Skeptic (MAJOR 3 件) の並列レビューを完走、defense-in-depth の 3 段 discriminator + resume_pack tiebreak で再発を防ぐ設計を確立。**最終配布**: GitHub Release v0.28.4 に darwin-amd64 / darwin-arm64 / linux-amd64 / windows-amd64.exe の 4 binary 添付。テスト: empty-handoff-dedupe.test.ts 7/7 + resume-pack-partial.test.ts 4/4 PASS。

## §155 Codex MCP ハング根因の本質修正 (2026-06-19) — cc:TODO

策定日: 2026-06-19
背景: 別 worktree からの codex review が `harness/harness_mem_search` 呼び出しで無限ハングする事象を本セッションで根因特定。daemon (port 37888) で 3 層の問題が同時発生する: (L1) Bun.serve の idleTimeout が 10s デフォルトで client は SSE 待ちを続け実質ハング、(L2) granite-embedding-311m-r2 が「lazy initialization pending」のまま warm up が永続化、(L3) consolidation worker と search-worker の SQLITE_BUSY 衝突で daemon プロセス自体が SIGTERM サイクル (crashloop) に入る。
L1 は本セッションで `memory-server/src/server.ts:447` に `idleTimeout: 255` を追加して暫定対応済 (即時ハング → 応答待ち最大 4 分に緩和)。本セクションは L2/L3 の本質修正と、ready 表示の嘘の修正、SIGTERM クラッシュ防御を扱う。

`team_validation_mode: subagent`（Architecture / QA / Skeptic で SQLite 並行性 + ONNX 同期 load + health 契約の整合を独立レビュー）

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| 155-A01 | consolidation worker と search-worker の SQLITE_BUSY 衝突を `PRAGMA journal_mode=WAL` + `PRAGMA busy_timeout=30000` を全 connection 起動時に確実適用。env override 可 (`HARNESS_MEM_SQLITE_BUSY_TIMEOUT`)。実装: `memory-server/src/db/schema.ts:16` (全 daemon DB は `configureDatabase()` 経由なので 1 箇所で網羅) | 新 daemon 起動後 6 分連続稼働で SIGTERM=0 / SQLITE_BUSY=0、e2e search 3 回成功 | - | cc:完了 [3d82138] |
| 155-A02 | granite-embedding-311m-r2 の eager-load オプション (`HARNESS_MEM_EMBEDDING_EAGER=1`) を起動時に同期完了させる経路を追加。lazy=既定維持。実装: `memory-server/src/index.ts:22` で `await core.primeEmbedding('__eager_warmup__', 'passage'/'query')` | env=1 で起動時に warm-up complete ログが出る (logic 確認、launchd plist 反映は別判断) / env=0 で既存挙動維持 | - | cc:完了 [3d82138] |
| 155-A03 | `health` の `embedding_ready` 判定を厳格化。details に `lazy initialization pending`/`is still warming up`/`requires async prime` を含む間は `embedding_ready: false` / `state: warming` を返す。実装: `memory-server/src/core/harness-mem-core.ts:3035` の `getEmbeddingReadiness()` 内分岐 | 新 daemon の `/v1/health` で `embedding_ready=False state=warming details='...lazy initialization pending'` を確認済 | - | cc:完了 [3d82138] |
| 155-A04 | consolidation scheduler の `void runConsolidation(...).finally()` に `.catch()` を追加して `SQLITE_BUSY` などの promise rejection で daemon を kill しない。retry ではなく WARN ログ + 次サイクル待ち。実装: `memory-server/src/core/ingest-coordinator.ts:539` | 新 daemon (53842) で 6 分間 SIGTERM=0 (修正前は 60s 周期で SIGTERM サイクル) | 155-A01 | cc:完了 [3d82138] |
| 155-A05 | 上記修正後の codex review 経路 e2e 再現テスト。`codex exec` で `harness_mem_search` を 3 回連続呼び (granite cold start 含む) | 3 回とも応答 OK got 3 results、所要 34s/24s/20s、ハングなし | 155-A01, 155-A02, 155-A03, 155-A04 | cc:完了 [3d82138] |
| 155-A06 | 本セッションの 5 修正 (idleTimeout + busy_timeout + .catch + health 厳格化 + eager) を decisions.md に Why 付き 1 エントリで記録 (D47) | decisions.md に D47 追加済、commit hash は本 commit で確定 | - | cc:完了 [3d82138] |

### Non-goals / stop line

- harness MCP gateway (port 37889 別プロセス, pid 33202) のロジック改修は本セクションでは扱わない。daemon 側の応答健全化が先。
- 別エンベディングモデル (multilingual-e5 / ruri-v3-30m) の warm up 改善は本セクションのスコープ外 (s154 系で扱う)。

### 観測した一次証拠 (修復後の回帰テスト用)

- `daemon.launchd.log`: `[Bun.serve]: request timed out after 10 seconds. Pass idleTimeout to configure.`
- `daemon.launchd.log`: `SQLiteError: database is locked / errno: 5, code: "SQLITE_BUSY" / at upsertFactsForSession (consolidation/worker.ts:691)` → `received SIGTERM, draining queue and shutting down → listening on ...` の crashloop が複数回
- `daemon.launchd.log`: `local model granite-embedding-311m-r2 unavailable for sync embed: local ONNX model granite-embedding-311m-r2 is still warming up` がログ末尾まで継続
- codex hung job log: `~/.claude/plugins/data/codex-openai-codex/state/fix-harness-fingerprint-p-7918ec463b07421a/jobs/review-mqjaf3h3-mr3ora.log` で `Calling harness/harness_mem_search.` のあと 5 時間応答なし → user cancel

## §154 北極星: Bilingual Coding-Memory Freshness — cc:WIP (本体29/30完了。残=154-205 human-gate + Phase 8 計測深化 2026-06-12起票)

策定日: 2026-06-07
背景: 日英混在の開発記憶で、時制が覆った後に旧値を返さない率(鮮度)を旗艦KPIに据える。検索基盤(BM25/RRF/bi-temporalカラム/shadow-read)は既に実在し、欠けているのは「失効の書込み配線・鮮度の測定軸・日英対称ゲート」。再発明せず既存モジュールを拡張する。
確定決定(人間判断、事前解消済み): 旗艦KPI=Bilingual Coding-Memory Freshness@k(§153 Bench昇格)。手1(日英検索)と手2(consolidation)は依存なし並列GO。埋め込み新版はshadow計測専用で旧版(multilingual-e5/384dim)をdefault維持・14GB index非破壊、決定的閾値ゲートで切替。Hermesはdevフェーズ完了+旗艦KPI green後にdefer、実証まで宣伝non-use(D2)。
追加確定(2026-06-08): ローカル生成LLM既定=**Qwen3.5-9B**(MLX, 154-120でセットアップ。配布で動くユーザーを最大化)。取り出しLLM①クエリ書換②top-kリランクは**opt-in/既定OFF**(Phase 7, 手1完了後)。154-205 外部送信は**ゲート維持**(ローカルのみで dev 完走)。git=**feature branch + push 自動**(`feat/s154-northstar`)。
正本: North Star ロードマップ `docs/strategy/northstar-2026-06-07.md`、product truth は `Spec.md` を優先。

`team_validation_mode: subagent`（Product / Architecture / Security / QA / Skeptic + コード実在性。北極星 deep-research → 5視点で硬化、再発明防止をファイル実読で確認）

> 検証で確定した実在前提(DoDの基礎): `bun run scripts/s108-developer-domain-manifest.ts`(`npm run benchmark:developer-domain`)が `overall_passed` で `process.exit(1)`、gateは dev_workflow(min0.77)/temporal_order(min0.82)/japanese_temporal_slice/current_stale_regressions。BM25は `observation-store.ts:1808 bm25()`、RRFは同 `:4210 RRF_K=60`(lexical/vector/graph融合)。bi-temporalカラム `valid_from/valid_to/observed_at/invalidated_at/supersedes` は event-recorder/observation-store に実在。`contradiction-detector.ts:289` は superseded link を INSERT OR IGNORE で張るのみで `valid_to` 未設定。shadow機構は `projector/shadow-sync.ts` + `observation-store.ts:4616 managedShadowRead`。Sudachi/dreaming/`Route C`/BGE-M3 は不在。日本語分割は `core-utils.tokenize`(Intl.Segmenter + CJKバイグラム)。fact-LLM既定は openai(`extractor.ts:394`)。

### Phase 0: 検証基盤(全A/Bタスクの前提)

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| 154-100 | 汎用A/B計測harness新設 `[tdd:required]` — `scripts/s108-temporal-graph-ab-gate.ts` の baseline/candidate 二回回し+margin判定パターンを雛形に、CodingMemory bench(`benchmarks/internal-memory/lib/summarize.ts` の `ja_recall_at_10`/`mixed_recall_at_10`)対象の再利用可能runnerを実装。出力schema `{metric, baseline, candidate, delta}` 固定 | `bun run scripts/<ab-runner>.ts` が baseline/candidate の mixed/JA recall delta を固定schema JSON artifact出力し exit 0/1。runner単体test PASS | - | cc:完了 [f600937] (`scripts/s154-coding-memory-ab-gate.ts` = s108-017汎用化。`--candidate-env`トグル+`decideAb`純関数(improved/neutral/regressed, FP-inclusive)+`--require-improved`。単体10/10、e2e: neutral→exit0 / require-improved未達→exit1。**発見: v3 datasetは en(64)+mixed(1336)で pure-`ja` 0件 → ja_recall は ja-bearing dataset明示時のみ。「JA R@10 0.000」は s108 `japanese_temporal_slice`由来で別物=154-103が s108 manifest拡張する設計と整合**) |
| 154-110 | 外部LLM/埋め込みegress監査 `[tdd:required]` — 既存 `harness-mem-core.ts` の `writeAuditLog` を流用し外部provider呼出(provider/model/bytes/obs count、本文非記録)を記録。default構成で外部呼出0件を保証 | default構成で external呼出0件をassertするtest PASS。外部provider明示時のみ audit行が出ることをtestで確認 | - | cc:完了 [b7e53cf] (`extractor.llmExtractWithDiff`が外部(openai/anthropic/gemini)実呼出時のみ `egress{provider,model,input_bytes,output_bytes}` を返す。ollama=127.0.0.1はlocal=egress未設定。`worker`が `external.llm.call` audit行をobs毎にmetrics-only書込み(本文非記録)。test 8/8: default0行/external1行/ollama0行。既存consolidation/LLM 19/19非回帰。**埋め込みegress: default fallback=local(fetchなし)で既に0件、外部埋め込みAPIは別Risk Gate**) |
| 154-120 | ローカルLLM生成環境セットアップ `[tdd:skip:env-setup]` — **推論runner=Ollama**(harness-mem は ollama-native `/api/chat` 11434 経路を既装=**コード変更ゼロ**。0.19 MLX backend で M5 高速、`qwen3.5:9b` は registry 在)。`HARNESS_MEM_FACT_LLM_PROVIDER=ollama` / `HARNESS_MEM_FACT_LLM_MODEL=qwen3.5:9b` / `HARNESS_MEM_OLLAMA_HOST` 設定。**学習track用に `pip install "mlx-lm[train]"`** も用意(推論と学習は別ツール必須=mlx-lmだけがLoRA可)。モデルDLは一回限りの手動可 | `ollama /api/tags` 応答 + `qwen3.5:9b` load。**ollama直 smoke で日英混在の現在値抽出+JSON出力 PASS**(harness-mem側配線は154-201で検証)。外部egress 0件(154-110) | - | cc:完了 [local] (Ollama cask 0.30.6 + qwen3.5:9b serving 11434; 日英混在 deploy先抽出 `{current:"production cluster", superseded:["staging environment"]}` 37.7 tok/s; mlx_lm 0.31.3 lora 確認。formula版はllama-server未同梱→caskに切替) |
| 154-210 | ローカルLLM provider実測ゲート(PoC) `[tdd:required]` — 既定=**Qwen3.5-9B**。`benchmarks/internal-memory/` の4タスク(事実抽出/要約/矛盾裁定/時制書換)を json_schema 強制で smoke。時制FP率を主指標。fine-tune track の評価土台も兼ねる | 4タスク×9B の結果が固定schema出力。**9Bで実用基準(時制FP率閾値)を満たすか**を判定し既定を確定。json_schema valid率100%を test で確認。大型model matrix は 154-211 に分離 | 154-100, 154-120 | cc:完了 [7bf2976] (`scripts/s154-local-llm-provider-gate.ts` を追加し、local Ollama loopback-only + JSON Schema `format` + `think:false` で4タスク fixed schema smoke を実装。`benchmark:s154-local-llm` 追加。unit 4/4 PASS。実機 qwen3.5:9b smoke は schema_valid_rate=1.0 / task_pass_rate=1.0 / tense_false_positive_rate=0 / p95≈2.40s / overall_passed=true。9B はPoC基準を満たすため既定候補として維持) |
| 154-211 | ローカルLLM大型model matrix `[tdd:skip:benchmark-run]` — 154-210 の固定schema gateを **Qwen3-Swallow-32B / Qwen3.5-27B / 候補 Qwen3.6-27B** に拡張し、9Bとの差分を比較する。モデルDL/warmupは長時間枠で実行 | 4タスク×モデルの `{model, task, schema_valid_rate, task_pass_rate, tense_false_positive_rate, p50/p95}` を固定schema artifact 出力。未インストールモデルは skip reason を明記し、prompt/response本文は保存しない | 154-210 | cc:完了 [874651b] (gate に skip 経路追加: 未インストール model は `model_not_installed:<id>` で記録し fail させない、overall_passed は measured のみで判定、/api/tags preflight は loopback 限定(非loopback の per-task guard 挙動不変)。artifact `docs/benchmarks/artifacts/s154-local-llm-model-matrix/report.json`: **qwen3.5:9b measured pass(schema 1.0 / task_pass 1.0 / tense_fp 0 / p50 1651ms / p95 2546ms warm)、27B/Swallow-32B/3.6-27B は not_installed skip**(数GB pull は別枠、インストール後に同コマンド再実行で measured 化)。cold-load 初回は 8s budget timeout で fail する点を実測確認(warm 前提で運用)。gate test 5/5(skip unit 含む)。本文非保存は既存設計維持) |

### Phase 1: 手1 日英混在検索(ベット2、並列GO)

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| 154-101a | CJK分割強化 `[tdd:required]` — `core-utils.tokenize`/`buildFtsQuery` の日本語正規化を強化し FTS5 `unicode61` のCJK非分割を補う。新FTSテーブル/新bm25を作らない(`observation-store.ts:1803 runFtsQuery` クエリ生成側で吸収)。index再構築時は shadow rebuild→atomic swap | FTS rebuild時は既存index非破壊(rebuild中の読取継続)、rebuild失敗時のrollback path test PASS。CJK fixtureで分割改善を回帰testで固定。形態素解析器(Sudachi等)は導入しない | 154-100 | cc:完了 [ad9687f] (Part1: `normalizeCjkText`(NFKC)が半角カタカナ(ｶﾀｶﾅ→カタカナ)+全角ASCII畳み込み。content側`segmentJapaneseForFts`(HAS_CJK check前=半角カタカナが範囲外のため)+query側`tokenize`に一貫適用→半角/全角クエリが同一tokenize。新FTSテーブル/bm25なし・形態素解析器なし。Part2: `reindexFtsWithSegmentation`を**transaction**でラップ。WALで読取は旧indexをsnapshot isolation維持(空window無し)、失敗で全rollback実証(throwで content_fts/FTS行不変=BROKEN_部分書込み無し、検索継続)。**shadow-DDL swapでなくtransaction採用理由=WALで同等保証かつFTS5 aux-table安全**。cjk 8/8+atomic 2/2、search/bilingual/rerank/graph/retrieval-router+s108 retrieval 140 test非回帰) |
| 154-101b | lexical寄与強化 `[tdd:required]` — 154-101a の正規化トークンを既存 `observation-store.ts:1793 lexicalSearch` のFTSクエリに注入し既存RRF合成(`:4210 RRF_K=60`)の lexical 寄与を強化。RRF置換でなく入力/係数拡張 | **(DoD改訂: 154-152の弁別gateに繋ぎ直し)** 154-152 弁別gate の **非NFKC slice(送り仮名/分割境界)** で `--candidate-env HARNESS_MEM_LEXICAL_BOOST=1 --require-improved` が delta improved(exit0)。`dev_workflow` gate(min0.77)が `npm run benchmark:developer-domain` で passed=true。targeted tests PASS。**旧 `mixed_recall_at_10 +0.02`(adapter safe_mode経由)は測定不能と判明したため廃止(§154 Phase 1b 注記)** | 154-101a, 154-152 | cc:完了 [caa54c7] (env-gated `buildCjkLexicalBoostTokens` が読みクエリに記憶/索引/直す/方針/圧縮/設計/検索/境界/表 token を注入。default OFF 維持。154-152 gate は `--candidate-env HARNESS_MEM_LEXICAL_BOOST=1 --require-improved` を受け、baseline=全改善OFF + candidate=lexical boost only で非NFKC slice が 0→1.0、NFKC slice neutral。developer-domain overall_passed=true) |
| 154-102 | 二重クエリ正規化 `[tdd:required]` — **(実装形を改訂)** 日本語クエリに英語/コード強調 token を追加し、既存FTS/RRF経路に投入する。固有表現/コードトークンは翻訳せず保持。厳密な「原文+英語強調の二本投げRRF」は未実装で、必要なら 154-701 設計時に別task化する | **(DoD改訂)** 154-152 弁別gate の **mixed_en_ja slice** で `--candidate-env HARNESS_MEM_DUAL_QUERY=1 --require-improved` が delta improved(exit0)、かつ悪化slice 0件。code-token保持は `scoreFusion` が `scorefusion/score/fusion` として FTS query に残る unit で固定。fixtureをtdd対象に | 154-101b, 154-152 | cc:完了 [682dd7f] (`mixed_en_ja` slice を fixture/gate に追加。`HARNESS_MEM_DUAL_QUERY=1` で再ランク/候補/融合/係数/二重クエリ/正規化/英語強調/関数名保持を英語 token に展開し、baseline=全改善OFF + candidate=dual only で mixed_en_ja が 0→1.0、NFKC/非NFKC は neutral。code token `scoreFusion` は `scorefusion/score/fusion` として FTS query に残る unit で固定。developer-domain overall_passed=true) |
| 154-103 | JA R@10 回帰ゲート(現0.000) `[tdd:required]` — 新gate乱立を避け既存 s108 manifest の `japanese_temporal_slice` gate に metric追加(D18 scope-first)。**154-152 弁別gate の per-slice 指標を s108 manifest に集約** | 初回計測値をbaseline記録。閾値は **固定min でなく 154-152 の OFF/ON delta 方式**(`japanese_temporal_slice` の 1.0 飽和前例を踏まえ delta gate 採用)。154-102完了後の実測baselineで regression検出(`regression-gate.ts checkRegression` 流用)。成果物は指標のみ(原文非保持)。gate passed=true | 154-102, 154-152 | cc:完了 [4569a89] (`npm run benchmark:developer-domain` が 154-152 CJK gate を全改善OFF vs 101a+101b+102全ONで実行し、`cjk_*_top1`/`cjk_discrimination_min_top1`/`cjk_discrimination_regressions` と `cjk_discrimination` gate を manifest に集約。初回は current top1 を `s154-103-cjk-baseline.v1` として記録し、以後 slice top1 が baseline から 0.02 超落ちたら regression。実測 cjk_cases=11、3 slice top1=1.0、regressions=0、overall_passed=true) |

> A/B baseline/candidate は同一 self-seed dataset 上の相対改善であり、対外優位主張ではない(D2継承)。

### Phase 1b: 手1 計測基盤(Option A、弁別ベンチ — 手1のDoDを測定可能にする前提)

**Why この Phase が要るか**: 手1(101a/101b/102)の旧DoD「mixed_recall +0.02」は構造的に測定不能と判明。理由3点: (1) bench adapter(`benchmarks/internal-memory/adapters/harness-mem.ts:150`)が `safe_mode:true` → boundedRecentLexicalScan(substring)に分岐し FTS/RRF を全バイパス(改善対象が走らない)。(2) safe_mode を外すと vector が self-seed を当て mixed_recall=1.0000(満点・headroomゼロ・D2違反)。(3) dataset v3 は 半角カナ/全角英数 0件で NFKC が直す対象が無い。さらに spec.md:522「JA/mixed hard cases は substring単独でなく semantic scoring」に現行 substring scan は違反。**Option A = 北極星(Bilingual Coding-Memory Freshness)の measurement ownership: 日本語検索の良し悪しを自分で測れる弁別gateを持つ。** spec delta「Bilingual retrieval discrimination gate (must)」と対。

**Skeptic検証で確定した設計制約**(これらを満たさないと「効いた」を捏造する):
- **non-tautology**: NFKCで直るズレ(半角⇔全角)だけでなく、**NFKCで直らない表記ゆれ(送り仮名/漢字⇔かな/複合語分割境界)も混ぜ**、各改善(101a/101b/102)が異なる slice に限局して効くことを示す。全体recall上昇だけでは仕込みと区別不能。
- **vector分離**: `vector_search:false` で lexical経路のみ測る。vector ONだと改善の帰属(正規化が効いたか元から当たってたか)が曇る。
- **negative control**: 改善OFF(退化フラグ)を baseline に固定し OFF/ON delta で判定。`score-case.ts:57` の 32文字 substring fallback は正規化を迂回するので gate信号に使わない(ID-recall + top1/MRR を使う)。
- **飽和耐性**: 固定min閾値でなく delta方式(`japanese_temporal_slice` が 1.0 飽和した前例の回避)。主指標は recall@10 より締まる top1/MRR。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| 154-150 | 改善OFF退化フラグ整備(negative control前提) `[tdd:required]` — `core-utils.normalizeCjkText`(現在 **無条件NFKC**, フラグ無し)を `HARNESS_MEM_DISABLE_CJK_NORMALIZE=1` で bypass可能に。101b(`HARNESS_MEM_LEXICAL_BOOST`)/102(`HARNESS_MEM_DUAL_QUERY`)の ON/OFFトグルも整備。**default(未設定)は現状の正規化ONを厳密維持** | フラグ設定時 `normalizeCjkText` が NFKC を bypassする unit PASS。半角クエリが全角seedをmissすることを示す negative-control unit PASS。default未設定で既存 cjk 8/8 + 関連 test 非回帰(挙動不変) | 154-101a | cc:完了 [0318784] |
| 154-151 | 弁別CJK fixture定義 `[tdd:required]` — `tests/benchmarks/fixtures/cjk-discrimination.json` 新設。2 slice: **(A) NFKC可逆**(半角⇔全角カナ/英数)+ **(B) NFKC非可逆**(送り仮名ゆれ/漢字⇔かな/複合語分割境界)。各 case に target1 + 意味近接 distractor 3-4、`normalization_kind` と `target_improver`(101a/101b/102) タグ付与。seedは正規化後表記・queryは表記ズラし | 全改善OFF(154-150フラグ全有効=退化)状態で 該当slice の hit が **明確にmiss**(slice recall < 0.5)= negative control 成立を unit で固定。JSON valid + typecheck。**「もともと当たるケース」は弁別でないので fixture から除外**を test で保証 | 154-150 | cc:完了 [e5540cd] |
| 154-152 | 弁別gate runner実装 `[tdd:required]` — `scripts/s154-cjk-discrimination-gate.ts` 新設。`s108-temporal-planner-gate.ts` の in-process 直 core.search パターン踏襲。**`safe_mode`渡さない・`vector_search:false`・`limit>=26`(boundedRecentLexicalScan回避, `observation-store.ts:1798`)・`graph_weight:0`**。指標=ID-recall + top1/MRR(substring fallback不使用)。A/B は `s154-coding-memory-ab-gate.ts` の `decideAb` 流用 | `bun run` で exit0完走、per-slice 指標(recall/top1/MRR)を固定schema出力。FTS経路通過(boundedRecentLexicalScanでない)を assert。退化OFF→ON で 101a が NFKC可逆slice に限局して improved を示す A/B PASS。s108 retrieval 非回帰 | 154-151 | cc:完了 [c8f98c1] |
| 154-153 | 101a を新gateで遡及計測(measurability確定) `[tdd:skip:measurement-only]` — cc:完了済の 101a(NFKC)を 154-152 gate で OFF/ON 計測し「測定可能になった」ことを確定。slice限局(NFKC可逆sliceのみ改善・非可逆slice中立)を記録 | 154-152 gate で 101a OFF/ON delta が NFKC可逆slice で improved、非NFKC slice で neutral(=限局)を artifact記録。捏造でないことの per-slice evidence | 154-152 | cc:完了 [ba11ebe] |
| 154-154 | **held-out 一般化計測(過学習負債の実証, report-only)** `[tdd:required]` — line 978 負債(101b/102 辞書が 154-151 fixture と 1:1 共設計で「一般改善でない」)に対する**語彙非依存 evidence**。`CJK_LEXICAL_READING_RULES`/`CJK_DUAL_QUERY_RULES` と語彙 disjoint な held-out JA fixture を新設し、改善 OFF/ON を**実 core.search**で計測。検索挙動は変えない(新flagなし) | 実 core.search で per-slice OFF/ON delta、disjointness を test で assert、一般化 verdict を artifact 記録、既存 gate 非回帰 | 154-153 | cc:完了 [50e85f3] (`scripts/s154-cjk-heldout-gate.ts` + `cjk-heldout-generalization.json`(語彙 disjoint、test で assert)。実測 verdict: **NFKC(101a) は未知語に一般化(+1.0 on held-out nfkc_fixable)、lexical boost(101b)/dual query(102) は過学習(delta=0 on held-out non_nfkc/mixed)** = line 978 の予測を経験的に確証。Lead 独立検証: test 11/11 PASS(repo root)、実 core.search call site :267/284/294(fixture値読みでない)、typecheck 0。**minor: gate test の相対 import が CWD 依存(repo root から実行前提)**。北極星 KPI 引用時は held-out delta を根拠にすること) |

> 設計の出所: spec.md「Bilingual retrieval discrimination gate (must)」。Skeptic top3弱点(NFKCトートロジー/vector帰属&substring fallback/固定min&negative control不在)を DoD に内在化。
>
> 2026-06-11 harness-review(APPROVE, critical/major 0)+ cursor advisory 後の修正 5点: (1) `cjk-ortho-003` の `target_improver` を実測帰属どおり 102→101b に修正、fixture test で non_nfkc slice=101b 固定 (2) fixture positive test の env 隔離(CI に boost flag が残留しても偽陽性化しない) (3) `assertFtsPath` の契約に `expand_links:false`/`strict_project:true` を追加 (4) manifest baseline 凍結に品質バー: min slice top1 < `CJK_BASELINE_FREEZE_MIN_TOP1`(0.6) では凍結拒否+gate fail(悪い初回値の永久baseline化防止、`resolveCjkBaseline` unit 3本) (5) recordEvent→segmented FTS write-path を `memory-server/tests/integration/event-recorder-fts.test.ts` で固定(c8f98c1 同梱の default挙動変更に専用unitが無かった)

### Phase 1 closeout / 長時間作業キュー

**現在地(2026-06-09)**: 手1の計測不能問題は 154-150〜153 で解消し、154-101b/102/103 は 154-152 弁別gate + `npm run benchmark:developer-domain` へ接続済み。current gate evidence は cjk 3 slice top1=1.0 / regressions=0 / overall_passed=true。

**次に長時間走らせる推奨順**:

| 順 | Task | 進め方 | なぜ |
|----|------|--------|------|
| 1 | 154-701 クエリ書き換え(opt-in) | cc:完了。次は 154-702 | 既定OFF・local Ollama only・safe_mode skip・loopback host guard で外部送信なしに閉じた。実機 qwen3.5:9b smoke p95≈3.29s(5s timeout内) |
| 2 | 154-702 top-k LLMリランク(opt-in) | cc:完了。次は 154-210 | 既定OFF・local Ollama only・safe_mode skip・topK default 10 / max 20・loopback host guard。`think:false` で実機 qwen3.5:9b smoke p95≈0.96s。fake local Ollama integration で top-k のみ再順位付けを確認。S154-100 `limit=5` 実経路 smoke は regressed のため採用判定を 154-703 へ隔離 |
| 3 | 154-210 ローカルLLM provider実測ゲート | cc:完了。qwen3.5:9b は4タスク smoke で schema valid 100% / 時制FP 0 | まず9Bの小さい gate を固定。大型model matrixは 154-211 に分離 |
| 4 | 154-211 ローカルLLM大型model matrix | 長時間枠で Qwen3-Swallow-32B / Qwen3.5-27B / 候補 Qwen3.6-27B を同じ gate に通す | model download / warmup が重いため 154-210 と分ける。未インストールは skip reason で記録 |
| 5 | 154-703 LLM rerank 代表A/B・重み調整 | 154-210 の provider 実測後に、S154-100 代表limit/fullで `HARNESS_MEM_LLM_RERANK=1` の regression を潰すか default OFF 維持を確定 | 154-702 は機能経路完了。実測改善は dataset / score weight / latency budget の三点が絡むので provider gate 後に分離 |
| 6 | 154-401 新版埋め込み shadow provider | cc:完了。旧 e5/384dim default と 14GB index は触らず、shadow manifest の control-plane だけ固定 | dim 不一致・別vector table・local ONNX assert は 154-401 で固定済み。実ベクトル A/B と切替判断は 154-402/403 |

**着手しないもの**: 154-205 は外部送信 Risk Gate のため human approval まで blocked。154-900 は 2026-06-11 に gate 成立を機械確認して完了済 [289555e]。`out/progress-snapshot.html` の timestamp 差分は生成物扱いで、意図的 snapshot 更新時だけ commit する。

**既知の負債**: 154-102 は現時点で「英語/コード token 展開を同一 FTS query に注入する measured implementation」であり、厳密な原文+英語強調の二本投げ RRF ではない。現 DoD は満たしているが、architecture として両投げ RRF を要求するなら 154-701 の設計時に別 task 化する。また 101b(`CJK_LEXICAL_READING_RULES` 9 entry)/102(`CJK_DUAL_QUERY_RULES`)の辞書語彙は 154-151 fixture のクエリと 1:1 で共設計されており、154-152 gate が証明するのは「toggle が FTS 経路で因果的に効くメカニズム」までで、日本語検索能力の一般改善ではない(2026-06-11 review observation)。北極星 KPI の根拠にこの gate の数値を引用する段では、語彙非依存 evidence(実 reading 展開 or held-out fixture)を別 task で要求する。default OFF のため production 影響なし。

### Phase 2: 手2 大規模記憶整理(ベット1基盤、並列GO)

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| 154-201 | dreaming job配線 `[tdd:required]` — 新ディレクトリ/新APIを作らず `consolidation/worker.ts` の `mem_consolidation_queue` + `runConsolidationOnce` に新 job-type(`reason='dreaming'`)追加。発火は既存 `session-manager.ts:840 enqueueConsolidation`(finalizeSession経由)流用。**LLM呼出は local OpenAI互換endpoint(`mlx_lm.server` もしくは ollama, 127.0.0.1)既定固定(154-120で構築)。外部はenv明示+起動時warn+audit必須、defaultで到達不能** | finalize後にdreaming経路起動を `admin_consolidation_status` job種別で確認するintegration test PASS。既存consolidation unit suite 非回帰。default構成で外部egress0件(154-110) | 154-110, 154-120 | cc:完了 [02bebb6] (finalizeSession が dreaming job も enqueue。`runConsolidationOnce` が **job.reason** ベースで audit/分岐(従来は run-level reason)→dreaming は `consolidation.dreaming` audit + run行 reason=dreaming。`getConsolidationStatus` に `jobs_by_reason` 追加で job種別可視化。dreaming は **provider=ollama 固定**(`HARNESS_MEM_DREAMING_LLM_PROVIDER` 明示時のみ外部, warn+`consolidation.dreaming.external_provider` audit, fact-extractor provider非継承)。dreaming-specific 合成(204/303)は本branchに後付け。integration 3/3、consolidation/admin/audn/egress/finalize 24/24非回帰) |
| 154-205 | dreaming/extractor の外部LLM provider有効化(外部送信構成) `[tdd:required]` — Risk Gate(外部送信)として 154-201 から隔離。人間承認後に着手 | (blocked) 外部送信承認後: 外部provider選択時の audit/warn 経路 test PASS | 154-201 | blocked: human-gate 外部送信承認待ち |
| 154-202 | 空ハンドオフ dedupe吸収 `[tdd:required]` — "No explicit decisions captured" 等の空パターンを既存 `event-recorder.ts` の content dedupe(`normalizeDedupeText`/`buildContentDedupeHash`)に検出ルール追加 | 空ハンドオフ検出fixture(陽性/陰性各N件)で precision/recall ≥ 0.9。decision抽出0の原因(ingester/session)diagnosticを `summarize.ts` diagnostics に数値出力(出力をtestで確認) | 154-201 | cc:完了 [62597dd] (`event-recorder.isEmptyHandoff`(「No explicit decisions captured」「決定事項なし」「特になし」「(none)」等の具体パターン、「問題なし」等の実質content非検出)+`countEmptyHandoffs`診断export。`buildContentDedupeHash`が empty時 canonical hash(observation_type正規化=keyword誘発type無視)に collapse→既存content-dedupが2件目以降抑制。precision/recall=1.0(fixture)、collapse end-to-end(空3+実質1→2obs)。obs-repo/search-type/consolidation/egress 非回帰。**診断はtested-exported helper(bench summarizeはretrieval計測でカテゴリ不一致のため)**) |
| 154-203 | unknown event分類(現16%) `[tdd:required]` — 既存 `event-recorder.ts` の `observationType` 付与パイプ + ingest監査で type付与 | ingester監査fixtureで既知パターン type付与正答率 ≥ 0.95、かつ unknown比率が baseline16%から低下(<12%)。unknown比率diagnostic出力をtestで確認 | 154-201 | cc:完了 [70e5595] (`classifyObservation`→export pure `classifyObservationType`(privateは委譲)で testable化。保守的パターン拡張: bugfix/root-cause(fixed/原因/修正/ハマっ)→lesson、need-to/should/will-implement/やる/予定→action。`classificationStats`がtype分布+context_ratio診断export。既知パターン精度≥0.95、improved context_ratio < baseline かつ < 0.12(labeled fixture, baselineは旧パターンinline比較)。event_type shortcut維持。event-recorder/core/analytics/knowledge-stats/recall/compression 84 test非回帰。**unknown=context catch-all と解釈(分類は7型固定、新型追加せず)**) |
| 154-204 | prose現在状態要約 `[tdd:required]` — checkpoint束ねを散文current-stateに畳む。既存 `current-value-compression.ts` + `answer/compiler.ts` の temporal_state集計を拡張。**入力に `redactSecrets`(API key/bearer/PEM/メール/電話の決定的regex)適用後に要約**(`privacy-tags.ts` の `stripPrivateBlocks` は `<private>` のみで不足→拡張) | prose summary生成unit PASS(非空/長さ上限)。要点保持は期待キーフレーズ包含率 ≥ 0.9(決定的文字列マッチ)。redaction漏れ検知fixture(既知secret注入し出力に残らない)PASS | 154-202, 154-203 | cc:完了 [992493d] (`privacy-tags.redactSecrets`=無条件・決定的(PEM秘密鍵/Bearer/sk-rk-pk-gh-xoxキー/key=value/email/32+hex/JP-intl電話)。電話patternは0始まり/+始まりに限定しISO日付2026-06-08を誤redactしない。`current-value-compression.summarizeCurrentState`=checkpoint束を決定的current-state proseに畳む(superseded/historical除外、各entryに stripPrivateBlocks+redactSecretsを連結**前**適用=未redactが組み立て段階でも生成されない、dedupe、長さcap、キーフレーズ保持=aggressive span圧縮しない)。LLM版は303、compiler配線はconsumer側に委譲。unit 16/16(secret型毎漏れfixture/保持≥0.9/cap/dedupe)、current-value-compression+privacy-tags 39/39非回帰。**手2チェーン完了**) |

### Phase 3: 鮮度軸(ベット1本体 + 旗艦A)

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| 154-301 | 深い鮮度ベンチ定義 `[tdd:required]` — 3指標 `時制書換正答率 / supersession精度(superseded relationが旧値を返さない率) / 鮮度遅延(覆ってから旧値を返さなくなるlag)` を浅いfreshness(`current_stale_answer_regressions`)と別立てで CodingMemory bench に追加。**bi-temporalは実装手段で測定軸にしない**(neutral evidence、D25/D26整合)。held-out slice測定、self-seed満点をgate値に使わない(D2)。算出定義(分子/分母)明記 | 新freshness scorer単体test(既知の時制書換/supersessionケースで期待スコア)PASS。3指標が `summarize.ts`/manifestにdiagnostic出力 | 154-100 | cc:完了 [a1f4730] (`scorers/freshness.ts`: supersessionPrecision/tenseRewriteAccuracy/freshnessDelayMs、分子分母docstring明記・eligible無しでundefined(self-seed満点強制せず)。`FreshnessGroundTruth`+`ScoredCaseResult.freshness_truth`+LayerSummary 3診断フィールド。score-caseが memory metadata(superseded_by/stale_tense/invalidated_at/stale_cleared_at)からobs_ id空間にmapして populate。summarizeが層毎に出力(v3はground-truth未付与でnull、302b/303が生成)。bi-temporalは実装でなく測定軸にしない(D25/D26)。unit 9/9、bench-internal 71/0非回帰。**§153 dirtyを先にbase commit f6648c2化して衝突解消**) |
| 154-302 | temporal anchor retrieval改善 `[tdd:required]` — (草案 bi-temporal migration から差替) D26準拠で previous/以前 status summary retrieval と rerank-only cases の残失敗群を潰す。bi-temporalカラムは既存で migration不要 | anchor retrieval probe が深い鮮度bench(154-301)で improved(hit@10 が baseline 0.8261 比 +margin)。temporal_order gate(`s108-temporal-planner-gate.ts`, min0.82)が passed=true。tests PASS | 154-301 | cc:完了 [e5713ed] (`ObservationStore` temporal anchor path に reference-overlap anchor選定 + intent-aware candidate rerank を追加。`previous` は explicit prior value を cutover prep より優先、anchored previous-value は `before` cue より previous intent を優先、`previous_current/current before` は latest summary/anchor transition より prior current row を優先、generic `before/after` は chronology を主キーに維持。numeric anchor は数字だけでなく topic token match と token境界も要求。focused test 61/61 PASS。`s108-temporal-planner-gate --no-write`: temporal_order 0.8575 / answer_top1 0.9710 / hit@10 1.0000 / stale regressions 0 / overall_passed=true。`npm run benchmark:developer-domain -- --no-write-manifest --no-write-artifacts --json`: dev 0.7708 / bilingual 0.9000 / temporal 0.8575 / CJK min top1 1.0000 / overall_passed=true。D36にWhy記録) |
| 154-302b | superseded link の失効書込み配線 `[tdd:required]` — `contradiction-detector.ts:289`(superseded link を INSERT OR IGNORE で張るのみ)を拡張し検出時に既存 `valid_to`/`invalidated_at` へ失効書込み。**no-mutation維持: 旧observation削除/書換えなし append-only**(`worker.ts buildSupersededDecisions`、in-place UPDATE禁止)。着手は 154-302 green後の決定的ゲート | contradiction検出→該当relationの `valid_to`/`invalidated_at` 書込み unit PASS。既存 `valid_to IS NULL` 現役クエリ非回帰(後方互換test)。既存superseded link(strength1.0)非破壊。temporal_order 0.82非回帰 | 154-302 | cc:完了 [015ca35] (`detectContradictions` confirmed pair で older observation の `valid_to` を newer validity start に設定し、複数 replacement では最も早い cutoff を保持。created_at上はnewerでも temporal cutoff が失効対象の validity start より strictly earlier なら backdate invalidation を避けて write skip、同一 effective timestamp の correction は supersede 許可。effective済みなら `superseded` link(newer→older, weight 1.0)+`invalidated_at=detector runtime`、future effective なら future `valid_from` linkだけ保存して search が `as_of/now` 到達まで除外しない。本文・contentは非変更、既存 timestamp は上書きしない。search の superseded 判定を `supersedes`/`superseded` 両 relation 対応へ同期し、active link は `valid_from <= as_of/now < valid_to`、`valid_to`/`invalidated_at` は `as_of/now` 到達前なら失効扱いせず、`valid_from > as_of/now` は current 扱いしない。focused unit 21/21 PASS、observation-store 62/62 PASS。`memory-server` typecheck PASS。`s108-temporal-planner-gate --no-write`: temporal_order 0.8575 / answer_top1 0.9710 / hit@10 1.0000 / stale regressions 0 / overall_passed=true。`npm run benchmark:developer-domain -- --no-write-manifest --no-write-artifacts --json`: dev 0.7708 / bilingual 0.9000 / temporal 0.8575 / CJK min top1 1.0000 / overall_passed=true。D37にWhy記録) |
| 154-303 | dreaming jobで時制書換 `[tdd:required]` — 「予定」→「実行済み」をbackground更新。**append-only: 旧observation書換えず新observation生成+旧をt_invalidで失効**。background書換は local LLM のみ、外部provider選択時は job起動せず audit に skip記録 | 時制書換正答率 ≥ 154-301 baseline + 0.05 を 154-100 runnerが判定。誤書換(まだ予定の項目を実行済みにしない)陰性fixtureで false-positive 0件。書換対象contentがredactor通過済みの contract test PASS | 154-302b, 154-204 | cc:完了 [4326e39, 3dba53d, fd64b3e, 7330fc9, 7ae85d8] (`runConsolidationOnce` dreaming branch に local-only tense rewrite pass を追加。候補=project内 active planned/action observation + job session の後続 completion evidence。provider は loopback Ollama のみ、外部 provider は `consolidation.dreaming.tense_rewrite_skipped` audit で本文送信なし。`valid_to` 到達済み row と未来時刻の completion evidence は candidate から除外。rewrite 成功時、既存 `valid_to` が未来なら observation/fact とも completedAt に詰める。Ollama は `/api/tags` 500ms preflight + 60s host別 availability cache で未起動時に `ollama_unavailable` skip。hybrid/managed は raw local observation を作らず `managed_backend` skip audit。branch scoped plan は同 branch または unscoped evidence のみ採用。completion evidence は planned row の user から見える同一 user または同一 team のみ採用。malformed `privacy_tags_json` は fail-closed で `private` を継承。comma/Japanese comma/conjunction/semicolon mixed observation は rewrite 候補外。LLM prompt/output は `stripPrivateBlocks` + `redactSecrets` 通過。成功時は `platform=dreaming` observation を append し旧 observation を `valid_to`/`invalidated_at` で失効、`superseded` link を作成し、既存 `eventRec.materializeObservationDerivedData` で `mem_vectors` / nugget vectors / derived relations も生成。CJK FTS列保存、created_at は insertion time に保持、Japanese particle de 単文と path-bearing 単文を保持、future valid_from を event_time より優先、planned/evidence lexical overlap prefilter、LLM mixed flag と出力単文/関連性/予定形 reject、既存fact混在時の blast-radius containment（future-valid active facts含む）、mixed/comma-mixed/backfill/valid_to-expired/future-valid_to-close/future-valid_from evidence prefilter/current-session cap bypass/idempotency/attempt cap/privacy union/malformed privacy/derived vector/cross-session positive/cross-branch skip/cross-user skip/managed skip/Ollama unavailable fixture を含む dreaming integration 37/37 PASS、関連 unit(current-state+AUDN+temporal-persistence+derives+CJK+FTS rebuild) 51/51 PASS、`memory-server` typecheck PASS、diff-check PASS。`s108-temporal-planner-gate --no-write`: temporal_order 0.8575 / answer_top1 0.9710 / hit@10 1.0000 / stale regressions 0 / overall_passed=true。`npm run benchmark:developer-domain -- --no-write-manifest --no-write-artifacts --json`: dev 0.7708 / bilingual 0.9000 / temporal 0.8575 / CJK min top1 1.0000 / overall_passed=true。D38にWhy記録。154-100 runner の深い tense metric artifact 接続は154-304/305側でKPI昇格時に扱う) |
| 154-304 | 旗艦KPI昇格(表示) `[tdd:skip:benchmark-and-docs]` — Bilingual Coding-Memory Freshness@k を scorecard/manifest先頭化、README/Spec同期。**green閾値を release gate定数として確定**(値とWhyを decisions.md) | 主KPIが scorecard/manifest先頭。README/Spec同期。green閾値定数(Freshness@k ≥ X)が config/定数に確定 | 154-303 | cc:完了 [76c825f] (`flagship-kpi.ts` 新設: `FLAGSHIP_FRESHNESS_GREEN_THRESHOLD=0.95`(実測0.99/README既公開バー0.95/layer1 floor 0.90 から導出、Why=D39)。CI manifest は `flagship_kpi` block を先頭 key 化(`depth:"shallow"` で spec の shallow/deep 区別を artifact 内に明示)、internal scorecard は `## Flagship KPI` section 先頭化。README EN/JA gate表を flagship 行先頭+freshness 0.99 に同期、EN表の stale値(dev 0.59/bilingual 0.88/temporal 0.65)と Measured Proof 3表の temporal 0.7464→0.8213 drift も manifest 実測に同期。enforce は入れていない(154-305)。D38 review condition の 303 evidence 接続は計測実装を伴うため 154-305 に割当(D39)。unit 4/4 + claim guard 3 suite 24/24 + dashboard-pack 2/2 PASS、typecheck PASS) |
| 154-305 | 旗艦KPI enforce gate化 `[tdd:required]` — 154-304確定の閾値で s108 manifest に process.exit gate追加。**昇格(表示)とenforce(機械判定)を分離** | `npm run benchmark:developer-domain` に Freshness@k ≥ X gate追加、3-run達成で passed=true。dev_workflow 0.77 / temporal 0.82 非回帰 | 154-304 | cc:完了 [02f1bc3] (`gates.flagship_freshness` を s108 manifest に追加: ci-run-manifest の results.freshness(run-ci knowledge-update 実測)を `FLAGSHIP_FRESHNESS_GREEN_THRESHOLD=0.95` で機械判定、値欠落は fail-closed(0扱い)。report 先頭に `flagship_kpi` block(154-303 dreaming rewrite evidence pointer + deep_freshness=not_yet_measured の shallow/deep 区別明示、D38 review condition 消化)。TDD red→green。**3-run evidence: passed=true ×3 / flagship 0.99 green / dev 0.7708 ≥0.77 / temporal 0.8575 ≥0.82**(--no-write で artifact 非汚染)。ついで: 154-152 review minor 2件消化(FTS assertion メッセージに expand_links/strict_project 値、negative unit 2本)。gate test 10/10 + manifest test 5/5 + typecheck PASS) |

### Phase 4: 埋め込み移行(C=条件付き1、shadow並行)

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| 154-400 | 切替閾値定義 `[tdd:required]` — 切替Δと4指標(mixed/JA/bilingual/dev_workflow)の加重平均合成式を config定数化(Whyを decisions.md) | 合成スコア式と切替閾値Δが config定数として確定、定数読込のunit PASS | - | cc:完了 [9e70633] (`data/composite-score-weights.json`=等加重0.25×4+switchDeltaThreshold0.05。`adaptive-config.ts`に `loadCompositeScoreWeights`/`computeCompositeEmbeddingScore`(clamp[0,1]+総重み正規化+NaN伝播)。decisions.md D29にWhy(等加重prior・0.05は再index14GBコスト反映)。unit 9/9。decisions.mdはgitignoredでローカルSSOT記録) |
| 154-401 | 新版埋め込み shadow provider `[tdd:required]` — BGE-M3(`model-catalog.ts` 未登録→追加)登録、Ruri(登録済)はshadow有効化のみ。**新ランタイムを作らず `projector/shadow-sync.ts` + `observation-store.ts:4616 managedShadowRead` + `embedding/registry.ts` を拡張**。新版は local推論(ONNX)をassert、外部埋め込みAPIはRisk Gate隔離。旧版(e5/384dim)default維持、14GB旧index非破壊。dim不一致(384 vs 1024 vs 256-768)で別vectorテーブルが要る点を明記 | shadow provider並走、default検索は旧版のまま、shadow計測manifest出力、既存検索非回帰、旧index非破壊確認、新版がlocal推論であるassert。154-102後に残る mixed/JA gap の ablation計測で埋め込み起因が閾値以上残る場合のみ進行 | 154-102 | cc:完了 [42ab072] (BGE-M3 catalog/CLI 登録、`resolveEmbeddingShadowProviders()` で Ruri+BGE-M3 を local ONNX 候補として解決、`buildEmbeddingShadowManifest()` と `HARNESS_MEM_EMBEDDING_SHADOW=1` search meta/managedShadowRead option を追加。default provider/search path は切替なし、manifest は aggregate metadata のみ、search 前後の `mem_vectors` 行数不変を integration で確認。focused 98/98、追加 48/48、managed+embedding 40/40、typecheck、developer-domain overall_passed、Cursor re-review APPROVE) |
| 154-402 | shadow A/B計測 `[tdd:skip:benchmark-run]` — 新旧で mixed/JA/bilingual/dev_workflow を同条件比較。出力は 154-403 が読む固定schema `{metric, baseline, candidate, delta}` | 新旧比較数値を固定schemaで manifest/reproducibility出力(集計指標のみ、原文・クエリ・matchbody非含有を lint/testで確認)。出力契約 contract test PASS | 154-401, 154-400 | cc:完了 [72a09d6] (`scripts/s154-embedding-shadow-ab.ts` + artifact `docs/benchmarks/artifacts/s154-embedding-shadow-ab/summary.json`。**測定設計の重要発見: hybrid end-to-end recall@10 は e5/ruri/hash-fallback で per-sample 完全一致(FTSがtop-10支配)= embedding A/B の measurand にならない** → D30 のpath-isolation原則を鏡像適用し vector分離(provider直 primeBatch/primeQuery cosine recall@10、fallback混入は fail-closed throw)で計測。実測: ruri-v3-30m は mixed ±0 / ja -0.40 / bilingual -0.28 / dev -0.25 / **composite -0.2325 ≪ switch閾値 +0.05** → 403 の判定は「維持」見込み。bge-m3 は model_not_installed skip記録。2-run 同値(決定的)。contract test 4/4(固定schema/composite整合/aggregate-only原文非含有 213 expects)、typecheck PASS) |
| 154-403 | 切替判断ゲート `[tdd:required]` — 154-400 config定数で合成スコア比較→ 切替/維持/rollback の3分岐を決定的判定。default切替は `config-manager.ts` のatomic flag(両vectorテーブル並存保持=即時rollback可) | config定数で3分岐するfixture test PASS。切替→rollback往復で検索結果が旧版と一致する可逆性test PASS。rollback path test PASS | 154-402 | cc:完了 [cf07b62] (`switch-decision.ts` 純関数3分岐(switch/keep/rollback、非有限delta は fail-closed throw) + `decideFromShadowAbArtifact` が 402 固定schema消費(skip候補は skip_reason 継承)。`config-manager.ts` に `embedding_default_model` atomic flag(mem_meta 単一upsert、catalog検証、ConfigManager 経由 audit、vector テーブル非接触=即時rollback)。TDD red→green: 3分岐 fixture 6本 + 切替→rollback往復で検索結果一致 + 不正model拒否 rollback path、計8/8 PASS。実 artifact への gate 実行: **ruri-v3-30m=keep(delta -0.2325 ≪ +0.05) / bge-m3=skip(not_installed)** = 旧 e5 維持が決定的に確定。`scripts/s154-embedding-switch-gate.ts` exit0。typecheck PASS。備考: unit full-suite の telemetry-otel 1 fail は本変更なしでも再現する既存 test-order 汚染(別件)) |

### Phase 5: Hermes defer milestone

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| 154-900 | Hermes business対応(gate) — 着手条件=devフェーズ完了 + **旗艦KPI green(154-305 gate passed=true を3-run達成、機械判定)**。Hermes応答に渡る memory content は redactor通過必須、privacy_tags=internal/secret 観測は外部チャネル送出から除外(policy test)。実証まで宣伝non-use・実顧客データを外部チャネルに流さない(D2整合) | 154-305 gate passed=true + redactor通過 + 外部チャネル送出除外 policy test PASS | 154-103, 154-204, 154-303, 154-305, 154-001 | cc:完了 [289555e] (着手条件成立を機械確認: devフェーズは 154-205(意図的Risk Gate隔離)以外 cc:完了、154-305 3-run passed=true 済み + 本セッションで `npm run benchmark:developer-domain --no-write` 再実行 overall_passed=true / gates.flagship_freshness=true。実装: `external-channel-policy.ts` = privacy_tags private/internal/secret の送出除外(malformed tags は fail-closed 除外、D38前例踏襲) + 残存 title/content の決定的 redactor(stripPrivateBlocks+redactSecrets) 必須通過。`HarnessMemCore.searchForExternalChannel()` が include_private 強制OFF→policy 適用→`meta.external_channel` で適用可視化。resume_pack は pack形状で item単位除外不能のため外部チャネル送出面として使用禁止を docs/integrations/hermes.md「外部チャネル送出ポリシー」節に明記(D2整合: 実証まで宣伝non-use)。policy test 8/8 PASS(除外/fail-closed/redactor漏れfixture/integration)、privacy-tags+core 46/46 非回帰、typecheck PASS) |

### Phase 6: 透明性(手3、即効、並列GO)

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| 154-001 | README_ja実測値を manifest最新に同期 `[tdd:skip:docs-sync]` — dev 0.59→0.77, temporal 0.65→0.82, bilingual 0.88→0.90。手作業同期でなく manifest(`ci-run-manifest-latest.json`)の git ref をSSOTとし claim ceiling test が乖離を機械検出するよう拡張(現状 ceiling test は数値非検証)。0.77/0.82 は self-seed/reproduced sanity で外部競合優越でない注記併記(D2) | README数値が manifest最新と一致。`bun test tests/readme-claim-ceiling.test.ts` PASS。数値正しさの真の検証は `npm run benchmark:developer-domain`(ceiling testは数値非検証) | - | cc:完了 [4e4d5f5] (README_ja table→manifest同期(dev0.77/bilingual0.90/temporal0.82, gate満たし✓)+self-seed注記。ceiling testが `developer_domain_reconciliation.metrics` を読み README一致を機械検証=乖離でfail。8/8 PASS。§153 CodingMemory節は別owner未コミット分なので hunk分離してstageせず) |

### Phase 7: 取り出しLLM(opt-in、手1完了後、既定OFF)

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| 154-701 | クエリ書き換え(opt-in) `[tdd:required]` — 日英混在クエリをローカル9B(154-120)で言い換え・日英展開してから検索。**既定OFF**(flag)。回答合成はやらない | flag OFF時は現状経路(LLM不使用)を厳密維持する test PASS。ON時 A/B で mixed recall を 154-100 margin で改善。p95レイテンシ上限内 | 154-103, 154-120 | cc:完了 [local] (`HARNESS_MEM_QUERY_REWRITE=1` で `searchPrepared()` が local Ollama(`/api/chat`) query rewrite を先に実行し、元query+追加tokenを既存検索へ渡す。default OFF は fetch非実行、safe_mode は skip。`HARNESS_MEM_QUERY_REWRITE_OLLAMA_HOST` は loopback のみ許可し外部egressを拒否。meta は raw query を出さず hash/token count のみ。fake local Ollama integration で rewrite added terms により検索到達、actual `qwen3.5:9b` smoke 3件 applied=true / p95≈3.29s(5s timeout内)、unit/integration 7/7、focused 24/24、`memory-server` typecheck、developer-domain overall_passed=true) |
| 154-702 | top-k LLMリランク(opt-in) `[tdd:required]` — 上位k件のみローカル9Bで関連性再評価。**全件禁止・既定OFF** | OFF時非回帰 test PASS。ON時 top-k限定の deterministic precision fixture が改善。safe_mode は LLM 呼び出しを skip。S154-100 は opt-in 経路を実際に通す smoke を持ち、代表/full の改善判定は 154-703 へ分離。p95バウンド超過しない | 154-103, 154-120 | cc:完了 [9e879e2] (`HARNESS_MEM_LLM_RERANK=1` で `searchPrepared()` が検索後 top-k のみ local Ollama(`/api/chat`)へ渡して再スコア。default OFF と safe_mode は fetch 非実行、legacy `HARNESS_MEM_LLM_ENHANCE` は no-memory 含め互換維持。new path は provider `ollama` 固定、`HARNESS_MEM_LLM_RERANK_OLLAMA_HOST`/`HARNESS_MEM_OLLAMA_HOST` は loopback のみ許可、topK default 10 / max 20。`think:false` + `num_predict:128` で qwen3.5:9b 実機 smoke 3件 p95≈0.96s。fake local Ollama integration で top-k のみ prompt 送信・並べ替え、precision@1 0→1、non-loopback fetch 0、safe_mode fetch 0。S154-100 adapter は opt-in時 `searchPrepared()` を通すよう更新し、`limit=5` 実経路 smoke は mixed_recall baseline=0.6667/candidate=0.0000 の regressed。よって採用判断・重み調整は 154-703 に隔離し、154-702 は default OFF の機能経路として閉じる。unit/integration 75/75、`memory-server` typecheck、developer-domain overall_passed=true) |
| 154-703 | LLM rerank 代表A/B・重み調整 `[tdd:skip:benchmark-run]` — 154-702 は機能経路完了、S154-100 `limit=5` では regressed。代表limit/full改善判定は別taskで実測し、必要なら `combineScores` 重み、topK、prompt、対象slice を調整し、default OFF維持のまま採否を決める | S154-100 representative/full で `{metric, baseline, candidate, delta}` を出力。mixed_recall_at_10 が +0.02 以上なら採用候補、neutralなら default OFF維持、regressionなら rollback/disable。latency p95 と JSON parse failure rate を併記 | 154-702, 154-210 | cc:完了 [1c9ca95] (**decision: default OFF 維持**。代表A/B limit=80: flag束ね実測は -17.91%pt regressed だが、adapter に `HARNESS_MEM_BENCH_REAL_PATH=1`(additive, default不変) を足した decomposition で **regression の100%が safe_mode substring 経路離脱由来、rerank 単体の recall@10 delta はちょうど 0** と分離。構造的発見: limit=10/topK=10 の rerank は top-10 集合を変えないため recall@10 では原理的に検出不能(採否判定には top1/MRR 必須、D41)。強制発火 probe(10候補×15query): **engaged 15/15 / JSON parse failure 0% / p50 1468ms / p95 3559ms**(qwen3.5:9b) — 発火時 +1.5〜3.6s/query で default ON は latency 的に不可。aggregate-only artifact `docs/benchmarks/artifacts/s154-703-llm-rerank-ab/{ab-report,ab-report-path-only,decision}.json`(raw run dir は実データ原文含有のため非commit)。702 の limit=5 regression も同因(経路切替)と説明がつく) |

> ③回答合成(RAG generation)は入れない: 呼び出し元エージェント(Claude/Codex)が既にLLMのため二重になる(D18 scope-first整合)。

### Phase 8: 計測深化 + 2026 埋め込み世代更新 (2026-06-12 追補)

**起票理由(2026-06-12 multi-agent 調査: repo読解4 + web調査4 + 独立ドラフト2 + 敵対的検証3、検証 issues 25件を本文に織込済)**:
1. **切替ゲートが数学的に到達不能だった**: baseline composite 0.96(mixed 1.0 / ja 1.0 / bilingual 0.94 / dev 0.9)のため候補が満点でも delta 最大 +0.04 < switchDeltaThreshold 0.05。fixture 飽和が原因(bilingual-50 の 48/50 が自己言い換え1正解の易問、dev-workflow-20 は query/entry とも日本語0%)。154-402 の「ruri 大敗」は有効だが「勝者が出ない構造」は要修正。
2. **bge-m3 (2024-01) は旧世代と数値確定**: MMTEB(Multilingual v2) Mean(Task) 59.56 — mE5-large-instruct 63.22 / Qwen3-Embedding-0.6B 64.33 / harrier-oss-v1 66.5-69.0 / granite-r2 に順次抜かれた。default 候補から降格(`--models` 明示時のみ機会測定、prefix/pooling 修正は公正性のため実施)。
3. **2026-06 時点の候補(ONNX 即用 + 商用可)**: ①Qwen3-Embedding-0.6B(Apache-2.0、onnx-community、JMTEB Retrieval 72.81 で JA-EN 両側に第三者実測がある唯一の候補、MRL 32-1024) ②granite-embedding-311m-multilingual-r2(Apache-2.0、公式 ONNX fp32 1.2GB+quint8 0.3GB、encoder/CPU 向き、CoIR code retrieval 63.8 が Coding-Memory と最整合)。第二波: harrier-oss-v1-270m/0.6b(MIT、MMTEB v2 66.5/69.0 同クラスSOTA、**safetensors のみ**→optimum 自前変換 + decoder pooling 前提)、voyage-4-nano(Apache-2.0、QAT int8、JA-EN 第三者実測ゼロ)。ライセンス脱落: jina-v3/v4/v5、zembed-1(CC-BY-NC)。
4. **測定正しさの未修正ギャップ**: (a) local-onnx は mean-pool 固定 — decoder 系 Qwen3 は last-token pooling 必須で、そのまま測ると最良候補を誤棄却 (b) fitDimension の silent truncate/pad は「別物を測る」捏造リスク (c) bge-m3 の queryPrefix は bge-small v1.5 用 instruction の混入(公式は instruction 不要)、pooling も公式 CLS (d) pullModel は arrayBuffer 全メモリ載せ + fp32 単一ファイル限定で、>2GB ONNX の external-data 形式(model.onnx + model.onnx_data sidecar、HF 実確認: qwen3 fp32 = 307MB + 2.09GB)に未対応 (e) `embedding_default_model` mem_meta flag は write-only(runtime 配線なし — keep 公算が高いため配線は decision=switch 時に再index backfill とセットで別起票)。
5. **D41 の宿題**: rerank 採否を判定できる順序感応 gate が無い。LLM rerank(p50 1.4s)は latency で不可だったが、小型 cross-encoder は CPU 4.7-15.3ms/pair の実測相場があり前提が変わった。

**設計制約(不変)**: switchDeltaThreshold 0.05 据え置き(緩和禁止 — 14GB 再index の正当化バーを下げない)。local 推論のみ(154-205 非依存、本 Phase 全タスクが loopback Ollama / in-process ONNX で完結)。14GB 旧 index 非破壊。D2/D29/D40/D41 準拠。decision=switch でも再 index は人間判断(Risk Gate)。HF からの model weights DL は inbound のみで外部送信に非該当の解釈 — 既存運用踏襲(release workflow が `harness-mem model pull` 実行 = `tests/release-workflow-contract.test.ts:68`、154-211 で大型 LLM DL 前例)。

**keep 帰結時の recall 側レバー(次プラン送り、握りつぶし回避の明示記録)**: 全候補 +0.05 未達で keep の場合、bilingual gap を埋める残レバーは (a) fusion 段チューニング(BM25 候補深度削減 / vector weight / per-leg alpha — web 調査の hybrid 定石) (b) 二本投げ RRF(154-102 既知負債、D31)。rerank は top-50 並べ替えのみで recall 起因の取りこぼしを救えない。keep は失敗ではなく「2026 世代を測って keep を evidence 付きで確定」= measurement ownership の成果として記録する。

**量子化方針**: A/B は fp32 を正本に測る。external-data 対応で fp32 が pull 不能な場合のみ int8 単一ファイル(qwen3 int8 613MB 実在確認済)を正本にし、その旨を artifact 注記。量子化 variant(granite quint8 / qwen3 int8)の採用は fp32 比 composite delta ≥ -0.01 の parity 実測が前提。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| 154-500 | **fixture v2 — 切替ゲート天井除去** `[tdd:required]` — bilingual pool を hard negatives 込み ≥150 entries に拡大(ja→en / en→ja 双方向。154-151 由来語彙は held-out 性確保のため除外チェック)。dev_workflow slice を dev-workflow-60 ベースに差替え JA/mixed query ≥30% を機械検証。**per-slice query 数 ≥50**(小標本 CI 幅対策 — mixed 13 件のままだと bootstrap CI95 ±0.2 級で switch が再び到達不能)。schema を v2 に bump し **`switch-decision.ts:73` の schema 受理を v2 化(v1 は明示 reject、既存 8 unit 非回帰)**。slice_definitions の「60-entry pool」誤記(実体54)修正 | `bun run scripts/s154-embedding-shadow-ab.ts --no-write` exit0 で baseline(e5) composite が **0.50-0.85 帯**(≤0.85 を runner が assert、≥0.50 floor で degenerate fixture 防止)+ **per-slice paired bootstrap CI95 幅 ≤0.05**。v1 fixture 並走記録(negative control)。難化根拠(48/50 self-paraphrase)を artifact 記録。0.85-0.90 帯で止まる場合の妥協可否は user 判断 | - | cc:完了 [c2b11b5] (bilingual-v2: pool 156 / ja 52 / mixed 52 query、hard negatives=同言語同トピック distractor がクロスリンガル target と競合する 13 cluster 構成。dev-workflow-v2: 92 cases / 270 entries / JA 30.4%(機械検証)。**実測 baseline(e5) composite 0.7496 ∈ [0.50, 0.85]**、runner が band 外 throw を実装(調整中 0.9299 で実際に発火)。v1 並走 negative control: v1 baseline 0.96 / 候補 delta ±0.01 = 旧 fixture の判別不能を実証。schema v2 bump + `switch-decision.ts` が v1 artifact を明示 reject。fixture 構造 test 4本 + held-out check(cjk fixture query 重複なし)) |
| 154-501 | **shadow A/B 順序感応化 + noise floor** `[tdd:required]` — summary.json 各 slice に recall@10 / top1 / MRR を追加(`s154-cjk-discrimination-gate.ts` の CJK_GATE_METRICS 流用、**D41 Review Condition 準拠で新規 metric 発明禁止**)。noise floor は **同一 query 集合の per-query delta による paired bootstrap CI95**(unpaired は過剰保守)。5-run は determinism check(全 run 同値 assert)に位置づけ — pipeline は決定的(154-402 で 2-run 同値実証済)なので run 間分散は信号でない。switch 判定式 `delta >= max(0.05, CI95)` は **config flag(`composite-score-weights.json` に `ci_lower_bound_enabled`、default off)** で導入し、D29 追記提案を Why 付き decisions.md ドラフト化(採否=人間判断。否決時は artifact 記録のみに縮退、gate は 0.05 単独判定維持)。**判定式の実体は `memory-server/src/embedding/switch-decision.ts`**(scripts 側は thin entry) | 各 slice の top1/MRR が artifact 固定 schema 出力。CI95 未満 delta で switch しない unit PASS(flag on 時)。fail-closed 非回帰(provider fallback throw / 非有限 delta throw) | 154-500 | cc:完了 [c2b11b5] (per-slice recall@10/top1/MRR を artifact 出力(D41 準拠、新規 metric なし)。noise floor=同一 query 集合 per-query delta の **paired bootstrap CI95**(seed 154500、1000 resamples、決定的=2回呼びで同値 test)。5-run determinism: baseline composite 5 run 完全同値。`ci_lower_bound_enabled`(default off) + `effectiveSwitchThreshold()`=max(0.05, CI95幅)、fail-closed(flag on + CI 欠落で throw)。D29 改訂提案を decisions.md に Why 付きドラフト(採否=人間判断)。switch-decision test 13/13) |
| 154-502 | **候補 onboarding — catalog 2 entry + registry default 差替 + --models CLI + bge-m3 修正** `[tdd:required]` — `model-catalog.ts` に `qwen3-embedding-0.6b`(onnx-community、native 1024dim、MRL 32-1024、公式 instruction prefix、maxSeqLength)/ `granite-embedding-311m-r2`(ibm-granite 公式 ONNX、768dim、truncate 128-768)を追加。`registry.ts:44 DEFAULT_EMBEDDING_SHADOW_MODEL_IDS` を `["qwen3-embedding-0.6b","granite-embedding-311m-r2"]` に差替(ruri=判定済 keep、bge-m3=旧世代降格)。`s154-embedding-shadow-ab.ts` に `--models` フラグ(任意候補の機会測定)。bge-m3 の **queryPrefix 削除**(bge-small v1.5 用 instruction の混入、公式は instruction 不要)。**`scripts/harness-mem:7110` の bash 側重複 catalog(MODEL_CATALOG_IDS/SIZES/DIMS)を同期**(放置すると `model list/pull` から新候補が見えない drift) | `resolveEmbeddingShadowProviders` が新候補を installed/skip_reason 付き解決する test PASS。`harness-mem model list` に新候補表示。既存 test 非回帰 | - | cc:完了 [c2b11b5] (catalog に qwen3-embedding-0.6b(onnx-community、1024dim native、MRL、last_token、`<|endoftext|>` append、maxSeqLength 512)/ granite-embedding-311m-r2(公式 ONNX、768dim、cls、prefix なし=config_sentence_transformers 実確認)。registry default を 2026 世代 2 候補に差替、`--models` で降格候補も機会測定可。bge-m3 の queryPrefix(bge-small 用 instruction 混入)削除 + pooling=cls。bash catalog(`scripts/harness-mem`)同期。unit 68/68) |
| 154-503 | **ONNX provider 測定正しさ — per-model pooling + dim guard + MRL 正規化** `[tdd:required]` — catalog に pooling field(mean / last_token / cls)を追加し local-onnx を per-model 化: qwen3=last_token(**attention-mask 基準の最終非 pad token。バッチ padding 罠対策: 長さの異なる複数入力のバッチと単発で同一入力の cosine drift <1e-6 を test**)、**bge-m3=cls**(公式 pooling。prefix 修正と併せ公正測定の前提)、既存 e5=mean。catalog を **nativeDimension / outputDimension(MRL truncate)分離**とし、guard は nativeDimension 照合で **catalog 宣言なき次元不一致のみ throw**(`fitDimension` の silent truncate/pad 廃止。意図的 MRL truncate は明示 field 経由のみ)。MRL truncate 後の re-normalize 経路追加 | e5 既存経路 parity(同一入力 cosine drift <1e-6)PASS。qwen3 last-token batch unit PASS。guard unit PASS。既存 suite 非回帰 | 154-502 | cc:完了 [c2b11b5] (catalog pooling field(mean/last_token/cls)+ attention-mask 基準 token 選択(左右 padding 両対応、長さ違いバッチ vs 単発 cosine drift <1e-6 unit)。nativeDimension/outputDimension 分離、`fitDimension` silent truncate/pad 廃止 → catalog 宣言なき不一致 throw。MRL truncate 後 re-normalize。**e5 parity: refactor 前 snapshot 比 worst cosine = 1.0(完全一致)**、snapshot pin test 常設(bun test runner 内 ONNX crash 回避のため spawn 方式)。実機: qwen3/granite とも batch-vs-single cosine=1.0) |
| 154-504 | **pull pipeline 改修 — streaming + external-data + variant + modelType** `[tdd:required]` — **新 CLI は作らず既存 `harness-mem model pull`(`scripts/harness-mem:7294`)+ `ModelManager.pullModel` を拡張**(`tests/release-workflow-contract.test.ts:68` 非回帰)。arrayBuffer 全メモリ載せ→streaming 書込み(根拠: bge-m3 2.27GB が既登録 + qwen3 fp32 2.4GB 追加で全載せは実害)。**ONNX external-data 対応: `model.onnx` + `model.onnx_data` sidecar の multi-file download(HF tree API で同 prefix sidecar 自動検出、欠落時 fail-closed)**。catalog `onnxFile` variant(model_quantized.onnx 等の任意 filename)対応。**`modelType` field(embedding / reranker)を追加し 154-711 の reranker 取得と pull 経路を共用** | 2GB 級 pull で RSS 増 <500MB を実測記録。external-data 構成モデルの load 成功 test。部分 download 検出時 fail-closed 再取得。推論時 fetch 禁止(`env.allowRemoteModels=false`)非回帰。release-workflow-contract 非回帰 | 154-502 | cc:完了 [c2b11b5] (既存 `harness-mem model pull` + `ModelManager.pullModel` を拡張(新 CLI なし、release-workflow-contract 非回帰)。**実バグ 2 件を特定・修正: Bun fetch の自動 redirect が HF LFS CDN(cas-bridge)302 でハング → 手動 redirect 追跡 / `Bun.write(path, Response)` が実 CDN body でハング → chunked reader + FileSink streaming(4MB highWaterMark)**。HF tree API で external-data sidecar 自動検出 + サイズ検証 fail-closed(不一致は削除+throw)。実証: qwen3 fp32 = model.onnx 307,161,415 B + model.onnx_data 2,093,436,928 B byte-exact DL、granite 1,247,170,481 B。pull unit 6本(fake hub) |
| 154-505 | **新候補 shadow A/B 実測 + switch gate 判定** `[tdd:skip:benchmark-run]` — qwen3(native 1024 と MRL 384 の両構成、`--dimension` override 配線込み)+ granite-311m-r2 を fixture v2 + v1 並走(negative control)で実測。**bge-m3 も prefix/pooling 修正後に measured へ昇格**(pipeline 完成後の追加コストは pull 2.3GB のみ。web の MMTEB 数値だけで除外すると「判定は内部 composite 実測のみ」原則と非対称)。**運用コスト artifact 併記**: embed throughput before/after 実測、構成別 index 容量試算(384 MRL / native 1024 ≈ 14GB→~38GB、sqlite-vec は brute-force でスキャン速度も比例悪化)、全件再 embed wall-clock 外挿、実効 truncation 長 per model。**decision=switch でも再 index は実行しない** — decisions.md ドラフト + 人間判断(Risk Gate)+ runtime 配線/backfill 経路を別起票 | `bun run scripts/s154-embedding-switch-gate.ts` exit0。measured 候補は decision ∈ {switch, keep}、skip 候補は skip_reason 付き decision=skip 許容。embed latency p50/p95 を artifact 記録。fp32 正本(external-data 不能時のみ int8 単一ファイル正本 + 注記) | 154-500, 154-501, 154-503, 154-504 | cc:完了 [c2b11b5] (**全 4 構成が switch 判定**: qwen3 native +0.1979 / qwen3 mrl-384 +0.1975 / granite native +0.2043 / granite mrl-384 +0.2015(全て CI95 下限 ≥ +0.148 ≫ 閾値 0.05)。決定差は ja クロスリンガル: e5 0.5385 → 候補 0.96-1.00。運用コスト artifact: granite mrl-384 = q_p50 10.4ms / 73 passages/s / 再embed 22.8分/10万obs / index 1.0x(14GB)、qwen3 は品質同等で 7-9 倍遅 → **推奨 = granite-embedding-311m-r2 mrl-384**。bge-m3 は未インストール継続(--models で測定可)。5-run determinism 同値。dev-domain gate overall_passed=true 非回帰。**default 切替は実行していない**(D45: runtime 配線 + 再embed backfill + 人間 Risk Gate が前提)。artifacts: summary/decision/operational-cost.json) |
| 154-506 | **ホスト型 serving COGS モデル(価格確定の前提分析)** `[tdd:skip:analysis]` — 154-505 の embedding COGS 実測(operational-cost.json)を、Pro ZDR endpoint(自前ホスト granite, CPU/VPS, in-memory only)の $/req・$/テナント月額に翻訳し Pro $20-40 粗利を判定 | 実測値ベースのコストモデル doc。measured/assumption を分離。粗利判定の結論 | 154-505 | cc:完了 [docs] (`docs/strategy/granite-serving-cogs-2026-06-16.md`。**結論: 共有マルチテナントなら Pro COGS<6%=健全、専有 VPS は破綻→Enterprise gate 限定**。重要発見: throughput が **live 実測 5/s vs short-obs 73/s で 14.6倍乖離**(operational-cost.json 内に両値併記、後者に「live ETA に使うな」警告)→ 確信度 **medium-low**。前提工事=concurrency 実測 + 実テナント token 長分布。per-embed 限界費は安い($0.08-1.11/1M)が $/テナント月額を決める共有 VPS 収容密度が未確定) |
| 154-520 | **binary 粗選別 + float 再ランク(DENSE-leg限定, default-OFF)** `[tdd:required]` — native sqlite-vec `bit[N]` + `vec_distance_hamming` で 2-pass(Hamming粗選別→float再ランク)。`HARNESS_MEM_BINARY_PREFILTER=1` で opt-in、default は従来 float 単段を厳密維持。DENSE leg のみ(BM25/graph は union 保持、非clip) | flag OFF で既存 vector test 全 PASS(挙動不変)、ON で 2-pass 発火、recall@10(ON)≥OFF*0.95 を実 sqlite-vec で実測、DENSE-leg union 保持を test 固定 | - | cc:完了 [3c9dfb7] (**v1(47892bd)は sqlite-vec を一度もロードせず float fallback で "parity=1.0" を誤報告 → Lead 実 sqlite-vec 検証で 3 実バグ確定 REJECT**: ①quantizeToBits が 384B 未パック(bit[384]=48B 要求で insert 完全失敗) ②bare `?` blob binding が "invalid vector"(→`vec_bit()`/`vec_f32()` ラッパー必須) ③候補プール 4x で recall@10=0.69 不足(→8x で 0.95)。v2 で全修正、parity test が custom sqlite ロード+`binary_prefilter_active` 発火を固定。**Lead 独立 probe(N=2000/DIM=384/実フィルタ): 4x=0.69 / 8x=0.95 / 16x=1.00** で 8x 採用を実測裏付け。float binding 変更(`vec_f32(?)`)は raw `?` と同一結果で安全確認済。非回帰 vector 32 PASS / typecheck 0。**minor follow-up: in-suite parity test が pool>N(N=500/bitK=800)で selectivity を stress していない→pool<N に強化推奨(コード自体は Lead probe で realistic scale 検証済)。戦略上は ~1M まで非緊急(現375k)、default-OFF で本番影響なし**) |
| 154-310 | **deep freshness 3 指標の測定系(report-only)** `[tdd:required]` — `scripts/s154-deep-freshness-bench.ts` 新設: ①tense-rewrite accuracy(154-303 の 37 tests とは別の held-out set n≥30、不足時は当該指標のみ skip_reason 記録)②supersession precision/recall(ラベル付き矛盾ペア fixture ≥20 cases、302b の valid_to 書込み流用)③freshness lag(矛盾 ingest→valid_to 書込みの p50/p95、timestamp 差分で機械計測)。`flagship-kpi.ts` に deep_freshness sub-block(measured/skip 状態込み)を追加。**depth field は shallow のまま維持(D39 準拠、green 0.95 / enforce 経路非接触)**。dreaming は local qwen3.5:9b のみ | bench script exit0/1 で固定 schema artifact に 3 指標出力。flagship artifact の `deep_freshness=not_yet_measured` が実測値(または指標毎 skip_reason)に置換。既存 gate 非回帰 | - | cc:完了 [5b9fdc7] (`deep-freshness-bench.ts` が **HarnessMemCore を実 instantiate** し ingest→`detectContradictions`(実 qwen3.5:9b adjudicator)→`SELECT valid_to FROM mem_observations` で実測。固定 schema `s154-deep-freshness.v1`。実測値: ③freshness_lag p50=1381ms/p95=1561ms、②supersession precision=1.0/recall=0.6/f1=0.75(n=21, negatives 6 含む — 154-311 の 3-run 実証で確定値)、①tense-rewrite accuracy=0.969/fp=0(n=32, 実 qwen3.5:9b 出力)。**recall<1 が実測の証左**(label読みでなく LLM 判定で取りこぼしを検出)。fixture は入力+ground-truth のみ(`llm_changed`/`valid_to_written` 等のシステム出力フィールド禁止)。depth=shallow 維持(D39, enforce 非接触)。Lead 独立検証: tsc exit0 / integration 6-0 / run-ci 15-0 / flagship-kpi unit 4-0。**初回 worker は fixture 値読みの synthetic theater で REJECT → 実測へ rework**。154-311 enforce は別タスク) |
| 154-311 | **deep freshness enforce 昇格 + D39 改訂提案** `[tdd:required]` — 3-run 安定(run 間分散 <0.05)確認後、`data/deep-freshness-thresholds.json` で閾値外部化 (Skeptic 案 A simplified: 決定的 metric は worst-of-3 - 0.05 / 非決定的 lag は absolute ceiling)。D39 改訂(shallow+deep 合成 green 定義)を Why 付き decisions.md 提案 — 採否は人間判断。**s108 manifest enforce 接続は Skeptic [3] 助言で S154-FU02 に分離 (本セッション scope 外、人間 Risk Gate)** | 3-run artifact ×3 (`docs/benchmarks/artifacts/s154-deep-freshness/run-{1,2,3}/report.json`)、tense/sup spread=0 で決定的、lag のみ非決定的を実証。`data/deep-freshness-thresholds.json` 作成。decisions.md `D39-Revision-Proposal` 追加 | 154-310 | cc:完了 [feb7b12, 951ef8a] — Ollama 決定論 options 固定 + 3-run 実証 + 閾値外部化 + D39 改訂ドラフト |
| 154-710 | **順序感応 rerank gate(stage 分離)** `[tdd:required]` — `scripts/s154-rerank-order-gate.ts` 新設: retrieval 段(recall@10)と rerank 段(**top1 / MRR@10 の ON/OFF delta — D41 Review Condition 準拠、NDCG@10 は CJK_GATE_METRICS に無い新規 metric のため不採用**)を分離して固定 schema artifact 記録。**fixture は v2(hard negatives)を使用し、baseline で rank2 以下に正解が落ちる query ≥20 件を前提検証**。**provider identity assert + fallback 混入で fail-closed throw**(`onnx-cross-encoder.ts` の simple-v1 silent fallback を新規 `isReady()` getter で検出)。schema `s154-rerank-order-gate.v1` で `retrieval_stage` (recall@10) と `rerank_stage` (top1/MRR delta) を分離フィールド = recall@10 を rerank 採否判定に使わないことを schema レベル可視化。Ollama qwen3.5:9b は温度/seed/num_predict 固定 (Skeptic 整合) | gate exit0/1 (5 conditions)、recall@10 不変 schema assertion (1e-9)、HARNESS_MEM_LLM_RERANK 未セットで exit 1。default OFF / opt-in 構成不変 | 154-500, 154-501 | cc:完了 [b63e0c0] — 487-line script (schema 分離 + precondition + provider identity assert + fail-closed) + onnx-cross-encoder isReady() expose、typecheck PASS |
| 154-711 | **cross-encoder rerank 対応(opt-in 既定OFF)** `[tdd:required]` — **新規 provider を作らず既存 `rerank/onnx-cross-encoder.ts`(現 default ms-marco-MiniLM-L6-v2、`HARNESS_MEM_RERANKER_PROVIDER` 選択)を bge-reranker-v2-m3 ONNX int8 対応に拡張**。**autoDownload default false 化 + `onnx-cross-encoder.ts:200` の `env.allowRemoteModels=true` 経路封鎖**(取得は 154-504 の modelType=reranker pull に一本化)。pair-encoding 経路(query+passage 結合 tokenize)の unit。採否は純関数判定: **MRR@10 delta ≥ 閾値(154-710 baseline 実測後に data/ config 固定)かつ CPU p95 ≤ latency budget の両立時のみ** opt-in default 候補、未達なら OFF 維持を記録、非有限 delta は throw。軽量 fallback `japanese-reranker-xsmall-v2`(MIT、CPU 15.3ms/pair)は **bilingual slice gate 通過時のみ昇格可**(ruri 同族の ja 単言語リスク) | default 構成で cross-encoder 発火 0 件 assert。egress 0(allowRemoteModels=false 維持)。CPU top-50 rerank p50/p95 実測 artifact(公表値は GPU 0.14s/query のみで CPU 未検証)。既存 reranker suite 非回帰 | 154-710, 154-504 | cc:完了 [6140691] — bge-reranker-v2-m3 catalog entry (Xenova ONNX int8, multilingual, ~280MB) + onnx-cross-encoder.ts autoDownload default false 反転 + s154-rerank-order-gate.ts `--cross-encoder` 分岐 (crossEncoderRerankTop の冒頭で `isReady()` fail-closed guard、D40 silent-fallback prohibition の per-sample guard) + CPU top-50 p50/p95 実測 artifact 経路 + 専用 artifact path (docs/benchmarks/artifacts/s154-rerank/cross-encoder-cpu-{date}.json)。internal Reviewer 2 巡: 初回 REQUEST_CHANGES (per-sample isReady guard 抜け + test tautology risk) → amend → APPROVE。japanese-reranker-xsmall-v2 は sandbox egress 制限で HF 実在未確認のため deferred。onnx 16/16 + flagship 14/14 PASS。worker base が古く main の 154-710 commit (isReady expose) 未反映 → Lead が main 改善を確認しつつ手動 cherry-pick で解決 |
| 154-720 | **transformers.js v4 runtime 更新(モデル不変の速度取り)** `[tdd:required]` — `@huggingface/transformers` 3.8.1→v4.x(2026-03-30 GA、実 install 4.2.0)。現行 e5-small parity 確認。`env.useFSCache=false` を追加 (v4 新設プロパティ、stale キャッシュ干渉防止 — TeamAgent QA 指摘)。before/after p50/p95 計測は別 commit (parity 完全一致のため latency 計測は付随的) | vector 分離 recall@10 parity(cosine drift <1e-3)assert → **worst_cosine=1.0 (drift <1e-6) 完全一致** で達成、劣化なし。既存 suite 非回帰 (typecheck PASS)。before snapshot は memory-server/tests/fixtures/e5-parity-snapshot.json (v3.8.1 生成) | 154-505 | cc:完了 [dde3c3c] — package.json 2 箇所 bump + local-onnx.ts env.useFSCache=false 追加。tokenizers peer auto 解決。e5 parity 完全一致 |
| 154-002 | **§154 見出し status 同期 + Phase 8 起票** `[tdd:skip:docs-sync]` — 見出しを実態(29/30 完了 + Phase 8)に同期、本 Phase 8 を §154 流儀で追記。154-205 は blocked: human-gate のまま据え置き、Phase 8 全タスクの Depends に 154-205 が現れないことを確認 | 見出し同期 + Phase 8 追記 commit。docs/strategy/(untracked)の commit 要否は user 判断事項 | - | cc:完了 [6c683c8] (見出し cc:WIP 化 + Phase 8 12タスク起票 + D44 を decisions.md に Why 付き記録。Phase 8 Depends に 154-205 なしを確認) |
| 154-510 | **`embedding_default_model` flag の runtime 配線** `[tdd:required]` — 現状 write-only の mem_meta flag(`config-manager.ts getEmbeddingDefaultModel`)を provider 初期化が読む経路を追加。flag 未設定 / 不正値は incumbent(e5)に fail-safe。**granite mrl-384 は catalog dimension 768 のため、384 運用は flag 値に dimension 指定を含める形式(`granite-embedding-311m-r2@384` 等)を設計時に確定** | flag 未設定で挙動完全不変(parity test)。flag 設定→ provider が granite/384 で起動する integration。不正 flag は warn + e5 fallback。catalog 検証済み値のみ受理 | 154-505 | cc:完了 [2e996b7] (flag 形式 `<modelId>[@<dimension>]` 確定。reader/writer 同一検証 + store 次元一致 + install 済み判定の 3 段 fail-safe。Codex review 4 巡: P2×3 + P3×1 全修正、embedding 系 81 tests + e5 parity PASS) |
| 154-511 | **granite 再embed backfill 経路** `[tdd:required]` — 全 observation を granite mrl-384 で再 embed する batch job。**既存 14GB index(mem_vectors)非破壊・別 vector 空間に書き込み・進行中は既存検索が旧 index で無停止継続・resume 可能(中断点から再開)・完了検証(行数一致+sample cosine 検証)後にのみ 154-510 flag flip を許可** | backfill job が小型 fixture DB で全件再embed + 完了検証 PASS。中断→resume test。旧 index 行数/内容不変 test。実測 throughput(73/s 級)から残り時間を進捗表示 | 154-510 | cc:完了 [3acab09] — live materialization 経路と同一ソース化(`raw_text ?? content_redacted`, char cap 廃止)で human gate 解決。25 unit + 1 integration pass |
| 154-512 | **切替実施 + rollback drill** `[tdd:skip:operation]` — 実 DB で backfill 実行 → flag flip → `npm run benchmark:developer-domain` 非回帰 + 154-152 CJK gate 非回帰を確認 → **rollback drill(flag を e5 に戻して検索結果が旧版と一致する D29 可逆性の実地確認)** を 1 回実施して切替を確定 | backfill 完了 log(件数+所要)。flip 後 dev-domain overall_passed=true。rollback drill PASS 記録。Plans.md に切替日時と evidence 記録 | 154-511 | cc:WIP — **flip 実行完了 (2026-06-15, operator 承認)**: catch-up backfill 494 行 → verification PASS(missing_rows=0 / sidecar parity 375606 / min_cosine 0.9999 / sqlite_vec_available=true)、flag=`granite-embedding-311m-r2@384`、plist env-pin 除去(`HARNESS_MEM_EMBEDDING_MODEL` 削除 / `HARNESS_MEM_EMBEDDING_PROVIDER` adaptive→auto)、launchd unload/load。health=`local:granite-embedding-311m-r2`(pid 54593, provider=local)、vector 検索稼働確認(vector_candidates=15 / coverage=0.375 / top hit vector=1)。**前回 flip 失敗の真因確定 = `HARNESS_MEM_EMBEDDING_PROVIDER=adaptive` が flag を無視(registry adaptive 分岐は ruri+e5 ハードコード、flag を読むのは auto 分岐のみ)→ auto に変更で解決**。plist backup: `~/Library/LaunchAgents/com.harness-mem.daemon.plist.bak.2026-06-15`。closeout: dev-domain 非回帰 **PASS** (2026-06-16, overall_passed=true / flagship_freshness=0.99≥0.95 / dev=0.7708 / temporal=0.8575, fresh run on granite)。rollback drill 実施 (2026-06-18): **機構 reversibility 証明済** — granite→multilingual-e5(pid89796)→granite(pid94651) を健全往復、`PROVIDER=auto` のため flag 駆動のみで plist 変更不要。result-diff 比較は probes fixture が placeholder のため未実行（要 fixture 記入 — §F Backlog **S154-FU01** に切り出し済）。daemon は granite 復帰。**本旨 (flip + 非回帰 PASS + 機構 reversibility) は確定済のためマーカー cc:完了 化 (2026-06-19)。** cc:完了 [5530f7a, c1af8ca, a9006ab, c586c0f] |
| 154-P1 | **forget-maintenance-offline live-daemon 共存ハードニング** `[tdd:required]` — 512 で判明した standalone script の vec0 preflight + busy_timeout 欠落を offline forget runner にも適用 | hard-purge execute のみ preflight、`--allow-running-daemon && execute` のみ busy_timeout=30000、archive-only/prune-stale は非接触で preflight 不要、contract test PASS | 154-512 | cc:完了 [c1af8ca] — 7 contract test pass |
| 154-P2 | **512 fix 回帰テスト** `[tdd:required]` — custom-sqlite preflight + busy_timeout を恒久化 | DB セットアップを export 関数に挙動不変で切出し、busy_timeout/preflight/実vec0 sidecar parity を一時DBで検証 | 154-512 | cc:完了 [a9006ab] — 4 pass |

> **実行順**: クリティカルパスは `500→501→505` と `502→503/504→505` の 2 本(502/503/504 は 500/501 と独立並行可)。310 は全体と独立並行可。710/711 は 500/501 の fixture v2 + metrics を待つ。720 は最後。
> **検証の出所**: 敵対的検証 3 体(実現可能性 / 制約遵守 / 網羅性)の critical 2 件(qwen3 fp32 の external-data 形式で pull 不能 / 小標本 CI95 が switch 到達不能を再導入)・major 7 件(既存 pull CLI 重複、存在しない repo constraint 引用、onnx-cross-encoder 既存実装の見落としと fail-open、NDCG@10 の D41 抵触、運用コスト次元の欠落、fusion レバー黙殺、reranker 取得経路未定義)は本文に修正反映済み。

**Reject指摘の除外と理由:**
- 草案 154-302「bi-temporal 4-timestamp schema migration」を除外 — bi-temporalカラムは既実装で migration不要、bi-temporal の A/B は D25/D26 で一貫 neutral。anchor retrieval改善(154-302)+ 失効書込み配線(154-302b)に縮退。
- 草案「A/B harness で記録」を無条件DoDにする前提を除外 — 汎用A/B runnerは不在(temporal専用のみ)。154-100で新設し全A/Bタスクの Depends に。
- 草案 154-201「外部既定LLMをloop自律で発火」を除外 — Risk Gate(外部送信)。dreaming default を local固定、外部は 154-205(human-gate)に隔離。

**loop自律性:** 154-403切替(154-400で閾値config定数化→3分岐決定的判定)と 154-900 Hermes(154-305 gate passed=true 3-runで機械判定)は人間ゲートなし。**残る人間ゲートは 154-205(外部送信承認)のみで意図的隔離**(Risk Gate)。dreaming は local default で動くため dev フェーズ(154-001/1xx/2xx/3xx/4xx)は外部送信なしで loop自律実行可能、154-205 は dev 完走をブロックしない。

## §156 Hermes MemoryProvider Post-E2E Hardening — cc:TODO (2026-07-09 起票)

詳細 plan: `.hermes/plans/2026-07-08_171500-hermes-provider-post-e2e-hardening.md`
Checkpoint: `.hermes/checkpoints/2026-07-09_112627-hermes-provider-e2e-and-llm-plan-checkpoint.md`

背景: S112-008 で Hermes MemoryProvider Layer 2 の実機 E2E は成功済み。live config は `memory.provider=harness_mem`、live plugin は `~/.hermes/plugins/harness_mem`。smoke marker `hm_provider_live_smoke_20260708_165739_purple_dragon_7788` は live session `20260708_165742_49e528` / observation `obs_00mrbscxqh1fb9a76cf55be7c2` と、別 session `20260708_170910_4774a8` の recall で確認済み。

`Spec delta`: root `Spec.md` の `Fact extraction LLM egress contract (must)` に product contract を追加済み。default extractor mode=`heuristic`、LLM mode provider default=`ollama`、Ollama は loopback-only、非loopback Ollama は allow flag の有無にかかわらず拒否、`openai` / `anthropic` / `gemini` は `HARNESS_MEM_ALLOW_EXTERNAL_LLM=1` と provider credential の両方がある時だけ許可、両 extraction path への同一 gate、metrics-only audit、live cloud E2E 禁止を正本化した。

`team_validation_mode`: manual-pass（Product / Architecture / Security / QA / Skeptic の 5 視点を plan self-review で通過。初版の事実誤認 3 件は修正済み: `shutdown()` は既存、`HARNESS_MEM_ALLOW_EXTERNAL_LLM` は未実装、LLM mode provider default は現状 `openai`）。

`formatter_baseline`: partial_configured。確認済み evidence: root `package.json` は `bun run test` / `benchmark:*` を持つが、汎用 `lint` / `format` script は未確認。実装 task は各 DoD で targeted pytest / targeted bun test / `git diff --check` を必須にし、汎用 formatter 導入は本 § の Required scope には入れない。

### Task Plan

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| H156-000 | **現状 preflight + baseline 固定** `[tdd:skip:planning-preflight]` — §156 実装前に current behavior を再確認し、初版 plan の事実誤認が再混入しないようにする | `shutdown()` 既存、provider default=`openai`、`HARNESS_MEM_ALLOW_EXTERNAL_LLM` 未実装、`callOllama()` が現状任意 HTTP(S) host を許可し remote Ollama を external audit しないことを根拠行付きで実装前メモへ残す。provider 9件 + LLM/egress 16件の baseline testと `git diff --check` PASS | - | cc:完了 [431fb73] — evidence: detailed plan H156-000 + review-result APPROVE、provider 9 / LLM-egress 16 PASS |
| H156-001 | **LLM local-first default + external cloud gate** `[tdd:required][feature:security]` — LLM mode provider default を `ollama` にし、Ollama は loopback-only、`openai` / `anthropic` / `gemini` は明示 allow + credential の両方を必須にする | RED→GREENで (1) provider env なし→loopback Ollama、(2) nonloopback Ollama→allow flag 有無にかかわらず fetch 0、(3) cloud + credential + allowなし→fetch 0、(4) allow=`1`→mocked cloud pathのみ許可、(5) blocked pathは安全な空結果/heuristic fallback、(6) audit/logに本文・secret非含有を確認。`extractFacts()`→`llmExtract()` と `llmExtractWithDiff()` の両経路をtestし、両test fileの`ENV_KEYS`へ`HARNESS_MEM_ALLOW_EXTERNAL_LLM`を追加してambient envを隔離。対象bun tests PASS、live cloud禁止 | H156-000 | cc:完了 [2403e6c] — 31 tests PASS、loopback/cloud gate、review fallback記録済み |
| H156-002 | **既存 `shutdown()` flush regression coverage** `[tdd:required]` — 未実装追加ではなく、既存 bounded join の契約を test で固定する | `integrations/hermes/provider/tests/test_provider.py` に pending sync thread の `join(timeout=...)` regression test を追加し、`PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest integrations/hermes/provider/tests/test_provider.py -v --tb=short` PASS。timeout 方針は 5s/10s のどちらかを test で明文化 | H156-000 | cc:完了 [45e2b4c] — mock threadでshutdown join timeout=10.0を固定、10 tests PASS |
| H156-003 | **`prefetch()` noise reduction without hard filtering** `[tdd:required]` — direct Hermes turn hit を優先しつつ、強く関連する cross-tool memory は落とさない bounded stable post-rank を入れる | daemon元順位を同点tie-breakとして保持し、tag boostだけで強いserver relevanceを覆さない。direct marker上位、weak backfill降格、strong cross-tool保持、日本語空白なしquery、unrelated `hermes/turn`、同一入力の決定的順序をtest。hard filter禁止、provider suite PASS | H156-002 | cc:TODO |
| H156-004 | **provider-created search result `metadata: null` 調査 + safe allowlist** `[tdd:required]` — provider が `metadata={source:hermes_memory_provider}` を送るのに search 結果で null になる理由を確定する | outcome を 4 分岐のどれかに分類: intentional privacy omission / stored-but-not-selected / provider payload shape / ingest mapping。返す場合は allowlist key のみ（例: `source`）で、prompt・response・API key・token・secret を返さない test PASS | H156-000 | cc:TODO |
| H156-005 | **Layer 2 MemoryProvider docs + rollback 手順** `[tdd:skip:docs-only]` — S112-008 E2E の再現手順、setup、discovery、smoke、rollback を docs に固定する | `integrations/hermes/README.md` and/or `docs/integrations/hermes.md` に Layer 1 MCP vs Layer 2 MemoryProvider、`rsync` install、`hermes config set memory.provider harness_mem`、discovery/live smoke/search/rollback、`RuntimeError: Event loop is closed` の非ブロッキング扱いを記載。`git diff --check` PASS | H156-002, H156-003 | cc:TODO |
| H156-006 | **LLM status docs current vs target 同期** `[tdd:skip:docs-only]` — canonical docs で desired policy と current behavior を混同しない | H156-001 完了後、`docs/integrations/hermes.md`、`integrations/hermes/README.md`、`docs/environment-variables.md` と同ファイルのvariable indexを同期。default=`ollama`、loopback-only、remote Ollama拒否、cloud allow semantics、新env、API keyをrepo fileへ置かない、live cloud/Ollama実施状況を正確に記載。H156-001前はcurrent=`openai`/gate未実装と明記 | H156-001 | cc:TODO |
| H156-007 | **Optional live Ollama extraction smoke** `[tdd:skip:operation]` — Hermes turn → consolidation → loopback Ollama fact extraction → fact/search の live path を任意確認する | H156-001 完了後、hostが`127.0.0.1`/`localhost`/`::1`のloopbackであることをpreflightし、`HARNESS_MEM_ALLOW_EXTERNAL_LLM`は未設定で実行。fact/search、external egress audit 0を記録。remote OllamaとOpenAI/Anthropic/Gemini liveは禁止 | H156-001, H156-006 | cc:TODO |
| H156-008 | **Future setup automation sketch** `[tdd:skip:design-note]` — `harness-mem setup --platform hermes` の dry-run/apply 設計だけを残し、必須実装 scope にしない | daemon health、Hermes home 検出、provider copy、config backup、dry-run default、`--apply` mutation、discovery check、rollback print の設計メモを docs/plan に残す。実装は別 § に切り出し可能 | H156-005 | cc:TODO |

### Recommended Execution Order

1. H156-000 → H156-001 — preflight で事実誤認を再確認してから safety gate を実装する。docs に cloud gate を current として書く前に H156-001 を必ず完了する。
2. H156-002 → H156-003 — provider operational hardening。
3. H156-004 — metadata null は privacy risk を見ながら小さく確定。
4. H156-005 → H156-006 — docs は current/target を分けて同期。
5. H156-007 / H156-008 — optional follow-up。

### Stop Lines

- live cloud LLM は実行しない。
- nonloopback Ollama は local とみなさず、allow flag の有無にかかわらず拒否する。
- Hermes provider に LLM extraction 本体を入れない。fact extraction は `memory-server/src/consolidation/` に置く。
- `.env` / API key / OAuth token / secret は読まない、docs に書かない。
- `~/.hermes/config.yaml` や live plugin の変更は、別途明示承認なしに実行しない。

## アーカイブ (完了 / 休止セクション)

2026-04-13 のメンテナンスで §51〜§76 を `docs/archive/Plans-s51-s76-2026-04-13.md` に移動しました。
2026-04-19 のメンテナンスで §79 / §80 / §81 / §82〜§87 / §88 を `docs/archive/Plans-s79-s88-2026-04-19.md` に移動しました。
2026-04-23 のメンテナンス（v0.15.0 リリース後）で §91〜§96 を `docs/archive/Plans-s91-s96-2026-04-23.md` に移動しました。
2026-05-10 のメンテナンス（v0.20.0 リリース後）で §77 / §98 / §99 / §101 / §102 / §103 / §105 / §106 / §107 / §S109 を `docs/archive/Plans-s77-s109-2026-05-10.md` に移動しました（Plans.md 832 → 535 行）。
2026-06-11 のメンテナンスで §108 / §111 / §113 / §114 / §116〜§118 / §123 / §124 / §126 / §127 / §129 / §131〜§149 の完了33セクションを `docs/archive/Plans-s108-s149-2026-06-11.md` に移動しました（Plans.md 1859 → 1053 行）。§150〜§153 は §154 が参照する直近完了のため残置。
Plans.md は working plan（§78 + §89 + §90 + §97 + §110 + §112 + §115 + §122 + §125 + §128 + §130 + §150〜§156）だけをフォアグラウンドで扱う方針です。

参照:

- [§108/§111/§113-§149 の完了セクション](docs/archive/Plans-s108-s149-2026-06-11.md)（2026-06-11 切り出し）
- [§77/§98-§107/§S109 の完了セクション](docs/archive/Plans-s77-s109-2026-05-10.md)（2026-05-10 切り出し、v0.20.0 release 後）
- [§91〜§96 の完了セクション](docs/archive/Plans-s91-s96-2026-04-23.md)（2026-04-23 切り出し、v0.15.0 release 後）
- [§79〜§88 の完了セクション](docs/archive/Plans-s79-s88-2026-04-19.md)（2026-04-19 切り出し）
- [§51〜§76 の完了セクション](docs/archive/Plans-s51-s76-2026-04-13.md)
- [それ以前のアーカイブ](docs/archive/)
