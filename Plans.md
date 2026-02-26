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
**主な課題**: コンソリデーション精度 / 関係性タイプ不足 / トークン最適化なし / SDK なし / コア6689行モノリス。

---

#### Phase 1: コア品質強化（Required）

> 依存: IMP-004 → IMP-001 の順が推奨。IMP-002/003 は並列可。

- [ ] `cc:TODO [feature:tdd]` **IMP-004**: コアモジュール分割
  - `harness-mem-core.ts` (6689行) → 5モジュールに分割
  - `session-manager.ts` / `event-recorder.ts` / `observation-store.ts` / `ingest-coordinator.ts` / `config-manager.ts`
  - DoD: 各1500行以下、既存API互換、テスト全通過 | 工数: 3-5日

- [ ] `cc:TODO [feature:tdd]` **IMP-001**: LLM 駆動コンソリデーション強化 (AUDN)
  - mem0 の ADD/UPDATE/DELETE/NOOP 4操作判定を参考に LLM モードを進化
  - 既存 `heuristic` モードは残す（フォールバック）
  - LLM モード: 新ファクト抽出 → 既存との比較 → LLM が操作判定 → `superseded_by` で矛盾解消
  - DoD: ファクト重複率 50%以下、heuristic からの回帰なし | 工数: 2-3日

- [ ] `[P] cc:TODO [feature:tdd]` **IMP-002**: メモリ関係性タイプ拡張
  - `mem_links.relation` に `updates`(上書き) / `extends`(補足) / `derives`(推論スキーマのみ) 追加
  - 検索: `updates` 先は除外、`extends` は加算。`autoLinkObservation()` 拡張
  - DoD: 3種類の関係性が記録・検索・表示される | 工数: 1-2日

- [ ] `[P] cc:TODO [feature:tdd]` **IMP-003**: トークン最適化レイヤー
  - `resume_pack` にトークンバジェット制御追加（デフォルト2000トークン）
  - 最重要ファクト + 直近セッションサマリーで予算内に収める。超過時は重要度順に切り捨て
  - DoD: resume_pack が設定バジェット以下、想起精度の回帰なし | 工数: 1日

---

#### Phase 2: エコシステム・DX 拡充（Recommended）

> UI タスク (W3-*) は Phase 1 と並列実行可能。

- [ ] `cc:TODO [feature:tdd] [feature:security]` **IMP-005**: TypeScript SDK 公開
  - `@harness-mem/sdk`: `search()`, `record()`, `resumePack()`, `timeline()`, `getObservations()`
  - HTTP クライアント (localhost:37888)。新規 `sdk/` ディレクトリ
  - DoD: npm publish 可能、README + テスト付き | 工数: 2-3日

- [ ] `[P] cc:TODO [feature:tdd]` **IMP-006**: 想起品質ベンチマーク
  - LOCOMO 風テストスイート: Single-Hop / Multi-Hop / Temporal / Cross-Platform
  - スコアリング: 正解率 + p95レイテンシ + トークン使用量。新規 `tests/benchmark/`
  - DoD: CI で実行可能、ベースラインスコアが記録される | 工数: 1-2日

- [ ] `[P] cc:TODO [feature:a11y]` **W3-001**: フィードにプラットフォームバッジ表示
  - 各レコードに claude/codex/cursor/opencode/gemini のバッジ追加
  - 対象: `FeedPanel.tsx` | DoD: プラットフォームが一目で区別できる | 工数: 0.5日

- [ ] `[P] cc:TODO [feature:a11y]` **W3-002**: Codex 環境コンテキスト折りたたみ
  - `<environment_context>` / `<AGENTS.md>` 系をデフォルト折りたたみ、展開ボタン付き
  - 対象: `FeedPanel.tsx`, `useFeedPagination.ts` | DoD: 情報密度向上 | 工数: 0.5-1日

- [ ] `cc:TODO [feature:a11y]` **W3-003**: セッション単位グルーピング表示
  - 同一 `session_id` を1行にまとめ（アコーディオン展開）。「Codex セッション — 32件」表示
  - 対象: `FeedPanel.tsx`, 新規 `SessionGroup` | DoD: 粒度均等化 | 工数: 1-2日

- [ ] `[P] cc:TODO [feature:a11y]` **W3-004**: プラットフォーム別タブ切替
  - フィード上部に All/Claude/Codex/Cursor/Gemini タブ。`platformFilter` と連動
  - 対象: `FeedPanel.tsx`, `useSettings.ts` | DoD: ワンクリック切替 | 工数: 0.5-1日

- [ ] `cc:TODO [feature:a11y]` **IMP-007**: VS Code 拡張
  - サイドバーにメモリ検索・タイムライン。SDK (IMP-005) 使用。新規 `vscode-extension/`
  - DoD: Marketplace 公開可能、検索 + タイムライン動作 | 工数: 3-5日

- [ ] `[P] cc:TODO [feature:tdd]` **IMP-008**: 埋め込みプロバイダー拡張
  - 英語モデル (gte-small, e5-small) を ONNX レジストリに追加。言語別自動選択
  - 対象: `embedding/registry.ts` | DoD: 日本語=ruri / 英語=gte 自動選択 | 工数: 1日

---

#### Phase 3: 差別化強化（Optional）

> Phase 2 完了後。harness-mem の独自価値をさらに伸ばすタスク群。

- [ ] `cc:TODO [feature:tdd]` **IMP-009**: Signal Extraction（重要度自動判定）
  - キーワード (`remember`, `architecture`, `decision`, `bug`, `fix`) 検出で importance +0.3
  - 環境コンテキスト系は importance -0.2。上限 1.0
  - DoD: シグナル付きイベントが検索上位に浮上 | 工数: 0.5-1日

- [ ] `cc:TODO [feature:tdd] [feature:security]` **IMP-010**: 外部ナレッジコネクタ
  - GitHub Issues → harness-mem 自動同期（`gh` CLI 利用）。decisions.md / ADR 取り込み
  - 新規 `memory-server/src/connectors/` | DoD: 取り込み動作、重複排除あり | 工数: 2-3日

- [ ] `cc:TODO [feature:tdd]` **IMP-011**: Derives 関係性（推論リンク）
  - 複数ファクト間のパターンから暗黙の洞察を自動生成（LLM モード時のみ）
  - コンソリデーション (IMP-001) の拡張 | DoD: 推論リンクが検索で活用される | 工数: 2-3日

---

### 22.3 完了判定（DoD）

1. Phase 1: コアが分割済み、LLM コンソリデーションでファクト重複率 50%以下
2. Phase 2: SDK が npm 公開可能、UI フィードで Codex と Claude が視覚的に均等
3. Phase 3: Signal Extraction でノイズ削減、推論リンクが検索で活用される
4. 全 Phase: 既存テスト + 新規テスト全通過、ビルド成功
