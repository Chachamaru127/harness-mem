# LOCOMO Runbook

## Baseline（固定値）

1. 比較基準は 2026-02-20 時点の下記を固定値として扱う。
   - `cat1-4 LLM Judge Accuracy = 18.31%`（1540問）
   - `cat1-5 F1 = 7.06%`
   - `cat1-5 EM = 0.856%`
2. この固定値を更新する場合は、同一 dataset / 同一 judge 設定 / 同一カテゴリ集計で3-run再計測し、結果JSONと再現レポートを同時更新する。

## Gate Definition（固定）

1. Gate A（回答器完成）
   - `cat-1 Judge Accuracy >= 25%`
   - `cat-4 Judge Accuracy >= 35%`
   - 100問スモークと全件再計測の両方で達成すること。
2. Gate B（時系列/multi-hop）
   - `cat-2 Judge Accuracy >= 35%`
   - `cat-3 Judge Accuracy >= 28%`
3. Gate C（公開前最終）
   - 最低ライン: `cat1-4 Judge Accuracy 3-run mean >= 52%`
   - ストレッチ: `cat1-4 Judge Accuracy 3-run mean >= 60%`
   - 追加必須: `stddev <= 2.5pt`, `search p95 <= 25ms`, `token avg <= 450`

## Rejection Rules（却下条件）

1. 同一 dataset / 同一 judge 設定 / 同一カテゴリ集計でない比較は却下。
2. `full score report / repro report / failure backlog / risk notes` が1つでも欠ける run は却下。
3. 3-run 集計で `mean/stddev/min/max` が揃っていない提出は却下。
4. Gate C 最低ライン（52%）未満、または `stddev` / `p95` / `token avg` の閾値超過は公開却下。

## Reviewer Checklist（提出前チェック）

1. 3-run の各 run に対して以下4成果物が存在すること。
   - `locomo10.runX.score-report.full.json`
   - `locomo10.runX.repro-report.json`（または3-run集約に含まれる根拠）
   - `locomo10.runX.failure-backlog.judged.json/.md`
   - `locomo10.runX.risk-notes.md`
2. 比較表には必ず `Judge Accuracy（cat1-4）/ EM / F1 / search p95 / token avg` を同時掲載すること。
3. 失敗タグ上位の改善チケット（担当・期限・再評価結果）を failure backlog に紐づけること。

## データ配置

1. LoCoMoデータを `tests/benchmarks/fixtures/` またはローカル作業ディレクトリへ配置する。
2. 最小確認は `tests/benchmarks/fixtures/locomo10.sample.json` を使う。
3. 本番評価では `locomo10.json` など実データへの絶対/相対パスを指定する。

## 実行手順

1. 契約/ローダーテスト:
   - `bun test tests/benchmarks/locomo-dataset-contract.test.ts tests/benchmarks/locomo-loader.test.ts`
2. harness-mem 単独ベンチ:
   - `bun run tests/benchmarks/run-locomo-benchmark.ts --system harness-mem --dataset .tmp/locomo/locomo10.json --output .tmp/locomo/locomo10.result.json`
3. LLM Judge（cat1-4）:
   - `bun --env-file=.env run tests/benchmarks/locomo-judge.ts --result .tmp/locomo/locomo10.result.json --categories cat-1,cat-2,cat-3,cat-4 --output .tmp/locomo/locomo10.judge.cat1-4.json`
4. 統合スコアレポート:
   - `bun run tests/benchmarks/locomo-score-report.ts --result .tmp/locomo/locomo10.result.json --judge-result .tmp/locomo/locomo10.judge.cat1-4.json --output .tmp/locomo/locomo10.score-report.full.json`
5. 再現性集計（3-run平均 + 分散）:
   - `bun run tests/benchmarks/locomo-repro-report.ts --reports run1.score-report.full.json,run2.score-report.full.json,run3.score-report.full.json --output .tmp/locomo/locomo10.repro-report.json`
6. 失点上位100問の抽出:
   - `bun run tests/benchmarks/locomo-failure-backlog.ts --result .tmp/locomo/locomo10.result.json --judge-result .tmp/locomo/locomo10.judge.cat1-4.json --limit 100 --output .tmp/locomo/locomo10.failure-backlog.json --markdown-output .tmp/locomo/locomo10.failure-backlog.md`
7. 比較アダプタ検証:
   - `bun test tests/benchmarks/locomo-mem0-adapter.test.ts tests/benchmarks/locomo-claude-mem-adapter.test.ts`
8. run別リスクノート（レビュー提出物）:
   - `cat > .tmp/locomo/locomo10.runX.risk-notes.md <<'EOF'`
   - `# Run X Risk Notes`
   - `- gate_status: pass|fail`
   - `- residual_risks: ...`
   - `- next_actions: ...`
   - `EOF`

## 再現条件

1. `bun` バージョンを固定（CIでは `1.3.6`）。
2. 同じデータセットパスと同じ評価器（EM/F1）を使う。
3. Judge Accuracy比較時は `cat-1..4` と同一judge設定（model/temperature/prompt）を固定する。
4. 比較時は同一質問セット・同一カテゴリ集計を維持する。
5. 結果JSONをartifactまたはローカルに保存し、ドリフト判定に使う。

## APIキーとコスト注意

1. APIキー:
   - `mem0` / `claude-mem` 接続時は token を環境変数で渡し、ログに出力しない。
2. コスト:
   - LLM Judgeを使う拡張評価はコストが増えるため、夜間定期ジョブで実行する。
3. セキュリティ:
   - `.env` をコミットしない（`.gitignore` 管理）。

## 改善ループ（Failure Backlog）

1. `locomo-failure-backlog.json` の `dominant tags` を見て、次スプリントの優先改善を決定する。
2. 失点上位100問をチケット化し、改善後に同じ100問で再評価する。
3. 改善前後で `Judge Accuracy`, `F1`, `search p95`, `token avg` を必ず併記して判断する。

## Phase1 証跡収集手順

Phase1 Multi-Tool UX Superiority の KPI/KGI/SLA/privacy/migration 証跡を自動収集する。

### 事前条件

- `bun`, `curl`, `jq` が利用可能なこと
- daemon が起動済みであること（`scripts/harness-memd start`）

### 実行コマンド

```bash
# Phase1 全証跡を収集
scripts/harness-mem-proof-pack.sh

# 出力先を指定する場合
scripts/harness-mem-proof-pack.sh --out-dir /tmp/proof-pack-$(date +%Y%m%d)

# daemon 起動後すぐ確認したい場合（latency 計測省略）
scripts/harness-mem-proof-pack.sh --skip-latency

# 3-run freeze review（提出物4JSON + 必須ゲート + 連続pass）
scripts/freeze-review.sh

# Human Eval gate（5名以上/ID重複なし/わかりやすい>=80）
scripts/verify-human-eval.sh artifacts/human-eval/report.json
```

### 生成される証跡ファイル

| ファイル | 内容 |
|---|---|
| `{ts}-health.json` | daemon ヘルス（起動確認） |
| `{ts}-doctor.json` | doctor --json 出力（all_green 確認） |
| `{ts}-smoke.log` | smoke テスト実行ログ |
| `{ts}-setup-timing.json` | セットアップ所要時間（KPI: 5分以内） |
| `{ts}-sla-latency.json` | 検索レイテンシ P95（SLA: 3秒以内） |
| `{ts}-privacy-audit.json` | private イベントのデフォルト除外確認 |
| `{ts}-boundary-check.json` | フォルダ境界分離確認（混入 0件） |
| `{ts}-migration-trail.json` | 移行コマンド存在確認 |
| `{ts}-kgi-continuity.json` | correlation_id セッションチェーン確認 |
| `{ts}-phase1-summary.json` | Phase1 KPI/KGI/SLA 集計サマリ |
| `onboarding-report.json` | 導入体験レポート（1コマンド導入/セットアップ指標） |
| `continuity-report.json` | 継続率レポート（`continuity_rate_pct` / 95%閾値） |
| `privacy-boundary-report.json` | privacy/boundary 漏えい件数レポート |
| `session-selfcheck-report.json` | セッション開始 self-check 状態レポート |

### 合格基準

`{ts}-phase1-summary.json` の `phase1_pass: true` を確認する。

| チェック項目 | 合格条件 |
|---|---|
| doctor all green | `doctor_all_green: true` |
| セットアップ時間 | `setup_time_seconds < 300` |
| 検索 SLA P95 | `search_p95_ms < 3000` |
| privacy デフォルト除外 | `default_excluded: true` |
| workspace 境界分離 | `isolation: true` |
| 移行コマンド | `migrate_command_available: true` |
| rollback コマンド | `rollback_command_available: true` |
| correlation_id チェーン | `correlation_id_chain: true` |

`scripts/freeze-review.sh` では以下を run ごとに必須チェックする。

- 漏えい 0（`privacy.leak_count == 0`）
- 境界漏れ 0（`boundary.leak_count == 0`）
- 継続率 95%以上（`continuity_rate_pct >= 95`）
- 1コマンド導入（`one_command_onboarding == true`）
- 提出物4JSON不足なし
- 3-run 連続pass
