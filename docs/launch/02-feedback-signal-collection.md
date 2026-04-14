# フィードバック信号収集 仕様書

策定日: 2026-04-14
対象: harness-mem OSS (client) と Pro API (server) 間のフィードバックループ
関連: [01-pro-api-concierge-spec.md](./01-pro-api-concierge-spec.md) / [03-pricing-plans.md](./03-pricing-plans.md) / [04-weekly-benchmark-regression.md](./04-weekly-benchmark-regression.md)

## 1. 目的

顧客のクエリと結果を使って Pro サーバーの品質を自己改善させるための **フィードバック信号収集基盤** を定義する。明示 (👍/👎) だけでなく、既存 MCP ツールの使用パターンから **暗黙の信号** を抽出することで、ユーザーに負担をかけずに学習データを蓄積する。

収集した信号は [04-weekly-benchmark-regression.md](./04-weekly-benchmark-regression.md) の週次ループに流し込み、candidate モデルの fine-tune / チューニングに使う。

## 2. 設計原則

1. **既存 MCP ツールに 150 行以下のフックを追加するだけ** で完成させる
2. **client 側はデフォルト off**。`HARNESS_MEM_PRO_API_KEY` + `HARNESS_MEM_TELEMETRY=on` で初めて動く
3. **匿名化はクライアント側で実施**。サーバーに届く時点で PII は除去済み
4. **Pro Private / Enterprise では完全 drop**。ネットワークに出さない
5. **ローカルログで何を送ったか確認可能** (`~/.harness-mem/telemetry.log`)

## 3. シグナル分類

強度 (1〜3) と種類 (positive/negative/neutral) で分類する。

| 信号 | 強度 | 方向 | 収集場所 | 実装方針 |
|---|---|---|---|---|
| Checkpoint 化された結果 | 3 | positive | `harness_mem_record_checkpoint` | observation_id と直近 search hits 照合、上位 hit なら強正例 |
| `get_observations` で深掘り | 2 | positive | `harness_mem_get_observations` | 同 observation が直近 search hits なら中正例 |
| 引用された (コピペ) | 2 | positive | `harness_mem_record_event` (UserPromptSubmit) | event 本文と hits.snippet を 5-gram 一致検出 |
| 再検索 (30 秒以内類似クエリ) | 2 | negative | `harness_mem_search` | 直近 query と string similarity ≥ 0.7 で失敗判定 |
| 結果無視 + 話題切替 | 1 | negative | `harness_mem_search` + `record_event` | search 後 60 秒以内に別 topic event、hit 0 件参照 |
| Session finalize 時の使用実績 | 3 | positive | `harness_mem_finalize_session` | session thread で使用された observation 集計 |
| 明示 👍 | 3 | positive | 新 `harness_mem_feedback` | 新規追加 (10 行) |
| 明示 👎 | 3 | negative | 同上 | |

## 4. イベントスキーマ (anonymized)

```jsonc
{
  "feedback_id": "fb_8c3a...",
  "tenant_id": "t_acme",
  "schema_version": 1,
  "occurred_at": "2026-04-14T10:23:45Z",
  "signal": {
    "type": "implicit_positive",
    "strength": 3,
    "subtype": "checkpoint_recorded"
  },
  "search_context": {
    "feedback_token": "fb_...",
    "route_used": "ensemble",
    "model_stack": ["ruri-v3-130m"],
    "benchmark_cohort": "stable-2026w16",
    "query_hash": "sha256(query || tenant_salt)",
    "query_text_sanitized": "...",
    "hits_count": 10,
    "hit_rank": 2
  },
  "latency_to_interaction_ms": 2300,
  "plan": "pro_learn",
  "learn_opt_in": true
}
```

`query_text_sanitized` は Pro Learn のみ保存。その他プランでは `null`。

## 5. 匿名化ルール

| 項目 | 扱い |
|---|---|
| tenant_id | 契約 ID (個人特定不可) |
| query_hash | tenant ごとの salt で sha256 hash |
| query_text | Pro Learn のみ保存、Pro Private/Enterprise では client で drop |
| コード本文 | 一律 drop (どのプランでも保存しない) |
| result snippet 本文 | 一律 drop |
| 名前 / メール / 電話 | 正規表現 + 簡易 NER で検出し redact |
| ファイルパス | basename のみ保存、フルパスは drop |

匿名化は **client 側** で実施。サーバーは受け取った時点で既に匿名化済の前提で処理する。

## 6. クライアント側実装

### 6-A. Telemetry モジュール (新規 `memory-server/src/telemetry/feedback.ts`)

```typescript
export interface FeedbackEvent { /* 上記スキーマ */ }

export class FeedbackEmitter {
  private queue: FeedbackEvent[] = [];
  private uploaderStarted = false;

  enabled(): boolean {
    return Boolean(process.env.HARNESS_MEM_PRO_API_KEY) &&
           process.env.HARNESS_MEM_TELEMETRY !== "off";
  }

  emit(ev: FeedbackEvent): void {
    if (!this.enabled()) return;
    this.queue.push(ev);
    this.startUploaderIfNeeded();
  }

  private startUploaderIfNeeded() { /* setInterval で 5 分ごと flush */ }
  private async flush() { /* POST /v1/feedback に batch 送信 */ }
}
```

### 6-B. 既存ハンドラへのフック

追加コードは 1 箇所あたり 3〜5 行。

```typescript
// harness_mem_record_checkpoint の末尾に:
if (context.recent_search?.feedback_token) {
  feedbackEmitter.emit({
    signal: { type: "implicit_positive", strength: 3, subtype: "checkpoint_recorded" },
    search_context: context.recent_search,
  });
}

// harness_mem_search の先頭に:
const recent = await recentSearchForSession(ctx.session_id, 30);
if (recent && stringSimilarity(query, recent.query) >= 0.7) {
  feedbackEmitter.emit({
    signal: { type: "implicit_negative", strength: 2, subtype: "refetch" },
    search_context: recent,
  });
}
```

### 6-C. 新 MCP tool `harness_mem_feedback`

```
name: harness_mem_feedback
args: { feedback_token: string, rating: "up"|"down", reason?: string }
```

10 行ほどの実装。Claude Code 側は必要時に AI が自動で呼ぶ設計も可能 (例: ユーザーが「この結果違う」と発話した時に自動 down)。

### 6-D. 全体フロー

```
MCP Tool (client-side)
  ↓ tool_use
harness-memd (local daemon)
  ↓ feedback event を queue
Feedback Uploader (background)
  ↓ batch 送信 (5 分 or 100 件)
Pro API Server (/v1/feedback)
  ↓ 再匿名化 (念のため) + 集約
Storage (S3/GCS)
  ↓ 週次バッチ
Tuning/Fine-tune Pipeline (項目 4 の週次ベンチと連動)
```

## 7. プライバシー契約上の手当て

### Pro Learn プラン

以下を契約書に明示:

1. 収集する情報の範囲 (§4 のスキーマ)
2. 収集しない情報 (§5 の drop ルール)
3. 利用目的の限定 (モデル学習 / ルーティング調整 / ベンチ)
4. 第三者提供なし
5. オプトアウト権 (随時 Pro Private にアップグレード可能、日割り精算)
6. 保持期間: 90 日間のみ学習に利用、その後は集約統計のみ保持

### Pro Private / Enterprise プラン

以下を技術的に担保:

- `X-CAN-AI-Plan: private` ヘッダで動作切替
- client 側で feedback emitter を完全 disable
- server 側で万一受け取っても即 drop
- Enterprise は監査証跡を S3 export で配信可能

## 8. 運用上の注意

- **信号の偏り監視**: 特定 tenant が大量の信号を送ると学習が偏る。tenant ごとの上限を設定
- **逆シグナルの扱い**: 「30 秒以内再検索」が正常な行動である可能性もある (単に気が変わった等)。strength 2 までに制限、strength 3 は明示フィードバックのみ
- **バッチ処理の健全性**: 週次バッチで信号の分布が大きく変化したら alert
- **フィードバック loops の exploit 耐性**: 悪意ある tenant が自演で positive を連打する可能性 → tenant 単位の正規化 + 異常検知

## 9. 初期のフィードバック量推定

想定スケール:

| フェーズ | 契約 | クエリ/月 | 信号/月 |
|---|---|---|---|
| β (10 seat) | Pro Learn 主体 | 10K | 3K〜5K (positive : negative ≒ 3 : 1) |
| 1 年後 (100 seat) | 混合 | 200K | 60K〜100K |
| 2 年後 (500 seat) | Enterprise 混入 | 1M | 200K〜400K (Private 除外分) |

月 10K 信号あれば週次チューニング可能な最小ライン。週次 fine-tune は月 50K 以上から効果的。

## 10. 関連コンポーネント

- [01-pro-api-concierge-spec.md §4 レイヤー 4 Feedback Tap](./01-pro-api-concierge-spec.md) — サーバー側受け口
- [04-weekly-benchmark-regression.md](./04-weekly-benchmark-regression.md) — 信号を使った週次改善ループ
- [03-pricing-plans.md](./03-pricing-plans.md) — プラン別の収集可否境界
