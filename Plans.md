# Harness-mem 実装マスタープラン

最終更新: 2026-03-02（§27 競合分析v2 改善プラン追加）
実装担当: Codex / Claude（本ファイルを唯一の実装計画ソースとして運用）

> **アーカイブ**: §0-21 → [`docs/archive/Plans-2026-02-26.md`](docs/archive/Plans-2026-02-26.md)
> §22 (IMP-001〜011 全完了) → [`docs/archive/Plans-s22-2026-02-27.md`](docs/archive/Plans-s22-2026-02-27.md)
> §23-26 (COMP-001〜013, TEAM-001〜011, UI-TEST-001, QUALITY-001 全完了) → [`docs/archive/Plans-s23-s26-2026-03-02.md`](docs/archive/Plans-s23-s26-2026-03-02.md)
> **テストケース設計**: [`docs/test-designs-s22.md`](docs/test-designs-s22.md)

---

## 凡例

`[P]` = 並列可 / `cc:TODO` / `cc:WIP` / `cc:完了` / `blocked`

---

## 27. 競合分析ベース改善 v2（2026-03 5ツール再比較）

目的: 5ツール14軸再比較で 103/140 → 120+/140 を目指す。
**ベンチマーク**: [`docs/benchmarks/competitive-analysis-2026-03-02.md`](docs/benchmarks/competitive-analysis-2026-03-02.md)
**スコア**: mem0(108) > OpenMemory(105) > **harness-mem(103)** > supermemory(100) > claude-mem(80)

---

#### Phase 1: 認知モデル + 検索高度化（Required, +6pt → 109）

- [ ] `cc:TODO [feature:tdd]` **NEXT-001**: Cognitive セクター自動分類
  - 観察を work/people/health/hobby/meta に自動分類、検索時セクター重み付け
  - DoD: 5セクター自動分類+検索精度向上、6テスト

- [ ] `cc:TODO [feature:tdd]` **NEXT-002**: Reranker + AST チャンク分割
  - コード取り込み時 AST ベース分割、検索時 Cross-encoder reranker
  - DoD: コードチャンク精度向上+reranker 動作、6テスト

- [ ] `cc:TODO [feature:tdd]` **NEXT-003**: MCP API 全機能公開
  - search/add/list/get/delete に加え compress/ingest/graph/stats ツール追加
  - DoD: MCP 経由で全主要機能アクセス可能、4テスト

- [ ] `cc:TODO` **NEXT-004**: グラフ可視化 UI
  - D3.js / force-directed でエンティティ関係グラフをブラウザ表示
  - DoD: ノード+エッジのインタラクティブ可視化、3テスト

- [ ] `cc:TODO` **NEXT-005**: MCP ツール拡充（関係編集・バルク操作）
  - add_relation / bulk_add / bulk_delete / export ツール追加
  - DoD: 関係操作+バルク操作が MCP 経由で動作、4テスト

---

#### Phase 2: マルチモーダル + ストレージ柔軟化（Recommended, +5pt → 114）

- [ ] `cc:TODO [feature:tdd]` **NEXT-006**: PDF ネイティブパーサー
  - pdf-parse 等で PDF バイナリ直接解析（現行 Markdown 変換のみ）
  - DoD: PDF 取り込み+チャンク分割+検索動作、5テスト

- [ ] `cc:TODO [feature:tdd]` **NEXT-007**: 画像 OCR 取り込み
  - Tesseract.js で画像→テキスト抽出→観察登録
  - DoD: 画像ファイルからテキスト抽出+検索可能、4テスト

- [ ] `cc:TODO [feature:tdd]` **NEXT-008**: pgvector バックエンド
  - PostgreSQL + pgvector でベクトル検索、SQLite と切り替え可能
  - DoD: pgvector 経由のベクトル検索動作、6テスト

- [ ] `cc:TODO` **NEXT-009**: フレームワーク SDK（Python/TS）
  - harness-mem-sdk パッケージ、LangChain/LlamaIndex Memory 互換インターフェース
  - DoD: Python/TS から SDK 経由で記録・検索動作、4テスト

---

#### Phase 3: クラウド同期 + ベンチマーク拡充（Optional, +6pt → 120）

- [ ] `cc:TODO [feature:tdd]` **NEXT-010**: クロスデバイス同期
  - CouchDB/PouchDB 方式の双方向同期、コンフリクト解決ポリシー
  - DoD: 2デバイス間の同期+コンフリクト解決、6テスト

- [ ] `cc:TODO` **NEXT-011**: LoCoMo フルデータセット評価
  - 現行サブセット→フルデータセットで再評価、CI 定期実行
  - DoD: フルデータセットスコア記録、3テスト

- [ ] `cc:TODO` **NEXT-012**: LongMemEval 拡張（Multi-session）
  - 単一セッション→マルチセッション評価、セッション間記憶持続性測定
  - DoD: マルチセッションスコア記録、3テスト

- [ ] `cc:TODO` **NEXT-013**: テンポラル KG 可視化
  - 時間軸付きナレッジグラフ表示、タイムスライダーで時点指定
  - DoD: 時系列グラフのインタラクティブ表示、3テスト

- [ ] `cc:TODO` **NEXT-014**: MCP 認証自動注入
  - MCP 接続時に user_id/team_id を自動解決（手動環境変数不要）
  - DoD: MCP 接続で認証情報自動付与、4テスト

**Phase 1-3 完了時見込み**: 103 + 17 = **120/140 (85.7%)** → mem0(108) を超える水準
