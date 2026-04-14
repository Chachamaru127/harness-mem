# Pro API Concierge 仕様書

策定日: 2026-04-14
対象: harness-mem Pro 経路サーバー (CAN AI 独自 API)
関連: [02-feedback-signal-collection.md](./02-feedback-signal-collection.md) / [03-pricing-plans.md](./03-pricing-plans.md) / [04-weekly-benchmark-regression.md](./04-weekly-benchmark-regression.md)

## 1. 目的

Pro API を **単なる embedding のプロキシ** ではなく、**クエリ理解から後処理までを統合したコンシェルジュ型サービス** として設計する。「OpenAI を後ろで呼んでいるだけ」ではなく、harness-mem 専用に最適化された統合レイヤーで差別化を成立させる。

## 2. 設計哲学

### 単なるラッパーと本設計の違い

| | 単なるラッパー | コンシェルジュ型 |
|---|---|---|
| 役割 | 電話の中継係 | ホテルのコンシェルジュ |
| 仕事 | 質問を転送し、答えを転送する | 意図を汲み、専門家に振り、結果を整えて渡す |
| 顧客の離脱理由 | 「OpenAI に直接契約すればいい」 | 「ここじゃないと駄目」 |

### データ所有の原則

- サーバー側は **顧客の SQLite DB を保持しない**
- 候補 (candidates) は **client 側が送信する**
- リクエスト処理が終わったら本文は破棄 (Zero-Retention の自然な成立)
- Pro Learn プランのみ匿名化した信号を学習用に残す

## 3. API エンドポイント

3 層に分けて公開する。

| 層 | エンドポイント | 役割 | 対象プラン |
|---|---|---|---|
| Concierge | `POST /v1/search` | 解析→ルーティング→検索→リランク→後処理まで全部込み | Pro Learn / Pro Private |
| Component | `POST /v1/embed`, `/v1/rerank`, `/v1/analyze` | 部品だけ取り出して client で組み立て | Pro Private (透過モード) |
| Feedback | `POST /v1/feedback` | 明示・暗黙シグナルの受付 | Pro Learn のみ |
| 運用 | `GET /v1/health`, `/v1/metrics` | 稼働確認、顧客自身の使用量可視化 | 全プラン |

### `/v1/search` リクエスト仕様

```jsonc
{
  "query": "先週直した 401 エラーのハンドリング",
  "candidates": [
    { "id": "obs_abc", "text": "...", "created_at": "2026-04-10T...", "tags": ["error", "auth"] }
  ],
  "scope": {
    "project_id": "my-app",
    "session_id_hash": "sha256(...)",
    "time_window": "last_30d"
  },
  "k": 10,
  "mode": "auto",
  "options": {
    "rerank": true,
    "expand_query": true,
    "time_decay": 0.3,
    "dedupe": true,
    "explain": true
  },
  "plan": "pro_learn",
  "learn_opt_in": true,
  "api_key": "sk-canai-..."
}
```

### `/v1/search` レスポンス仕様

```jsonc
{
  "hits": [
    {
      "id": "obs_xyz",
      "score": 0.87,
      "components": {
        "vector_ja": 0.74,
        "vector_general": 0.62,
        "lexical": 0.81,
        "time_boost": 0.92,
        "rerank": 0.89
      },
      "snippet": "...",
      "reason": "401 + ハンドリング + 時間重み (7日以内)"
    }
  ],
  "route_decision": {
    "detected_language": "ja+code",
    "ja_ratio": 0.62,
    "code_ratio": 0.28,
    "temporal_signal": "last_week",
    "chosen_route": "ensemble",
    "expansions": ["401 error handling", "エラー処理", "HTTP 401"]
  },
  "model_stack": ["ruri-v3-130m", "rerank-ja-v1"],
  "latency_ms": { "analyze": 3, "embed": 42, "rerank": 18, "total": 63 },
  "cache_hit": false,
  "feedback_token": "fb_8c3a...",
  "quality_tier": "stable-2026w16"
}
```

### 設計上の重要点

- `candidates` を client が送る → サーバーは tenant DB を持たない
- `explain` (score components) → 顧客は「なぜこの順位か」を監査可能
- `route_decision` の公開 → コンシェルジュの判断が見える (ブラックボックス化しない)
- `feedback_token` → 後続の学習と紐付けるキー
- `quality_tier` → どの benchmark cohort で検証されたモデルかを明示

## 4. 内部パイプライン (10 レイヤー)

```
Request
  │
  [1] Auth + Rate Limit             API key, plan, quota 判定
  │
  [2] Tenant Router                 Learn / Private / Enterprise で分岐
  │
  [3] Query Analyzer                ja_ratio / code_ratio / 時間表現 / 意図分類
  │
  [4] Preprocessor                  NFKC 正規化, カタカナ揺れ, 送り仮名
  │
  [5] Query Expander                同義語展開, 略語展開 (synonyms-ja/en.json)
  │
  [6] Route Selector                どのモデルをどう組み合わせるか決定
  │
  [7] Embedding Pool ─┬─ Ruri-v3-130m (日本語)
  │                   ├─ multilingual-e5-large (汎用 / コード)
  │                   └─ (将来) fine-tuned-harness-ja-v2
  │
  [8] Retrieval Engine              candidates に対してベクトル + 時間 + メタで合成
  │
  [9] Reranker                      上位 50 → 10, cross-encoder 方式
  │
  [10] Post-processor               dedupe, snippet 生成, citation
  │
  [Feedback Tap] (非同期) ──→ Event Bus → Object Storage
  │
Response
```

10 レイヤー目のリランカーが品質の決め手。初期は軽量な cross-encoder (Ruri-reranker 派生) を使い、Phase 3 以降で自前 fine-tune。

## 5. 技術スタック

| 要素 | 採用 | 理由 |
|---|---|---|
| 言語 | Python 3.11+ | HuggingFace エコシステム最強 |
| Web フレームワーク | FastAPI + uvicorn | 型付き、非同期、日本でも定番 |
| モデル実行 | PyTorch + sentence-transformers | Ruri 公式リファレンス通り |
| トークナイザ | SentencePiece | Ruri v3 公式仕様 |
| キャッシュ | Redis (マネージド) | 共有キャッシュで再計算回避 |
| メタ DB | PostgreSQL (tenant, key, usage) | Fly.io Postgres or Neon |
| 秘密情報 | Fly Secrets / Doppler | hardcode しない |
| Observability | Datadog (CAN AI 既存契約想定) | 一貫性 |
| ホスティング | Fly.io `performance-2x` NRT | 日本近接、固定月額 |
| 将来 GPU | Modal / Replicate / Fly GPU | 学習時のみ burst |
| CI | GitHub Actions + Docker | 既存 harness-mem と同じ |

## 6. ディレクトリ構成 (別 private repo)

```
canai-ops/harness-mem-pro-api/
├── app/
│   ├── main.py                       FastAPI entry
│   ├── routers/
│   │   ├── search.py
│   │   ├── embed.py
│   │   ├── rerank.py
│   │   ├── analyze.py
│   │   └── feedback.py
│   ├── concierge/
│   │   ├── analyzer.py               クエリ理解 (レイヤー 3)
│   │   ├── preprocessor.py           正規化 (4)
│   │   ├── expander.py               クエリ拡張 (5)
│   │   ├── router.py                 ルーティング判断 (6)
│   │   ├── retrieval.py              検索合成 (8)
│   │   ├── reranker.py               リランク (9)
│   │   └── postprocessor.py          後処理 (10)
│   ├── models/
│   │   ├── pool.py                   モデルロード / 切替
│   │   ├── ruri130m.py
│   │   └── rerank_ja.py
│   ├── tenant/
│   │   ├── auth.py
│   │   ├── plans.py
│   │   └── quota.py
│   ├── feedback/
│   │   ├── collector.py
│   │   ├── anonymizer.py
│   │   └── uploader.py
│   └── observability/
│       ├── metrics.py
│       └── tracing.py
├── bench/                            項目 4 の週次ベンチと連動
│   ├── fixtures/
│   ├── run_weekly.py
│   └── compare.py
├── infra/
│   ├── fly.toml
│   ├── Dockerfile
│   └── docker-compose.yml            ローカル開発用
├── scripts/
│   ├── model_download.sh
│   └── tenant_provision.py
├── tests/
├── pyproject.toml
└── README.md
```

## 7. セキュリティ要件

- TLS 1.3 以上必須
- API key は `sk-canai-` prefix + 48 文字のランダム (bcrypt hash で DB 保管)
- Rate limit: 60 req/min per key (標準プラン)、tenant 単位で overlay
- Request body の最大サイズ: 256 KiB (candidates 含む)
- 5 秒タイムアウト (client 側と揃える)
- エラーレスポンスに stack trace を含めない
- `X-CAN-AI-Plan` ヘッダで plan 動作切替 (server 側で最終検証)

## 8. 品質指標 (本設計が達成すべきゴール)

| 指標 | 目標 |
|---|---|
| p95 latency (total) | ≤ 250ms (warm cache) / ≤ 500ms (cold) |
| p99 latency | ≤ 1000ms |
| availability | ≥ 99.5% (Pro Private), ≥ 99.0% (Pro Learn) |
| error rate | < 1% (5 分ウィンドウ) |
| cache hit rate | ≥ 40% (warm-up 後) |
| dev-workflow recall@10 improvement | ≥ +5pp vs Free 経路 |

## 9. 実装順序

Phase 1 (MVP) と Phase 3 (Fine-tune) に分ける。詳細は Plans.md §80 のロードマップ参照。

1. Phase 1-a: `/v1/embed` 単体 (薄い Ruri-130m ラッパー)
2. Phase 1-b: `/v1/analyze` + `/v1/search` (コンシェルジュの土台)
3. Phase 1-c: `/v1/rerank` + `/v1/feedback`
4. Phase 1-d: Observability + Rate Limit + 認証整備
5. Phase 3: Fine-tune 統合 (モデル差し替え、A/B テスト基盤)

## 10. 設計上のオープン論点

- **rerank モデルの初期選定**: Ruri-reranker-v3 の実測性能が未確認。Phase 1-c までに検証必要
- **Redis の配置**: Fly.io Redis vs Upstash 比較
- **Zero-Retention の形式検証**: 第三者監査 (SOC 2) の導入タイミング
- **Enterprise のオンプレ配布**: Docker + Helm vs ソースコード提供の選択
