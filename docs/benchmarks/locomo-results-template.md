# LOCOMO Results Template

## Fixed Baseline & Gates

- Baseline (2026-02-20 lock):
  - `cat1-4 Judge Accuracy = 18.31%`（1540問）
  - `cat1-5 F1 = 7.06%`
  - `cat1-5 EM = 0.856%`
- Gate A:
  - `cat-1 >= 25%`, `cat-4 >= 35%`
- Gate B:
  - `cat-2 >= 35%`, `cat-3 >= 28%`
- Gate C:
  - Minimum: `cat1-4 Judge Accuracy 3-run mean >= 52%`
  - Stretch: `>= 60%`
  - Required together: `stddev <= 2.5pt`, `search p95 <= 25ms`, `token avg <= 450`

## Run Metadata

- Date:
- Commit:
- Dataset:
- Evaluator version:
- Judge config (model / temperature / prompt hash):
- Notes:

## Evidence Bundle Checklist（必須）

- [ ] `locomo10.run1.score-report.full.json`
- [ ] `locomo10.run2.score-report.full.json`
- [ ] `locomo10.run3.score-report.full.json`
- [ ] `locomo10.repro-report.json`
- [ ] `locomo10.failure-backlog.judged.json`
- [ ] `locomo10.failure-backlog.judged.md`
- [ ] `locomo10.run1.risk-notes.md`
- [ ] `locomo10.run2.risk-notes.md`
- [ ] `locomo10.run3.risk-notes.md`

## Summary

| Metric | Value |
| --- | --- |
| Baseline system | harness-mem |
| Compared systems | mem0, claude-mem, memos |
| Total QA count |  |
| External KPI (cat1-4 LLM Judge Accuracy) |  |
| Internal KPI (cat1-5 F1) |  |
| Search latency p95 (ms) |  |
| Search token avg / question |  |

## Gate Decision

| Gate | Condition | Result | Evidence |
| --- | --- | --- | --- |
| Gate A | cat-1 >= 25%, cat-4 >= 35% |  |  |
| Gate B | cat-2 >= 35%, cat-3 >= 28% |  |  |
| Gate C-min | cat1-4 Judge mean >= 52% |  |  |
| Gate C-stretch | cat1-4 Judge mean >= 60% |  |  |
| Stability | Judge stddev <= 2.5pt |  |  |
| Performance | search p95 <= 25ms |  |  |
| Cost | token avg <= 450 |  |  |

## System Comparison

| System | Judge Accuracy (cat1-4) | EM (cat1-5) | F1 (cat1-5) | Search p95 (ms) | Token avg | Verdict |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| harness-mem |  |  |  |  |  | baseline |
| mem0 |  |  |  |  |  |  |
| claude-mem |  |  |  |  |  |  |
| memos |  |  |  |  |  | scope gate required |

## Category Breakdown

| System | Category | Judge Accuracy | EM | F1 | QA Count |
| --- | --- | ---: | ---: | ---: | ---: |
| harness-mem | cat-1 |  |  |  |  |
| harness-mem | cat-2 |  |  |  |  |
| harness-mem | cat-3 |  |  |  |  |
| harness-mem | cat-4 |  |  |  |  |
| harness-mem | cat-5 | n/a |  |  |  |

## Reproducibility (3-run)

| Metric | Mean | Stddev | Min | Max |
| --- | ---: | ---: | ---: | ---: |
| Judge Accuracy (cat1-4) |  |  |  |  |
| Judge Accuracy (cat-1) |  |  |  |  |
| Judge Accuracy (cat-2) |  |  |  |  |
| Judge Accuracy (cat-3) |  |  |  |  |
| Judge Accuracy (cat-4) |  |  |  |  |
| F1 (cat1-5) |  |  |  |  |
| Search p95 (ms) |  |  |  |  |
| Token avg / question |  |  |  |  |

## Failure Backlog

1. Top 100 failures file:
2. Dominant tags:
3. Improvement tickets (owner / due / re-eval):
4. Rejection checks passed (yes/no):

## Risk Notes

1. Token/API limits:
2. Data-model mismatch:
3. Reproducibility concerns:
4. Publication rejection trigger hit?:

## Phase1 KPI/KGI/SLA 証跡（harness-mem-proof-pack）

`scripts/harness-mem-proof-pack.sh` で生成された証跡を記入する。

### 生成コマンド

```bash
scripts/harness-mem-proof-pack.sh --out-dir artifacts/proof-pack
```

### 導入 KPI

| 指標 | 基準値 | 実測値 | 合否 |
|---|---|---|---|
| セットアップコマンド数 | 1コマンド | 1 | |
| セットアップ所要時間 | 5分以内（300秒） | `setup-timing.json` 参照 | |
| doctor all green | 全項目 green | `doctor.json` 参照 | |
| smoke テスト | pass | `smoke.log` 参照 | |

### 同期 SLA

| 指標 | 基準値 | 実測値 | 合否 |
|---|---|---|---|
| 検索レイテンシ P95 | 3秒以内（3000ms） | `sla-latency.json` 参照 | |

### プライバシー証跡

| 指標 | 基準値 | 実測値 | 合否 |
|---|---|---|---|
| private デフォルト除外 | 漏洩 0件 | `privacy-audit.json` 参照 | |
| workspace 境界分離 | 混入 0件 | `boundary-check.json` 参照 | |

### 移行体験証跡

| 指標 | 基準値 | 実測値 | 合否 |
|---|---|---|---|
| migrate-from-claude-mem コマンド | 存在する | `migration-trail.json` 参照 | |
| rollback-claude-mem コマンド | 存在する | `migration-trail.json` 参照 | |

### KGI 継続性証跡

| 指標 | 基準値 | 実測値 | 合否 |
|---|---|---|---|
| correlation_id セッションチェーン | 追跡可能 | `kgi-continuity.json` 参照 | |

### Phase1 総合判定

- 証跡ファイル: `{timestamp}-phase1-summary.json`
- `phase1_pass`: （true / false）
- 判定日時:
