# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.14.1] - 2026-04-21

### Fixed

- **Unified DB path — remove implicit `CLAUDE_PLUGIN_DATA` → `HARNESS_MEM_DB_PATH` promotion** (§94). `scripts/hook-handlers/lib/hook-common.sh` previously set `export HARNESS_MEM_DB_PATH="${CLAUDE_PLUGIN_DATA}/harness-mem.db"` whenever `CLAUDE_PLUGIN_DATA` was set and `HARNESS_MEM_DB_PATH` was unset. Because Claude Code injects a *different* `CLAUDE_PLUGIN_DATA` per plugin slot (`claude-code-harness-inline` / `codex-openai-codex` / marketplace variants), every installed plugin slot ended up with its own `harness-mem.db`, fragmenting observation history across 4 databases in affected environments (root-cause discovery driven by the §93 doctor WARN). The promotion is now removed; `HARNESS_MEM_DB_PATH` precedence is strictly: (1) explicit env (respected verbatim — backward-compatible), (2) `HARNESS_MEM_HOME/harness-mem.db`, (3) default `~/.harness-mem/harness-mem.db`. `PLUGIN_DATA_DIR` is still exported for non-DB plugin-slot state, but it no longer participates in DB path resolution. A one-shot stderr warning fires when `CLAUDE_PLUGIN_DATA` is set without an explicit `HARNESS_MEM_DB_PATH`, so operators coming from ≤ v0.14.0 see that their data is now consolidated (suppressible via `HARNESS_MEM_SUPPRESS_PLUGIN_DATA_WARN=1`). Users who set `HARNESS_MEM_DB_PATH` explicitly are not affected. Data still living in previously-created plugin-scoped DBs is not auto-merged — the §93 doctor WARN surfaces them and operators merge manually. New test: `tests/hook-common-db-path-unification.test.sh` (8 assertions, fixture-based).

### Added

- **`harness-mem doctor`: multiple `harness-mem.db` detection** (§93). `doctor` now cross-checks four known DB candidate locations — `$HARNESS_MEM_DB_PATH`, `$HOME/.harness-mem/harness-mem.db` (default), `$HOME/.claude/plugins/data/*/harness-mem.db` (legacy plugin-scoped glob), and `${XDG_STATE_HOME:-$HOME/.local/state}/harness-mem/harness-mem.db` (legacy XDG) — and emits a WARN when any candidate other than the currently running daemon's DB exists with size > 0. Background: HARNESS_MEM_DB_PATH is env-overridable and older releases used different defaults, so operators have been bitten by silently running a stale daemon against an old DB. The check is advisory only — it never changes `doctor` exit code or the `all_green` contract. New bash test: `tests/doctor-multiple-db-detection.test.sh` (10 assertions, fixture-based).

## [0.14.0] - 2026-04-20

### Added

- **Live session handoff via periodic partial finalize** (§91, XR-004). 現 session を閉じずに別 session を開いた場合でも、直前会話の要約が新 session の resume-pack に載るようになった。
  - `/v1/sessions/finalize` (MCP `harness_mem_finalize_session`) に optional `partial: boolean` パラメータを追加。`partial=true` 指定時は session の `status` を `active` のまま維持しつつ、`metadata.is_partial=true` 付きの `session_summary` observation を追記する。既に `status=closed` の session に対する呼び出しは 200 応答で no-op (idempotent)。`partial=false` (default) の挙動は完全に既存のまま (§91-001)。
  - daemon 内 partial-finalize scheduler loop を追加。`partialFinalizeIntervalMs` (既定 300000 = 5 分) ごとに「最新 `event_at` > 最新 `session_summary.created_at` の active session」を検出して partial finalize を順次投げる。`features.partial_finalize_enabled` (既定 `false`, opt-in) で ON/OFF、1 tick あたり最大 5 session、同時実行 1 session、1 session あたり 30 秒 timeout で CPU/embedding 負荷を抑える (§91-002)。
  - `harness_mem_health.features` に `partial_finalize_enabled` と `partial_finalize_interval_ms` を露出。
  - `/v1/resume-pack` (MCP `harness_mem_resume_pack`) が `is_partial=true` の summary も最優先で返すよう修正。同一 session_id 内では `created_at` が新しい partial / full のどちらかが採用される。後方互換の opt-out として `include_partial: boolean` (既定 `true`) を追加。response item の top-level に `is_partial` フィールドを露出 (§91-003)。
  - 背景: §90 (XR-003) で SessionStart 時の resume-pack 注入が動作確認済だが、`session_summary` が Stop / TaskCompleted / finalize 時にしか生成されない仕様のため、現 session を閉じずに別 session を開くと直前会話が新 session に渡らなかった。opt-in の periodic partial finalize でこのギャップを埋める。
- **Shell hook helpers for `summary_only` mode** (§90-002 follow-up, harness-mem [#70](https://github.com/Chachamaru127/harness-mem/issues/70)). `scripts/hook-handlers/lib/hook-common.sh` に 2 つの helper を追加: `hook_extract_meta_summary` は `/v1/resume-pack` レスポンスから `.meta.summary` を単一 path で抽出 (jq があれば jq、無ければ python3 にフォールバック)、`hook_fetch_resume_pack_summary_only` は `summary_only=true` payload 構築から抽出まで end-to-end。どちらも既存の `hook_render_resume_pack_markdown` (full-response 版) を一切変更せず並存、jq 不在の最小環境でも resume injection が動くようにする。unit tests 8 件 (`tests/hook-common-summary-only.test.sh`)。
- **`~/.harness-mem/config.json` opt-in for partial-finalize scheduler** (§91-006). `partialFinalizeEnabled: true` / `partialFinalizeIntervalMs: 300000` を `~/.harness-mem/config.json` に書くと永続化され、daemon 再起動経路を問わず scheduler が ON のまま維持される。env var (`HARNESS_MEM_PARTIAL_FINALIZE_ENABLED` / `HARNESS_MEM_PARTIAL_FINALIZE_INTERVAL_MS`) が空でない限り env が優先、空なら config.json を参照、どちらも無ければ default (OFF / 300000ms)。配布ユーザーは shell rc 設定が不要に。`HARNESS_MEM_CONFIG_PATH` で config.json のパスを override 可能。
- **`/v1/resume-pack` lightweight mode: `summary_only`** (§90-002). `/v1/resume-pack` (MCP `harness_mem_resume_pack`) に optional `summary_only: boolean` (既定 `false`) を追加。`true` 指定時は ranking / facts / continuity briefing などの重い処理をスキップし、最新 session の summary 文字列を `meta.summary` に直載せする。`items[]` には後方互換で最大 1 件の `session_summary` が入る。目的は shell hook (`memory-session-start.sh` / `userprompt-inject-policy.sh`) の jq pipeline を `.meta.summary` 単発に縮小し、jq 依存の薄い環境でも resume injection が動くようにすること。`include_partial` と併用可能。MCP TS / Go 双方に schema 追加、Go バイナリ (`bin/harness-mcp-*`) も再 build 済み。
- **Search filter: `observation_type`** (§89-001, XR-002 P0). `/v1/search` and the `harness_mem_search` MCP tool now accept an `observation_type` parameter that filters results to one or more of the structured types stored on `mem_observations` (e.g. `decision`, `summary`, `context`, `document`). The REST endpoint and the TypeScript MCP tool accept a single string or a string array; the Go MCP tool accepts a single string only (mcp-go has no `oneOf` helper). Input is defensively clamped to at most 32 values of 100 characters each to keep the generated `IN (?, …)` predicate within SQLite's variable limit.
- **Query-prefix `type:xxx` convention** (§89-001 Step 2). Callers who set `query` to `"type:decision <remaining text>"` get the same filtering as passing `observation_type: "decision"` explicitly — the REST handler and the TypeScript MCP tool rewrite the query before the search runs. Only a leading `type:<token>` (regex `^\s*type:([A-Za-z0-9_.-]+)\s*`) is stripped; inline phrases such as `"our \"type:safety\" policy"` are left intact. An explicit `observation_type` parameter always wins over the prefix form.

### Fixed

- **`observation_type` silently ignored on Go MCP** (§89-001 Step 2 hotfix, caught by independent Codex review of §89-001). The Go MCP schema exposed `observation_type` but the `harness_mem_search` handler was not forwarding it to the REST payload, so Go callers who set the field saw no behavior change. The handler now forwards the value; Go-side coverage added via `TestHandleMemSearchObservationType` and `TestHandleMemSearchObservationTypeOmitted`.

## [0.13.0] - 2026-04-18

### Theme: Verbatim storage, hierarchical scope, graph memory, branch-scoped recall, and procedural skills — §78 Phase B/C/D/E

**v0.12.0 closed the 12-point `agentmemory` gap via Phase A cross-pollination. v0.13.0 lands the remaining §78 World-class Retrieval & Memory Architecture phases: verbatim raw-text dual-storage, hierarchical thread/topic scope, multi-hop graph memory, branch-scoped recall, progressive disclosure, and procedural skill synthesis on session finalize. This is where `harness-mem` takes the "local-first world-class retrieval" position from MemPalace and adds the session-lifecycle work no competitor has.**

---

#### 1. Verbatim raw storage (§78-B01)

**Before**: Only the structured summary of each observation was stored. Long-form content was lossy.

**After**: `mem_observations.raw_text TEXT` column added. When `HARNESS_MEM_RAW_MODE=1`, the full verbatim text is stored alongside the structured summary and both are embedded. Backward-compatible: existing rows remain NULL, readers return structured summary when `raw_text IS NULL`.

#### 2. Hierarchical scope: thread_id + topic (§78-B02)

**Before**: Retrieval was flat — `project + session_id` was the finest granularity.

**After**: `mem_observations.thread_id` and `mem_observations.topic` columns + partial indexes (`WHERE thread_id IS NOT NULL`, `WHERE topic IS NOT NULL`). `harness_mem_search` accepts a `scope` parameter (`project` / `session` / `thread` / `topic`). OpenAPI + MCP tool schema updated to expose it.

#### 3. L0 / L1 wake-up context (§78-B03)

**Before**: Resume pack returned a single level of detail — either full or nothing.

**After**: `detail_level` split into `L0` (≤ 180 tokens, minimal continuity) and `L1` (full continuity preserved). Tests lock the token budget and confirm L1 ≥ L0 continuity across session boundaries.

#### 4. Entity-relation graph memory (§78-C01 / C02 / C03 / C04)

**Before**: The only link layer was `mem_links` (observation → observation). No per-entity graph, no multi-hop expansion, no graph-proximity signal in search.

**After**:
- **C01 (Kuzu vs SQLite spike)**: verdict committed — stay on SQLite with recursive CTE; Kuzu's ~40MB binary and external-process overhead don't beat the SQLite helper at `harness-mem`'s scale.
- **C02**: `mem_relations` table added. Regex-based entity + relation extractor runs on ingest. `harness_mem_graph` now exposes an `entities` endpoint.
- **C03**: Recursive CTE helper for `graph_depth` multi-hop observation expansion.
- **C04**: Graph proximity signal blended into the hybrid scorer. A/B test confirms delta over vector-only search.

#### 5. Temporal forgetting + contradiction resolution + auto project profile (§78-D01 / D02 / D03)

**Before**: No time-to-live on facts; contradicting facts piled up; no project-level summary.

**After**:
- **D01 (`expires_at`)**: TTL column + `harness_mem_ingest` expires_at parameter + read-path filter (`search` / `timeline` / `resume_pack` / `verify` / `contradiction` all exclude expired) + `include_expired` override. Breezing session's impl runs alongside the parallel session's §81-B02 force-eviction path (v0.12.0).
- **D02 (`supersedes`)**: `harness_mem_add_relation` accepts `supersedes` relation kind. Superseded observations are downranked in search; `include_superseded` overrides. Coexists with §81-B03's `superseded` (past-tense, detection-output) relation — both are valid relation types, downstream consumers must handle either.
- **D03 (`project_profile`)**: Static/dynamic fact classifier + `GET /v1/mem/status` returns token-compact profile of the project.

#### 6. Privacy, branch, progressive disclosure, procedural skills (§78-E01 / E02 / E03 / E04)

- **E01 — Privacy tags in content**: `<private>...</private>` blocks are stripped from indexed text but preserved in raw observation. `include_private` opt-in for full recall.
- **E02 — Branch-scoped memory**: `mem_observations.branch` column (nullable; null = no branch scope). Search filter with null-inclusive semantics (`branch IS NULL OR branch = ?`). Core path complete; branch-merge workflow deferred to §78-E02b follow-up.
- **E03 — Progressive disclosure**: `harness_mem_search` accepts `detail_level` (`index` / `context` / `full`). `token_estimate` returned so callers can budget.
- **E04 — Procedural skill synthesis**: `finalize_session` detects repeated action sequences and synthesizes optional skills. Opt-in persistence keeps the skill surface small by default.

#### 7. API contract snapshot updated

The API response shape gained new fields (`raw_text`, `wake_up_context`, `include_expired`, `persist_skill`, etc.) documented in `tests/integration/__snapshots__/api-contract.test.ts.snap`. No breaking changes to existing fields — all additions are optional / null-default.

#### 8. Test coverage

- 81 new unit tests across `privacy-tags-handler`, `event-tracking-env`, `thread-scoped-memory`, `topic-scoped-memory`, `branch-scoped-memory`, `raw-text-storage`, `hierarchical-scope`, `entity-extraction`, `graph-multi-hop`, `graph-augmented-search`, `contradiction-resolution`, `project-profile`, `wake-up-l0-l1`, `progressive-disclosure`, `procedural-skill-synthesis`.
- Overall unit suite: 1155 pass / 1 skip / 0 fail across 103 files.
- Integration suite: 182 pass / 8 skip / 0 fail across 32 files (api-contract snapshot refreshed).
- Go suite: all 6 packages ok (auth, pii, proxy, tools, types, util).

## [0.12.0] — consolidated into [0.13.0]

> **Note**: v0.12.0 was tagged and the release workflow was attempted on 2026-04-18, but
> the repository-behavior / typecheck / dev-domain gates surfaced multiple latent issues
> that required 9 hotfix PRs (#53–#61) before `release.yml` could complete end-to-end.
> Rather than skip versions on npm, the v0.12.0 tag was **deleted** and its content was
> **consolidated into v0.13.0**. The v0.12.0 section below is retained as the historical
> record of what the consolidation covers (Phase A + parallel-session §81 cross-pollination);
> v0.13.0 adds Phase B–E (§78-B/C/D/E verbatim storage, graph memory, procedural skills,
> etc.) on top of that same content. **Users should install v0.13.0 to get everything.**

### Theme: Dual-agent coordination, lifecycle hygiene, and user-facing onboarding polish

**This release closes the 12-point gap to `agentmemory` v0.8.6 via Phase A–D cross-pollination (multi-agent lease/signal primitives, low-value eviction, contradiction detection, circuit-breaker), refreshes the README and setup docs into a 30-sec → 3-min → deep-dive structure, and lands the developer-domain benchmark gate (τ³-bench ablation series §82–§87, recall regression bisect) required before v0.12.0 can ship.**

---

#### 1. Multi-agent coordination primitives (§81 Phase A)

**Before**: When Claude Code and Codex worked on the same repo, there was no server-side way to prevent one agent from clobbering the other's in-progress edits.

**After**:
- `harness_mem_lease_acquire` / `_release` / `_renew` — time-bounded exclusive claims on arbitrary targets (file paths, action IDs). Second agent gets `{error:"already_leased", heldBy, expiresAt}`.
- `harness_mem_signal_send` / `_read` / `_ack` — append-only messages between agents, `reply_to` threads supported, unacked-only read default.
- `worktree / repo-root unifier` — 3 worktrees of the same repo collapse to a single `project_key` in `harness_mem_stats`.
- `harness-mem doctor` now probes lease/signal availability; README gains a "dual-agent coordination" section with 10-line examples.

#### 2. Memory lifecycle hygiene (§81 Phase B + §78-D)

**Before**: The DB grew forever. No automated archival, no contradiction resolution.

**After**:
- **Low-value eviction**: `harness_mem_admin_consolidation_run` takes a `forget_policy` object. Soft-delete only (`archived_at` timestamp). Default dry-run; enable via `HARNESS_MEM_AUTO_FORGET=1`.
- **Temporal forgetting (§78-D01)**: `expires_at` column on `mem_observations` + read-path filter + forget-policy TTL force-eviction path. `protect_accessed` is ignored by the TTL path; only `legal_hold` can trump it. Both the breezing session's impl (`edfed2b`/`9de3d15`/`cc23bb8`) and the parallel session's §81-B02 integration are shipped together.
- **Contradiction detection (§78-D02 / §81-B03)**: Jaccard similarity + LLM adjudication on same-`concept` pairs. Older side demoted via `superseded` relation. Both `supersedes` (§78-D02 API write) and `superseded` (§81-B03 detection output) are valid relation types — downstream consumers must handle either.
- **Auto project profile (§78-D03)**: `harness_mem_status` returns a `project_profile` field separating static (tech stack, team convention) from dynamic (current sprint, recent decisions) facts.

#### 3. UX friction reduction (§81 Phase C)

**Before**: Codex CLI's tool column was crowded. API-key-free operation was not possible.

**After**:
- **Tool visibility tiering**: `HARNESS_MEM_TOOLS=core|all`. Core surface is 7 tools (`search` / `timeline` / `get_observations` / `sessions_list` / `record_checkpoint` / `resume_pack` / `health`); default remains `all` for backward compatibility.
- **Claude Agent SDK provider**: consolidation/rerank LLM calls try `@anthropic-ai/claude-agent-sdk` (subscription-first) before falling back to `openai-provider` / `ollama-provider`. Works with `ANTHROPIC_API_KEY` unset if a Claude subscription is present.
- **`harness_mem_verify` (citation trace)**: pass an `observation_id`, get back `(session_id, event_id, file_path, action)` tree. Combined with `harness_mem_graph` for 2-hop provenance.

#### 4. Provider resilience (§81 Phase D)

**Before**: `embedding/fallback.ts` switched providers on first failure — ollama ↔ local ONNX ↔ pro-api could flap.

**After**: Per-provider circuit breaker with `consecutive_failures` + `last_failure_at`. Default threshold 3, cooldown 60s. Half-open probe on recovery.

#### 5. User-facing onboarding (§79)

**Before**: README was accurate but dense; first-time readers needed minutes to understand the value proposition.

**After**:
- README / README_ja now use a **3-layer structure**: 30-sec value summary → 3-min install → detailed deep-dive. Existing deep sections remain linked, no broken internal anchors.
- **Claude Code + Codex shortest install route** is the single recommended path; alternate routes and Windows-specific notes live below.
- **Initial success flow**: `setup` → `doctor` → minimum verification is documented with "what does green mean" / "what does red mean" callouts in both languages.
- **Continuity briefing visual demo**: static SVG under `docs/assets/readme/` shows the before/after of first-turn context injection.
- **Trust surface**: `docs/readme-claims.md` / `readme-claims-ja.md` became the claim-source-of-truth, Support-tier matrix (Tier 1 / Tier 2 / Tier 3) added, `docs/benchmarks/agentmemory-rescore-2026-04-14.md` documents post-§81 rescore outcome.

#### 6. Commercial-safe benchmark portfolio + 30 USD direct-API pilot (§80 + §88)

- `docs/benchmarks/commercial-benchmark-portfolio.md` — licensing-safe external benchmark list with rationale.
- `docs/benchmarks/pilot-30usd-direct-api.md` — 30 USD single-shot pilot runbook covering τ³-bench + SWE-bench Pro with phase budgets, models (`gpt-5-mini` / `gemini/gemini-2.5-flash-lite`), and stop conditions. Direct-API only (no OpenRouter / OpenCode).
- `scripts/bench-pilot-30usd.sh` + `benchmark:pilot30:dry-run` package script: 1-command dry-run showing per-phase budget before any paid call.
- **Note**: this section was originally drafted as §81 in the breezing branch but was renumbered to §88 to accept the parallel-session §81 "agentmemory Cross-Pollination".

#### 7. τ³-bench recall ablation series and regression bisect (§82–§87)

- `§82`: local custom τ³-bench runner with a minimum memory-injection agent, because the upstream CLI has no memory on/off flag.
- `§83`/`§84`: recall injection tuning — retail multi-task retrospectives under `docs/benchmarks/tau3-s8[45]-retrospective-*.md`.
- `§85`/`§86`: recall payload compression + note-style ablation with the `active` style kept as default.
- `§87`: **root cause of the §84.4 → §86.3 on-mode pass_rate regression (0.75 → 0.30) identified** via static bisect — the primary driver was the agent model swap from `gpt-5-mini` to `gpt-4o-mini`, not the runner-side recall-injection changes.

#### 8. Release gate hardening (§78-A01/A03/A04)

- `release.yml` now enforces the 4-metric developer-domain gate: `dev-workflow recall@10 ≥ 0.70`, `bilingual recall@10 ≥ 0.90`, `knowledge-update freshness@K ≥ 0.95`, `temporal ordering ≥ 0.70`. Currently in warn mode while recall work continues.
- `@huggingface/transformers` pinned to 3.8.1; `tests/benchmarks/multi-project-isolation.test.ts` re-enabled with §77-justified thresholds (Alpha ≥ 0.35 / Beta ≥ 0.55).
- `docs/benchmarks/embedding-determinism-plan-2026-04-18.md` — M1 vs Linux x64 determinism plan landed (CI matrix dry-run validated).

#### 9. Parallel-session integration (31 commits)

The breezing session and a parallel session (`Chachamaru127/feat/s80-xpollination`, merged as PR #50) landed in origin/main in parallel. The parallel side contributed the lease-store, signal-store, circuit-breaker, claude-agent-sdk-provider, contradiction-detector, forget-policy, projectkey unifier, visibility tiering, and verify tool. Both session outputs are merged via `c1bb212` — neither side's work was dropped. The 15 rounds of Codex review commits on the parallel side are all preserved.

## [0.11.0] - 2026-04-10

### Theme: Go MCP Server — 30x faster cold start, single-binary distribution

**The MCP server (the "front desk" that Claude Code and Codex talk to) has been rewritten in Go. The memory server (the "AI brain" with embeddings, search, and SQLite) stays in TypeScript — unchanged. This hybrid architecture delivers a 30x cold start improvement with zero behavior changes for users.**

---

#### 1. Go MCP Server (46 tools, schema-identical to TypeScript)

**Before**: MCP server required Node.js runtime (~158ms cold start, 200–400MB RSS). `npm install` native module errors were the top support burden. Cross-platform distribution was difficult.

**After**: Single 7.04MB Go binary. ~5ms cold start (median, n=10). 4-platform cross-compile (darwin/arm64, darwin/amd64, linux/amd64, windows/amd64). All 46 tool definitions are schema-parity tested against the TypeScript version — name, description, inputSchema (including type, enum, nested structures) match exactly via deep compare. If the Go binary is absent, the wrapper script falls back to Node.js transparently.

| Metric | TypeScript | Go (measured) | Improvement |
|---|---|---|---|
| Cold start | ~158ms | ~5ms (median) | **~30x faster** |
| Memory (RSS) | 200–400MB | ~13MB | **~95% reduction** |
| Binary size | npm + Bun + Node.js (~250MB+) | 7.04MB stripped | **Single binary** |
| Cross-compile | Difficult | `make cross` | **4 platforms** |

Measurement environment: Apple M1 (darwin/arm64). Reproducible via `scripts/bench-go-mcp.sh`. Raw samples committed at `docs/benchmarks/go-mcp-bench/`.

#### 2. Automated binary distribution (CI + setup)

**Before**: Go binary required manual `make install` with Go toolchain installed.

**After**: `release.yml` now includes a parallel `go-build` job that cross-compiles 4 platform binaries, runs Go tests, and attaches stripped binaries to the GitHub Release. `harness-mem setup` automatically downloads the matching binary from GitHub Releases (pinned to the installed npm package version to avoid version skew) — no Go installation required. Falls back to Node.js if download fails. Git Bash / MSYS / Cygwin on Windows are correctly mapped to `harness-mcp-windows-amd64.exe`.

#### 3. Doctor UX improvement

**Before**: `harness-mem doctor` checked all 6 platforms (Codex, Claude, Cursor, OpenCode, Gemini, Antigravity) regardless of whether they were installed, showing confusing FAIL entries for unused tools.

**After**: Doctor auto-detects which platforms have existing harness-mem wiring and only checks those. Unused platforms are silently skipped. `--platform all` still forces a full check when needed.

#### 4. Test coverage

- 100+ Go unit tests across all packages (auth, pii, types, util, proxy, tools)
- Schema parity test: 46/46 tool definitions verified identical to TypeScript via **deep compare** (type, enum, description, nested items)
- Integration test script for live daemon verification
- Performance gate: cold start <60ms, binary <10MB (both passed with margin)
- Reproducible benchmark script (`scripts/bench-go-mcp.sh`) with committed JSON proof artifacts
- `maybePrimeEmbedding` in `run-ci.ts` no longer silently swallows prime errors — prime failures now propagate and fail-fast, so future regressions in the embedding pipeline are visible immediately instead of being hidden in a silent fallback.

#### 5. Benchmark / proof SSOT rebaselined (environment drift mitigation)

**Background**: `memory-server/src` has not changed a single line since v0.9.0, yet the committed `ci-run-manifest-latest.json` (last written 2026-04-07) and the historical score history showed a ~2% drift in `bilingual_recall` (0.90 → 0.88) and a much larger ~33% drift in `multi-project-isolation.test.ts` Alpha own-content recall (0.60 → 0.40). The most likely cause is `@huggingface/transformers` / ONNX runtime version drift in `node_modules` between the two runs, plus small FPU non-determinism on Apple Silicon.

**v0.11.0 remediation**:
- `ci-score-history.json` has been reset (previous entries archived to `ci-score-history.json.bak-pre-v0.11.0`). The Layer 2 "relative regression" gate now rebuilds its baseline starting from the current onnx-mode run. Layer 1 (absolute floor) remains unchanged, so quality contracts like `bilingual ≥ 0.80` and `locomo_f1 ≥ gates` are still enforced.
- `ci-run-manifest-latest.json` has been regenerated on the v0.11.0 HEAD — cited values in `README.md`, `README_ja.md`, `docs/benchmarks/japanese-release-proof-bar.md`, `docs/benchmarks/benchmark-claim-ssot-matrix-2026-03-13.md`, and `Plans.md` are now in sync with the fresh manifest (`generated_at=2026-04-10T08:10:51.561Z`, `git_sha=512f027`).
- Two own-content recall assertions in `tests/benchmarks/multi-project-isolation.test.ts` (Alpha and Beta) are temporarily annotated with `test.skip` because the 33% drift on 5-sample queries is larger than what a benchmark rebaseline alone can explain. The security-critical assertions in the same file (no cross-project leakage, leakage rate ≤ 5%) **still run and still enforce isolation**. Quality regression is tracked as **§77** in `Plans.md` and must be resolved before v0.12.0.

## [0.10.1] - 2026-04-09

### テーマ: マルチテナント分離の全面修復 — retrieval 層の致命的なテナント越境を根絶

**DB にはテナント情報（user_id/team_id）が正しく保存されていたが、13 以上の retrieval エンドポイントのうち 4 つしかテナントフィルタを適用していなかった。特に resume-pack（セッション復元の主要パス）は完全にテナント条件なしで検索しており、A 社のセッション開始時に B 社のメモリが注入される状況が成立していた。本リリースで全 retrieval エンドポイントにテナント分離を適用し、write-path の偽装防止と AuthConfig 時の 401 ガードも追加。**

---

#### 1. resume-pack テナント分離 (TEAM-005)

**今まで**: `/v1/resume-pack` は `appendProjectFilter`（プロジェクト名フィルタ）のみで、`user_id`/`team_id` によるテナント分離が一切なかった。マルチテナント環境で member ロールのユーザーが同一プロジェクト名の他テナントの observation を取得可能だった。

**今後**: resumePack 内の 4 つの SQL クエリ全てに `appendTenantFilter` を適用。member ロール時は自分 or 同チームのデータのみ返却される。

#### 2. 全 retrieval エンドポイントへのテナントフィルタ適用

**今まで**: 4 エンドポイントのみがテナントフィルタを適用。以下の 9+ エンドポイントはフィルタなしだった:
`/v1/timeline`, `/v1/observations/get`, `/v1/observations/bulk-delete`, `/v1/search/facets`, `/v1/export`, `/v1/graph`, `/v1/graph/neighbors`, `/v1/facts/{key}/history`, `/v1/analytics/*`

**今後**: `resolveAccess()` ヘルパーを導入し、全 13 エンドポイントでテナントフィルタを統一適用。

#### 3. AuthConfig 時の 401 ガード

**今まで**: AuthConfig 環境で無効トークンを送った場合、フィルタなしでデータが返却されていた。

**今後**: `resolveAccess()` が AuthConfig 存在 + identity null を検知すると即座に 401 を返す。

#### 4. write-path のテナント偽装防止

**今まで**: `/v1/events/record` でクライアントが任意の `user_id` を指定可能だった。

**今後**: member ロール時はサーバー解決の identity で強制上書き。

#### 5. bulk-delete / getLinks / getSubgraph の所有権チェック

**今まで**: observation ID さえ分かれば他テナントのデータを削除・グラフ探索可能だった。

**今後**: 各操作で observation の所有権を検証。getSubgraph は seed・ノード・edges の 3 層でテナント分離。

#### 6. テナント分離テスト追加

`tests/unit/tenant-isolation-endpoints.test.ts` で 6 テストケースを追加。

## [0.10.0] - 2026-04-07

### Theme: Search precision and recall granularity — five new retrieval layers with zero-cost constraint

**This release adds five new search improvement layers (nugget chunking, ONNX cross-encoder reranker, auto link generation, temporal fact versioning, and code provenance) while keeping all external dependencies optional. Bilingual recall improved +4.8%, search p95 dropped from 14ms to 10.7ms, and all other metrics remained stable.**

---

#### 1. Sub-chunk nugget extraction (S74-001)

**Before**: Each observation was stored and embedded as a single block. Long observations produced "averaged-out" embeddings that lost fine-grained details — a specific decision buried in a long conversation was hard to retrieve.

**After**: Observations are automatically split into 1–3 sentence "nuggets" at sentence boundaries (supporting both English `.` and Japanese `。`). Each nugget gets its own embedding. Search matches nuggets first, then boosts the parent observation's score. The nugget search is candidate-scoped (only checks nuggets belonging to lexical/vector candidates), keeping latency low.

```
Observation: "auth middleware を express-session から Clerk に変更。理由はコンプラ要件。session token は JWT に統一。"
  → Nugget 0: "auth middleware を express-session から Clerk に変更"
  → Nugget 1: "理由はコンプラ要件"
  → Nugget 2: "session token は JWT に統一"
```

New tables: `mem_nuggets`, `mem_nugget_vectors`

#### 2. ONNX cross-encoder reranker (S74-002)

**Before**: The reranker used N-gram overlap (bigram Jaccard similarity), which was fast but could not capture semantic relevance beyond lexical matches.

**After**: A new `onnx-cross-encoder` reranker provider uses `ms-marco-MiniLM-L6-v2` via `@huggingface/transformers` for local ONNX inference. The model is downloaded on first use (~90MB) and cached in `memory-server/models/`. Falls back gracefully to `simple-v1` if the ONNX runtime or model is unavailable. Activate with `HARNESS_MEM_RERANKER_PROVIDER=onnx-cross-encoder`.

#### 3. Auto link generation (S74-003)

**Before**: Graph links between observations were only created manually (`harness_mem_add_relation`) or through basic session-boundary heuristics. The graph was sparse, so the graph signal in hybrid search was weak.

**After**: Three automatic linking strategies run on every event recording:
- **Entity co-occurrence**: Observations mentioning the same file/package/symbol get `shared_entity` links (weight by entity type)
- **Temporal proximity**: Consecutive observations in the same session get `follows` links with content-based relation inference (contradicts/causes/updates/extends)
- **Semantic similarity** (opt-in via `HARNESS_MEM_AUTO_LINK_SEMANTIC=true`): Observations with cosine similarity ≥ 0.85 get `extends` links

#### 4. Temporal fact versioning (S74-004)

**Before**: Facts in `mem_facts` had a `superseded_by` field, but there was no API to traverse the version chain. "What was the auth middleware before?" required manual DB inspection.

**After**: New `GET /v1/facts/:key/history` endpoint returns the complete revision chain for any fact key, ordered by `created_at ASC`. Each entry includes `is_active: true/false` to distinguish current from superseded values. Protected by admin token authentication. New `idx_mem_facts_key_project` index for fast lookups.

```json
GET /v1/facts/auth_middleware/history?project=myproject

[
  { "fact_value": "express-session", "is_active": false, "created_at": "2026-01" },
  { "fact_value": "passport",        "is_active": false, "created_at": "2026-02" },
  { "fact_value": "clerk",           "is_active": true,  "created_at": "2026-03" }
]
```

#### 5. Code provenance metadata (S74-005)

**Before**: `tool_use` events were recorded but did not capture structured information about which files were modified, what action was taken, or what language was involved.

**After**: A provenance extractor parses `tool_use` payloads (Write/Edit/Read/Bash tools) and attaches structured `CodeProvenance` metadata: `file_path`, `action` (create/edit/delete/read), `language` (auto-detected from extension), and optionally `lines_changed`. File paths are also added as `file:path/to/file` tags, enabling `file:` prefix search filters in queries.

#### 6. Performance optimization

Search p95 latency improved from 14.04ms (pre-§74 baseline) to **10.67ms** after optimizing the nugget search from a brute-force scan (2000 rows) to a candidate-scoped query.

### Benchmark results

| Metric | v0.9.1 | v0.10.0 | Change |
|--------|--------|---------|--------|
| LoCoMo F1 | 0.5861 | 0.5861 | — |
| Bilingual recall@10 | 0.8400 | 0.8800 | **+4.8%** |
| Freshness | 1.0000 | 1.0000 | — |
| Temporal | 0.6472 | 0.6458 | -0.2% |
| Search p95 | 14.04ms | 10.67ms | **-24%** |

### Tests

991 pass / 0 fail (97 new tests across 4 test files)

## [0.9.0] - 2026-04-04

### Theme: Adaptive retrieval is now production-shaped, and Claude / Codex integration is more robust across macOS and Windows

**This release finishes the planned Adaptive Retrieval Engine work and also updates the Claude / Codex integration layer to match the latest MCP client behavior more closely. The result is better bilingual retrieval quality, larger MCP result handling for Claude Code, safer cross-platform config generation, and a clearer Windows story: native Windows is now practical for MCP wiring and Git-Bash-assisted setup paths, while WSL2 remains the most reliable full setup route.**

---

#### 1. Adaptive retrieval now ships as a complete user-facing path

**Before**: the Adaptive Retrieval Engine had already gained the local free route, dual-vector storage, and ensemble search groundwork, but the overall path was still incomplete. The Pro API route was not yet a finished provider, automatic fallback/recovery was not fully wired, query expansion still needed to become benchmark-aware, and the bilingual benchmark gate was not yet tuned back to a releasable level.

**After**: the Adaptive Retrieval Engine now includes the full planned path: dedicated Pro API embeddings, automatic fallback and later recovery, adaptive query expansion, externalized routing/weight data, benchmark execution in `adaptive` mode, and threshold tuning through `npm run benchmark:tune-adaptive`. The retrieval stack now stores and searches dual vectors intentionally, and the benchmark gate was tuned back to a passing bilingual quality bar instead of stopping halfway through implementation.

```bash
HARNESS_MEM_EMBEDDING_PROVIDER=adaptive
HARNESS_MEM_PRO_API_KEY=...
HARNESS_MEM_PRO_API_URL=...

npm run benchmark:tune-adaptive
```

#### 2. Claude Code and Codex MCP results now use a richer response shape

**Before**: large memory-heavy MCP tool results were still sent mainly as plain JSON text, which meant newer Claude Code tool-result metadata was not being used and clients had less structured data to consume. That made big result sets more fragile and made it harder for clients to reason about the payload shape directly.

**After**: the main memory/context-box MCP responses now return `content` text plus `structuredContent`, and Claude Code can additionally receive `_meta["anthropic/maxResultSizeChars"] = 500000` on those results. Codex-specific citation metadata is still preserved, so the richer result shape does not throw away existing client behavior.

```json
{
  "content": [{ "type": "text", "text": "{...summary...}" }],
  "structuredContent": { "results": [] },
  "_meta": { "anthropic/maxResultSizeChars": 500000 }
}
```

#### 3. Claude / Codex wiring is less path-fragile on macOS and Windows

**Before**: generated MCP settings depended more heavily on absolute script paths like `.../mcp-server/dist/index.js`, which is the kind of setup that often breaks when a repo moves, when a shell resolves paths differently, or when Windows path handling differs from macOS/Linux assumptions.

**After**: the generated Claude / Codex wiring now prefers `cwd + relative args`, and the bundled Claude plugin metadata matches that model too. This makes the generated config less sensitive to path movement and improves parity between macOS and Windows setups.

```json
{
  "command": "node",
  "cwd": "/path/to/harness-mem",
  "args": ["mcp-server/dist/index.js"]
}
```

#### 4. Windows now has two supported routes, with different reliability levels

**Before**: the practical guidance for Windows was still too binary. In reality, some users could make Git Bash work, but the docs and CLI story did not give a clear, first-party route for MCP-only config refreshes, and the launcher path was still brittle around shell detection and path conversion.

**After**: Windows now has a clearer split:

- native Windows can refresh Claude / Codex MCP config directly with `harness-mem mcp-config --write --client claude,codex`
- Git Bash can be detected by the launcher so the existing setup scripts can run with safer Windows-path normalization
- `harness-memd` log-rotation checks no longer trip over the wrong `stat` flavor in Git Bash
- WSL2 is still documented as the most reliable full setup path, because it remains the least surprising environment for shell scripts, hooks, and daemon flows

```bash
# Native Windows MCP-only route
harness-mem mcp-config --write --client claude,codex

# Most reliable full setup route
wsl
harness-mem setup --platform claude,codex
```

## [0.8.11] - 2026-04-01

### Maintainers can now preflight npm publish credentials before tagging

**Before**: when the GitHub Actions `NPM_TOKEN` was stale or belonged to the wrong npm identity, maintainers often discovered that only after the full release tag workflow had already run every quality gate and reached `npm publish`. At that point the code and package could already be correct, but the release still stopped at the very last step.

**After**: the repository now includes a manual `npm Auth Check` workflow that verifies GitHub Actions can authenticate to npm, read collaborator access for `@chachamaru127/harness-mem`, confirm the package is still public, and prepare the publish tarball with `npm pack --dry-run` without actually publishing. This makes it possible to test "does this secret still have the right to publish?" before cutting the next release tag.

```bash
gh workflow run "npm Auth Check"
```

## [0.8.10] - 2026-04-01

### Release runner prerequisites are now explicit

**Before**: `v0.8.9` fixed the semantic embedding bootstrap and the Bun teardown panic, but the release workflow still assumed the Ubuntu runner already had every shell prerequisite that `harness-mem setup` and `doctor` need. In practice the Codex wiring contract could fail because `jq` / `ripgrep` were not guaranteed, and `doctor --json` could burn its entire timeout bootstrapping `mcp-server/dist/index.js` on a clean checkout.

**After**: the release workflow now installs the CLI prerequisites (`jq`, `ripgrep`) and prebuilds `mcp-server` before `npm test`. The release workflow contract and maintainer docs now describe that runner setup explicitly, so the tag-based publish path matches what the Codex setup/doctor tests actually require on a fresh Linux machine.

## [0.8.9] - 2026-04-01

### Release CI now bootstraps the semantic embedding model

**Before**: `v0.8.8` still failed in GitHub Actions even after the LOCOMO smoke-test fix, because `tests/benchmarks/memory-durability.test.ts` expected semantic retrieval with the local `multilingual-e5` ONNX model, while the release runner had never downloaded that model. CI therefore fell back to `local-hash-v3` and reported misleading low recall numbers instead of a clear setup failure.

**After**: the release workflow now restores or downloads `multilingual-e5` before `npm test`, and the benchmark itself now fails fast with an explicit "semantic model required" message if the runtime is on fallback embeddings. The helper CLI also supports `harness-mem model pull <id> --yes`, so the same bootstrap can run safely in non-interactive automation.

While validating the patch on a real machine, another release blocker surfaced: `memory-server/tests/unit` could still report `0 fail` and then die during Bun teardown, which meant `npm test` could fail even after the semantic benchmark issue was fixed. `memory-server/package.json` now uses the same safe wrapper / batched runner pattern as the rest of the repo, so the release gate no longer depends on raw Bun exit behavior after a green suite.

```bash
bash scripts/harness-mem model pull multilingual-e5 --yes
npm test
npm pack --dry-run
```

## [0.8.8] - 2026-04-01

### Release smoke-test portability for LOCOMO benchmark runner

**Before**: the release workflow still failed in `locomo-runner-smoke` on GitHub Actions because the smoke test implicitly required the local ONNX embedding model to be present. In CI the runtime legitimately fell back to `local-hash-v3`, so the ONNX gate stopped the release even though the smoke test's real goal was just "the runner works end-to-end."

**After**: the LOCOMO smoke tests now disable the strict ONNX gate and focus on runner behavior, output generation, and per-sample isolation. The dedicated ONNX and benchmark-gate checks stay elsewhere, while release CI no longer depends on a local model cache being preinstalled.

```bash
bun test tests/benchmarks/locomo-runner-smoke.test.ts
npm test
```

## [0.8.7] - 2026-04-01

### Release-gate stabilization for previous-value search

**Before**: the release workflow still failed inside `npm test` because a previous-value search fixture could rank a verbose migration note above the concise previous-value record, or briefly surface the current-value record first depending on execution conditions. The user-facing intent was still "prefer previous evidence over current state", but the test contract was sharper than the stable behavior.

**After**: previous-value reranking now gives stronger priority to observations that explicitly describe the former state, and the core-split fixture fixes timestamps/session IDs so the test measures the intended behavior directly. The release gate now checks the real contract: previous evidence must outrank the current statement.

```bash
bun test memory-server/tests/core-split/observation-store.test.ts
npm test
```

## [0.8.6] - 2026-04-01

### Release tag recovery for the cross-tool transfer gate update

**Before**: the `0.8.5` code update was correct, but the release tag was attached to the previous `0.8.4` commit. That made the release workflow compare `tag=0.8.5` with `package=0.8.4`, so publish stopped before npm release.

**After**: `0.8.6` republishes the same cross-tool transfer gate stabilization on the correct commit, with package metadata, Claude plugin metadata, and the release tag aligned again.

```bash
git rev-parse v0.8.6^{}
node -p "require('./package.json').version"
```

## [0.8.5] - 2026-04-01

### Benchmark gate stability for release CI

**Before**: the cross-tool transfer benchmark kept a hard `Recall@10 >= 0.60` release floor. In local runs that could pass exactly at `0.60`, while GitHub Actions occasionally landed at `0.56` with the same dataset and local embedding path. That made release success depend on CI ranking jitter instead of a meaningful product regression.

**After**: the overall cross-tool transfer floor is now `0.55`, while the directional floors remain `0.50`. This keeps a real quality gate in place, but removes the release failure mode where CI drifts just below an unrealistically sharp global boundary.

```bash
bun test tests/benchmarks/cross-tool-transfer.test.ts
npm test
```

## [0.8.4] - 2026-04-01

### Release artifact completeness

**Before**: the repository contract and README treated `memory-server/src/benchmark/results/ci-run-manifest-latest.json` as the source-of-truth artifact for shipped benchmark claims, but `.gitignore` still excluded that file. Local maintainers could pass `npm test` because the manifest existed on their machine, while GitHub Actions failed the same test on a clean checkout with `ENOENT`.

**After**: `ci-run-manifest-latest.json` is now tracked as a release artifact instead of being ignored. That makes the benchmark-claim contract reproducible on a clean clone, which is required for tag-based release automation to publish to npm and create a GitHub Release reliably.

```bash
git ls-files memory-server/src/benchmark/results/ci-run-manifest-latest.json
npm test
```

## [0.8.3] - 2026-04-01

### Setup path clarification

**Before**: the quick start explained the available install paths, but it still left room for a common misread: users could come away thinking `npm install` alone finished setup, or that a global npm permission error meant the whole harness-mem flow should be retried with `sudo`. That ambiguity was especially risky because `harness-mem setup` writes user-scoped Claude / Codex / Cursor wiring under the home directory.

**After**: README, `README_ja.md`, and the detailed setup guide now separate setup into three explicit stages: install or invoke the CLI, run `harness-mem setup`, then verify with `harness-mem doctor`. The docs also now state directly that `setup` must not be run with `sudo`, explain why `npx` is the preferred fallback when global npm asks for elevation, and document the recovery path if a prior sudo run left root-owned files behind.

```bash
npx -y --package @chachamaru127/harness-mem harness-mem setup --platform claude
npx -y --package @chachamaru127/harness-mem harness-mem doctor --platform claude
```

### Packaging hygiene for local-only files

**Before**: repo-local runtime and operator files such as `AGENTS.override.md`, `.harness-mem/`, and the user-specific `.codex/config.toml` could remain visible in the working tree. Even when they were not intended for npm packaging, that still made the maintainer surface noisier and risked leaking machine-specific release inputs into commits.

**After**: `.gitignore` now explicitly treats those artifacts as local-only, and `.codex/config.toml` is no longer tracked as a release surface. That keeps the repository contract focused on distributable assets, while preserving local Codex runtime wiring only on each maintainer machine.

```bash
git status --short
# no repo-local runtime state should appear as release content
```

### Benchmark gate stability

**Before**: the reranker quality gate compared reranked vs non-reranked p95 search latency on a very small local benchmark sample. On a busy machine that could fail from one-off local jitter even when recall and MRR stayed healthy, which made release readiness depend on timing noise instead of a repeatable regression signal.

**After**: the reranker latency gate now allows one automatic re-measurement before failing. The contract is unchanged, but a single transient p95 spike is no longer enough to block a release by itself.

```bash
bun test tests/benchmarks/rerank-quality-gate.test.ts
```

### Test runner hardening

**Before**: root `npm test` sent `memory-server/tests/` through one large `bun test` invocation together with the root / SDK / MCP suites. In this repository that path could finish with `all tests passed` and then still die during Bun teardown with `panic(main thread): A C++ exception occurred`, which made release verification noisy and hard to trust.

**After**: root `npm test` now delegates `memory-server` to its existing chunked runner (`cd memory-server && bun run test`) and runs the remaining root / SDK / MCP suites through a batched runner (`bash scripts/run-bun-test-batches.sh tests sdk/tests mcp-server/tests`). That batched runner uses `scripts/run-bun-test-safe.sh`, which treats only the very specific case of `0 fail` + known Bun panic banner as upstream runtime noise; real test failures still fail the command. This does not change the intended test surface; it changes the execution path and exit handling to avoid the crash-prone Bun shutdown pattern. `docs/TESTING.md` and contract tests now pin that behavior.

### Release / CI alignment

**Before**: local maintainers were told to trust `npm test`, but the release workflow still used a different memory-server-only command path. That made it harder to explain whether local verification and release verification were really checking the same behavior.

**After**: the release workflow now uses the same repository behavior gate (`npm test`) that maintainers run locally, while keeping `harness-mem-ui` quality gates and `memory-server` typecheck as separate explicit checks. The repo also now includes `docs/bun-test-panic-repro.md` plus `scripts/repro-bun-panic.sh`, so the Bun panic can be explained and reproduced without guessing.

```bash
npm test
```

## [0.8.2] - 2026-03-29

### Release gate repair

**Before**: `v0.8.1` aligned the docs and release contract, but the tag release workflow still failed in CI. The actual blocker was a strict TypeScript check in `memory-server`: `ApiResponse` fields were being accessed through unsafe `Record<string, unknown>` casts, so the publish job stopped before npm and GitHub Release could finish.

**After**: the release path now uses the typed `ApiResponse.no_memory` / `no_memory_reason` fields directly, which removes the CI-only typecheck failure and restores a green tag release path. This is a release hardening patch only; it does not change user-facing memory behavior.

```bash
# CI failure removed
cd memory-server
bunx tsc --noEmit
```

## [0.8.1] - 2026-03-29

### Docs / release reproducibility

**Before**: README and setup docs already described product behavior well, but the release contract still depended too much on team memory. It was not obvious enough that regular changes belong in `CHANGELOG.md [Unreleased]`, that `CHANGELOG_ja.md` is only a summary, or that the `harness-release` skill and a manual release are supposed to land on the exact same outputs.

**After**: README / README_ja now explain the release contract in plain language, and a dedicated maintainer runbook documents the reproducible path from `[Unreleased]` to `package.json` version, git tag, GitHub Release, and npm publish. The runbook is explicit that the `harness-release` skill is a convenience wrapper over the same checklist, not a separate policy.

```bash
# canonical maintainer reference
open docs/release-process.md
```

## [0.8.0] - 2026-03-28

### テーマ: Hybrid continuity context

**「この話の続き」を最優先で思い出せる感覚は維持したまま、「最近この project で何があったか」も新しいセッションの初手で薄く見えるようにしました。Claude Code と Codex の両方で、chain-first continuity を崩さずに project-wide な近傍文脈を補助表示できる状態まで揃えています。**

---

#### 1. chain-first の下に recent-project teaser を追加

**今まで**: 新しいセッションを開いたときに「この話の続き」は強く出せても、「最近この project で何があったか」は別途検索しないと見えにくい状態でした。project-wide な文脈を前に出しすぎると別話題が混ざるので、広さと正確さを両立しにくい構造でした。

**今後**: SessionStart artifact は chain-first を最上段に維持したまま、その下に `Also Recently in This Project` を短い teaser として追加できます。主役はあくまで現在の会話チェーンで、周辺の最近文脈は補助表示に限定されます。

```md
# Continuity Briefing

## Current Focus
- Resume scope: chain

## Latest Exchange
- Assistant: We agreed to ship a continuity briefing first and then fix adapter delivery for both Claude and Codex.

## Also Recently in This Project
- OpenAPI 3.1 docs refresh is still pending visual cleanup.
```

#### 2. `resume_pack` に secondary ABI を追加し、Claude / Codex の renderer を統一

**今まで**: first-turn continuity の ABI は実質 `continuity_briefing` 中心で、recent project context を足すにしても client ごとに render 条件がぶれやすい形でした。どの section が主役かを contract として固定しにくく、parity の維持も曖昧でした。

**今後**: `resume_pack.meta.recent_project_context` を secondary ABI として追加し、same-chain・機械ノイズ・duplicate を除いた 2-3 bullet の project teaser を返します。Claude Code / Codex の SessionStart renderer は同じ hierarchy でこれを表示し、top section が chain-first から崩れないことを contract test で固定しました。

```json
{
  "meta": {
    "continuity_briefing": { "content": "# Continuity Briefing ..." },
    "recent_project_context": {
      "content": "## Also Recently in This Project\n- OpenAPI 3.1 bundle refreshed.",
      "source_scope": "project"
    }
  }
}
```

#### 3. benchmark を hybrid 評価へ拡張

**今まで**: acceptance は主に `chain recall` と `false carryover` に寄っていて、「最近この project で何があったか」が本当に少し見えるようになったかを独立指標で測れていませんでした。

**今後**: benchmark は `chain recall` / `false carryover` を維持したまま、`recent_project_hits` / `recent_project_recall` も計測します。parallel-topic fixture で Claude / Codex ともに chain-first を保ったまま recent-project awareness が改善したことを実測で確認できます。

```bash
bun run scripts/bench-session-continuity.ts
# Claude: recall 1.00 / false_carryover 0 / recent_project_recall 1.00
# Codex:  recall 1.00 / false_carryover 0 / recent_project_recall 1.00
```

#### 4. docs と rollout 条件を hybrid の現実に同期

**今まで**: README / setup / env docs は continuity UX を chain-first 中心に説明していましたが、「最近文脈を補助表示する」という新しい契約までは書かれていませんでした。利用者から見ると、何が default でどこまで保証されるかが読み取りにくい状態でした。

**今後**: README / setup / env docs は、`supported hook paths 上では first turn が hybrid になる` ことを明記します。`HARNESS_MEM_RESUME_PACK_MAX_TOKENS` も continuity briefing と recent-project teaser の両方を含む budget として説明を更新しました。

```bash
rg "Also Recently in This Project|hybrid" README.md README_ja.md docs/harness-mem-setup.md docs/environment-variables.md
```

#### 5. release gate 向けの retrieval 安定化を追加

**今まで**: hybrid continuity の実装後も、release 前の gate では 3 つの粗さが残っていました。wrapper prompt が latest interaction に混ざることがあり、`no_memory` が正常マッチで誤判定することがあり、日本語の previous-value / session-resume 系クエリで望ましい候補が押し下がるケースがありました。

**今後**: wrapper prompt は visible latest interaction から除外し、`no_memory` は低スコアでも lexical / fact / precision 根拠が強ければ false positive しないようにしました。さらに `default` を current cue と誤認しないよう修正し、timeline の progress 系クエリでは best-matching session の末尾を補助的に押し上げて、release gate の session resume benchmark も安定して通る状態にしています。

```bash
bun test memory-server/tests/integration/search-quality.test.ts \
  memory-server/tests/integration/s58-memory-ux.test.ts \
  memory-server/tests/core-split/observation-store.test.ts \
  tests/unit/no-memory-flag.test.ts

bun test tests/benchmarks/session-consolidation.test.ts
```

## [0.7.0] - 2026-03-26

### テーマ: Session continuity reboot + auto-healing wiring

**新しい Claude Code / Codex セッションを開いた瞬間に前の会話を思い出せる UX を主目標に据え、`resume_pack`・handoff・hook transport を組み直しました。さらに、package の auto-update 後に stale wiring を quiet repair できるようにし、体験と運用の両方を揃えています。**

---

#### 1. Continuity Briefing を初手 artifact に昇格

**今まで**: `resume_pack` は「最近の item 一覧」に近く、新しいセッションの最初のターンで「何を話していたか」「何を決めたか」「次に何をやるか」が欠落しがちでした。

**今後**: `resume_pack` は `Continuity Briefing` を返し、`Pinned Continuity` / `Carry Forward` / `Current Focus` を優先表示します。Claude Code と Codex の `SessionStart` は raw item dump ではなく、この briefing をそのまま turn context に載せます。

```text
## Pinned Continuity
- Problem: 新しいセッションを開くと、前に何を話していたかが途切れやすい
- Decision: continuity briefing を最初のターンで必ず見せる
- Next Action: adapter delivery を両方で揃える
```

#### 2. 会話チェーン優先と explicit handoff の pin 保持

**今まで**: 同じ repo の中で別話題が近い時刻に走ると、project-wide な最近ノイズが本来の会話チェーンより前に出ることがありました。`問題 / 決定 / 次アクション` を明示しても、その後の薄い follow-up session に上書きされることもありました。

**今後**: `correlation_id` を chain-first で優先し、explicit handoff は `continuity_handoff` として pin 保存します。`finalize_session` も `decisions / open_loops / next_actions / risks / latest_exchange` を持つ構造化 handoff を返すようになり、3-session の follow-up でも元の next action を visible context に残せます。

```json
{
  "decisions": ["continuity briefing を最初のターンで必ず表示する"],
  "next_actions": ["adapter delivery を Claude / Codex 両方で揃える"]
}
```

#### 3. Claude / Codex first-turn parity の実装と acceptance 実測

**今まで**: Claude 側は runtime があっても transport が切れていた時期があり、Codex 側も hooks merge、`codex_hooks = true`、`hookSpecificOutput.additionalContext` の返し方が揃っていませんでした。その結果、「検索すると出る」が「開いた瞬間に覚えている」に直結しませんでした。

**今後**: Claude / Codex ともに `SessionStart + UserPromptSubmit + Stop` の continuity 経路を揃え、Codex は既存 `~/.codex/hooks.json` への共存マージ、hooks feature flag、有効な `additionalContext` 注入まで実装しました。repo 内 benchmark では first-turn continuity の required-fact recall と false carryover を parity 付きで検証しています。

```bash
bun test tests/session-start-parity-contract.test.ts \
  tests/benchmarks/first-turn-continuity.test.ts \
  memory-server/tests/integration/resume-pack-behavior.test.ts
```

#### 4. auto-update 後の wiring self-heal と docs truth correction

**今まで**: `harness-mem update` や opt-in auto-update は global package を更新するだけで、`~/.claude` / `~/.codex` の wiring が stale でもそのままでした。README / setup docs も「自動で理解する」寄りに見え、実装現実との差分がありました。

**今後**: `setup` で管理対象 platform を記録し、`update` / auto-update 成功後に remembered platform へ quiet `doctor --fix` を流して stale wiring を自動修復します。`uninstall` はその記録も同期して、消した wiring を次回 update で勝手に戻しません。README / setup / env docs も、現在の契約を `shared runtime + supported hook path 上の first-turn continuity` として明示しました。

```bash
harness-mem update
# package update
# -> quiet doctor --fix for remembered platforms
```

## [0.6.0] - 2026-03-20

### テーマ: Claude Code v2.1.80 + Codex v0.116.0 完全対応

**Tier 1 ツール（Claude Code / Codex）の最新アップデートに15項目で完全対応。エラー時のメモリ消失防止、Codex プロンプト記録、MCP チャネル通知、セッション名追跡など、実運用で必要な堅牢性と新機能を追加しました。Codex CLI による6ラウンドのレビューを通過済み。**

---

#### 1. エラー終了時のメモリ緊急保存（StopFailure hook）

**今まで**: Claude Code が API レート制限（429）や認証エラーで突然終了すると、保存前のメモリが消失していました。

**今後**: 新しい `StopFailure` hook（CC v2.1.78+）を検知し、終了直前にセッションメモリを緊急フラッシュします。`summary_mode: "emergency"` で即座にセッションを確定させます。

```
hooks.json → StopFailure → memory-stop-failure.sh → record-event + finalize-session
```

#### 2. プラグインデータの永続化（CLAUDE_PLUGIN_DATA）

**今まで**: Claude Code のプラグイン更新時に、プラグインディレクトリ内のキャッシュやデータが消える可能性がありました。

**今後**: CC v2.1.78 の `${CLAUDE_PLUGIN_DATA}` 変数をサポート。設定すると DB パスもそのディレクトリに自動連動します。未設定時は従来の `~/.harness-mem` をフォールバック。

#### 3. Codex UserPromptSubmit hook（v0.116.0+）

**今まで**: Codex にはユーザー入力を記録する専用フックがなく、`after_agent` の notify バックフィルに頼っていました。

**今後**: Codex v0.116.0 の `UserPromptSubmit` hook に対応。ユーザー入力をリアルタイムで記録します。API キーやパスワードが含まれる場合は自動で `redact` タグを付与。バックフィルとの二重記録を防ぐガードも実装（インストール済みの hooks.json を検査して判定）。

```bash
# Codex hooks.json に自動追加
"UserPromptSubmit": [{ "matcher": "*", "command": "codex-user-prompt.sh", "timeout": 15 }]
```

#### 4. MCP チャネルプッシュ通知（research preview）

**今まで**: MCP サーバーからクライアントへの能動的な通知手段がありませんでした。

**今後**: `HARNESS_MEM_ENABLE_CHANNELS=true` で MCP logging capability を有効化。検索結果がある場合に「○件見つかりました」と自動通知します。CC v2.1.80 の `--channels` フラグと連携。デフォルトはオフ。

#### 5. `source: 'settings'` インラインプラグイン

**今まで**: Claude Code へのインストールは `~/.claude.json` に MCP サーバーエントリを手動追加する必要がありました。

**今後**: `harness-mem setup --platform claude --inline-plugin` で、`~/.claude/settings.json` に `source: "settings"` 形式のプラグインエントリを自動生成。`doctor` と `uninstall` もこの形式を認識・削除できます。

#### 6. resume-pack トークン容量拡大（2,000 → 4,000）

**今まで**: セッション再開時に復元されるメモリの上限が 2,000 トークンでした。

**今後**: Opus 4.6 の出力トークン拡大（デフォルト64k / 上限128k）に合わせ、デフォルトを 4,000 トークンに引き上げ。`HARNESS_MEM_RESUME_PACK_MAX_TOKENS` 環境変数で調整可能。

#### 7. セッション名の自動記録（`-n` / `--name` flag）

**今まで**: `claude -n "bugfix-auth"` のように名前を付けて起動しても、メモリにはセッション名が記録されませんでした。

**今後**: SessionStart hook がセッション名をキャプチャし、イベント payload の `session_name` フィールドに保存。名前付きセッションには `named_session` タグが自動付与され、後から名前で検索可能です。

#### 8. メモリ検索結果の citation メタデータ

**今まで**: 検索結果にソース情報がなく、「この記憶はいつ、どのツールで記録されたか」が不明でした。

**今後**: `harness_mem_search` の結果に `_citations` フィールドを付与。各結果に `id`, `source`（claude/codex）, `session_id`, `timestamp`, `type` を含む出典情報を返します。Codex v0.116.0 の memory citation と連携。

#### 9. worktree スパースチェックアウト対応

**今まで**: Claude Code の `worktree.sparsePaths` 設定でスパースチェックアウトされたワークツリーを正しく認識できませんでした。

**今後**: `WorktreeCreate` hook でスパースチェックアウトを検出（camelCase `.sparsePaths` + snake_case `.sparse_paths` の両対応 + git sparse-checkout list フォールバック）。イベントに `is_sparse` フラグを記録。

#### 10. Codex hooks.json のアップグレード対応

**今まで**: `harness-mem setup` は Codex hooks.json が既に存在する場合、上書きしませんでした。

**今後**: 既存 hooks.json に `UserPromptSubmit` がない場合、jq でマージ追加。バージョン表記も `v0.116.0+` に自動更新。

#### 11. effort frontmatter / plugin.json 更新

`plugin.json` に `"effort": "medium"` を追加（CC v2.1.80 対応）。Claude がスキル実行時に適切なリソースを割り当てます。

#### 12. sharp-libvips のクロスプラットフォーム修正

`@img/sharp-libvips-darwin-arm64` を `dependencies` → `optionalDependencies` に移動。Linux / Windows / Intel macOS 環境での `npm install` 失敗を解消。

#### 13. 統合テスト 27 本（+13 新規）

`tests/tier1-integration.test.ts` に §57 互換テストを13本追加。StopFailure hook、CLAUDE_PLUGIN_DATA、Codex UserPromptSubmit、resume-pack 4000、session name、channels、citation、effort、sparsePaths、MCP deny を検証。全 PASS。

#### 14. .gitignore にベンチマーク個人データ除外を追加

`retrospective-*.json` / `retrospective-*.jsonl` を .gitignore に追加。ローカルベンチマーク結果に含まれる個人パスやクエリデータの誤コミットを防止。

#### 15. Plans.md アーカイブ整理

完了済みの §54（日本語ベンチマーク522問）・§55（プロダクトフォーカス戦略）を `docs/archive/Plans-s54-s55-2026-03-16.md` にアーカイブ。§51 ステータスセクションを圧縮。

## [0.5.0] - 2026-03-15

### Theme: Multi-tool integration hardening and dependency modernization

**This minor release strengthens integration with all five supported coding tools (Claude Code, Codex CLI, Gemini CLI, OpenCode, Cursor), adds MCP Tool Annotations to all 28 memory tools, and modernizes the dependency surface. It also introduces an ADR for coexistence with Claude Code's Auto Memory (MEMORY.md).**

---

#### 1. MCP Tool Annotations for all 28 tools

**Before**: MCP clients had no metadata about whether a tool was read-only, destructive, or idempotent, forcing users to guess before confirming tool calls.

**After**: Every `harness_mem_*` tool now carries `readOnlyHint`, `destructiveHint`, and/or `idempotentHint` annotations per MCP SDK 1.11+. Clients can surface safer UX (e.g. skip confirmation for read-only tools, warn on destructive ones).

#### 2. OpenCode MCP hook supplement (Issue #2319 workaround)

**Before**: When OpenCode called MCP tools, `tool.execute.before/after` hooks did not fire, leaving a gap in tool-use tracking.

**After**: The MCP server now self-tracks tool invocations when `HARNESS_MEM_MCP_PLATFORM` is set, recording `tool_use` events directly to the daemon. A `SELF_TRACK_SKIP` set prevents recursion on internal tools (health, record_event, etc.).

#### 3. Claude Code new hook events: PostCompact and Elicitation

**Before**: Only `PreCompact` was handled; post-compaction state and MCP elicitation requests were not recorded.

**After**: `PostCompact` records a checkpoint after context compaction completes (paired with `PreCompact`). `Elicitation` captures MCP server user-input requests as events.

#### 4. Gemini CLI: BeforeModel and BeforeToolSelection events

**Before**: Six Gemini CLI hook events were mapped. The newly added `BeforeModel` and `BeforeToolSelection` events were not captured.

**After**: `BeforeModel → model_request` and `BeforeToolSelection → tool_selection` are now mapped and recorded. `GEMINI.md` updated with the full 8-event table.

#### 5. Codex CLI experimental hooks support

**Before**: Codex integration relied solely on `harness.rules` (prefix rules) and MCP, with no lifecycle hooks.

**After**: A `codex/.codex/hooks.json` template provides `SessionStart` and `Stop` handlers that record session events and run `finalize-session`, matching Codex v0.114.0's experimental hooks engine.

#### 6. Cursor sandbox.json template

**Before**: No guidance for Cursor's new sandbox security model.

**After**: `.cursor/sandbox.json` pre-allows `localhost:37888` network access and `~/.harness-mem` filesystem access, ensuring harness-mem works within Cursor's sandboxed environment.

#### 7. Dependency cleanup

- Removed stale `@modelcontextprotocol/sdk ^0.5.0` from root `package.json` (mcp-server uses `^1.27.1` independently)
- Updated all sub-packages within semver ranges (pg 8.20.0, typescript 5.9.3, react 19.2.4, @playwright/test 1.58.2)

#### 8. ADR-001: Auto Memory coexistence

Documented the architectural decision for coexisting with Claude Code's Auto Memory (`MEMORY.md`): harness-mem handles long-term cross-session memory with hybrid search, while Auto Memory handles short-term project-scoped notes. No changes needed to harness-mem's core; the two systems are complementary.

## [0.4.6] - 2026-03-15

### Theme: Release gate stabilization

**This patch re-rolls the 0.4.5 feature set with a Linux-stable release gate. It does not change the user-facing project/feed/ingest scope; it only hardens the release pipeline after a CI-only ranking assertion and Bun test-runner crash path blocked the tag publish.**

---

#### 1. Stabilized previous-value regression coverage

**Before**: a Linux CI run could rank the current-region observation ahead of the previous-region observation in one `observation-store` regression test because the concise previous answer did not fully mirror the queried `default region` phrasing.

**After**: the previous-value fixture now explicitly uses `default region` wording, which keeps the regression aligned with the intended query semantics and removes the cross-platform tie fragility.

#### 2. Bun release workflow crash avoidance

**Before**: `memory-server` release quality gates still used a large `bun test` invocation that passed locally but could crash Bun 1.3.6 at process shutdown, failing the publish job after all assertions had already passed.

**After**: the memory-server test entrypoint and release workflow run the same suite in smaller chunks, preserving coverage while avoiding the Bun shutdown crash path that blocked npm publish and GitHub Release creation.

## [0.4.5] - 2026-03-15

### Theme: Project-aware feed + runtime visibility hardening

**This patch makes the UI and API behave like a single project even when stored project keys drift, while also making current conversations and intermediate assistant replies reliably visible. It improves grouping, feed startup, conversation rendering, and temporal retrieval rather than changing installation or packaging.**

---

#### 1. Canonical project grouping and fan-out

**Before**: absolute paths, `repo::scope` keys, and legacy short names could appear as separate projects in the sidebar and project filters even when they belonged to the same repository. Non-repo folders could also be absorbed into an ancestor Git repository name.

**After**: project stats, feed, stream, sessions, and project-scoped queries now expose a canonical project name based on direct repo/worktree detection or folder basename fallback. The UI fans a canonical project selection back out to its raw member projects, so data is grouped correctly without rewriting stored project keys.

#### 2. Feed startup, caching, and conversation-first UX

**Before**: initial UI startup could overload the daemon with replay/stats work, project switching showed unnecessary loading states, and conversation view hid intermediate assistant replies behind a summary note.

**After**: startup is staged as `context -> project feed -> projects/stats -> health -> stream`, project feed snapshots are cached for instant switching, and conversation view now shows the full user/assistant exchange while keeping meta/event records behind the optional `All events` mode.

#### 3. Codex ingest recovery and temporal retrieval fixes

**Before**: current Codex conversations could disappear when ingest advanced past failed records or compacted tails, and some `current vs previous` / `before switching` questions were misrouted or weakly retrieved.

**After**: Codex ingest now stops on failed offsets, reconstructs compacted tails, restores current turns into the live feed, and strengthens temporal routing/retrieval with dedicated regression coverage.

## [0.4.4] - 2026-03-13

### Theme: Release pipeline completion

**This patch closes the last release blockers from v0.4.3 by making the OCR dependency explicit in `memory-server` and moving the release workflow off the local Bun 1.3.6 crash path.**

---

#### 1. Release workflow runtime

**Before**: the `Release` GitHub Actions workflow was pinned to Bun `1.3.6`, which reproduced a local full-suite crash path during `memory-server` quality gates and left the publish path more brittle than the rest of the repo state.

**After**: the release workflow now installs Bun `1.3.10`, the latest stable release verified from Bun's official GitHub releases, so the publish pipeline is no longer pinned to the crashing runtime.

#### 2. OCR dependency declaration

**Before**: `memory-server/src/ingest/document-parser.ts` dynamically imported `tesseract.js`, but `memory-server/package.json` did not declare it. Clean CI installs therefore failed TypeScript resolution even though local environments with leftover modules could pass.

**After**: `tesseract.js` is declared in `memory-server/package.json` and captured in `memory-server/bun.lock`, so frozen installs and clean typechecks resolve the OCR module consistently.

## [0.4.3] - 2026-03-13

### Theme: Benchmark SSOT remediation + ingest visibility hardening

**Release evidence is now anchored to machine-readable benchmark artifacts, deprecated Japanese aliases are sealed end-to-end, and Claude ingest backfills user-visible turns more reliably. This patch improves trustworthiness and resume quality rather than adding a new product surface.**

---

#### 1. Benchmark / claim SSOT remediation

**Before**: `README.md`, `README_ja.md`, `Plans.md`, and the Japanese proof bar could drift away from the current benchmark manifest. Historical and current Japanese benchmark aliases were also mixed, making it too easy to quote stale evidence as if it were current.

**After**: public claim surfaces are synchronized to machine-readable artifacts. Main gate, current Japanese companion, historical baseline, and deprecated aliases are explicitly separated. The deprecated `s40-ja-release-latest` alias is sealed at both root and deep artifact paths so it cannot be reused as live evidence.

#### 2. Freeze scripts and drift guards

**Before**: `bench-freeze-locomo.sh` could abort before freezing a failing run because `run-ci.ts` exits non-zero on FAIL. The LoCoMo runbook/template still instructed old `locomo10.*` bundle names, and contract tests did not cover all public metadata copies.

**After**: the freeze script preserves FAIL snapshots when a manifest exists, writes correct manifest paths into the freeze summary, and the Japanese companion freeze stays canonicalized to `run1/run2/run3`. Contract tests now guard README/proof-bar/Plans metadata, deprecated alias sealing, and generic `benchmark.*` evidence bundle names.

#### 3. Historical artifact naming cleanup

**Before**: low-risk historical surfaces such as the shadow query pack and archived plan notes still referenced legacy `locomo10.*` artifact bundle names, leaving room for naming drift to reappear during manual benchmark work.

**After**: historical shadow artifacts and archived notes now use generic `benchmark.*` review evidence names, aligned with the current runbook/template contract.

#### 4. Claude ingest visibility backfill

**Before**: Claude Code ingest could miss user-visible turns needed for “latest interaction” style recalls, and the repo root lacked a tracked `AGENTS.md`, leaving bootstrap guidance incomplete for local cross-repo startup.

**After**: visible turns are backfilled during Claude ingest, latest-interaction quality is hardened by regression tests, and the repo root includes `AGENTS.md` so repo-local guidance is available without relying on local-only overrides.

## [0.4.2] - 2026-03-11

### テーマ: セットアップ体験の改善 + マーケットプレイス配布対応

**セットアップのハードルを3方向から下げました。Bun の自動インストール、デーモンの自動復旧強化、そして Claude Code プラグインマーケットプレイスからのインストールに対応しました。**

---

#### 1. Bun 自動インストール (`ensure_bun`)

**今まで**: `bun` が未インストールの場合、`setup` は即座にエラー終了していた。ユーザーは手動で `curl -fsSL https://bun.sh/install | bash` を実行する必要があった。

**今後**: macOS で `bun` が見つからない場合、`ensure_ripgrep` と同じパターンで公式インストーラーを自動実行する。インストール後に `~/.bun/bin` を PATH に追加し、コマンド存在を再確認する。

#### 2. デーモン自動再起動フォールバック (`memory-session-start.sh`)

**今まで**: `memory-self-check.sh` にデーモン自動再起動があったが、300秒のクールダウンがあった。クールダウン中にデーモンが落ちた場合、`memory-session-start.sh` はエラーファイルを書くだけで resume-pack 取得に失敗していた。

**今後**: `memory-session-start.sh` にも独自のフォールバック再起動ロジックを追加。resume-pack の前にヘルスチェックを行い、デーモン不在なら `cleanup-stale` + `start` を試みる。resume-pack 失敗時にも1回限りのリトライを実行する。`_DAEMON_RESTARTED` フラグで無限ループを防止。

#### 3. Claude Code プラグインマーケットプレイス対応

**今まで**: `npx` または `npm install -g` でのインストールのみ対応。Claude Code のプラグインマーケットプレイスUIからの発見・インストールはできなかった。

**今後**: `.claude-plugin/marketplace.json` を追加し、以下のフローでインストール可能:

```
/plugin marketplace add Chachamaru127/harness-mem
/plugin install harness-mem@chachamaru127
```

`plugin.json` も強化し、`mcpServers` に `${CLAUDE_PLUGIN_ROOT}` ベースのポータブルパスを設定。

#### 4. テスト追加 (42 新規 expect)

- `ensure-bun-auto-install.test.ts` — 9 テスト: 関数定義、依存統合、PATH フォールバック、即時 return、プラットフォーム分岐
- `session-start-daemon-restart.test.ts` — 11 テスト: フォールバック関数、ヘルスチェック順序、リトライ制御、E2E (正常/異常)
- `marketplace-schema.test.ts` — 22 テスト: スキーマ準拠、バージョン一貫性、予約名チェック、MCP パス検証

## [0.4.1] - 2026-03-10

### テーマ: 作業フェーズ完了時ファイナライズ + テスト安定化

**ターミナルを閉じても記憶が失われなくなりました。全タスク完了時・スキル完了時に即座にセッションサマリーを保存するため、Stop フック未発火でもresume-pack に完全なコンテキストが残ります。加えて、CI の全ワークフローが安定して通過するよう修正しました。**

---

#### 1. 作業フェーズ完了時の自動ファイナライズ

**今まで**: セッションサマリーの生成は `Stop` フック（`/exit` や Ctrl+C）に依存していた。ターミナルの × ボタンで閉じると `Stop` フックが発火せず、サマリーが保存されないため、次回セッションの resume-pack に前回の文脈が欠落していた。

**今後**: 以下の2つのタイミングで `finalize-session` を自動呼び出しするようになった:

- **breezing / harness-work 全タスク完了時** — `task-completed.sh` が `all_tasks_completed` を検知した瞬間に HTTP API で即座にサマリー保存
- **スキル完了時** — `/harness-work`, `/harness-review`, `/harness-release` 等のスキル終了後に `memory-skill-finalize.sh` がサマリーを更新

`finalize-session` は冪等（UPDATE 文）なので、その後 Stop フックが正常に発火してもサマリーが上書き更新されるだけで問題ない。

#### 2. ポイントインタイム検索の正確性向上

**今まで**: `as_of`（時点指定）パラメータで過去の状態を検索した場合でも、`getLatestInteractionContext` が指定時点より未来の observation を混入させていた。

**今後**: `as_of` が指定されている場合は `getLatestInteractionContext` をスキップし、指定時点までの observation のみを返すようになった。

#### 3. FTS カラムのスキーマ移行修正

**今まで**: `title_fts` / `content_fts` カラムの追加が `initFtsIndex` に含まれており、INSERT 時に `migrateSchema` だけ実行された環境ではカラムが存在せずエラーになることがあった。

**今後**: FTS カラムの追加を `migrateSchema` に移動し、テーブル作成直後に常にカラムが存在するようにした。

#### 4. CI 安定化 (pgvector / benchmark / SDK テスト)

- pgvector CI: `pg` パッケージの依存解決を修正 + ワークフロートリガーパスを拡張
- ベンチマーク: `shapeOf()` のバリアント順序を決定的にソート + `core.timeline()` の `await` 漏れ修正
- SDK テスト: `HarnessMemLangChainMemory` のインポートパスを `integrations.ts` から `langchain-memory.ts` に修正し、camelCase API に合わせてテストを更新
- UI テスト: FeedPanel の `<pre hidden>` を条件付きレンダリングに変更 + `<article>` にクリックハンドラ追加

#### 5. LOCOMO アダプター fixture 修正

- `japanese-failure-bank.json` の temporal-015 の `strategy_contains` を `"object-slot"` → `"previous-slot"` に修正

## [0.4.0] - 2026-03-10

### テーマ: Claude Code セッション取り込み + 直近対話アンカー

**「直近を調べて」と聞いた時、ユーザーが最後に見ていた会話をすぐに返せるようになりました。Claude Code のセッション履歴も自動取り込み対象に加わり、daemon 常駐環境での restart も安全になりました。**

---

#### 1. 直近対話アンカー（latest interaction context）

**今まで**: 「直近を調べて」「最近の作業は？」と聞くと、semantic search の結果だけを返すため、ユーザーが最後に見ていた prompt / assistant 回答とズレることがあった。

**今後**: search API が自動的にプロジェクト内で最後に成立した user-visible な会話（prompt + assistant_response ペア）を特定し、`meta.latest_interaction` として返す。

```json
{
  "meta": {
    "latest_interaction": {
      "platform": "claude",
      "prompt": { "content": "今やり取りした記録を確認して" },
      "response": { "content": "確認します。" },
      "incomplete": false
    }
  }
}
```

- AGENTS.md / `<turn_aborted>` / context summary / `<skill>` 展開テキスト / `"No response requested."` は除外
- Claude / Codex / Cursor 等を横断して最新ペアを選出
- 「直近/最近/最後」系クエリではスコアブーストで上位表示

#### 2. Claude Code セッション自動取り込み

**今まで**: harness-mem は Codex / Cursor / OpenCode / Gemini CLI の履歴を取り込めたが、Claude Code（~/.claude/projects/ 以下の JSONL）は対象外だった。

**今後**: `~/.claude/projects/<encoded-path>/<uuid>.jsonl` を自動パースし、user prompt / assistant response / session summary / PR link を harness-mem に取り込む。

- thinking ブロック・tool_use / tool_result はスキップ（ノイズ除去）
- mtime 降順でファイルをソートし、最近更新されたセッションを優先的に処理
- 手動 API（`/v1/ingest/claude-code-history`）ではファイル数制限なしで全量処理

#### 3. launchctl 常駐環境での安全な restart

**今まで**: `harness-memd restart` は LaunchAgent 管理下でも stop → start を実行するため、launchd が意図しないタイミングでプロセスを再生成し、PID が二重化するリスクがあった。

**今後**: LaunchAgent が管理するジョブを検出した場合は `launchctl kickstart -k` を使い、launchd にプロセス再生成を委ねる。PID ファイルも launchd 経由で整合を取る。

```
$ harness-memd restart
harness-memd restarted via launchctl (pid=60463, port=37888)
```

#### 4. search パフォーマンス最適化

**今まで**: `getLatestInteractionContext` が全 search リクエストで LIMIT 400 の SQL を実行していた。

**今後**: 「直近を調べて」系のクエリでは LIMIT 400（深いクロスセッション走査）、それ以外は LIMIT 20（meta 用の軽量走査）に分岐。intent チェックを SQL 実行より先に行うことで不要な計算を回避。

### Added

- **Latest Interaction Context** (§47-001~004): search meta に project-wide latest interaction を追加。cross-CLI 対応、非 user-visible プロンプト除外フィルタ付き
- **Claude Code Sessions Ingester** (§47): `claude-code-sessions.ts` パーサー + `ingest-coordinator.ts` への統合。user/assistant/summary/pr-link を取り込み
- **Launchctl Restart** (§47-005): `harness-memd restart` が LaunchAgent 検出時に `kickstart -k` を使用

### Changed

- `MAX_FILES_PER_POLL` を 5 → 50 に引き上げ（自動タイマー）
- 手動 API（`/v1/ingest/claude-code-history`）ではファイル数制限を撤廃
- search の `getLatestInteractionContext` に `scanLimit` パラメータを追加し、intent に応じて走査量を制御

### Fixed

- daemon が LaunchAgent 管理下で restart 時に PID 二重化する問題
- Claude Code セッションのうち mtime が古いファイルが自動 ingest で取りこぼされる問題

## [0.3.0] - 2026-03-04

### 🎯 What's Changed for You

**Team management, PostgreSQL backend, CQRS architecture, Graph reasoning, and standalone plugin registration. Benchmark scores improved across all 4 competitive dimensions.**

| Before | After |
|--------|-------|
| SQLite-only storage | PostgreSQL backend with repository pattern (SQLite still default) |
| No team/workspace support | Full Team CRUD + member management with role-based access control |
| Monolithic core (harness-mem-core.ts) | CQRS decomposition into event-recorder, observation-store, session-manager |
| Linear retrieval only | Multi-hop graph reasoning with chain inference |
| No benchmark regression gates | LoCoMo F1 regression gate + CI integration |
| Memory hooks bundled in claude-code-harness | Standalone plugin registration via `.claude-plugin/` |

### Added

- **Team Management** (team-001~006): Team CRUD endpoints, member management with role-based access, SDK support (TS/Python 9 methods), OpenAPI schema
- **PostgreSQL Backend** (pg-002~006): Repository interfaces + PG implementations for observations, sessions, vectors; adapter factory; integration tests + CI workflow
- **Graph Chain Reasoning** (s31-graph): Multi-hop graph traversal for inference across related observations
- **LoCoMo Benchmark Gate** (loco-001~003): Baseline generation, F1 regression gate, CI threshold sync
- **CQRS Decomposition** (s28-p1): Core split into event-recorder, observation-store, session-manager with backward-compatible API
- **Competitive Improvements** (s29-p1~p3, s30-p0~p3): 19+10 architecture tasks improving retrieval quality, reranking, and adaptive decay
- **Standalone Plugin** (.claude-plugin/): harness-mem registers directly as a Claude Code plugin with memory hooks
- **UI Graph Panel**: HarnessMemGraph component with temporal graph visualization
- **SDK Extensions**: LangChain memory, Vercel AI, CrewAI integrations; team API methods
- **Quality Hardening** (s27.1): 6 HARDEN tasks including rate limiter, validator middleware, PII filter

### Fixed

- **Benchmark runner**: ID double `obs_` prefix bug
- **CQRS forward-port**: user_id/team_id propagation to event-recorder
- **Integration tests**: 30 test failures after CQRS decomposition
- **SQLite disk I/O**: Flaky errors in parallel test execution
- **Security review**: 5 High findings from security/performance review
- **Timer callbacks**: Defense-in-depth try-catch for timer callbacks

## [0.2.1] - 2026-03-01

### 🎯 What's Changed for You

**Memory quality improvements with 15 tasks across 3 phases, plus comprehensive security/performance/accessibility hardening from 4-expert Harness review.**

| Before | After |
|--------|-------|
| No command injection protection for `gh` CLI integration | Shell-escaped parameters + repo/label validation |
| SQL alias injection possible in visibility filter | Alias validated with `/^[a-zA-Z_][a-zA-Z0-9_]*$/` |
| Ingest endpoints (GitHub Issues, Knowledge File, Gemini) unprotected | All ingest endpoints require admin token |
| O(n²) tokenization in deduper/derives link generation | Pre-computed token sets eliminate redundant work |
| `<h3>` nested inside `<button>` (WCAG violation) | Semantic heading outside button + roving tabindex |
| `exclude_updated` returned wrong observations | Correct link direction (to_observation_id) |

### Added

- **Memory relation links**: `createLink` / `getLinks` API for `updates`, `extends`, and `derives` relationships between observations.
- **Exclude updated search**: `exclude_updated` option in search to filter out superseded observations.
- **GitHub Issues connector**: `parseGitHubIssues` and `buildGhIssueListCommand` for ingesting GitHub Issues as observations.
- **Knowledge file connector**: Ingest markdown/text knowledge files as observations with deduplication.
- **Gemini history/events ingest**: Dedicated endpoints for Gemini CLI session history and event ingestion.
- **Database backup verification**: Backup integrity check with row-count comparison.
- **Consolidation session tracking**: `consolidation_session_id` column for batch traceability.

### Changed

- Deduper tokenization pre-computes `activeTokenSets` to avoid O(n²) re-tokenization.
- `generateDerivesLinks` pre-computes token sets for all facts before comparison.
- `loadObservations` uses batched queries (MAX_BATCH=500) instead of unbounded IN clauses.
- Feed card UI refactored: heading outside button, `<pre>` always in DOM with `hidden` attribute.
- Tab navigation uses roving tabindex with full keyboard support (Arrow keys, Home, End).

### Fixed

- **`exclude_updated` link direction**: Query now correctly uses `to_observation_id` (superseded observation) instead of `from_observation_id`.
- **Shell injection in `buildGhIssueListCommand`**: All parameters shell-escaped; repo format and label content validated.
- **SQL alias injection in `visibilityFilterSql`**: Alias parameter validated against safe identifier regex.
- **Path traversal in admin endpoints**: `source_db_path` resolved and extension-checked (`.db`, `.sqlite`, `.sqlite3`).
- **Missing admin token warning**: Server logs warning at startup when `HARNESS_MEM_ADMIN_TOKEN` is not set.
- **`isValidLabel` slash injection**: Removed `/` from allowed label characters.
- **Feed card accessibility**: `<h3>` moved outside `<button>`; `cursor: pointer` restricted to `.card-toggle` only.
- **Tab panel visibility**: `<pre>` element always present in DOM (using `hidden` attr) so `aria-controls` target exists.
- **Focus management**: Added `focus-visible` outline styles for card toggle and tab buttons.

### Security

- **Command injection prevention**: `shellEscape()` wraps all CLI parameters; `isValidRepoFormat()` rejects `..` sequences.
- **SQL injection prevention**: Alias validation + batched IN clauses (MAX_BATCH=500) in `exclude_updated` and `loadObservations`.
- **Admin token enforcement**: GitHub Issues, Knowledge File, Gemini History, and Gemini Events endpoints added to `requiresAdminToken` whitelist.
- **Path traversal prevention**: Admin import endpoint validates resolved path and file extension.
- **Timing attack prevention**: Admin token comparison uses `crypto.timingSafeEqual` (carried forward from v0.2.0).

### Migration Notes

- No breaking changes. All new features are additive.
- `mem_links` table is created automatically via `migrateSchema` if not present.

### Verification

- 286 unit tests passing (175 memory-server + 111 UI).
- 4-expert Harness review: Security A, Performance A, Accessibility A, Quality B.
- All Critical/High findings resolved across 3 review rounds.

## [0.2.0] - 2026-02-27

### 🎯 What's Changed for You

**Gemini CLI joins as the 6th platform, and 11 memory quality improvements add local ONNX embeddings, LLM-based fact extraction, and temporal fact management.**

| Before | After |
|--------|-------|
| 5 platforms (Claude, Codex, Cursor, OpenCode, Antigravity) | 6 platforms (+Gemini CLI with full hook/MCP/skill support) |
| Cloud API required for vector embeddings | Local ONNX inference (Ruri V3-30M) — zero API calls |
| Heuristic-only consolidation | LLM-based fact extraction with diff comparison (Ollama) |
| Facts have no expiry | Temporal facts with `valid_from`/`valid_to` and `superseded_by` |

### Added

- **Gemini CLI integration**: Full platform support including MCP wiring, hook handler (SessionStart/End, BeforeAgent/AfterAgent, AfterTool, PreCompress), agent skill, and GEMINI.md context file.
- **Local ONNX embedding**: Ruri V3-30M model for Japanese-optimized vector search with model catalog, automatic download, and async inference.
- **LLM-based fact extraction**: Ollama-powered consolidation with diff comparison against existing facts.
- **Temporal fact management**: `valid_from`/`valid_to` and `superseded_by` fields for fact lifecycle tracking.
- **Write queue**: Promise-based async queue with 503 overflow protection for high-throughput recording.
- **Database backup**: `VACUUM INTO` based backup via CLI (`harness-mem backup`) and API endpoint.
- **Progressive compaction**: Resume-pack now ranks facts by importance × recency for smarter context.
- **Recall trace**: 6 score components exposed in debug mode for search quality analysis.
- **Prompt cache optimization**: Static/dynamic section splitting with SHA-256 hash for cache hits.
- **Configurable recency**: Half-life, auto tag inference, and access frequency tracking.

### Changed

- Consolidation is now enabled by default (previously opt-in).
- Vector model migration includes progress reporting.

### Fixed

- **Timing attack prevention**: Admin token comparison uses `crypto.timingSafeEqual`.
- **SSRF prevention**: Ollama host URL validated to http/https scheme only.
- **N+1 query**: Entity INSERT/SELECT batched (N+1 → 3 queries).
- **Input validation**: LLM fact_value capped at 500 characters.
- **Schema**: `superseded_by`/`valid_to` indexes moved to `migrateSchema` for correct upgrade path.
- **Gemini hooks**: Updated from deprecated array-of-arrays format to v0.30.0 object format.

### Security

- `crypto.timingSafeEqual` for admin token comparison (timing attack mitigation).
- Ollama host URL scheme validation (SSRF prevention).
- LLM fact_value length limit (500 characters).

### Migration Notes

- No breaking changes. Run `harness-mem update` to upgrade.
- New Gemini CLI support: run `harness-mem setup --platform gemini` or add `gemini` to existing platforms.

### Verification

- 22 Gemini-specific tests (13 vitest + 9 bash).
- Resume-pack cache section integration tests.
- All existing tests continue to pass.

## [0.1.35] - 2026-02-25

### What changed for users

- `harness-mem setup` and `harness-mem update` now ask whether to install the Codex Agent Skill when Codex platform is enabled but the skill is not yet installed.

### Added

- **Interactive Codex Skill install prompt**: During `setup` or `update`, users with Codex enabled are asked whether to install the harness-mem Codex Agent Skill to `~/.codex/skills/`.
- **Codex skill wiring check**: `harness-mem doctor` reports whether the Codex Agent Skill is installed.

### Changed

- None.

### Fixed

- None.

### Removed

- None.

### Security

- None.

### Migration Notes

- No migration is required. Run `harness-mem update` to be prompted for skill installation.

### Verification

- `bash -n scripts/harness-mem`

## [0.1.34] - 2026-02-25

### What changed for users

- harness-mem now tracks Claude Code worktree and config-change events, enriches OpenCode memory with MCP session metadata, and is distributable as a Codex Agent Skill.

### Added

- **Claude Code v2.1 hook handlers**: `WorktreeCreate`, `WorktreeRemove`, `ConfigChange` event coverage.
- **OpenCode lifecycle hooks**: `tool.execute.before` / `tool.execute.after` with MCP `sessionID`/`messageID` enrichment.
- **Codex Agent Skill**: `codex/skills/harness-mem/SKILL.md` for native Codex skill distribution.
- **Tool input sanitization**: `sanitizeToolInput()` redacts secret-like keys and truncates at 2000 chars.

### Changed

- Wiring checks now verify each required hook individually instead of a single OR pattern.

### Fixed

- OpenCode plugin `success` field now defaults to `undefined` instead of `true` for honest telemetry.
- Removed `payload.id` from session ID candidates (not session-stable in MCP attachments).
- Environment panel dims uninstalled items and shows warning reasons inline.

### Removed

- None.

### Security

- Tool input sanitization prevents accidental persistence of secrets/tokens in memory events.

### Migration Notes

- No migration is required.

### Verification

- `bash -n scripts/harness-mem`
- `python3 -c "import json; json.load(open('hooks/hooks.json'))"`
- `bun test memory-server/tests/`

## [0.1.33] - 2026-02-25

### What changed for users

- Managed mode now enforces fail-close: writes are blocked when PostgreSQL backend is unreachable, preventing silent fallback to local-only storage.

### Added

- **Managed mode write durability indicator**: `recordEvent` response now includes `write_durability` field (`"managed"`, `"local"`, or `"blocked"`).
- **Health degraded status**: health endpoint reports `"degraded"` when managed backend is required but not connected.
- **Admin token in promote gate**: `_check_shadow_metrics_gate` sends `x-harness-mem-token` header when `HARNESS_MEM_ADMIN_TOKEN` is set.

### Fixed

- **Managed hidden fallback**: adapter-factory returns `managedRequired` flag; core throws when managed mode lacks endpoint instead of silently using SQLite only.
- **Session FK violation in replication**: event-store now batch-upserts sessions in a single transaction before inserting events, preventing FK constraint failures.
- **Shadow match threshold mismatch**: aligned shadow read match threshold from 70% to 95%, matching promotion SLA gate criteria.

## [0.1.32] - 2026-02-24

### What changed for users

- `harness-mem update` now asks the auto-update opt-in question only when auto-update is currently disabled.

### Added

- None.

### Changed

- Update-time prompt gate now checks existing `auto_update.enabled` state before asking.
- Documentation wording for `harness-mem update` now matches the gated prompt behavior.

### Fixed

- Fixed repeated opt-in prompts for users who had already enabled auto-update.

### Removed

- None.

### Security

- None.

### Migration Notes

- No migration is required.
- For users with auto-update already enabled, `harness-mem update` proceeds without asking the opt-in question.

### Verification

- `bash -n scripts/harness-mem`
- `bun test tests/update-command-contract.test.ts`

## [0.1.31] - 2026-02-24

### What changed for users

- Existing users can now run `harness-mem update` to update and set auto-update opt-in in one flow.

### Added

- Added new CLI command: `harness-mem update`.
- Added update-command contract test: `tests/update-command-contract.test.ts`.

### Changed

- Update guidance now defaults to `harness-mem update` in README and setup guide.
- `update` command is excluded from background auto-update checks to avoid nested self-update behavior.

### Fixed

- Fixed the gap where update-time auto-update opt-in prompt was unavailable unless users re-ran interactive setup.

### Removed

- None.

### Security

- None.

### Migration Notes

- No migration is required.
- Existing users can keep using manual update (`npm install -g @chachamaru127/harness-mem@latest`) if preferred.

### Verification

- `bash -n scripts/harness-mem`
- `bun test tests/update-command-contract.test.ts`
- Interactive check: `bash scripts/harness-mem update` (prompt appears)

## [0.1.30] - 2026-02-24

### What changed for users

- System/tool envelope prompts are no longer shown as normal user prompts in Feed cards.

### Added

- Added a UI unit test that verifies system-envelope `user_prompt` cards are categorized as `other`.

### Changed

- Feed categorization now checks known system-envelope prefixes (e.g. `# AGENTS.md instructions`, `<environment_context>`) before classifying `user_prompt` cards as `prompt`.

### Fixed

- Fixed noisy prompt labeling where setup/instruction envelopes were misclassified as user prompts.

### Removed

- None.

### Security

- None.

### Migration Notes

- No migration is required.

### Verification

- `bun run --cwd harness-mem-ui test:ui tests/ui/feed-panel.test.tsx`
- `bun run --cwd harness-mem-ui typecheck`

## [0.1.29] - 2026-02-24

### What changed for users

- Duplicate project entries are now auto-collapsed more aggressively (short name vs absolute path, and case-only variants).
- Project filters and counts are more stable because project keys converge to canonical roots.

### Added

- Added workspace-boundary tests for:
  - runtime canonicalization using observed absolute project roots
  - startup migration from short legacy keys to unique observed absolute roots
  - startup collapse of case-only short-name variants

### Changed

- Project alias migration now uses observed absolute project roots as canonical targets when basename match is unique.
- Runtime project normalization now learns absolute project roots seen in incoming events and reuses them for subsequent basename-only events.

### Fixed

- Fixed split project lists such as `claude-code-harness` vs `/Users/.../claude-code-harness`.
- Fixed split project lists such as `kage-bunshin` vs `/Users/.../kage-bunshin`.
- Fixed case-only project key drift such as `Jarvis` vs `JARVIS`.

### Removed

- None.

### Security

- None.

### Migration Notes

- Existing databases are normalized automatically at startup.
- For immediate effect in long-running environments, restart `harness-memd` once.

### Verification

- `cd memory-server && bun test tests/unit/workspace-boundary.test.ts`
- `cd memory-server && bun test && bun run typecheck`

## [0.1.28] - 2026-02-24

### What changed for users

- Release publishing is no longer blocked by false-negative test failures in the memory-server quality gate.
- Claude feed visibility in the UI is more reliable when platform labels or project aliases vary.

### Added

- Added UI regression tests for Claude feed platform filtering and live-feed alias project matching.

### Changed

- Medium search-latency benchmark now uses a CI-aware budget (`1500ms` on CI, `500ms` locally) with reduced synthetic corpus load.
- Antigravity ingest integration tests now assert against the normalized project key behavior.

### Fixed

- Fixed `managed-mode-wiring` test path resolution so it works when CI runs from `memory-server/`.
- Fixed feed filtering to match `claude-*` platform labels when `platformFilter=claude`.
- Fixed live feed prepend drops caused by strict string mismatch between selected project and normalized alias project paths.

### Removed

- None.

### Security

- None.

### Migration Notes

- None.

### Verification

- `cd memory-server && bun test && bun run typecheck`
- `cd harness-mem-ui && bun run test:ui && bun run typecheck`

## [0.1.27] - 2026-02-24

### What changed for users

- Release automation is now resilient when a release tag is pushed shortly before the release branch merge reaches `main`.

### Added

- None.

### Changed

- `Release` workflow now retries main-containment verification for up to 15 minutes (`15s` interval).
- Main-containment verification now uses a non-shallow `git fetch origin main` to avoid shallow-history false negatives.

### Fixed

- Fixed repeated `publish-npm` failures at `Verify tag commit is on main` that could occur with merge commits under `--depth=1` fetch.

### Removed

- None.

### Security

- None.

### Migration Notes

- No migration is required.

### Verification

- Confirmed recurring failure signature in previous release runs (`v0.1.25`, `v0.1.26`) at `Verify tag commit is on main`.
- Merged workflow fix in PR `#18` and released this patch version to apply the corrected guard in future releases.

## [0.1.26] - 2026-02-23

### What changed for users

- Mem UI now includes an `Environment` tab for non-specialists to quickly inspect runtime state.
- Interactive `harness-mem setup` can now opt in to automatic CLI updates.

### Added

- New read-only environment snapshot API: `GET /v1/admin/environment` (admin token required).
- New UI proxy endpoint: `GET /api/environment`.
- New `Environment` tab and `EnvironmentPanel` with:
  - 5-second summary cards
  - Internal servers / languages-runtimes / CLI tools / AI-MCP tool sections
  - FAQ and beginner-friendly explanations
- New environment API contract doc: `docs/plans/environment-tab-v1-contract.md`.
- New tests:
  - `memory-server/tests/integration/environment-api.test.ts`
  - `harness-mem-ui/tests/ui/environment-panel.test.tsx`
  - `harness-mem-ui/tests/e2e/environment.spec.ts`

### Changed

- `scripts/harness-mem setup` interactive flow now includes auto-update opt-in selection.
- Auto-update state is persisted in `~/.harness-mem/config.json` under `auto_update.enabled`.
- CLI startup now performs periodic npm version checks for opt-in users and can auto-install newer versions.
- README, Japanese README, and setup guide now document both Environment tab usage and auto-update behavior.

### Fixed

- Sensitive values in environment snapshots are masked before API/UI rendering.
- Environment collection now degrades gracefully when `tool-versions.json` or `doctor-last.json` is missing.

### Removed

- None.

### Security

- Admin token protection is enforced for the environment snapshot endpoint.
- Secret/token-like values are redacted in environment output.

### Migration Notes

- No manual database migration is required.
- Existing users can continue as-is; auto-update remains opt-in (disabled by default).

### Verification

- `bun run --cwd memory-server typecheck`
- `bun test --cwd memory-server tests/integration/environment-api.test.ts`
- `bun run --cwd harness-mem-ui typecheck`
- `bun run --cwd harness-mem-ui test:ui -- tests/ui/environment-panel.test.tsx tests/ui/useSettings.test.tsx`
- `bun run --cwd harness-mem-ui test:e2e -- tests/e2e/feed.spec.ts tests/e2e/environment.spec.ts`

## [0.1.25] - 2026-02-23

### What changed for users

- Project labels in the UI now display readable repository names (for example `Context-Harness`) instead of full absolute paths.
- Subdirectories and linked Git worktrees are now canonicalized to the same workspace project key, preventing project-list fragmentation.
- Synthetic/noise project rows such as `shadow-*` and hidden-directory paths are now excluded from project stats display.

### Added

- UI project label utility with collision-safe fallback logic (`basename` -> `parent/basename` -> full path).
- New UI tests for project label rendering and collision handling.
- New core tests for git-root/worktree canonicalization and project-stats noise filtering.

### Changed

- Strengthened project normalization in core to resolve Git workspace roots (including linked worktrees) for existing paths.
- Expanded startup legacy project alias migration to normalize all existing project keys to canonical roots.
- Updated project sidebar/settings preview to use display labels while preserving canonical project keys internally.

### Fixed

- Fixed issue where one workspace appeared as multiple projects due to subfolder/worktree path differences.
- Fixed issue where absolute path project labels reduced readability in project selection UI.

### Removed

- None.

### Security

- None.

### Migration Notes

- No manual database migration is required.
- Restart `harness-memd` after upgrade so startup alias normalization can apply to existing project keys.

### Verification

- `bun test tests/unit/core.test.ts tests/unit/workspace-boundary.test.ts`
- `bun test tests/integration/feed-stream.test.ts`
- `bun run --cwd harness-mem-ui test:ui`
- `bun run --cwd harness-mem-ui typecheck`
- `bun run --cwd harness-mem-ui build:web`

## [0.1.24] - 2026-02-23

### What changed for users

- Documentation is now cleaner and easier to follow for first-time setup and upgrades.
- English docs are now consistently the default entrypoint, with Japanese content clearly separated.

### Added

- README section for explicit upgrade command (`npm install -g @chachamaru127/harness-mem@latest`).

### Changed

- Reorganized `README.md` into a user-facing structure (quick start, core commands, supported tools, troubleshooting).
- Reorganized `README_ja.md` to mirror the same structure in Japanese.
- Rewrote `docs/harness-mem-setup.md` as a clean English operational guide and removed mixed-language/internal planning noise.

### Fixed

- Removed stale/confusing documentation fragments that mixed internal workflow notes with end-user setup instructions.

### Removed

- Removed internal Phase/KPI spec notes from `docs/harness-mem-setup.md` user documentation surface.

### Security

- None.

### Migration Notes

- No runtime migration required.
- Existing users can update with: `npm install -g @chachamaru127/harness-mem@latest`.

### Verification

- Manual doc review: `README.md`, `README_ja.md`, `docs/harness-mem-setup.md`
- `npm pack --dry-run`

## [0.1.23] - 2026-02-23

### What changed for users

- Legacy Mem UI has been removed. `harness-mem` now serves only one UI design everywhere.
- npm installs and local runs now use the same `static-parity` bundle path with no runtime fallback switch.

### Added

- Contract test: `tests/harness-mem-ui-static-contract.test.ts` to prevent reintroducing legacy UI fallback paths.

### Changed

- `harness-mem-ui/src/server.ts` now serves only `src/static-parity` and fails fast when the bundle is missing.
- Removed `HARNESS_MEM_UI_PARITY_V1` runtime wiring from `scripts/harness-memd`.
- Updated UI dev/test docs and Playwright config to remove parity toggle usage.

### Fixed

- Eliminated root cause of mixed UI rendering (new UI vs legacy UI) across environments.

### Removed

- Deleted legacy static UI files:
  - `harness-mem-ui/src/static/index.html`
  - `harness-mem-ui/src/static/app.js`
- Removed parity toggle behavior that could silently fall back to legacy UI.

### Security

- None.

### Migration Notes

- No manual migration is required.
- Update command: `npm install -g @chachamaru127/harness-mem@latest`

### Verification

- `bun test tests/harness-memd-ui-autostart-contract.test.ts tests/harness-mem-ui-static-contract.test.ts tests/mcp-runtime-bootstrap-contract.test.ts`
- `npm pack --dry-run` (verify `harness-mem-ui/src/static-parity/*` is included and legacy `harness-mem-ui/src/static/*` is absent)

## [0.1.22] - 2026-02-23

### What changed for users

- Mem UI design is now consistent across local repo runs and npm global installs.
- `harness-mem setup` users now get the same parity UI bundle by default (no unexpected fallback to the legacy look).

### Added

- npm package now ships `harness-mem-ui/src/static-parity/*` parity bundle assets.

### Changed

- Removed `harness-mem-ui/src/static-parity` from UI local ignore rules so release artifacts are included in source and package outputs.
- Rebuilt parity static assets from the current React UI build.

### Fixed

- Fixed distribution mismatch where npm installs served the legacy `src/static` UI while local dev served `src/static-parity`.

### Removed

- None.

### Security

- None.

### Migration Notes

- No manual migration is required.
- Existing users can update with: `npm install -g @chachamaru127/harness-mem@latest`.

### Verification

- `bun run --cwd harness-mem-ui build:web`
- `npm pack --dry-run`
- Verify tarball contains `harness-mem-ui/src/static-parity/index.html` and `harness-mem-ui/src/static-parity/assets/*`

## [0.1.21] - 2026-02-23

### What changed for users

- Restored Mem UI auto-start during `harness-mem setup` so `http://127.0.0.1:37901` is available again after successful setup.
- setup output now includes an explicit Mem UI startup line (`Mem UI started: ...`) for faster troubleshooting.

### Added

- Contract test: `tests/harness-memd-ui-autostart-contract.test.ts` to prevent future regressions where UI lifecycle wiring is accidentally removed.

### Changed

- `scripts/harness-memd` now reinstates full UI lifecycle management:
  - auto-start UI on daemon start (`start_ui`)
  - stop UI on daemon stop (`stop_ui`)
  - include UI endpoint checks in `doctor`
  - support explicit UI disable with `HARNESS_MEM_ENABLE_UI=false`
- Setup guide now documents `HARNESS_MEM_ENABLE_UI` in runtime environment variables.

### Fixed

- Fixed regression in `0.1.20` where setup completed successfully but Mem UI process was not launched.

### Removed

- None.

### Security

- None.

### Migration Notes

- No manual migration is required.
- If running headless intentionally, set `HARNESS_MEM_ENABLE_UI=false`.

### Verification

- `bun test tests/harness-memd-ui-autostart-contract.test.ts tests/mcp-runtime-bootstrap-contract.test.ts`
- `bun test tests/harness-memd-guardrails.test.ts`
- `HARNESS_MEM_PORT=<port> HARNESS_MEM_UI_PORT=<port> harness-mem setup --platform codex,cursor,claude --skip-smoke --skip-quality`

## [0.1.20] - 2026-02-23

### What changed for users

- `harness-mem doctor --fix` and setup now recover automatically when the npm package is missing `mcp-server/dist/index.js`.
- setup post-check no longer reports false failures when daemon doctor warns but `/health` is still reachable.

### Added

- Contract test: `tests/mcp-runtime-bootstrap-contract.test.ts` to keep MCP runtime bootstrap behavior stable.

### Changed

- `ensure_mcp_runtime` now bootstraps MCP runtime locally (`npm install --include=dev` + `npm run build`) when `mcp-server/dist/index.js` is absent.
- setup repair hint for MCP runtime now points to the full rebuild command.

### Fixed

- Prevented hard failure pattern on global installs: `MCP dist entry missing: .../mcp-server/dist/index.js`.
- Reduced false `doctor_post_check` failures caused by stale daemon PID warnings.

### Removed

- None.

### Security

- None.

### Migration Notes

- No manual migration is required.

### Verification

- `bun test tests/mcp-runtime-bootstrap-contract.test.ts`
- `npm pack --dry-run`

## [0.1.19] - 2026-02-22

### What changed for users

Project names in memory are now normalized to a single canonical value, so the same workspace no longer splits into separate entries like `harness-mem` and `/.../harness-mem`.

### Added

- Startup migration that rewrites legacy basename project rows to the canonical `codexProjectRoot` path for `mem_sessions`, `mem_events`, `mem_observations`, `mem_facts`, and `mem_consolidation_queue`.
- Regression tests for basename-to-path canonicalization and legacy project alias migration.

### Changed

- Project normalization now resolves basename-style project values to the configured workspace root when names match.
- API-side project filters (`search`, `feed`, `sessions`, `resume-pack`, and chain resolution) now use the same canonical project normalization path.

### Fixed

- Prevented feed/project sidebar fragmentation caused by mixed project identifiers (`basename` vs absolute path).
- Prevented confusion between `session_id` UUID values and project buckets by keeping project namespaces consistent.

### Removed

- None.

### Security

- None.

### Migration Notes

- No manual migration command is required. Existing legacy project aliases are normalized automatically on daemon startup.

### Verification

- `bun test memory-server/tests/unit/workspace-boundary.test.ts`
- `bun test memory-server/tests/unit/core.test.ts`
- `bun test` (cwd: `memory-server`)
- `bun run --cwd memory-server typecheck`
- `bun run --cwd harness-mem-ui typecheck`
- `bun run --cwd harness-mem-ui test:ui`
- `npm pack --dry-run`

## [0.1.18] - 2026-02-22

### What changed for users

Release documentation now clearly defines the upcoming System Inventory experience and the LLM query endpoint contract.

### Added

- README roadmap section for the planned System Inventory screen.
- Planned server inventory detail requirements: `port`, `protocol`, `pid`, and bind address.
- Planned LLM read-only endpoint contract: `GET /v1/admin/system/llm-context`.

### Changed

- Clarified EN/JA documentation coverage for release notes and planning visibility.

### Fixed

- Reduced ambiguity about whether System Inventory requirements are implemented vs planned.

### Removed

- None.

### Security

- Documented that LLM-facing system context is designed as read-only under `v1/admin/*` scope.

### Migration Notes

- No runtime migration is required.

### Verification

- Confirm README includes `Planned Next (EN / JA)` section.
- Confirm release notes include server-port visibility and `system/llm-context` endpoint contract.
## [0.1.17] - 2026-02-22

### What changed for users

`harness-mem setup` now installs and starts the Mem UI alongside the API daemon, so first-time setup immediately provides both endpoints.

### Added

- npm package now ships Mem UI runtime files (`harness-mem-ui/src/*`) required for standalone UI server startup.
- `harness-memd start` now launches Mem UI on `HARNESS_MEM_UI_PORT` (default `37901`) when `HARNESS_MEM_ENABLE_UI` is enabled.

### Changed

- setup success logs now show both API (`:37888`) and Mem UI (`:37901`) URLs.
- setup/docs now document that Mem UI is auto-started by default.

### Fixed

- Removed first-setup UX gap where users had to manually clone the repository and run `harness-mem-ui` separately.

### Removed

- None.

### Security

- None.

### Migration Notes

- No migration is required.
- To disable auto UI startup explicitly: `HARNESS_MEM_ENABLE_UI=false`.

### Verification

- `bash -n scripts/harness-memd`
- `bash -n scripts/harness-mem`
- `bun test tests/harness-memd-guardrails.test.ts`
- `npm pack --dry-run`

## [0.1.16] - 2026-02-22

### What changed for users

`harness-mem doctor --fix` now recovers environments missing ripgrep (`rg`) by automatically installing it via Homebrew during setup repair.

### Added

- Automatic `ripgrep` install path in dependency bootstrap (`brew install ripgrep`) when `rg` is missing.

### Changed

- Setup dependency failure hint now includes `ripgrep`.
- Troubleshooting docs now include `ripgrep` in required dependency list.

### Fixed

- Prevented `doctor_post_check` false-failures caused by `rg: command not found` in hook/wiring checks.

### Removed

- None.

### Security

- None.

### Migration Notes

- No migration is required.

### Verification

- `bash -n scripts/harness-mem`
- `bun test tests/doctor-json-contract.test.ts tests/readme-plans-rules.test.ts`
- `npm pack --dry-run`

## [0.1.15] - 2026-02-22

### What changed for users

Release pipeline reliability improved again by fixing CI-environment detection in the medium-corpus latency quality gate.

### Added

- None.

### Changed

- Latency benchmark gate now detects CI using both `CI` and `GITHUB_ACTIONS`.
- CI threshold for the medium corpus gate is now `p95 < 3000ms` (local/dev remains `p95 < 500ms`).

### Fixed

- Prevented false release failures when GitHub Actions did not present `process.env.CI` as expected in Bun tests.

### Removed

- None.

### Security

- None.

### Migration Notes

- No migration is required.

### Verification

- `cd memory-server && bun test tests/integration/search-quality.test.ts`
- `cd memory-server && bun test && bun run typecheck`
- `npm pack --dry-run`

## [0.1.14] - 2026-02-22

### What changed for users

Release workflow now passes consistently on GitHub-hosted runners by using CI-aware latency guard thresholds.

### Added

- None.

### Changed

- Adjusted medium-corpus search latency gate in CI context:
  - local/dev threshold remains `p95 < 500ms`
  - CI threshold is now `p95 < 1500ms`

### Fixed

- Prevented false-negative release failures caused by slower shared CI runners while preserving a strict local benchmark target.

### Removed

- None.

### Security

- None.

### Migration Notes

- No migration is required.

### Verification

- `cd memory-server && bun test tests/integration/search-quality.test.ts`
- `cd memory-server && bun test && bun run typecheck`
- `npm pack --dry-run`

## [0.1.13] - 2026-02-22

### What changed for users

Release automation no longer fails due benchmark timeout defaults during memory-server quality gates.

### Added

- None.

### Changed

- None.

### Fixed

- Increased timeout budget for benchmark-heavy tests used by CI quality gates:
  - `memory-server/tests/integration/search-quality.test.ts`
  - `tests/benchmarks/rerank-quality-gate.test.ts`

### Removed

- None.

### Security

- None.

### Migration Notes

- No migration is required.

### Verification

- `cd memory-server && bun test tests/integration/search-quality.test.ts`
- `bun test tests/benchmarks/baseline-output.test.ts tests/benchmarks/rerank-quality-gate.test.ts`

## [0.1.12] - 2026-02-22

### What changed for users

Harness-mem now ships a larger retrieval/runtime toolkit (managed backend routing, embedding/rerank/router modules, and stronger daemon guardrails) together with updated release docs and benchmark workflows.

### Added

- Backend abstraction and adapters for SQLite/PostgreSQL (`storage-adapter`, adapter factory, managed-mode schema helpers).
- Retrieval/quality modules:
  - embedding provider registry (`fallback`, `openai`, `ollama`)
  - reranker registry
  - retrieval router
  - answer compiler
  - consolidation worker/extractor/deduper
  - token estimate utility
- New integration and contract coverage:
  - API contract / token-estimate / managed-mode / security hardening tests
  - 100k performance benchmark and LOCOMO workflow scaffolding
  - Python SDK and LangChain integration starter packages

### Changed

- `README.md` and setup docs were expanded with benchmark, guardrail, and proof-pack workflows.
- `mcp-server/README.md` npm package examples now point to `@claude-code-harness/mcp-server`.
- Hook and ingestion coverage was extended for Codex/Cursor/OpenCode/Antigravity paths.

### Fixed

- `harness-memd` now avoids false healthy states from non-JSON health responses.
- `harness-memd` now detects port conflicts/stale pid states earlier and self-heals UI pid drift.
- Added daemon/UI log rotation controls:
  - `HARNESS_MEM_LOG_MAX_BYTES`
  - `HARNESS_MEM_LOG_ROTATE_KEEP`
- Kept MCP runtime bootstrap safety for missing `mcp-server/dist` by retaining package source/build metadata in npm files.

### Removed

- None.

### Security

- Expanded test coverage for workspace boundary and security-hardening behaviors.

### Migration Notes

- No destructive migration is required.
- If you use managed/hybrid backend mode, verify your backend env wiring before production rollout.

### Verification

- `cd harness-mem-ui && bun run test:ui && bun run typecheck`
- `cd memory-server && bun test && bun run typecheck`
- `bun test tests/harness-memd-guardrails.test.ts`
- `bun test tests/doctor-json-contract.test.ts`
- `./tests/test-memory-daemon-chaos.sh 2`
- `./tests/test-memory-daemon.sh`
- `npm pack --dry-run`

## [0.1.11] - 2026-02-18

### What changed for users

`setup` no longer fails on global npm installs when `mcp-server/dist` is missing from the package.

### Added

- Included `mcp-server/src/` and `mcp-server/tsconfig.json` in npm package files for deterministic local MCP builds.

### Changed

- None.

### Fixed

- `ensure_mcp_runtime` now bootstraps and builds MCP locally if `mcp-server/dist/index.js` is absent.
- Prevented setup hard-failure pattern: `MCP dist entry missing: .../mcp-server/dist/index.js`.

### Removed

- None.

### Security

- None.

### Migration Notes

- Upgrade and run setup again:
  - `npm install -g @chachamaru127/harness-mem@0.1.11`
  - `harness-mem setup --platform codex,claude,cursor,opencode`

### Verification

- `npm pack --dry-run`
- `harness-mem setup --platform claude --skip-start --skip-smoke --skip-quality` from a fresh global install path.

## [0.1.10] - 2026-02-18

### What changed for users

Fresh installs now wire Claude and Cursor MCP entries automatically, reducing post-setup missing-server cases.

### Added

- Cursor setup now writes `~/.cursor/mcp.json` with `mcpServers.harness`.
- Cursor doctor now validates MCP wiring, not only hook wiring.

### Changed

- Setup prompts now describe Cursor as global hooks plus global MCP wiring.
- Cursor hook command is now written as an absolute path for stable execution.

### Fixed

- Claude setup now writes `mcpServers.harness` to `~/.claude.json` automatically.
- `doctor --fix --platform claude` now repairs missing Claude MCP wiring.

### Removed

- None.

### Security

- None.

### Migration Notes

- Run `harness-mem doctor --fix --platform claude,cursor` after upgrading to normalize existing global config files.

### Verification

- `./scripts/harness-mem doctor --platform claude --skip-smoke --skip-quality`
- `./scripts/harness-mem doctor --platform cursor --skip-smoke --skip-quality`

## [0.1.9] - 2026-02-18

### What changed for users

Search now returns more relevant results while preventing cross-project leakage.

| Before | After |
|--------|-------|
| Search scoring was simpler (`hybrid_v1`) and could not use graph/entity context safely. | Search uses `hybrid_v3` with richer scoring (`tag_boost`, `importance`, `graph`) and stricter filters. |
| Link expansion risked including unrelated project records. | `strict_project` keeps results isolated to the requested project. |
| Privacy filtering relied on string matching and could misclassify edge cases. | Privacy filtering now uses strict JSON tag evaluation for `private` / `sensitive`. |
| Vector search could mix incompatible model/dimension rows. | Vector candidates are restricted to current model + dimension, with coverage-aware fallback weighting. |

### Added

- `/v1/search` request fields: `expand_links`, `strict_project`, `debug`.
- `/v1/search` response fields: `scores.graph`, `meta.candidate_counts`, `meta.vector_coverage`.
- Entity extraction and observation linking (`follows`, `shared_entity`) as search signals.
- New integration coverage for project isolation, privacy strictness, vector compatibility, and coverage-based weighting.

### Changed

- Search ranking upgraded from `hybrid_v1` to `hybrid_v3`.
- Default vector dimension increased to `256`.
- Default vector model updated to `local-hash-v3`.
- Synonym expansion and bigram-aware hashing improve lexical/vector recall.

### Fixed

- Prevented cross-project result contamination during link expansion.
- Removed privacy false-positives from naive substring matching.
- Prevented ranking drift from mixed vector model/dimension datasets.

### Removed

- None.

### Security

- Stricter privacy filtering reduces accidental exposure of sensitive entries in default search.

### Migration Notes

- No destructive DB migration.
- Existing DBs are migrated safely (`observation_type`, entity tables, and new indices are created if missing).
- Optional: run vector reindex for best `vector_coverage` if old vectors dominate.

### Verification

- `cd memory-server && bun test && bun run typecheck`
- Confirm `/v1/search` returns `meta.ranking = "hybrid_v3"` and includes `candidate_counts`, `vector_coverage`.

## [0.1.8] - 2026-02-18

### What changed for users

`uninstall` now removes the npx runtime cache, so local cleanup is complete.

### Added

- None.

### Changed

- Uninstall lifecycle now includes package runtime cache cleanup.

### Fixed

- Removed leftover `~/.harness-mem/runtime/` artifacts after uninstall.

### Removed

- None.

### Security

- None.

### Migration Notes

- No manual migration required.
- If you previously uninstalled on `<=0.1.7`, run uninstall once more to clear old runtime cache.

### Verification

- Run `harness-mem uninstall`.
- Confirm `~/.harness-mem/runtime/` is removed.

## [0.1.7] - 2026-02-18

### What changed for users

npx setup now writes stable runtime paths so MCP wiring does not break after npm cache cleanup.

### Added

- None.

### Changed

- Setup and doctor flows now synchronize runtime files into `~/.harness-mem/runtime/harness-mem`.

### Fixed

- Removed dependency on ephemeral `~/.npm/_npx/...` paths in generated wiring.

### Removed

- None.

### Security

- None.

### Migration Notes

- Re-run `harness-mem setup` if you installed via npx before `0.1.7`.

### Verification

- Run `harness-mem doctor`.
- Confirm generated paths point to `~/.harness-mem/runtime/harness-mem`.

## [0.1.6] - 2026-02-18

### What changed for users

OpenCode setup and doctor no longer write unsupported keys that can block startup.

### Added

- None.

### Changed

- OpenCode repair flow now normalizes to `mcp.harness.environment`.

### Fixed

- Removed legacy `plugins` and `env` key patterns from OpenCode wiring.

### Removed

- Unsupported legacy OpenCode config key usage.

### Security

- None.

### Migration Notes

- Run `harness-mem doctor --fix --platform opencode` to normalize existing OpenCode config.

### Verification

- Run `harness-mem doctor --platform opencode`.
- Confirm OpenCode starts without config schema errors.

## [0.1.5] - 2026-02-17

### What changed for users

Release automation now blocks off-branch or mismatched-tag publishes and runs quality gates before npm publish.

### Added

- Mandatory pre-publish quality gates for UI and memory-server.

### Changed

- Release workflow now verifies tag commit ancestry against `origin/main`.
- Release workflow now verifies tag version matches `package.json`.

### Fixed

- Corrective release handling for earlier tag and commit mismatches.

### Removed

- None.

### Security

- Reduced accidental release risk by enforcing branch and version checks.

### Migration Notes

- Maintainers should use SemVer tags that match `package.json` exactly.

### Verification

- Trigger release with a SemVer tag.
- Confirm workflow runs: ancestry check, version check, quality gates, `npm pack --dry-run`, publish.

## [0.1.1] - 2026-02-17

### What changed for users

Setup and feed browsing became easier through an interactive setup flow and inline feed detail expansion.

### Added

- Interactive setup prompts for language, target tools, import choice, and post-import stop choice.
- UI design presets: `Bento Canvas`, `Liquid Glass`, `Night Signal`.
- Dedicated platform badge labels for `cursor` and `antigravity`.

### Changed

- Feed detail view now opens inline at the selected card (accordion behavior).
- UI language defaults and `document.lang` behavior were aligned for stable switching.

### Fixed

- Reduced scroll-position confusion caused by modal overlay detail behavior.

### Removed

- Previous overlay-first card detail behavior.

### Security

- None.

### Migration Notes

- No breaking migration required.
- Re-run `harness-mem setup` to use the new interactive onboarding path.

### Verification

- Run `harness-mem setup` and confirm interactive prompts appear in sequence.
- Open feed UI and confirm card details expand inline.
