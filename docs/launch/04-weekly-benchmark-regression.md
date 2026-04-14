# Weekly Benchmark + Regression Detection 仕様書

策定日: 2026-04-14
対象: Pro API サーバーの週次品質ゲートと shadow deploy
関連: [01-pro-api-concierge-spec.md](./01-pro-api-concierge-spec.md) / [02-feedback-signal-collection.md](./02-feedback-signal-collection.md) / [03-pricing-plans.md](./03-pricing-plans.md)

## 1. 目的

自動学習 ([02-feedback-signal-collection.md](./02-feedback-signal-collection.md) の信号を fine-tune に流す) の **暴走リスク** を封じ、顧客に退化を露出させないための **週次ゲート + shadow deploy** を定義する。

併せて、ベンチ結果を公開することで **透明性そのものを差別化** に変える。

## 2. アーキテクチャ

```
                    ┌──────────────┐
                    │  Cron (日曜   │
                    │  03:00 JST)   │
                    └──────┬───────┘
                           │
                ┌──────────▼──────────┐
                │  Bench Runner       │
                │  (GitHub Actions)   │
                └─────┬────────┬──────┘
                      │        │
          ┌───────────▼┐     ┌─▼───────────┐
          │ Call API   │     │ Call API    │
          │ against    │     │ against     │
          │ stable     │     │ candidate   │
          │ endpoint   │     │ endpoint    │
          └───────┬────┘     └──────┬──────┘
                  │                 │
              ┌───▼─────────────────▼───┐
              │ Compare + Regression    │
              │ Gate Evaluation         │
              └────────┬────────────────┘
                       │
            ┌──────────▼──────────┐
            │ Verdict:            │
            │  - PASS → promote   │
            │  - FAIL → rollback  │
            │  - WARN → human     │
            └────────┬────────────┘
                     │
         ┌───────────▼───────────┐
         │ Outputs:              │
         │  1. Slack alert       │
         │  2. ci-run-manifest-pro-
         │     2026-W16.json     │
         │  3. Public dashboard  │
         │     (harness-mem.jp   │
         │      /transparency)   │
         └───────────────────────┘
```

## 3. Shadow Deploy の構成

Pro サーバーを **candidate と stable の 2 系統** に分ける。

```
Fly.io app: harness-mem-pro-api
  ├── process group "stable"      → 本番 traffic 100%
  └── process group "candidate"   → bench traffic のみ

DNS / routing:
  https://api.canai.jp/v1/*         → stable
  https://api-canary.canai.jp/v1/*  → candidate (internal only)
```

### デプロイフロー

1. 新モデル (fine-tune 済み or パラメータ変更) → **candidate に deploy**
2. 週次ベンチで candidate 評価
3. PASS → stable に昇格、本番切替 (blue/green)
4. FAIL → candidate 破棄、stable 維持
5. **本番 traffic は常に検証済みの stable モデルのみが処理** → 顧客に退化の影響を与えない

## 4. Regression Gates

Plans §78 (World-class Retrieval) の Global DoD に対応する品質 4 指標と、Pro 固有の 3 指標。

| カテゴリ | 指標 | 退化判定条件 | 対応 |
|---|---|---|---|
| 品質 (Layer 1) | dev-workflow recall@10 | 前週比 -0.02 OR 絶対値 < 0.60 | auto-rollback |
| 品質 (Layer 1) | bilingual recall@10 | 前週比 -0.02 OR 絶対値 < 0.86 | auto-rollback |
| 品質 (Layer 1) | knowledge-update freshness | 絶対値 < 0.93 | auto-rollback |
| 品質 (Layer 1) | temporal ordering | 前週比 -0.03 OR 絶対値 < 0.60 | auto-rollback |
| 性能 | Pro search p95 | 前週比 1.5 倍 超 OR 800ms 超 | alert + human review |
| 性能 | Pro error rate | 1% 超 | auto-rollback |
| 信号 | feedback positive rate | 前週比 -10% | alert (即 rollback はしない) |

### 2 週連続退化の扱い

Layer 1 品質が 2 週連続で退化した場合:

1. **全 candidate モデルを破棄**
2. 学習パイプラインを pause
3. **人間介入フェーズへ** (data quality / 信号分布の再調査)
4. 根本原因が判明するまで stable を固定

## 5. 週次実行フロー

```
毎週日曜 03:00 JST (UTC 月曜 18:00)
  │
  ├─ 1. 固定 fixture 取得
  │   ├─ LoCoMo-120
  │   ├─ bilingual-50
  │   ├─ dev-workflow-20
  │   ├─ knowledge-update-100
  │   └─ temporal-100-v2
  │
  ├─ 2. stable endpoint に対してベンチ実行
  ├─ 3. candidate endpoint に対してベンチ実行
  ├─ 4. 前週の stable 結果と candidate 結果を diff
  ├─ 5. Gate 評価 (§4)
  │
  ├─ 6. Verdict
  │   ├─ PASS → candidate を stable に promote
  │   ├─ FAIL → rollback (candidate 破棄)
  │   └─ WARN → human review (Slack)
  │
  ├─ 7. Output
  │   ├─ ci-run-manifest-pro-2026-Wxx.json (internal)
  │   ├─ pro-weekly-latest.json (public)
  │   ├─ Slack alert (#harness-mem-quality)
  │   └─ Datadog custom metric
  │
  └─ 8. 人間の週次レビュー (月曜朝 30 分)
      ├─ 結果サマリを目視
      ├─ alert / warn への対応判断
      └─ 次週の候補モデルの準備状況確認
```

## 6. 公開 JSON スキーマ (透明性)

`https://harness-mem.jp/transparency/pro-weekly-latest.json`

```jsonc
{
  "week": "2026-W16",
  "published_at": "2026-04-20T03:15:00Z",
  "stable_model": {
    "version": "ruri-v3-130m-ft-2026w15",
    "promoted_at": "2026-04-13T03:15:00Z"
  },
  "candidate_model": {
    "version": "ruri-v3-130m-ft-2026w16",
    "verdict": "promoted"
  },
  "metrics": {
    "dev_workflow_recall_at_10": { "stable": 0.71, "candidate": 0.73, "delta": 0.02 },
    "bilingual_recall_at_10":    { "stable": 0.90, "candidate": 0.90, "delta": 0.00 },
    "knowledge_update_freshness":{ "stable": 1.00, "candidate": 1.00, "delta": 0.00 },
    "temporal_ordering":         { "stable": 0.68, "candidate": 0.70, "delta": 0.02 },
    "search_p95_ms":             { "stable": 182, "candidate": 195, "delta": 13 },
    "error_rate":                { "stable": 0.001, "candidate": 0.001, "delta": 0.000 }
  },
  "gates": {
    "layer1_all_pass": true,
    "performance_all_pass": true,
    "feedback_positive_rate_delta_pct": 1.2
  },
  "history_link": "https://harness-mem.jp/transparency/pro-weekly/"
}
```

## 7. 透明性ダッシュボード

`harness-mem.jp/transparency` に過去 52 週の time series を公開する。

### 表示要素

- 各 Layer 1 指標の週次推移グラフ
- promotion / rollback の歴史 (candidate の verdict を色で区別)
- 現在の stable モデル バージョンと promotion date
- 直近 4 週のサマリ表
- 過去の rollback 履歴と根本原因 (簡潔)

### 意義

- **顧客「Pro は退化しないのか?」** → 「毎週公開している」と即答できる
- **エンタープライズ営業の必殺技** — 透明性を出している SaaS は少ない
- **競合へのメッセージ** — 同じ透明性がない競合はプロ感で劣る

## 8. 運用ルール

### 日常

- Slack `#harness-mem-quality` で週次 verdict を自動通知
- Datadog でリアルタイム metric (p95, error rate, cache hit rate) を監視
- alert レベル: P0 (auto-rollback), P1 (human review 必須), P2 (参考通知)

### 週次レビュー

毎週月曜朝に 30 分:

- 前週の verdict を目視
- 退化の傾向を確認 (時系列で緩やかな劣化がないか)
- 次週の candidate 準備状況を確認
- 人間介入が必要な alert への対応判断

### 月次レビュー

月次で 60 分:

- 過去 4 週の傾向まとめ
- Benchmark fixture の rotation 判断 (過学習防止)
- Pro の顧客フィードバックと内部 metric の整合チェック
- 次月の fine-tune 戦略レビュー

## 9. Benchmark fixture の rotation

同じ fixture で評価し続けると **candidate が fixture に過学習** する危険がある。以下で対策:

- Fixture を **A/B/C** の 3 セットに分割
- 毎週使うのは 2 セット (AB / BC / CA の rotation)
- 新規 fixture を月次で +10% 追加 (5% は実顧客の匿名化クエリから生成)
- **hold-out セット** を 1 セット (D) 維持 (candidate が触れない)

## 10. フィクスチャ管理

| fixture | 出所 | 件数 | 更新頻度 |
|---|---|---|---|
| LoCoMo-120 | 公開 | 120 | 固定 |
| bilingual-50 | 公開 | 50 | 固定 |
| dev-workflow-20 | harness-mem 独自 | 20 | 四半期に +5 |
| knowledge-update-100 | harness-mem 独自 | 100 | 半年に +20 |
| temporal-100-v2 | harness-mem 独自 | 100 | 固定 |
| ja-522 (companion) | harness-mem 独自 | 522 | 固定 |
| 匿名化実クエリ (month-ly) | Pro Learn | 月 50 新規 | 毎月 |

実クエリは匿名化 + キュレーション後に追加。PII を含むものは排除。

## 11. 実装順序

| Phase | 内容 |
|---|---|
| Phase 0 | 本仕様書確定 (本ドキュメント) |
| Phase 1 | GitHub Actions ベースの週次 runner 実装 (単純 diff のみ) |
| Phase 2 | Shadow deploy (candidate/stable 分離) |
| Phase 3 | Auto-rollback + Slack alert |
| Phase 4 | 透明性ダッシュボード (harness-mem.jp/transparency) |
| Phase 5 | Fixture rotation + hold-out 運用 |
| Phase 6 | 月次レビュー定着 + fine-tune pipeline 統合 |

## 12. 関連コンポーネント

- [01-pro-api-concierge-spec.md §8 品質指標](./01-pro-api-concierge-spec.md) — 本ゲートが満たすべきゴール
- [02-feedback-signal-collection.md §9 初期のフィードバック量](./02-feedback-signal-collection.md) — 学習入力の規模感
- [03-pricing-plans.md §6 Zero-Retention 技術的担保](./03-pricing-plans.md) — SLA 担保の根拠
- harness-mem 既存: `memory-server/src/benchmark/run-ci.ts` — Free 側の ci runner (Pro 版はこれを参考に実装)
