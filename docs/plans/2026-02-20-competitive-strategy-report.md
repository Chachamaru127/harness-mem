# Harness-mem Competitive Strategy Report (2026-02-20)

## 結論

最適戦略は「高スコア競争」単独ではなく、**低バイアス比較で証明された運用信頼性 + 5分導入体験**を同時達成すること。  
比較対象は `claude-mem` / `mem0` / `Backboard-Locomo-Benchmark` / `EverMemOS` / `memU`。

## 背景と目的

- 目的: `Claude-mem` や `mem0` を上回るための完成プロダクト像を定義する。
- 条件: 実装は行わず、マルチ視点の批判的議論でプランを収束させる。
- 追加条件: 4つの外部リポジトリを参考にしてブラッシュアップする。

## 参考リポジトリ

- <https://github.com/Backboard-io/Backboard-Locomo-Benchmark>
- <https://github.com/EverMind-AI/EverMemOS>
- <https://github.com/NevaMind-AI/memU>
- <https://github.com/thedotmack/claude-mem>

### 参照した主要補助URL

- <https://raw.githubusercontent.com/Backboard-io/Backboard-Locomo-Benchmark/main/locomo_ingest_eval.py>
- <https://raw.githubusercontent.com/EverMind-AI/EverMemOS/main/docs/ARCHITECTURE.md>
- <https://raw.githubusercontent.com/EverMind-AI/EverMemOS/main/evaluation/README.md>
- <https://docs.claude-mem.ai/search-tools>
- <https://docs.claude-mem.ai/private-tags>

## 市場の現状（2026-02-20時点）

- `claude-mem`: stars 29,430（配布力が強い）
- `memU`: stars 9,501（24/7訴求が強い）
- `EverMemOS`: stars 2,126（高スコア・多層設計）
- `Backboard-Locomo-Benchmark`: stars 9（比較手法の示唆は有用）

## 外部比較から得た示唆

### Backboard

- 学ぶべき点:
  - 評価パイプラインを公開して再現しやすい。
  - カテゴリ別表示で弱点が見える。
- 注意点:
  - `cat-5` 除外や寛容judgeでスコアが高めに出るリスク。

### EverMemOS

- 強み:
  - 高いLoCoMo主張値、役割分離された多層アーキテクチャ。
- 注意点:
  - オンラインAPI依存評価は再現性論点が残る。
  - 運用構成が重く、導入障壁が高くなりやすい。

### memU

- 強み:
  - `24/7 proactive memory` とコスト訴求でメッセージが強い。
- 注意点:
  - 誇張すると期待不一致の反動が大きい。

### claude-mem

- 強み:
  - 導入導線と配布規模が圧倒的。
  - 体験設計（3-layer、viewer、private tags）が完成して見える。
- 注意点:
  - ここに勝つには機能追加より導入体験・公開比較の証明が先。

## 相互批判ラウンドの収束結果

### 合意できた点

1. 低バイアス再現ベンチは必須。
2. 偽正常を潰す運用SLOは必須。
3. 配布強化は必要だが、品質ゲート前の拡販は危険。

### 意見が割れた点

- 優先順位:
  - A: ベンチ規格最優先
  - D: plugin-first導入最優先

### 最終判断

- 単一優先ではなく二段ゲート:
  1. Gate1: 運用品質・再現性
  2. Gate2: plugin-first配布加速

## ブラッシュアップ後の完成プラン（90日）

### 0-30日

1. 比較規格を固定（同一データ・同一評価器・同一出力形式）。
2. LoCoMoを `cat1-5` 分離 + 総合で標準化。
3. KPI: 比較再実行成功率 100%。

### 31-60日

1. 偽正常防止を含む運用SLOを定常運用。
2. KPI: 記録→検索→詳細のE2E成功率 99.5%以上。
3. KPI: `doctor healthy` 後24時間内の実利用失敗率 1%以下。

### 61-90日

1. plugin-first fast path で初回導入を短縮。
2. KPI: `TTFV` P75 15分以内。
3. KPI: 導入成功率 95%以上。

## 90日時点の勝利条件

1. 品質: 競合比較で主要指標が有意に非劣後以上。
2. 信頼: privacy重大事故 0。
3. 事業: 有償PoC 6件、本契約転換率 50%以上。

## 明確に捨てること

1. 単発スコアを盛る最適化。
2. 全方位同時拡張。
3. 「完全上位互換」「全部入り」訴求。

## 最終ポジショニング文

`harness-mem` は、複数AIツール運用チーム向けに、ローカル主権のまま記憶の再現性と運用信頼性を数値証明するメモリ基盤。

## 補足

- ユーザー要望により、本ラウンドは `claude -p` 連携を最終的に実施せず、既存マルチエージェント討論で収束した。

## Phase1 Multi-Tool UX Superiority 成果（2026-02-21 実装完了）

Phase1 で実装・確認された機能と証跡を記録する。

### 実装済み機能

| 機能 | ステータス | 実装ファイル |
|---|---|---|
| correlation_id ツール横断セッション継続 | 完了 | `memory-server/src/core/harness-mem-core.ts` |
| workspace 境界厳格分離（normalizeProjectName + symlink解決） | 完了 | `memory-server/src/core/harness-mem-core.ts:367` |
| private タグ監査ログ（privacy_filter） | 完了 | `memory-server/src/core/harness-mem-core.ts` |
| migrate-from-claude-mem 1コマンド移行 | 完了 | `scripts/harness-mem` |
| rollback-claude-mem ロールバック導線 | 完了 | `scripts/harness-mem` |
| Phase1 証跡収集スクリプト | 完了 | `scripts/harness-mem-proof-pack.sh` |

### Phase1 KPI 達成状況

| KPI | 基準値 | 証跡 |
|---|---|---|
| セットアップ | 1コマンド/5分以内 | `scripts/harness-mem-proof-pack.sh` Step 3 |
| doctor all green | 全項目 green | `scripts/harness-mem-proof-pack.sh` Step 1 |
| 検索 SLA P95 | 3秒以内 | `scripts/harness-mem-proof-pack.sh` Step 4 |
| privacy デフォルト除外 | 漏洩 0件 | `scripts/harness-mem-proof-pack.sh` Step 5 |
| workspace 境界分離 | 混入 0件 | `memory-server/tests/unit/workspace-boundary.test.ts` |
| 移行 1コマンド完結 | import→verify→cutover | `scripts/harness-mem migrate-from-claude-mem` |
| rollback 導線 | 実装済み | `scripts/harness-mem rollback-claude-mem` |

### 証跡収集コマンド

```bash
scripts/harness-mem-proof-pack.sh --out-dir artifacts/proof-pack
```

---

## LoCoMo 実装レビュー用 Gate 定義（2026-02-20 固定）

### Baseline（比較原点）

1. `cat1-4 LLM Judge Accuracy = 18.31%`（1540問）
2. `cat1-5 F1 = 7.06%`
3. `cat1-5 EM = 0.856%`

### Gate A / B / C

1. Gate A（回答器完成）
   - `cat-1 Judge Accuracy >= 25%`
   - `cat-4 Judge Accuracy >= 35%`
2. Gate B（時系列・multi-hop）
   - `cat-2 Judge Accuracy >= 35%`
   - `cat-3 Judge Accuracy >= 28%`
3. Gate C（公開判定）
   - 最低ライン: `cat1-4 Judge Accuracy 3-run mean >= 52%`
   - ストレッチ: `>= 60%`
   - 追加条件: `stddev <= 2.5pt`、`search p95 <= 25ms`、`token avg <= 450`

### 却下条件（公開停止）

1. 同一 dataset / 同一 judge 設定 / 同一カテゴリ集計でない比較結果。
2. `full score report / repro report / failure backlog / risk notes` の欠落。
3. 3-run で `mean/stddev/min/max` が未提示。
4. Gate C最低ライン未達、または `stddev` / `p95` / `token avg` の閾値超過。
