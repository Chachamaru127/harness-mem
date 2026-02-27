# Harness-mem 実装マスタープラン

最終更新: 2026-02-27
実装担当: Codex / Claude（本ファイルを唯一の実装計画ソースとして運用）

> **アーカイブ**: §0-17, §18-20 → [`docs/archive/Plans-2026-02-26.md`](docs/archive/Plans-2026-02-26.md)
> §17 INV-001〜012 は全て `blocked`（再定義待ち）のためアーカイブ。
> **テストケース設計**: [`docs/test-designs-s22.md`](docs/test-designs-s22.md)

---

## 凡例

`[P]` = 並列可 / `cc:TODO` / `cc:WIP` / `cc:完了` / `blocked`

---

## 22. メモリ品質改善（競合分析ベース）

目的: mem0, OpenMemory, supermemory, claude-mem との比較分析に基づき、harness-mem のメモリ品質・DX・エコシステムを段階的に強化する。

**独自価値**: 6つの AI コーディングツール横断の統合メモリを完全ローカルで実現。
**主な課題**: ~~コンソリデーション精度 / 関係性タイプ不足 / トークン最適化なし / SDK なし / コア6689行モノリス。~~ → §22 で全て解決済み。

---

#### Phase 1: コア品質強化（Required） — 全完了

> 依存: IMP-004 → IMP-001 の順が推奨。IMP-002/003 は並列可。

- [x] `cc:完了 [feature:tdd]` **IMP-004**: コアモジュール分割
  - `harness-mem-core.ts` (6689行) → 5モジュールに分割
  - `session-manager.ts` (419行) / `event-recorder.ts` (140行) / `observation-store.ts` (582行) / `ingest-coordinator.ts` (82行) / `config-manager.ts` (328行)
  - DoD: 各1500行以下 ✓、既存API互換 ✓、テスト全通過 (87 core-split + 134 unit) ✓

- [x] `cc:完了 [feature:tdd]` **IMP-001**: LLM 駆動コンソリデーション強化 (AUDN)
  - mem0 の ADD/UPDATE/DELETE/NOOP 4操作判定を参考に LLM モードを進化
  - 既存 `heuristic` モードは残す（フォールバック）
  - DoD: ファクト重複率 50%以下 ✓、heuristic からの回帰なし ✓、9テスト通過 ✓

- [x] `cc:完了 [feature:tdd]` **IMP-002**: メモリ関係性タイプ拡張
  - `mem_links.relation` に `updates`/`extends`/`derives` 追加。自動判定 (Jaccard類似度)
  - DoD: 3種類の関係性が記録・検索・表示される ✓、5テスト通過 ✓

- [x] `cc:完了 [feature:tdd]` **IMP-003**: トークン最適化レイヤー
  - `resume_pack` にトークンバジェット制御追加（デフォルト2000トークン）
  - DoD: resume_pack が設定バジェット以下 ✓、想起精度の回帰なし ✓、6テスト通過 ✓

---

#### Phase 2: エコシステム・DX 拡充（Recommended） — 全完了

- [x] `cc:完了 [feature:tdd] [feature:security]` **IMP-005**: TypeScript SDK 公開
  - `@harness-mem/sdk`: search/record/resumePack/timeline/getObservations/health
  - DoD: npm publish 可能 ✓、README + テスト付き (11テスト) ✓

- [x] `cc:完了 [feature:tdd]` **IMP-006**: 想起品質ベンチマーク
  - LOCOMO 風: Single-Hop/Multi-Hop/Temporal/Cross-Platform
  - DoD: CI 実行可能 ✓、ベースラインスコア記録済み ✓、5テスト通過 ✓

- [x] `cc:完了 [feature:a11y]` **W3-001**: フィードにプラットフォームバッジ表示
  - PlatformBadge コンポーネント (claude/codex/cursor/opencode/gemini)、aria-label 付き
  - DoD: プラットフォームが一目で区別できる ✓

- [x] `cc:完了 [feature:a11y]` **W3-002**: Codex 環境コンテキスト折りたたみ
  - デフォルト折りたたみ、クリック/Enter/Space で展開
  - DoD: 情報密度向上 ✓

- [x] `cc:完了 [feature:a11y]` **W3-003**: セッション単位グルーピング表示
  - SessionGroup コンポーネント、アコーディオン展開、キーボード操作対応
  - DoD: 粒度均等化 ✓

- [x] `cc:完了 [feature:a11y]` **W3-004**: プラットフォーム別タブ切替
  - All/Claude/Codex/Cursor/OpenCode/Gemini タブ、platformFilter 連動
  - DoD: ワンクリック切替 ✓

- [x] `cc:完了 [feature:a11y]` **IMP-007**: VS Code 拡張
  - サイドバーにメモリ検索・タイムライン。SDK 使用。VSIX ローカル動作
  - DoD: 検索 + タイムライン動作 ✓、10テスト通過 ✓

- [x] `cc:完了 [feature:tdd]` **IMP-008**: 埋め込みプロバイダー拡張
  - gte-small/e5-small-v2 追加、言語検出 (日本語≥10% → ruri、それ以外 → gte) 自動選択
  - DoD: 日本語=ruri / 英語=gte 自動選択 ✓、12テスト通過 ✓

---

#### Phase 3: 差別化強化（Optional） — 全完了

- [x] `cc:完了 [feature:tdd]` **IMP-009**: Signal Extraction（重要度自動判定）
  - キーワード検出 +0.3、環境コンテキスト -0.2、上限 1.0
  - DoD: シグナル付きイベントが検索上位に浮上 ✓、6テスト通過 ✓

- [x] `cc:完了 [feature:tdd] [feature:security]` **IMP-010**: 外部ナレッジコネクタ
  - GitHub Issues コネクタ + ADR/decisions.md コネクタ、重複排除ハッシュ付き
  - DoD: 取り込み動作 ✓、重複排除あり ✓、19テスト通過 ✓

- [x] `cc:完了 [feature:tdd]` **IMP-011**: Derives 関係性（推論リンク）
  - Jaccard 類似度 0.05-0.35 の同型ファクト間に双方向 derives リンク自動生成
  - DoD: 推論リンクが検索で活用される ✓、5テスト通過 ✓

---

### 22.3 完了判定（DoD） — 全達成

1. ✅ Phase 1: コアが5モジュールに分割済み、LLM コンソリデーション + heuristic フォールバック
2. ✅ Phase 2: SDK npm 公開可能、UI フィードで全プラットフォームが視覚的に均等
3. ✅ Phase 3: Signal Extraction でノイズ削減、derives 推論リンクが検索で活用
4. ✅ 全 Phase: 286テスト全通過 (unit 173 + core-split 87 + benchmark 5 + SDK 11 + VS Code 10)
