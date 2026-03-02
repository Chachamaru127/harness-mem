# Harness-mem 実装マスタープラン

最終更新: 2026-03-02（§27 完了+品質監査、§27.1 品質強化 + §28 改善プラン追加）
実装担当: Codex / Claude（本ファイルを唯一の実装計画ソースとして運用）

> **アーカイブ**: §0-21 → [`docs/archive/Plans-2026-02-26.md`](docs/archive/Plans-2026-02-26.md)
> §22 (IMP-001〜011 全完了) → [`docs/archive/Plans-s22-2026-02-27.md`](docs/archive/Plans-s22-2026-02-27.md)
> §23-26 (COMP-001〜013, TEAM-001〜011, UI-TEST-001, QUALITY-001 全完了) → [`docs/archive/Plans-s23-s26-2026-03-02.md`](docs/archive/Plans-s23-s26-2026-03-02.md)
> §27 (NEXT-001〜014 全完了、品質監査済) → [`docs/archive/Plans-s27-2026-03-02.md`](docs/archive/Plans-s27-2026-03-02.md)
> §22 IMP-001〜011, W3-001〜004, §27.2 QH-001〜006, §28 CQRS-001〜007, Quality H1/M5, M4, H2 → [`docs/archive/Plans-2026-03-02.md`](docs/archive/Plans-2026-03-02.md)
> **テストケース設計**: [`docs/test-designs-s22.md`](docs/test-designs-s22.md) / [`docs/test-designs-s27.1.md`](docs/test-designs-s27.1.md)

---

## 凡例

`[P]` = 並列可 / `cc:TODO` / `cc:WIP` / `cc:完了` / `blocked`

---

## §27 結果サマリー

**申告値**: 103 + 11 = **114/140 (81.4%)** → 首位獲得（mem0: 109, supermemory: 105）
**品質監査後の実態値**: **~110/140**（OCR モック、SDK 型未検証、Sync HTTP 未実装、pgvector スタブの影響）
**ベンチマーク**: [`docs/benchmarks/competitive-analysis-2026-03-02-v2.md`](docs/benchmarks/competitive-analysis-2026-03-02-v2.md)

> テスト品質監査の結果:
> - **C 評価（モック過多）**: NEXT-007 OCR, NEXT-009 SDK, NEXT-004 Graph viz
> - **B 評価（統合テスト不足）**: NEXT-008 pgvector, NEXT-010 Sync, NEXT-002 Reranker
> - **バグ**: NEXT-011 LoCoMo maxSamples 未伝播

---

## 27.1 §27 品質強化（Required — 申告スコアの正当性担保）

目的: テスト品質監査で発見された「テストは pass するが実装が不完全」な箇所を修正し、申告 114pt を実態として裏付ける。
**原則**: §28 の新機能に進む前に、§27 の品質を固める。

#### Phase 0: 品質ゲート修正（Required, 全6タスク）

- [x] `cc:完了 [feature:tdd]` **HARDEN-001**: OCR 統合テスト — Tesseract.js 実動作検証
  - `tests/fixtures/` に3画像作成、統合テスト3件追加（モックなし実動作）
- [x] `cc:完了 [feature:tdd]` **HARDEN-002**: SDK 型互換テスト — `as never` 除去
  - `as never` 4箇所除去、`HarnessMemClientLike` 導入、`satisfies` 検証2件追加
- [x] `cc:完了 [feature:tdd]` **HARDEN-003**: Sync HTTP エンドポイント実装
  - `/v1/sync/push` + `/v1/sync/pull` 実装、認証+冪等性+入力バリデーション、6テスト
- [x] `cc:完了 [feature:tdd]` **HARDEN-004**: pgvector Docker CI 統合テスト
  - `docker-compose.test.yml` + CI ワークフロー新規作成、統合テスト4件追加
- [x] `cc:完了` **HARDEN-005**: Reranker テスト閾値の厳格化
  - `< 0.3` に厳格化 + 日本語バイグラムテスト追加
- [x] `cc:完了 [bugfix:reproduce-first]` **HARDEN-006**: LoCoMo maxSamples 伝播バグ修正
  - `locomo-full.ts` → `run-locomo-benchmark.ts` への maxSamples 伝播修正、回帰テスト2件

---

### 27.1 完了判定（DoD）

1. 全6タスク完了
2. `bun test` 全 pass（既存 6 fail の FeedPanel/E2E は除外可）
3. pgvector 統合テストが CI で自動実行
4. `as never` がテストコードからゼロ
5. 実画像 OCR テストが pass

**完了後**: 申告 114pt が実態として正当化され、§28 に進める状態になる。

---

## 28. 首位維持＋圧倒的リード確立（2026-03 114→126/140）

目的: §27.1 で品質を固めた上で、2位 mem0（109）との差を 5pt→17pt に広げ、圧倒的リードを確立する。
**前提**: §27.1 全タスク完了後に着手。
**ベンチマーク**: [`docs/benchmarks/competitive-analysis-2026-03-02-v2.md`](docs/benchmarks/competitive-analysis-2026-03-02-v2.md)
**スコア**: **harness-mem(114)** > mem0(109) > OpenMemory(105) = supermemory(105) > claude-mem(69)

---

#### Phase 1: 基盤完成 — ストレージ＋同期の本格化（P0, +3pt → 117）

- [ ] `cc:TODO [feature:tdd]` **GAP-001**: pgvector StorageAdapter 非同期対応完成
  - async StorageAdapter v2 導入 → フル CRUD。**前提**: HARDEN-004 完了
  - DoD: pgvector フル CRUD、8テスト

- [ ] `cc:TODO [feature:tdd]` **GAP-002**: Cloud Sync WebSocket リアルタイム同期
  - WS リアルタイム通知 + 再接続差分同期。**前提**: HARDEN-003 完了
  - DoD: WS 接続 + 通知 + 再接続同期、6テスト

---

#### Phase 2: 認知+SDK+マルチモーダル拡張（P1, +3pt → 120）

- [ ] `cc:TODO [feature:tdd]` **GAP-003**: エピソード/意味記憶の型分類
  - episodic/semantic/procedural 自動分類 + 型フィルタ検索
  - DoD: 3記憶型の自動分類+フィルタ検索、8テスト

- [ ] `cc:TODO [feature:tdd]` **GAP-004**: Vercel AI SDK + CrewAI プロバイダー
  - MemoryProvider 互換 + CrewAI Memory ラッパー
  - DoD: 2 SDK から記録・検索動作、6テスト

- [ ] `cc:TODO [feature:tdd]` **GAP-005**: 音声トランスクリプション取り込み
  - Whisper で音声→テキスト→観察登録、話者分離対応
  - DoD: 音声取り込み+検索可能、6テスト

---

#### Phase 3: グラフ強化+ベンチマーク公開+プライバシー（P2, +3pt → 123）

- [ ] `cc:TODO` **GAP-006**: Embeddable グラフ React コンポーネント
  - `<HarnessMemGraph />` npm パッケージ（iframe + React 両対応）
  - DoD: npm ビルド + 統合テスト、5テスト

- [ ] `cc:TODO [feature:tdd]` **GAP-007**: ベンチマーク結果公開 + CI 自動実行
  - LoCoMo/LongMemEval を GitHub Actions 週次実行 + スコア推移記録
  - DoD: CI 自動実行+結果記録、4テスト

- [ ] `cc:TODO [feature:security]` **GAP-008**: オフライン LLM 対応（Ollama ファーストクラス）
  - Ollama API でファクト抽出・圧縮・リフレクションを完全ローカル実行
  - DoD: API キーなしで全 LLM 機能動作、6テスト

---

#### Phase 4: UX 革新（P3, +2~3pt → 126）

- [ ] `cc:TODO` **GAP-009**: ネイティブデスクトップアプリ（Tauri）
  - Tauri v2 + React UI、システムトレイ常駐+グローバル検索
  - DoD: macOS/Windows/Linux ビルド+起動、4テスト

- [ ] `cc:TODO [feature:tdd]` **GAP-010**: ストリーミング圧縮エンジン
  - リアルタイム増分圧縮 + Working→Archive 自動昇格
  - DoD: ストリーミング圧縮+自動昇格動作、6テスト

---

### 28.1 完了判定（DoD）

1. Phase 1: pgvector フル CRUD + Cloud Sync WebSocket
2. Phase 2: 記憶型分類 + 2 SDK 追加 + 音声取り込み
3. Phase 3: 組み込みグラフ + CI ベンチマーク + オフライン LLM
4. Phase 4: Tauri デスクトップ + ストリーミング圧縮

**Phase 1-4 完了目標**: 114 + 12 = **126/140 (90.0%)** — 全ツール中の圧倒的首位
