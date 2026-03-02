# Harness-mem 実装マスタープラン

最終更新: 2026-03-03（FIX-001 Bun並列テストSQLiteフラッキー修正）
実装担当: Codex / Claude（本ファイルを唯一の実装計画ソースとして運用）

> **アーカイブ**: §0-21 → [`docs/archive/Plans-2026-02-26.md`](docs/archive/Plans-2026-02-26.md)
> §22 (IMP-001〜011 全完了) → [`docs/archive/Plans-s22-2026-02-27.md`](docs/archive/Plans-s22-2026-02-27.md)
> §23-26 (COMP-001〜013, TEAM-001〜011, UI-TEST-001, QUALITY-001 全完了) → [`docs/archive/Plans-s23-s26-2026-03-02.md`](docs/archive/Plans-s23-s26-2026-03-02.md)
> §27 (NEXT-001〜014 全完了、品質監査済) → [`docs/archive/Plans-s27-2026-03-02.md`](docs/archive/Plans-s27-2026-03-02.md)
> §22 IMP-001〜011, W3-001〜004, §27.2 QH-001〜006, §28 CQRS-001〜007, Quality H1/M5, M4, H2 → [`docs/archive/Plans-2026-03-02.md`](docs/archive/Plans-2026-03-02.md)
> **テストケース設計**: [`docs/test-designs-s22.md`](docs/test-designs-s22.md) / [`docs/test-designs-s27.1.md`](docs/test-designs-s27.1.md)

---

## FIX-001: Bun並列テストSQLiteフラッキー修正 `cc:完了`

- 依頼内容: `bun test` 並列実行時に統合テストが断続的に `SQLiteError: disk I/O error` で失敗する問題を修正
- 原因: バックグラウンドタイマーコールバックが shutdown 後もDBにアクセスし続ける race condition
- 修正: `startBackgroundWorkers()` の各タイマーコールバックに `shuttingDown` ガード + `try-catch` を追加
- 検証: `bun test memory-server/tests/` を3回実行、全600テストパス（0失敗）
- 追加日時: 2026-03-03

---

## 凡例

`[P]` = 並列可 / `cc:TODO` / `cc:WIP` / `cc:完了` / `blocked`

---

## §27 + §27.1 結果サマリー

**§27 申告値**: 103 + 11 = 114/140 → §27.1 品質強化後: **118/140 (84.3%)**
**v3 ランキング**: **harness-mem(118)** > supermemory(115) > mem0(110) > OpenMemory(106) > claude-mem(76)
**ベンチマーク v3**: [`docs/benchmarks/competitive-analysis-2026-03-02-v3.md`](docs/benchmarks/competitive-analysis-2026-03-02-v3.md)
**警告**: supermemory が +10pt 急成長で 3pt 差に迫る。Graph(10)/Benchmark(10) で逆転されている

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

## 28. supermemory 逆転阻止＋圧倒的リード確立（2026-03 118→130/140）

目的: supermemory が +10pt 急成長で 3pt 差に迫る中、逆転を阻止し圧倒的リードを確立する。
**前提**: §27.1 全タスク完了済み。
**ベンチマーク v3**: [`docs/benchmarks/competitive-analysis-2026-03-02-v3.md`](docs/benchmarks/competitive-analysis-2026-03-02-v3.md)
**スコア**: harness-mem(118) > **supermemory(115, +10急成長)** > mem0(110) > OpenMemory(106) > claude-mem(76)

**harness-mem が負けている軸**: Graph(-2), Platform(-1), Benchmark(-1), MemoryModel(-1), Storage(-1), Privacy(-1)

---

#### Phase 1: supermemory 逆転阻止 + スタブ解消（P0, +5pt → 123）

- [ ] `cc:TODO [feature:tdd] [P]` **GAP-006**: Graph 強化 — Embeddable コンポーネント + データモデル拡張
  - `<HarnessMemGraph />` npm パッケージ（WebGL + React）+ typed relations 6種追加
  - relation types: `updates`/`extends`/`derives`/`contradicts`/`causes`/`part_of`
  - **対抗**: supermemory Graph(10) に **-2pt 差（CRITICAL）**
  - DoD: npm ビルド + typed relations CRUD + 埋め込みデモ + 統合テスト、8テスト

- [ ] `cc:TODO [feature:tdd] [P]` **GAP-001**: pgvector StorageAdapter 完成（スタブ解消）
  - `query().all()/.get()/.run()` スタブ → async StorageAdapter v2 フル CRUD + Core 統合
  - **理由**: §27→§27.1 と2フェーズ未解決。3度目で確実に完了させる
  - DoD: pgvector フル CRUD + HarnessMemCore 経由の読み書き動作、8テスト

- [ ] `cc:TODO [feature:tdd] [P]` **GAP-004**: Vercel AI SDK + CrewAI プロバイダー
  - MemoryProvider 互換 + CrewAI Memory ラッパー
  - **対抗**: mem0/supermemory Platform(10) に -1pt 差
  - DoD: 2 SDK から記録・検索動作、6テスト

- [ ] `cc:TODO [P]` **GAP-007**: ベンチマーク公開 + CI + MemoryBench 対抗
  - LoCoMo/LongMemEval CI 週次実行 + スコア推移 + 公開ダッシュボード
  - **対抗**: supermemory Benchmark(10) に -1pt 差
  - DoD: CI 自動実行+結果公開+スコア比較表、5テスト

---

#### Phase 2: 全軸9以上達成（P1, +3pt → 126）

- [ ] `cc:TODO [feature:tdd]` **GAP-003**: エピソード/意味記憶の型分類
  - episodic/semantic/procedural 自動分類 + 型フィルタ検索
  - **対抗**: supermemory/OpenMemory MemoryModel(9) に -1pt 差
  - DoD: 3記憶型の自動分類+フィルタ検索、8テスト

- [ ] `cc:TODO [feature:security]` **GAP-008**: オフライン LLM 対応（Ollama ファーストクラス）
  - Ollama API でファクト抽出・圧縮・リフレクションを完全ローカル実行
  - **対抗**: OpenMemory Privacy(10) に -1pt 差
  - DoD: API キーなしで全 LLM 機能動作、6テスト

- [ ] `cc:TODO [feature:tdd]` **GAP-005**: 音声トランスクリプション取り込み
  - Whisper で音声→テキスト→観察登録、話者分離対応
  - DoD: 音声取り込み+検索可能、6テスト

---

#### Phase 3: リード拡大（P2, +2pt → 128）

- [ ] `cc:TODO` **GAP-009**: ネイティブデスクトップアプリ（Tauri）
  - Tauri v2 + React UI、システムトレイ常駐+グローバル検索
  - **対抗**: supermemory Nova(9)
  - DoD: macOS ビルド+起動+基本操作、4テスト

- [ ] `cc:TODO [feature:tdd]` **GAP-002**: Cloud Sync 永続化 + クライアント SDK
  - SyncStore DB 永続化 + Core observations 統合 + WS リアルタイム通知
  - **注意**: Cloud Sync は既に 9pt（同率首位）。Phase 1-2 完了後に着手
  - DoD: DB永続化 + WS 接続 + クライアント SDK、8テスト

> **削除**: ~~GAP-010 ストリーミング圧縮~~ — Consolidation(8)は既に全競合と同率首位。勝っている軸の強化は不要。

---

### 28.1 完了判定（DoD）

1. Phase 1: Graph 強化(+2) + pgvector 完成(+1) + SDK(+1) + ベンチマーク公開(+1)
2. Phase 2: 記憶型分類(+1) + Ollama(+1) + 音声(+1)
3. Phase 3: Tauri(+1) + Sync 永続化(+1)

**Phase 1-3 完了目標**: 118 + 10 = **128/140 (91.4%)** — 2位に13pt差
