# CodingMemory Bench Charter（日本語）

策定日: 2026-06-06  
Companion: `Spec.md` Public CodingMemory Benchmark / `Plans.md` §153

## 名称と目的

**CodingMemory Bench** は、日本語・日英混在の AI コーディングセッション記憶を測る developer-domain 向けベンチマークです。

- MemoryAgentBench（英語・百科型）の **補完** であり、置き換えではない
- 主戦場: Claude Code / Codex / Cursor 由来の hook JSON、判断メモ、PR/issue、混在 query
- 公開 claim の上限: **同 dataset / 同 scorer / 同 manifest で reproduced した数値のみ**

## 対象ユーザー

- 日本語・混在 coding memory を扱うプロダクトオーナー / エンジニア
- developer-workflow 記憶の retrieval 品質を第三者が再現したい評価者
- MemoryAgentBench 4 能力語彙を coding domain に適用したい研究者

## 4 能力（MemoryAgentBench 互換）

| 能力 | 略称 | CodingMemory で測ること |
|------|------|-------------------------|
| Accurate Retrieval | AR | 正しい fact / memory fragment の検索 |
| Test-Time Learning | TTL | 直近の訂正・指示を後続 query に反映 |
| Long-Range Understanding | LRU | 離れた turn / session 間の fact 接続 |
| Conflict Resolution | CR | 新 fact を旧 fact より優先 |

## 非目標

- LoCoMo full / general-lifelog を主ゲートにすること
- MemoryAgentBench 英語百科スコアを CodingMemory の代理 KPI にすること
- raw 生ログ・PII mapping の公開 commit
- harness-mem self-seed 満点のみの優位主張
- published(reference-only) と reproduced の混載ランキング

## データセット

- Dataset id: `coding-memory-real-ja-mixed-v3`（以降 v3 系）
- 1400+ 件、各能力 ≥350、PII 不可逆マスク済み JSONL
- 推奨統計: mixed ≥ 90%、en 纯 ≥ 5%、platform メタ（claude / codex / cursor）
- Hugging Face 公開時は dataset 単体 LICENSE（CC-BY-4.0 + PII 注記）を card に明記

## 採点の透明性

公開表は **ID recall@10 を主指標** とし、以下を副次または別表で記載する。

- **ID recall**: `relevant_ids` のいずれかが top-10 に含まれるか（主）
- **Content fallback（AR substring）**: 回答断片が hit content に substring 一致する救済（副。self-seed 有利バイアスに注意）

TTL/LRU は LLM judge 補完を別フィールドとして扱い、substring  recall と混同しない。

## Reproduced 競合（公開版 minimum）

同一 v3 dataset / scorer / manifest で live 計測:

1. harness-mem（production search profile: `HARNESS_MEM_INTERNAL_BENCH_EMBEDDING=1`）
2. Agentmemory（localhost REST、seed + smart-search）
3. Supermemory（API credential 必須、ingest + search）

Mem0 live は Optional stretch。credential 未設定時は skip を manifest に記録する。

## Claim 上限（claim_safety）

**載せてよい**

- reproduced 3-system 表、per-competency breakdown
- reproducibility env（secret は set/unset のみ）
- 「日本語・混在 coding memory 向けベンチマークを提唱する」という bounded 提唱

**載せてはいけない**

- 「業界最高」「MAB より優位」（domain 不同）
- self-seed harness-mem 満点のみの優位主張
- hash fallback embedding profile を public baseline として提示すること

## 再現手順

```bash
# Schema + PII gate
bun test benchmarks/internal-memory/tests/
cd benchmarks/internal-memory/pii && python3 -m pytest

# Public smoke (v3, limit 20)
npm run benchmark:codingmemory:smoke

# Full public reproduced run (operator window)
npm run benchmark:codingmemory:public
```

成果物: `benchmarks/internal-memory/reports/codingmemory-public/`
