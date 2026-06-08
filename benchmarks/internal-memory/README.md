# Internal Memory Benchmark Dashboard

内部向けの memory system 比較ベンチ。公開互換の retrieval 指標と、日本語・日英混在の coding-memory 指標を分けて測る。

## 測定方針（reproduced は harness-mem のみ）

既定の reproduced（ローカル実測）対象は **harness-mem のみ**。他の競合はすべて **published（reference-only）** として別表に出し、reproduced ランキングには混ぜない。

| ID | 既定の measurement | 種別 / opt-in 実測 |
|----|--------------------|--------------------|
| `harness-mem` | **reproduced** | ローカル in-process（テストは temp DB） |
| `agentmemory` | published(reference-only) | opt-in: `--competitors agentmemory` + local `AGENTMEMORY_URL` (default `http://127.0.0.1:3111`), optional `AGENTMEMORY_SECRET` |
| `supermemory` | published(reference-only) | opt-in: `--competitors supermemory` + `SUPERMEMORY_API_KEY`, 任意 `SUPERMEMORY_BASE_URL` |
| `claude-mem` | published(reference-only) | opt-in: `--competitors claude-mem` + 任意 `CLAUDE_MEM_BASE_URL`, `HARNESS_MEM_TOKEN`（harness-mem 互換 `/v1/search`） |
| `mem0` | published(reference-only) | 実測経路なし（公称値のみ） |
| `mempalace` | published(reference-only) | 実測経路なし（LongMemEval 公称 96.6%、domain mismatch） |

published 値は `adapters/import-published.ts` の `PUBLISHED_REFERENCES` に出典付きで保持し、数値不明は `null`（reference-only）とする。外部競合を `--competitors <id>` で渡したときのみ live 実測され reproduced に昇格する。

## 公平性ルール

- **published（reference-only）** と **reproduced** は別表に分離し、同一ランキングに混ぜない
- 同一 dataset / 同一 scorer / 同一 manifest でローカル実測のみ比較する
- credential 未設定の競合は `skipped_missing_credentials`（スコア 0 扱いにしない）
- harness-mem は自分で種を入れて引く in-process 構造のため満点が出やすい。これは「実装が end-to-end で動く確認」であって対外優位の証明ではない
- scorer には ID recall 0 時に本文 substring で救済する content-substring fallback（`lib/score-case.ts`）がある。**AR ケースのみ**に限定し、CR/TTL/LRU では旧事実への誤マッチを防ぐ。自己シードの harness-mem に構造的有利になりうる。reproduced harness-mem スコアは competitive superiority ではなく implementation sanity として扱う
- LoCoMo full は主ゲートにしない（`Plans.md` §78 の domain mismatch 判断に従う）

## 実行

```bash
# ユニットテスト（schema / scorer / harness smoke）
bun test benchmarks/internal-memory/tests/

# ユニットテスト（ONNX なし・高速）
bun run benchmark:internal-memory:test

# harness-mem のみ（推奨の初回スモーク）
bun run benchmark:internal-memory -- --competitors harness-mem --limit 20

# 4 競合の runner smoke（embedding 使用・bun test 外で実行）
bun run benchmark:internal-memory:smoke

# embedding 単体 smoke
bun run benchmark:internal-memory:embedding-smoke

# 全実測対象（credential なしは skip 記録）
bun run benchmark:internal-memory

# Official MemoryAgentBench smoke（small limit / OpenRouter 不要）
bun run benchmark:memoryagentbench:smoke

# Official MemoryAgentBench full compatible runner（raw は .cache に保存、commit 禁止）
bun run benchmark:memoryagentbench

# OpenRouter LLM judge 付き（20 USD cap、.env 自動読込）
bun run benchmark:internal-memory:openrouter

# 任意 .env を明示
bun run benchmark:internal-memory -- --use-openrouter --env-file /path/to/.env

# ダッシュボード再生成（既存 raw-results から）
bun run benchmark:internal-memory:dashboard
```

## 出力

`benchmarks/internal-memory/reports/latest/`（**tracked baseline**）:

- `summary.json` — レイヤー別集計
- `raw-results.jsonl` — ケース単位の生結果
- `scorecard.md` — 人間向け比較表
- `dashboard.html` — 内部閲覧用 HTML
- `reproducibility.md` — manifest / git / env スナップショット

Raw upstream fetch は `benchmarks/internal-memory/.cache/`（gitignored）に保存する。smoke / full run は `writeReportPack` で `reports/latest/*` を上書きする。意図しない差分は restore し、baseline を更新するときだけ commit する。

## データセット

- `datasets/coding-memory-ja-mixed-v1.jsonl` — 日本語・混在・分離・再開
- `datasets/public-retrieval-v1.jsonl` — 英語中心の公開互換サブセット
- `datasets/longmemeval-s-manifest.json` — 外部データ参照用マニフェスト（fixture のみ）
- `datasets/coding-memory-real-ja-mixed-v1.jsonl` — 実データ由来パイロット（§140、PII マスク済み）
- `datasets/coding-memory-real-ja-mixed-v2.jsonl` — 実データ本格スケール（§141、350/能力、runner は v2 優先）
- Official MemoryAgentBench — Hugging Face `ai-hyz/MemoryAgentBench` を datasets-server rows API から取得し、`benchmarks/internal-memory/.cache/` に保存する（raw upstream data は commit 禁止）

## Real-data pipeline (§140)

```bash
bun run benchmark:internal-memory:real-data-pipeline
bun run benchmark:internal-memory:pii-test
```

See `docs/benchmarks/real-data-pipeline.md`.

## Agentmemory live comparison (§142)

Official Agentmemory is self-hosted on `http://127.0.0.1:3111` with REST under `/agentmemory/*`.
Protected deployments use `AGENTMEMORY_SECRET` as a bearer token. There is no vendor-issued API key.

```bash
# Terminal 1: start Agentmemory (official quickstart)
npx @agentmemory/agentmemory

# Terminal 2: smoke (same dataset/scorer as harness-mem)
bun run benchmark:internal-memory -- --competitors harness-mem,agentmemory --limit 20

# Full v2 comparison (after smoke passes)
bun run benchmark:internal-memory -- --competitors harness-mem,agentmemory
```

See `docs/benchmarks/agentmemory-live-runbook.md` for preflight, localhost-only guard, and claim safety.

## MemoryAgentBench 4 能力マッピング（§139）

内部ベンチは [MemoryAgentBench](https://arxiv.org/abs/2507.05257) の 4 能力語彙を標準とする（`Spec.md` Benchmark And Competitive Evaluation）。

| 能力 | 略称 | 既存 layer / category | 採点 tier |
|------|------|------------------------|-----------|
| Accurate Retrieval | **AR** | `public_compatible` / `english_*`; `ja_coding` / `ja_requirements`, `ja_decision`; `mixed_coding` / `mixed_symbol`, `en_content_ja_query`; `isolation` / `project_boundary` | substring（`substring_grounding_score`）+ ID recall |
| Test-Time Learning | **TTL** | `ja_coding` / `mixed_coding` / `test_time_learning` | LLM judge（`llm_grounding_score`、OpenRouter opt-in） |
| Long-Range Understanding | **LRU** | `resume` / `handoff_resume` | LLM judge + `resume_hit_rate` |
| Conflict Resolution | **CR** | `ja_coding` / `mixed_coding` / `conflict_resolution`; `ja_coding` / `temporal_fix`; `public_compatible` / `english_temporal` | substring + ID recall（新事実を relevant_ids に指定） |

### 採点二段構え

- **AR / CR**: `expected_keywords` に対する substring match を `substring_grounding_score` に記録（`grounding_score` は後方互換エイリアス）
- **TTL / LRU**: OpenRouter LLM judge を `--use-openrouter` 時のみ実行し、`llm_grounding_score` に別記録
- `contentRecallFallback`（本文先頭 32 文字の substring 救済）は **AR のみ** に限定し、CR/TTL/LRU では旧事実への誤マッチを防ぐ

### Official MemoryAgentBench runner（§150 / §151）

Official dataset compatible runs are opt-in. The loader (`memoryagentbench-transform-v3`) splits large upstream `context` into document/session chunks before seeding memory:

- `Document N:` markers (Accurate_Retrieval)
- `Dialogue N:` markers (Test_Time_Learning)
- `Session N:` markers (fixture / session-style rows)
- numbered facts after `Here is a list of facts:` (Conflict_Resolution)
- paragraph-bounded fallback for very large single blobs (Long_Range_Understanding)
- every chunk is bounded to 64,000 chars (full) or 4,000 chars (smoke) even after marker splitting

`relevant_ids` point to chunks that contain the accepted answer alias or keypoint for each question. Three gates apply before publishing full results:

1. **Smoke** (`--limit N`): 4,000-char chunks, max 8 chunks/row, trimmed queries.
2. **Medium** (`--mab-row-limit N` without `--limit`): full 64KB chunking on N upstream rows (validates search at corpus scale).
3. **Full** (`--mab-split all`): all rows/chunks; run only after medium gate PASS.

`HarnessMemAdapter` uses `safe_mode` + `graph_weight: 0` for bounded in-process search on large MAB corpora. It dedupes ingest by scoped project + `memory.id` so multi-question rows do not re-record the same corpus across cases. Raw upstream rows stay in `benchmarks/internal-memory/.cache/` and must not be committed.

Full all-split transform (3,671 cases) still lists ~7.6M memory entries across cases, but only ~68k unique `memory.id` values are ingested after adapter dedupe; listed char volume remains ~4.3GB. Full run remains deferred until a dedicated benchmark window is available.

```bash
# default smoke (AR, limit 2)
bun run benchmark:memoryagentbench:smoke

# Per-split smoke (limit 2, harness-mem only)
bun run benchmark:memoryagentbench:smoke:ar
bun run benchmark:memoryagentbench:smoke:ttl
bun run benchmark:memoryagentbench:smoke:lru
bun run benchmark:memoryagentbench:smoke:cr

# Medium gate (full 64KB chunking, row 1 only — validates full-scale search)
bun run benchmark:memoryagentbench:medium:ar
bun run benchmark:memoryagentbench:medium:ttl
bun run benchmark:memoryagentbench:medium:lru
bun run benchmark:memoryagentbench:medium:cr

# Full all-split run with LLM judge (after medium gate PASS)
INTERNAL_BENCH_BUDGET_USD=50 bun run benchmark:memoryagentbench:openrouter -- --env-file /path/to/.env

# one split with custom limit
bun run benchmark:internal-memory -- --dataset memoryagentbench --mab-split Conflict_Resolution --limit 20 --competitors harness-mem

# full all-split run (downloads all splits; overwrites tracked reports/latest)
bun run benchmark:memoryagentbench
```

Raw upstream rows stay in `benchmarks/internal-memory/.cache/` (gitignored). `benchmarks/internal-memory/reports/latest/*` are tracked baseline artifacts: smoke/full runs overwrite them via `writeReportPack`. Review `git diff` after runs and restore the prior pack unless intentionally updating the baseline.

The loader records `dataset_id`, Hugging Face source URL, split, revision, sample limit, transform version, and cache directory in the report manifest. Official metric proxy output is written as `official_metric` and rendered in its own scorecard section; it must not be merged into internal `recall_at_10`, MRR, or nDCG. This support means "official dataset compatible runner", not a public superiority claim.

### 2026-05-28 時点の未カバー（S139-001 調査）

| 能力 | ギャップ | 対応 |
|------|---------|------|
| **CR** | 専用 `conflict_resolution` カテゴリが未整備 | S139-002 で ≥2 件追加済み |
| **TTL** | 専用 `test_time_learning` カテゴリが未整備 | S139-003 で ≥2 件追加済み |
| **LRU** | 長距離 multi-session（数十ターン以上）の synthetic ケースなし | `resume` / `handoff_resume` で代理評価。LongMemEval-V2 規模は主ゲート外 |
| **AR** | 公開互換 subset は 5 件のみ | 拡張は §138 follow-up |
