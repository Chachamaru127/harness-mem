# Competitive Analysis Benchmark v6: harness-mem v0.2.1+§30

> **Snapshot date**: 2026-03-03 (v6 — §30 アーキテクチャ改善完了後)
> **harness-mem version**: v0.2.1 + §30 (main branch)
> **Previous snapshot**: [`competitive-analysis-2026-03-03-v5.md`](competitive-analysis-2026-03-03-v5.md) (119/119/119 三つ巴)
> **Purpose**: §30 アーキテクチャ改善（Repository/MCP 1.x/OpenAPI/Ingester）後の厳密再評価。5並列リサーチエージェントで全ツールを独立調査。

---

## Methodology

- 14 evaluation axes (1-10 each, max 140 points)
- 5 parallel research agents deployed concurrently (2026-03-03)
  - **harness-mem**: Explore agent がコード実査（§30 全モジュール検証、very thorough）
  - **supermemory**: WebSearch + GitHub + 公式ドキュメント + MemoryBench 調査
  - **mem0**: WebSearch + GitHub Releases + AWS Strands + Reranker 5種調査
  - **OpenMemory**: WebSearch + GitHub + MCP エコシステム + Chrome Extension 調査
  - **claude-mem**: WebSearch + GitHub + CVE調査 + Smart Explore（厳密モード）
- **v5 との違い**: 自己申告値ではなく、各エージェントが独立に証拠ベースで採点

---

## 採点項目の解説（14軸）

各項目が「何を測っているのか」を分かりやすく説明します。

### 1. Memory Model（記憶の整理方法）
**「記憶をどれだけ上手に分類・構造化できるか」**

人間の記憶には「昨日の会話」（エピソード記憶）、「Pythonの文法」（意味記憶）、「いつもの作業手順」（手続き記憶）など種類があります。AIの記憶システムも、これらを区別して適切に保存・取り出しできるかが重要です。

### 2. Search / Retrieval（検索・取り出し精度）
**「必要な記憶を、必要なときに正確に見つけられるか」**

キーワード検索（全文検索）と意味検索（ベクトル検索）を組み合わせた「ハイブリッド検索」が現在の標準。さらに検索結果を並べ替えて精度を上げる「リランカー」の有無が差を生みます。

### 3. Storage Flexibility（保存先の柔軟性）
**「データをどこに保存できるか、その選択肢の広さ」**

ローカルの SQLite から、クラウドの PostgreSQL、Redis まで。用途に応じて保存先を選べる柔軟性を評価します。

### 4. Platform Integration（他ツールとの連携力）
**「どれだけ多くのAIツールやプラットフォームと繋がれるか」**

Claude、ChatGPT、Cursor、VS Code、LangChain、CrewAI など。MCP（Model Context Protocol）対応は現在のデファクトスタンダードです。

### 5. Security（セキュリティ）
**「記憶データを不正アクセスから守る仕組み」**

認証（誰がアクセスするか）、認可（何にアクセスできるか）、暗号化、監査ログ。企業利用では SOC2 や HIPAA 認証の有無も重要です。

### 6. UI / Dashboard（管理画面）
**「記憶データを視覚的に確認・管理できるか」**

記憶の一覧表示、検索、グラフ可視化、分析ダッシュボード。「中身が見えるか」は運用上とても重要です。

### 7. Consolidation / Dedup（統合・重複排除）
**「同じ内容の記憶を賢くまとめられるか」**

100回「東京に住んでいます」と記録しても、1つの事実として管理できるか。矛盾する記憶（「犬が好き」→「猫派になった」）を適切に処理できるかも含みます。

### 8. Graph / Relations（関係性グラフ）
**「記憶同士のつながりを理解できるか」**

「AさんはBプロジェクトのリーダー」「BプロジェクトはC技術を使用」→「AさんはC技術に詳しい」のように、関係性をたどって推論できる能力です。

### 9. Privacy (Local-first)（プライバシー）
**「データが外部に出ないことを保証できるか」**

完全ローカル動作、クラウド不要、テレメトリ（利用データ収集）なし。機密情報を扱う場合に最重要の項目です。

### 10. Multi-user / Team（チーム利用）
**「複数人で安全に使えるか」**

ユーザーごとの記憶分離、チーム共有メモリ、権限管理。個人利用→チーム利用への拡張性を測ります。

### 11. Cloud Sync（クラウド同期）
**「外部データソースと自動的に同期できるか」**

GitHub Issues、Notion、Google Drive などから自動で記憶を取り込み、常に最新の状態を維持できるかを評価します。

### 12. Multi-modal（マルチモーダル）
**「テキスト以外（画像・音声・PDF）も記憶できるか」**

OCR（画像からテキスト抽出）、音声文字起こし（Whisper）、PDF解析など。テキスト以外のデータを扱える幅広さです。

### 13. Benchmark / Eval（評価・ベンチマーク）
**「性能を数値で測定・証明できるか」**

LoCoMo、LongMemEval などの標準ベンチマークでの成績。「良いと言っている」のではなく「数字で証明できる」かが鍵です。

### 14. Temporal Reasoning（時間的推論）
**「いつの記憶かを理解し、時系列で推論できるか」**

「先週の会議で決まったこと」「3ヶ月前のバグ報告」など、時間軸を理解して検索・推論する能力です。

---

## Scorecard (14 Axes)

| # | Axis | harness-mem | supermemory | mem0 | OpenMemory | claude-mem |
|---|------|:-----------:|:-----------:|:----:|:----------:|:----------:|
| 1 | Memory Model | 8 | **9** | **9** | **9** | 5 |
| 2 | Search / Retrieval | 9 | 9 | **10** | 8 | 2 |
| 3 | Storage Flexibility | 8 | **9** | **9** | **9** | 3 |
| 4 | Platform Integration | **10** | **10** | **10** | 9 | 3 |
| 5 | Security | 8 | 7 | **9** | 7 | 2 |
| 6 | UI / Dashboard | 8 | **9** | 7 | 8 | 2 |
| 7 | Consolidation / Dedup | **8** | **8** | **8** | 7 | 3 |
| 8 | Graph / Relations | 7 | **10** | 9 | 8 | 1 |
| 9 | Privacy (Local-first) | 9 | 6 | 9 | **10** | 6 |
| 10 | Multi-user / Team | 7 | 7 | 7 | 6 | 1 |
| 11 | Cloud Sync | 9 | **10** | 8 | 6 | 1 |
| 12 | Multi-modal | **8** | **8** | 7 | 5 | 1 |
| 13 | Benchmark / Eval | 8 | **9** | **9** | 5 | 3 |
| 14 | Temporal Reasoning | **8** | **8** | **8** | 7 | 6 |
| | **Total (/140)** | **115** | **119** | **119** | **104** | **39** |
| | **Pct** | **82.1%** | **85.0%** | **85.0%** | **74.3%** | **27.9%** |

### Ranking

| Rank | Tool | Score | Grade | v5比 | Trend |
|:----:|------|:-----:|:-----:|:----:|:-----:|
| **1** | **supermemory** | **119/140** | **A** | ±0 | → 首位維持 |
| **1** | **mem0** | **119/140** | **A** | ±0 | → 首位維持 |
| **3** | **harness-mem** | **115/140** | **A-** | **-4** | ↓ 3位転落 |
| 4 | OpenMemory | 104/140 | B+ | -4 | ↓ |
| 5 | claude-mem | 39/140 | F | **-37** | ↓↓↓ 大幅下方修正 |

> **v6 の特徴**: v5 では自己申告ベースで全社 119/140 の同率首位だったが、
> v6 ではコードベース実査＋厳密な証拠ベース採点により、実力差が明確化。
> harness-mem は自社コード監査で -4pt（正直な自己評価）、claude-mem は -37pt（v5 が過大評価だった）。

---

## v5→v6 変動分析

### harness-mem: 119 → 115 (-4) — 正直な自己評価

| Axis | v5 | v6 | Reason |
|------|:--:|:--:|--------|
| Storage | 9 | **8** | PostgreSQL async がまだ `throw` する。実運用は SQLite のみ |
| Security | 9 | **8** | RBAC/監査ログ/暗号化は完備だが、SOC2/HIPAA 認証なし |
| Graph | 8 | **7** | 8 relation types 実装済みだが、multi-hop traversal（A→B→C の連鎖推論）未実装 |
| Multi-user | 8 | **7** | project_id による分離はあるが、team management API なし |
| Benchmark | 9 | **8** | LoCoMo ベンチマーク実装済みだが CI に統合されていない（手動実行のみ） |
| Platform | 9 | **10** | §30 で MCP SDK 1.27.1 + OpenAPI 3.1 + 14 Ingester プラグイン化 (**+1**) |

**正味**: -5 + 1 = **-4**

### supermemory: 119 → 119 (±0)

変動なし。Graph(10) + Cloud Sync(10) + Platform(10) の三本柱が盤石。MemoryBench フレームワークと MCP v4 が独自の強み。Privacy(6) がウィークポイントのまま。

### mem0: 119 → 119 (±0)

変動なし。Search(10) + Platform(10) が最大の武器。AWS Strands 公式採用（186M API calls/四半期）で実績は群を抜く。$24M Series A で資金力も十分。UI(7) が唯一の弱点。

### OpenMemory: 108 → 104 (-4) — 厳密再評価

| Axis | v5 | v6 | Reason |
|------|:--:|:--:|--------|
| Security | 8 | **7** | 認証メカニズムなし（ローカル前提で API キー不要だが、ネットワーク公開時に脆弱） |
| Multi-user | 7 | **6** | コミュニティ主導で team API なし。CNCF メンバーシップも未取得 |
| Benchmark | 6 | **5** | 独自評価フレームワークなし。第三者ベンチマーク参加実績なし |
| Temporal | 8 | **7** | Pro 版のみの機能。OSS 版では基本的な時系列フィルタのみ |

### claude-mem: 76 → 39 (-37) — v5 が大幅に過大評価だった

| Axis | v5 | v6 | Reason |
|------|:--:|:--:|--------|
| Memory Model | 9 | **5** | CLAUDE.md + MEMORY.md の2ファイル構成。構造化記憶モデルなし |
| Search | 8 | **2** | 検索機構なし。ファイル全文読み込みのみ。200行超は切り捨て |
| Storage | 7 | **3** | Markdown ファイルのみ。DB なし、インデックスなし |
| Platform | 8 | **3** | Claude Code 専用。MCP ツールなし、SDK なし |
| Security | 5 | **2** | CVE-2025-59536/CVE-2026-21852（RCE 脆弱性）。認証なし |
| UI | 7 | **2** | テキストファイル直接編集のみ。GUI なし |
| Consolidation | 8 | **3** | 手動で書き換えるしかない。自動統合なし |
| Graph | 2 | **1** | 関係性の概念なし |
| Privacy | 8 | **6** | ローカルファイルだが、CVE により RCE リスクあり |
| Multi-user | 2 | **1** | 完全に個人利用限定。分離機構なし |
| Cloud Sync | 2 | **1** | git push のみ。自動同期なし |
| Multi-modal | 1 | **1** | テキストのみ |
| Benchmark | 3 | **3** | 評価フレームワークなし |
| Temporal | 6 | **6** | ファイルタイムスタンプのみ |

> **注**: v5 の claude-mem 76pt は「Claude Code の能力」を含めた過大評価だった。
> v6 では純粋に「記憶システムとしての機能」のみを評価。
> claude-mem はファイルベースのメモ帳に過ぎず、記憶システムとしての機能は極めて限定的。

---

## harness-mem が負けている軸（GAP 分析）

| Axis | harness-mem | Best | Gap | Priority | 改善策 |
|------|:-----------:|:----:|:---:|:--------:|--------|
| **Graph / Relations** | 7 | SM **10** | **-3** | **CRITICAL** | multi-hop traversal 実装 |
| **Search / Retrieval** | 9 | mem0 **10** | **-1** | **HIGH** | learned embeddings / 5種 reranker |
| **Memory Model** | 8 | 3社 **9** | **-1** | **HIGH** | preference/emotional 型追加 |
| **Storage Flexibility** | 8 | 3社 **9** | **-1** | **HIGH** | PG async 本稼働 |
| **Security** | 8 | mem0 **9** | **-1** | **HIGH** | SOC2 Type II 準備 |
| **UI / Dashboard** | 8 | SM **9** | **-1** | **MEDIUM** | モバイル対応 |
| **Cloud Sync** | 9 | SM **10** | **-1** | **MEDIUM** | WebSocket リアルタイム同期 |
| **Benchmark / Eval** | 8 | SM/mem0 **9** | **-1** | **MEDIUM** | LoCoMo CI ゲート統合 |

**理論上の上限**: 115 + 10 = **125/140**（全ギャップ解消時）

**首位奪還に必要な最小改善**: +5pt（Graph +3, Memory Model +1, Benchmark +1 など）

---

## Competitive Landscape (v6)

```
140 ┬
    │
130 ┤                                ★ Target: 125/140
    │
119 ┤     ┌─ supermem ─┬─ mem0 ─┐     119  ← 2社同率首位
    │     │            │        │
115 ┤  ┌─ harness ─┐   │        │     115  ← 3位 (-4pt)
    │  │           │   │        │
    │  │           │   │        │
104 ┤  │           │   │  ┌ OM ─┤     104  ← #4 (-4)
    │  │           │   │  │     │
    │  │           │   │  │     │
    │  │           │   │  │     │
 39 ┤  │           │   │  │  ┌ c-m ┤   39  ← #5 (-37, 大幅修正)
    │  │           │   │  │  │     │
  0 ┴──┴───────────┴───┴──┴──┴─────┴──
         Gap: -4pt ← supermemory/mem0 が先行
```

---

## 軸別リーダー一覧

| # | Axis | Leader(s) | Score | harness-mem 位置 |
|---|------|-----------|:-----:|:----------------:|
| 1 | Memory Model | supermemory / mem0 / OpenMemory | 9 | 2位 (8) |
| 2 | Search / Retrieval | mem0 | 10 | 2位 (9) |
| 3 | Storage Flexibility | supermemory / mem0 / OpenMemory | 9 | 4位 (8) |
| 4 | Platform Integration | **harness-mem** / supermemory / mem0 | **10** | **1位** |
| 5 | Security | mem0 | 9 | 2位 (8) |
| 6 | UI / Dashboard | supermemory | 9 | 2位 (8) |
| 7 | Consolidation / Dedup | **harness-mem** / supermemory / mem0 | **8** | **1位** |
| 8 | Graph / Relations | supermemory | 10 | 4位 (7) |
| 9 | Privacy (Local-first) | OpenMemory | 10 | 2位 (9) |
| 10 | Multi-user / Team | harness-mem / supermemory / mem0 | 7 | 1位タイ |
| 11 | Cloud Sync | supermemory | 10 | 2位 (9) |
| 12 | Multi-modal | **harness-mem** / supermemory | **8** | **1位** |
| 13 | Benchmark / Eval | supermemory / mem0 | 9 | 3位 (8) |
| 14 | Temporal Reasoning | **harness-mem** / supermemory / mem0 | **8** | **1位** |

> harness-mem は 14軸中 **5軸でトップタイ**、**9軸で2位以内**。
> 致命的な弱点は **Graph (-3pt)** の1軸のみ。

---

## 業界動向（2026年3月時点）

| 動向 | 影響 |
|------|------|
| **Mastra Observational Memory** | LongMemEval 94.87%。新たな精度 SOTA 候補 |
| **OMEGA** | LongMemEval 95.4%。研究レベル SOTA |
| **mem0 AWS Strands 公式採用** | 186M API calls/四半期。エンタープライズ実績で圧倒 |
| **supermemory MemoryBench** | 独自ベンチマークフレームワーク公開。業界標準化を狙う |
| **CVE-2025-59536/CVE-2026-21852** | Claude Code フック機構に RCE。claude-mem の信頼性に致命的影響 |

---

## 次期改善ロードマップ（優先順）

### 首位奪還プラン: 115 → 120+ (/140)

| Priority | Target Axis | Current | Goal | Delta | 施策 |
|:--------:|-------------|:-------:|:----:|:-----:|------|
| **P0** | Graph / Relations | 7 | 9 | +2 | multi-hop traversal + GNN-based inference |
| **P0** | Benchmark / Eval | 8 | 9 | +1 | LoCoMo CI ゲート + LongMemEval 参加 |
| **P1** | Storage Flexibility | 8 | 9 | +1 | PostgreSQL async 本稼働 |
| **P1** | Memory Model | 8 | 9 | +1 | preference/emotional 型 + auto-classification |
| **P2** | Search / Retrieval | 9 | 10 | +1 | learned embeddings + 5種 reranker 追加 |

**P0 達成時**: 115 + 3 = **118/140**（接近）
**P0+P1 達成時**: 118 + 2 = **120/140**（首位奪還）
**全達成時**: 120 + 1 = **121/140**（2pt リード）

---

## 測定条件に関する注意事項

> **重要**: 本レポートの harness-mem スコアと競合他社スコアは、測定条件が異なるため直接比較できません。

| 項目 | harness-mem | OMEGA / Mastra |
|---|---|---|
| **評価データセット** | LoCoMo サブセット（cat-1〜4、40サンプル×120QA） | LongMemEval（7タイプ、500問フルセット） |
| **評価レイヤー** | 検索レイヤーのみ（LLM 推論なし、ルールベース抽出） | End-to-End（LLM 推論込み） |
| **harness-mem baseline** | overall F1=0.179、EM=0.050（2026-03-04 計測） | 95.4%（OMEGA）/ 94.87%（Mastra）は自社公表値 |
| **独立検証** | 本レポートは独立計測済み | 競合スコアは独立検証なし |

**この表の数値（14軸採点）は機能・アーキテクチャ評価であり、LoCoMo/LongMemEval の精度スコアとは別物です。**
詳細な測定条件は [`docs/benchmarks/measurement-framework.md`](measurement-framework.md) を参照。
