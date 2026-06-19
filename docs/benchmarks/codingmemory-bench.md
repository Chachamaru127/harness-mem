# CodingMemory Bench — 提唱ページ

日本語・日英混在の AI コーディングセッション記憶を測る、developer-domain 向け公開ベンチマーク **CodingMemory Bench** を提唱します。

> 数値は [`benchmarks/internal-memory/reports/codingmemory-public/`](../benchmarks/internal-memory/reports/codingmemory-public/) の reproduced scorecard のみを公開 claim として扱います。README や本ページに数値を載せる場合は必ずその manifest を参照してください。

## なぜ必要か

- MemoryAgentBench は英語百科型の excellent baseline ですが、**Claude Code / Codex / Cursor の hook JSON・判断メモ・混在 query** とは domain が異なります
- LoCoMo / general-lifelog 系ベンチも developer-workflow の主 KPI にはなりません
- 日本語・混在 coding memory 向けに、**同条件 reproduced 比較** 可能な dataset + scorer + manifest が不足していました

CodingMemory Bench はこの gap を埋める **Tier B 公開**（Hugging Face dataset + 提唱ドキュメント + reproduced scorecard）です。

## 何を測るか

- **1400+** マスク済み Q&A（dataset id: `coding-memory-real-ja-mixed-v3`）
- MemoryAgentBench 互換 **4 能力**: AR / TTL / LRU / CR
- 言語: 日本語・日英混在（mixed ≥ 90% 目標）
- 由来: harness-mem.db から export した実 coding session ログ（PII 不可逆マスク）

詳細: [charter（JA）](./codingmemory-bench-charter.md) / [charter（EN）](./codingmemory-bench-charter-en.md)

## どう再現するか

### 1. データセット

- ローカル: `benchmarks/internal-memory/datasets/coding-memory-real-ja-mixed-v3.jsonl`
- Dataset card: [`benchmarks/internal-memory/datasets/dataset-card.md`](../benchmarks/internal-memory/datasets/dataset-card.md)
- Hugging Face: `PLACEHOLDER_HF_DATASET_URL`（S153-023 公開後に revision id を manifest へ記録）

```bash
# v3 生成（export → mask → filter → judge）
npm run benchmark:internal-memory:real-data-pipeline -- \
  --corpus-limit 50000 --target-per-competency 350 --dataset-version v3

# v2 から platform メタ付与で v3 を構築（高速パス）
npm run benchmark:codingmemory:build-v3
```

### 2. 品質ゲート

```bash
bun test benchmarks/internal-memory/tests/
npm run benchmark:internal-memory:pii-test
npm run benchmark:codingmemory:smoke
```

### 3. Public reproduced run

```bash
# Production embedding profile（ONNX/adaptive 相当）
npm run benchmark:codingmemory:public
```

競合: `harness-mem`, `agentmemory`, `supermemory`（同一 dataset / scorer / manifest）

- `AGENTMEMORY_URL` デフォルト `http://127.0.0.1:3111`
- `SUPERMEMORY_API_KEY` 未設定時は skip を scorecard に記録

### 4. 成果物

| ファイル | 内容 |
|---------|------|
| `summary.json` | run id、git sha、competitor 別 metrics |
| `scorecard.md` | reproduced 表（published とは分離） |
| `reproducibility.md` | env set/unset、embedding profile、HF revision |
| `dashboard.html` | 可視化 |

## Claim safety（読者向け注意）

- harness-mem は benchmark case を in-process seed するため、**self-seed 満点は実装健全性の確認に留め**、競合優位の根拠にしません
- MemoryAgentBench 英語スコアと CodingMemory スコアは **domain が異なる** ため直接比較しません
- 公開表は **ID recall@10 主** + content fallback 副次として charter に明記します

## 関連リンク

- [Memory benchmark references](./memory-benchmark-references.md)
- [Spec.md Public CodingMemory Benchmark](../../Spec.md)
- [Plans.md §153](../../Plans.md)
