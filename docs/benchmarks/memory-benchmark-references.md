# Memory Benchmark Reference Survey (§139)

策定日: 2026-05-28  
Companion: `Plans.md` §139 / `Spec.md` Benchmark And Competitive Evaluation

案 A 確定時の調査証跡。内部ベンチ（`benchmarks/internal-memory/`）の設計判断に使った外部ベンチマークと競合の出典を1枚にまとめる。

## 採用判断サマリ（案 A）

| 判断 | 内容 |
|------|------|
| 能力語彙 | MemoryAgentBench の 4 能力（AR / TTL / LRU / CR）を標準語彙とする |
| 採点 | 二段構え — AR/CR は substring baseline、TTL/LRU は LLM judge 補完 |
| 主ゲート | developer-domain（日本語・混在 coding-memory）+ 公開互換 subset |
| LoCoMo full | 主ゲートにしない（domain mismatch、`Plans.md` §78） |
| 競合比較 | harness-mem のみ reproduced 既定。他は published(reference-only) |

---

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
| FactConsolidation 風 CR | `conflict_resolution` カテゴリ ≥2 件（`coding-memory-ja-mixed-v1.jsonl`） |
| TTL 評価 | `test_time_learning` カテゴリ ≥2 件 |
| LoCoMo-Plus 批判 | AR/CR substring と TTL/LRU LLM judge の分離（`score-case.ts`） |
| LongMemEval | manifest 参照のみ、LRU 代理は `resume` layer |

---

## 変更履歴

- 2026-05-28: §139 S139-005 初版（案 A 調査証跡）
