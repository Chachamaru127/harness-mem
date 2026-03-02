# harness-mem 改善プラン v4: 130/140 達成ロードマップ

> **作成日**: 2026-03-02
> **根拠**: [`competitive-analysis-2026-03-02-v4.md`](../benchmarks/competitive-analysis-2026-03-02-v4.md)
> **現在スコア**: 119/140 (85.0%, #1)
> **目標**: 130/140 (92.9%) — 2位との差を +10pt 以上に拡大し、逆転リスクを解消

---

## 現状分析サマリー

### 危機的状況

```
v3 (3/2前半): harness-mem 118 — supermemory 115 = Gap 3pt
v4 (3/2後半): harness-mem 119 — mem0/SM 117  = Gap 2pt ⚠️

→ リードが縮小中。mem0 が +7pt/期で急追。あと1期で逆転される可能性
```

### 負けている軸の詳細分析

| 軸 | 現在 | 目標 | 差分 | 競合の強み | 必要な施策 |
|----|:---:|:---:|:---:|------------|-----------|
| Graph / Relations | 8 | **10** | +2 | supermemory: Embeddable Memory Graph (React/WebGL/PixiJS)、typed relations | グラフ可視化UI + 関係タイプ拡充 |
| Search / Retrieval | 9 | **10** | +1 | mem0: Reranker (Cohere/ZeroEntropy等)、フィルタ演算子拡張 | 外部Reranker統合 + 検索フィルタ強化 |
| Platform Integration | 9 | **10** | +1 | mem0/SM: LangChain/CrewAI/Vercel AI SDK/AWS Strands対応 | フレームワーク統合拡大 |
| Memory Model | 8 | **9** | +1 | SM/OM: conversations endpoint、5セクターモデル | 会話レイヤー追加 |
| Storage Flexibility | 9 | **9** | 0 | 達成済み | 維持 |

### 伸ばせる独自軸

| 軸 | 現在 | 目標 | 差分 | 施策 |
|----|:---:|:---:|:---:|------|
| Benchmark / Eval | 9 | **10** | +1 | LongMemEval + ConvoMem ベンチマーク追加、公開スコア |
| Security | 9 | **10** | +1 | RBAC + API rate limiting + audit trail 強化 |
| Privacy | 9 | **10** | +1 | 完全オフラインモード証明、ネットワーク分離テスト |

---

## Phase 別改善計画

### Phase A: 首位固め（+5pt → 124/140）
> 期間目安: 1-2週間 | リスク: 低 | 前提: §28 Phase 1 完了

**目的**: 最小コストで競合との差を安全圏 (7pt) に広げる

#### IMP-A1: 外部 Reranker 統合 (Search +1 → 10)

**現状**: 内蔵の `recencyScore` + `importanceBoost` + `tagBoost` による自前リランキング
**競合**: mem0 は Cohere/ZeroEntropy/HuggingFace/Sentence Transformers の4プロバイダーをプラグイン対応
**施策**:
- `observation-store.ts` の `rerankResults()` を拡張
- Cohere Rerank API v3 をファーストクラスサポート（APIキー設定で有効化）
- ローカル Reranker (cross-encoder/ms-marco-MiniLM) もフォールバックとして用意
- 設定: `HARNESS_MEM_RERANKER_PROVIDER=cohere|local|none`

**DoD**:
- Reranker 有効時に LoCoMo Recall@10 が +5% 以上向上
- 既存の `none` モードに回帰なし

---

#### IMP-A2: MemoryBench 参加 + 公開スコア (Benchmark +1 → 10)

**現状**: LoCoMo 内部ベンチマーク実装済みだが、公開スコアレポートなし
**競合**: supermemory が MemoryBench OSS + LongMemEval/LoCoMo/ConvoMem 3冠を主張（ただし現在2位に後退）
**施策**:
- LongMemEval ベンチマークスイートを `tests/benchmarks/` に追加
- ConvoMem テストケースも追加（5問 × 3カテゴリ）
- 公開スコアレポートを `docs/benchmarks/` に配置
- CI で回帰検知ゲート実装

**DoD**:
- LongMemEval + LoCoMo + ConvoMem の3ベンチマーク実行可能
- 公開スコアが docs/ に記録
- CI で Recall@10 が -5% 以上低下で警告

---

#### IMP-A3: セキュリティ強化 (Security +1 → 10)

**現状**: Bearer token認証、timingSafeEqual、localhost フォールバック、privacy_tags
**競合**: mem0 は SOC2/HIPAA/BYOK 対応
**施策**:
- RBAC (Role-Based Access Control): `admin` / `reader` / `writer` ロール
- API rate limiting: `HARNESS_MEM_RATE_LIMIT=100/min`（デフォルト無制限）
- Audit trail 完全化: 全 API コールの監査ログ（現在は search_hit のみ）
- セキュリティヘッダー: HSTS, CSP, X-Content-Type-Options

**DoD**:
- 3ロールの RBAC テスト通過
- rate limiting テスト通過
- OWASP Top 10 チェックリスト全項目対応

---

#### IMP-A4: 完全オフラインモード (Privacy +1 → 10)

**現状**: ローカルSQLiteがデフォルトだが、managed/hybrid モードでの外部通信あり
**競合**: OpenMemory は「no cloud sync, no external storage」を原則として明文化
**施策**:
- `HARNESS_MEM_OFFLINE_MODE=true` フラグ追加
- オフラインモード時: 全外部通信をブロック（managed/hybrid を拒否）
- ネットワーク分離テスト: テスト中に DNS/HTTP をモックして外部通信ゼロを検証
- ドキュメント: `docs/PRIVACY.md` にオフラインモードの保証内容を記載

**DoD**:
- オフラインモードで全 API が正常動作
- ネットワーク分離テスト通過

---

#### IMP-A5: Conversations エンドポイント (Memory Model +1 → 9)

**現状**: events/observations/checkpoints/sessions/links の5階層だが、会話単位の操作なし
**競合**: supermemory は `/conversations` エンドポイントで会話フローを直接管理
**施策**:
- `POST /v1/conversations` — 会話の開始・追記
- `GET /v1/conversations/:id` — 会話履歴の取得
- 内部的には `mem_sessions` + `mem_events` を会話ビューとして公開
- 既存の sessionThread() を conversations API のバックエンドとして活用

**DoD**:
- conversations CRUD が動作
- TS SDK に `conversations()` メソッド追加
- テスト5件以上

---

### Phase B: 差別化強化（+4pt → 128/140）
> 期間目安: 2-3週間 | リスク: 中 | 前提: Phase A 完了

**目的**: 競合にない独自価値を構築し、追い付かれにくい優位性を確立

#### IMP-B1: Embeddable Memory Graph (Graph +2 → 10)

**現状**: `mem_links` テーブルに5種の関係タイプ、expand_links 検索、derives 推論リンク
**競合**: supermemory は React/WebGL/PixiJS による組み込み可能なグラフ可視化を提供
**施策**:
- **Phase B1-a**: グラフ API エンドポイント
  - `GET /v1/graph?center_id=xxx&depth=2` — 指定ノードを中心にグラフデータを返す
  - ノード: observations、エッジ: mem_links
  - 応答形式: `{ nodes: [...], edges: [...] }` (D3/Cytoscape 互換 JSON)
- **Phase B1-b**: React グラフコンポーネント
  - `@harness-mem/graph` パッケージ（React + D3.js force-directed graph）
  - VS Code 拡張のサイドバーに組み込み
  - Web UI ダッシュボードにも統合
- **Phase B1-c**: 関係タイプ拡充
  - `contradicts`（矛盾）、`supersedes`（上書き）、`causal`（因果）追加
  - 自動矛盾検出: 同一エンティティの相反するファクトを検出してリンク

**DoD**:
- グラフ API テスト10件通過
- React コンポーネントが npm 公開可能
- 3種の新関係タイプが記録・検索・表示される

---

#### IMP-B2: フレームワーク統合拡大 (Platform +1 → 10)

**現状**: Claude/Codex/Cursor/OpenCode/Antigravity/Gemini + GitHub Issues + ADR コネクタ
**競合**: mem0 は LangChain/CrewAI/Vercel AI SDK/AWS Strands/MCP に統合
**施策**:
- **LangChain ChatMemory**: `@harness-mem/langchain` — 既存の langchain-memory.ts を SDK ベースに整理
- **CrewAI Memory Provider**: `@harness-mem/crewai`
- **Vercel AI SDK Provider**: `@harness-mem/vercel-ai`
- **MCP Server の SDK 1.x 対応**: §28 Phase 4 (MCP-001) を前倒し

**DoD**:
- 3フレームワーク統合が動作
- 各統合にテスト + README 付き

---

### Phase C: 市場定義（+2pt → 130/140）
> 期間目安: 3-4週間 | リスク: 高 | 前提: Phase B 完了

**目的**: 130/140 達成。業界ベンチマークの主導権を確立

#### IMP-C1: Code-Aware Memory (独自軸)

**現状**: テキストベースの event/observation のみ。コード構造の理解なし
**競合**: supermemory の code-chunk (recall +28pt)、claude-mem の Smart Explore (11-18x トークン削減)
**施策**:
- tree-sitter AST を使ったコード変更のセマンティック記録
- `code_change` イベントタイプ: ファイルパス + 変更シンボル + diff サマリー
- コード変更と decision/context イベントの自動リンク
- 「なぜこのコードがこう書かれたのか」を記憶から引き出せる検索

**DoD**:
- code_change イベント記録 + 検索が動作
- LoCoMo Code-Specific カテゴリで Recall@5 > 80%

---

#### IMP-C2: 公開ベンチマークリーダーボード

**現状**: 内部ベンチマークのみ
**競合**: supermemory が MemoryBench OSS で業界標準を自己定義
**施策**:
- `harness-mem-bench` OSS リポジトリ公開
- LoCoMo + LongMemEval + ConvoMem の3ベンチマーク統合ランナー
- 競合アダプター: mem0, supermemory, OpenMemory, claude-mem
- GitHub Pages で自動更新リーダーボード

**DoD**:
- OSS リポジトリ公開
- 5ツールの比較スコアが自動生成

---

## スコア予測

| Phase | 期間 | 累積スコア | 2位との差 | リスク |
|-------|------|:---------:|:---------:|:------:|
| 現在 | — | 119 | 2pt | — |
| Phase A | 1-2w | 124 | 7pt | 低 |
| Phase B | 2-3w | 128 | 11pt | 中 |
| Phase C | 3-4w | 130 | 13pt | 高 |

---

## 優先度マトリクス

```
     HIGH IMPACT
         │
    ┌────┼──────────────────┐
    │ A1 │ B1               │
    │Reranker│Graph (CRITICAL)   │
    │    │                  │
    ├────┤──────────────────┤
    │ A2 │ B2               │
    │Bench│Framework Integ  │
    │    │                  │
    │ A5 │ C1               │
    │Convo│Code-Aware       │
    │    │                  │
    ├────┤──────────────────┤
    │ A3 │ C2               │
    │Security│Leaderboard    │
    │ A4 │                  │
    │Offline│                │
    └────┴──────────────────┘
   LOW                   HIGH
   EFFORT               EFFORT
```

---

## §28 との関係

| 改善タスク | §28 依存 | 備考 |
|-----------|---------|------|
| IMP-A1 (Reranker) | Phase 1 完了 ✅ | ObservationStore の rerankResults() を拡張 |
| IMP-A2 (Benchmark) | なし | テストのみ |
| IMP-A3 (Security) | なし | server.ts 拡張 |
| IMP-A4 (Offline) | なし | 設定フラグ + テスト |
| IMP-A5 (Conversations) | Phase 1 完了 ✅ | SessionManager を活用 |
| IMP-B1 (Graph) | Phase 1 完了 ✅ | ObservationStore + 新コンポーネント |
| IMP-B2 (Frameworks) | Phase 3 (SDK) 推奨 | SDK を基盤として利用 |
| IMP-C1 (Code-Aware) | Phase 6 (Ingester) 推奨 | 新 Ingester として実装 |
| IMP-C2 (Leaderboard) | なし | 独立リポジトリ |

---

## リスクと対策

| リスク | 確率 | 影響 | 対策 |
|--------|:----:|:----:|------|
| mem0 が AWS Strands 独占で市場を固定 | 高 | 大 | Phase B2 でフレームワーク統合を急ぐ |
| supermemory の Graph が業界標準に | 中 | 大 | Phase B1 で同等以上の Graph を提供 |
| ベンチマーク操作（有利な評価軸の定義） | 中 | 中 | Phase C2 で公平なリーダーボードを主導 |
| CQRS Phase 2-7 との並列化コスト | 中 | 中 | Phase A は §28 と独立、Phase B 以降は §28 進捗と調整 |
| code-chunk / Smart Explore が標準化 | 低 | 大 | Phase C1 で対応 |

---

## 結論

harness-mem は首位を維持しているが、**リードは 2pt にまで縮小**。特に mem0 の $24M 資金力 + AWS Strands 採用による急追が最大の脅威。

**最優先アクション**:
1. **Phase A を即座に開始**: 低リスクな +5pt で安全圏を確保
2. **IMP-B1 (Graph) を並行して設計開始**: supermemory の -2pt ギャップは最大の脆弱性
3. **§28 Phase 2-7 は Phase A/B の合間に進める**: 内部品質と外部競争力の両立

> **「機能で勝ち、品質で守る」** — CQRS 基盤の上に競争力のある機能を積み上げる。
