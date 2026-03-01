# Harness-mem 実装マスタープラン

最終更新: 2026-03-02（Plans.mdをTaskList実態に同期）
実装担当: Codex / Claude（本ファイルを唯一の実装計画ソースとして運用）

> **アーカイブ**: §0-21 → [`docs/archive/Plans-2026-02-26.md`](docs/archive/Plans-2026-02-26.md)
> §22 (IMP-001〜011 全完了) → [`docs/archive/Plans-s22-2026-02-27.md`](docs/archive/Plans-s22-2026-02-27.md)
> **テストケース設計**: [`docs/test-designs-s22.md`](docs/test-designs-s22.md)

---

## 凡例

`[P]` = 並列可 / `cc:TODO` / `cc:WIP` / `cc:完了` / `blocked`

---

## 23. 競合分析ベース改善（2026-03 5ツール比較）

目的: 5ツール14軸比較で B-(84/140) → A(120+) を目指す。
**ベンチマーク**: [`docs/benchmarks/competitive-analysis-2026-03-01.md`](docs/benchmarks/competitive-analysis-2026-03-01.md)
**スコア**: mem0(119) > supermemory(103) > OpenMemory(96) > **harness-mem(84)** > claude-mem(66)

---

#### Phase 1: グラフ強化 + 適応的忘却（Required, +12pt）

- [x] `cc:完了 [feature:tdd]` **COMP-001**: Multi-hop グラフ探索
  - 1-hop → N-hop(max_depth=3) 拡張、activation spreading(decay=0.5/hop)
  - DoD: 1-hop 比 +15% 再現率、6テスト

- [x] `cc:完了 [feature:tdd]` **COMP-002**: 適応的メモリ減衰（Adaptive Decay）
  - 3-tier decay (hot/warm/cold)、アクセス時自動強化、60分間隔で再計算
  - DoD: 未アクセス観察が自然に順位低下、5テスト

- [x] `cc:完了 [feature:tdd]` **COMP-003**: Point-in-time クエリ
  - `search` API に `as_of` パラメータ、valid_from/valid_to + updates リンク活用
  - DoD: 過去時点のファクトのみ返却、4テスト

---

#### Phase 2: LLM 柔軟化 + 埋め込み拡張（Required, +8pt）

- [x] `cc:完了 [feature:tdd]` **COMP-004**: LLM コンソリデーション マルチプロバイダー
  - Ollama + OpenAI / Anthropic / Gemini API 選択可能、LlmProvider 抽象化
  - DoD: 3プロバイダーでファクト抽出動作、8テスト

- [x] `cc:完了 [feature:tdd]` **COMP-005**: 埋め込みカタログ拡張
  - 3→6モデル（+bge-small/multilingual-e5/nomic-embed）、多言語自動選択
  - DoD: 6モデル自動選択+多言語テスト、6テスト

---

#### Phase 3: メモリ圧縮 + マルチモーダル（Recommended, +10pt）

- [x] `cc:完了 [feature:tdd]` **COMP-006**: メモリ圧縮エンジン
  - merge/summarize/prune 3戦略、`/v1/admin/compress` + 定期自動実行
  - DoD: 観察数 30%以上削減かつ検索品質維持、6テスト

- [x] `cc:完了 [feature:tdd]` **COMP-007**: PDF/Markdown ドキュメント取り込み
  - `/v1/ingest/document`、MD(見出し分割)/HTML(タグ除去)/text の3形式（外部ライブラリ不使用）
  - DoD: 3形式の取り込み動作、8テスト

- [x] `cc:完了 [feature:tdd]` **COMP-008**: URL コネクター
  - `/v1/ingest/url`、robots.txt 尊重、SSRF 防止（プライベートIPブロック）
  - DoD: 公開 URL 取り込み動作、6テスト（12テスト実装）

---

#### Phase 4: 公開ベンチマーク + MCP サーバー（Recommended, +8pt）

- [x] `cc:完了 [feature:tdd]` **COMP-009**: LongMemEval / LoCoMo ベンチマーク
  - 4タスク(Single-Hop/Multi-Hop/Temporal/Open-Domain)、CI 定期実行
  - DoD: スコア記録+CI 統合、4テスト

- [x] `cc:完了 [feature:tdd]` **COMP-010**: MCP サーバー公開
  - stdio/HTTP 両対応、search/add/list/get/delete ツール（+harness_mem_delete_observation追加）
  - DoD: Claude Desktop + Cursor から動作確認、8テスト

---

#### Phase 5: 外部コネクター + 自動リフレクション（Optional, +3pt）

> COMP-011（ユーザースコープ分離）は **§24 TEAM-003〜005** に統合・大幅拡張。

- [x] `cc:完了` **COMP-012**: Notion / Google Drive コネクター — DoD: 取り込み動作、8テスト
- [x] `cc:完了` **COMP-013**: 自動リフレクション — DoD: 矛盾ファクト検出・解消、5テスト

**Phase 1-4 完了時見込み**: 84 + 38 = **122/140 (87.1%)** → mem0(119) に迫る水準

---

## 24. VPS/チームデプロイ（2026-03 顧問先導入）

目的: 顧問先企業（IT4名+マーケ3名+役員2名）への harness-mem チーム導入。
**要件詳細**: [`docs/specs/vps-team-deploy-spec.md`](docs/specs/vps-team-deploy-spec.md)

**原則**: PII はクライアント側フィルタ / 生データはチーム内、ファクトは全社共有 / VPS ダウン時もローカル継続

---

#### Phase 1: VPS 基盤（P0 — VPS化の最低条件）

- [x] `cc:完了 [feature:security]` **TEAM-001**: リモートバインド + トークン認証必須化
  - `0.0.0.0` バインド時 `ADMIN_TOKEN` 必須、TLS はリバースプロキシ方式（Caddy/Nginx ドキュメント）
  - DoD: リモートバインド+トークン必須+TLSドキュメント、4テスト

- [x] `cc:完了` **TEAM-002**: MCP Server リモート接続対応
  - `HARNESS_MEM_REMOTE_URL` / `REMOTE_TOKEN` 追加、ensureDaemon スキップ→/health 確認
  - DoD: MCP 経由でリモート VPS に記録・検索動作、5テスト

---

#### Phase 2: マルチユーザー + NDA 対応（P1 — チーム運用の前提）

- [x] `cc:完了 [feature:tdd]` **TEAM-003**: ユーザー識別スキーマ拡張
  - mem_sessions/events/observations に `user_id` + `team_id`、環境変数で MCP から付与
  - DoD: ユーザー・チーム別データ記録+マイグレーション、5テスト

- [x] `cc:完了 [feature:security]` **TEAM-004**: マルチトークン認証
  - config.json トークンマップ（token → user_id + team_id）、admin は全アクセス可
  - DoD: 複数トークンでユーザー解決+不正トークン拒否、6テスト

- [x] `cc:完了 [feature:tdd]` **TEAM-005**: データアクセス制御
  - 自分:R/W、同チーム:R、別チーム:❌、ファクト:全社R
  - DoD: スコープ別アクセス制御動作、8テスト

- [x] `cc:完了 [feature:security]` **TEAM-006**: PII フィルタリング
  - MCP→VPS 送信前フィルタ（電話/メール/住所/LINE ID）、pii-rules.json カスタマイズ可
  - DoD: PII が VPS に到達しない、6テスト

---

#### Phase 3: デプロイ自動化（P1）

- [x] `cc:完了` **TEAM-007**: Docker compose + セットアップ自動化
  - Dockerfile + docker-compose.yml (PostgreSQL+Caddy)、`harness-mem deploy` サブコマンド
  - DoD: `docker compose up` でワンコマンド起動、4テスト

---

#### Phase 4: 耐障害性 + チーム UI（P2）

- [x] `cc:完了 [feature:tdd]` **TEAM-008**: ローカル⇔リモート ハイブリッドモード
  - VPS ダウン→ローカル SQLite 退避→復旧後フラッシュ（dedupe_hash 重複排除）
  - DoD: VPS停止→退避→復旧→フラッシュの一連動作、6テスト

- [x] `cc:完了 [feature:tdd]` **TEAM-009**: チームフィード + ユーザーフィルター
  - 全メンバーのリアルタイム表示（既存SSE活用）+ user_id/team_id フィルター UI
  - DoD: 複数ユーザーのデータ表示・フィルタ可能、5テスト

---

#### Phase 5: 運用強化（P3）

- [x] `cc:完了` **TEAM-010**: ナレッジマップ + 利用統計 — DoD: ファクト分布・利用統計表示、4テスト
- [x] `cc:完了` **TEAM-011**: クライアント設定配布コマンド — DoD: 設定スニペット出力、3テスト

---

## 25. UI テスト環境修正

- [x] `cc:完了` **UI-TEST-001**: bun:test で DOM 環境が未定義になる問題を修正
  - 依頼内容: bun test 実行時に document/localStorage 未定義、vi.stubGlobal 非対応エラーを修正
  - 追加日時: 2026-03-02
  - 解決: bunfig.toml + tests/setup.ts（jsdom 注入）作成、vi.stubGlobal → globalThis 直接代入に変更

### 24.1 完了判定（DoD）

1. P0: VPS 上で TLS 越し動作、MCP からリモート接続可能
2. P1: 9名が個別トークンで接続、スコープ分離、PII フィルタ、Docker ワンコマンド起動
3. P2: VPS 停止時ローカルフォールバック→復旧同期、チーム UI フィルタ表示
4. P3: ナレッジマップ・統計ダッシュボード・設定配布コマンド
