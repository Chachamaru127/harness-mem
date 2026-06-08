# Memory Benchmark Reference Survey (§139)

策定日: 2026-05-28  
Companion: `Plans.md` §139 / `Spec.md` Benchmark And Competitive Evaluation

案 A 確定時の調査証跡。内部ベンチ（`benchmarks/internal-memory/`）の設計判断に使った外部ベンチマークと競合の出典を1枚にまとめる。

## 採用判断サマリ（案 A）

| 判断 | 内容 |
|------|------|
| 能力語彙 | MemoryAgentBench の 4 能力（AR / TTL / LRU / CR）を標準語彙とする |
| 採点 | 二段構え — AR/CR は substring baseline、TTL/LRU は LLM judge 補完 |
| 主ゲート | developer-domain（日本語・混在 coding-memory）+ CodingMemory Bench v3 + 公開互換 subset |
| LoCoMo full | 主ゲートにしない（domain mismatch、`Plans.md` §78） |
| 競合比較 | harness-mem reproduced 既定。公開 CodingMemory 表は harness-mem + Agentmemory + Supermemory を同条件 reproduced。他は published(reference-only) |

---

## CodingMemory Bench（§153 公開提唱）

**出典**

- Charter: [`codingmemory-bench-charter.md`](./codingmemory-bench-charter.md)
- Advocacy: [`codingmemory-bench.md`](./codingmemory-bench.md)
- Dataset: `benchmarks/internal-memory/datasets/coding-memory-real-ja-mixed-v3.jsonl`
- Public scorecard: `benchmarks/internal-memory/reports/codingmemory-public/`

**要点**

- 日本語・日英混在 AI コーディングセッション記憶（Claude Code / Codex / Cursor 由来）
- MemoryAgentBench 互換 4 能力（AR / TTL / LRU / CR）
- 1400+ PII マスク済み Q&A、optional `source_platform` metadata
- 公開 claim は reproduced 3-system 表 + manifest のみ（self-seed 満点・MAB 英語スコアは不可）

```bash
# v3 build (v2 + platform metadata)
npm run benchmark:codingmemory:build-v3

# Smoke (v3, limit 20)
npm run benchmark:codingmemory:smoke

# Public reproduced run (operator window)
npm run benchmark:codingmemory:public
```

Claim safety: ID recall@10 を主指標とし、content substring fallback は副次。hash fallback embedding profile を public baseline として提示しない。

## MemoryAgentBench

**出典**

- 論文: [Evaluating Memory in LLM Agents via Incremental Multi-Turn Interactions](https://arxiv.org/abs/2507.05257) (ICLR 2026)
- コード: [HUST-AI-HYZ/MemoryAgentBench](https://github.com/HUST-AI-HYZ/MemoryAgentBench)
- データ: [ai-hyz/MemoryAgentBench](https://huggingface.co/datasets/ai-hyz/MemoryAgentBench)

**要点**

- LLM エージェントの記憶を **incremental multi-turn** 形式で評価する統一ベンチ
- 4 能力: Accurate Retrieval / Test-Time Learning / Long-Range Understanding / Conflict Resolution（Selective Forgetting）
- FactConsolidation データセットで矛盾解決（旧事実の上書き）を測定

**採用理由**

- 4 能力語彙が harness-mem の retrieval / resume / temporal / conflict ニーズと直結
- 内部 jsonl ケースの `competency` / `category` マッピングの正本として採用（案 A）

**Official dataset runner (§150 / §151)**

- Dataset: Hugging Face [`ai-hyz/MemoryAgentBench`](https://huggingface.co/datasets/ai-hyz/MemoryAgentBench)
- Known HF revision used by the runner default: `00d1946269e29b41eed74511997afa8171b91e08`
- Transform version: `memoryagentbench-transform-v3` — splits large `context` into document/session chunks (`Document N:`, `Dialogue N:`, numbered facts, haystack sessions), bounds every chunk to 64KB (full) or 4KB (smoke), and maps `relevant_ids` to answer-containing chunks; `HarnessMemAdapter` dedupes ingest by scoped project + `memory.id`
- Format exposed by HF: parquet, accessed through the datasets-server rows JSON API to avoid adding a parquet dependency
- Splits: `Accurate_Retrieval`, `Test_Time_Learning`, `Long_Range_Understanding`, `Conflict_Resolution`
- Local cache: `benchmarks/internal-memory/.cache/` (gitignored). Raw upstream data must not be committed.
- Reports: `benchmarks/internal-memory/reports/latest/` (tracked baseline). Smoke/full runs overwrite this pack via `writeReportPack`. Review `git diff` after runs and restore the prior pack unless intentionally updating the baseline.

```bash
# Smoke: default AR sample (limit 2), no OpenRouter required
bun run benchmark:memoryagentbench:smoke

# Per-split smoke (limit 2 each)
bun run benchmark:memoryagentbench:smoke:ar
bun run benchmark:memoryagentbench:smoke:ttl
bun run benchmark:memoryagentbench:smoke:lru
bun run benchmark:memoryagentbench:smoke:cr

# Medium gate (full 64KB chunking, row 1)
bun run benchmark:memoryagentbench:medium:ar
bun run benchmark:memoryagentbench:medium:ttl
bun run benchmark:memoryagentbench:medium:lru
bun run benchmark:memoryagentbench:medium:cr

# Full compatible runner over all four splits (after medium gate PASS)
bun run benchmark:memoryagentbench

# Full all-split + OpenRouter LLM judge
INTERNAL_BENCH_BUDGET_USD=50 bun run benchmark:memoryagentbench:openrouter -- --env-file /path/to/.env
```

Full all-split transform (revision `00d19462…`, no limit) produces 3,671 cases and ~68k unique memory ids. AR row 1 alone seeds 1,204 × 64KB chunks; medium gate (`--mab-row-limit 1`) completes in ~15s on a warm machine after the safe_mode search path fix. Full run wall-clock remains high — schedule a dedicated operator window after medium gate PASS on every split.

Smoke notes: `--limit` caps seeded chunks to 8 × 4,000 chars and trims oversized LRU-style queries. Medium gate uses `--mab-row-limit` without `--limit` so chunking stays at 64KB while upstream rows are capped.

Claim safety: this is an official dataset compatible runner. `official_metric` is a retrieval-output proxy and is rendered separately from internal `recall_at_10` / MRR / nDCG. Do not use these runs as superiority claims unless competing systems are reproduced on the same dataset revision, transform manifest, scorer, and hardware.

---

## LongMemEval-V2

**出典**

- 論文: [LongMemEval-V2: Evaluating Long-Term Agent Memory Toward Experienced Colleagues](https://arxiv.org/html/2605.12493v1)
- V1 コード: [xiaowu0162/LongMemEval](https://github.com/xiaowu0162/LongMemEval)
- V2 コード: [xiaowu0162/LongMemEval-V2](https://github.com/xiaowu0162/LongMemEval-V2)

**要点**

- ユーザ–アシスタント / Web エージェント文脈での長期記憶評価
- 動的更新・経験蓄積（experienced colleague）を強調
- V1 は ICLR 2025、V2 は agentic 長コンテキストへ拡張

**採用理由**

- LRU（Long-Range Understanding）の外部参照軸として有用
- 内部ベンチでは `datasets/longmemeval-s-manifest.json` で fixture 参照のみ。フルデータは主ゲート外（コスト・domain mismatch）

---

## LoCoMo-Plus

**出典**

- 論文: [LoCoMo-Plus: Beyond-Factual Cognitive Memory Evaluation Framework for LLM Agents](https://arxiv.org/html/2602.10715v1)
- コード: [xjtuleeyf/Locomo-Plus](https://github.com/xjtuleeyf/Locomo-Plus)

**要点**

- LoCoMo 系の **factual recall 超え** — cue–trigger semantic disconnect 下での cognitive memory
- 従来の string-matching 指標が不適切なケースを constraint-consistency 評価で測る
- LoCoMo full を主ゲートにしない根拠の文献補強（`Plans.md` §78 domain mismatch と整合）

**採用理由**

- 二段採点（substring + LLM judge）採用の理論的根拠
- exact-match だけでは memory capability と prompt adaptation が混ざるという批判を内部 claim_safety に反映

---

## agentmemory（競合スロット）

**出典**

- 内部 adapter: `benchmarks/internal-memory/adapters/agentmemory.ts`
- manifest: `benchmarks/internal-memory/competitors.manifest.json`
- 関連業界ベンチ（参考）: [vectorize-io/agent-memory-benchmark](https://github.com/vectorize-io/agent-memory-benchmark) / [agentmemorybenchmark.ai](https://agentmemorybenchmark.ai/)

**要点**

- harness-mem 内部ベンチの **published(reference-only)** 競合スロットの一つ
- 公称 retrieval@10 ベンチマークは未整備。`--competitors agentmemory` + `AGENTMEMORY_BASE_URL` で opt-in 実測
- HTTP ingest/search API 互換アダプタで比較可能

**採用理由**

- 公平性ルール（reproduced vs published 分離）の実装対象として manifest に登録
- 外部 AMB 等は apples-to-apples 比較の参考だが、内部 developer-domain ゲートとは domain が異なるため主ゲートにしない

---

## 内部実装への反映

| 外部参照 | 内部反映 |
|---------|---------|
| MemoryAgentBench 4 能力 | `README.md` マッピング表、`competency` フィールド、`scorers/competency.ts` |
| MemoryAgentBench official dataset | `lib/memoryagentbench-loader.ts`, `--dataset memoryagentbench`, `.cache/` manifest, separate `official_metric` |
| FactConsolidation 風 CR | `conflict_resolution` カテゴリ ≥2 件（`coding-memory-ja-mixed-v1.jsonl`） |
| TTL 評価 | `test_time_learning` カテゴリ ≥2 件 |
| LoCoMo-Plus 批判 | AR/CR substring と TTL/LRU LLM judge の分離（`score-case.ts`） |
| LongMemEval | manifest 参照のみ、LRU 代理は `resume` layer |

---

## 変更履歴

- 2026-06-05: §150 official dataset compatible runner / smoke commands / claim safety を追記
- 2026-05-28: §139 S139-005 初版（案 A 調査証跡）
