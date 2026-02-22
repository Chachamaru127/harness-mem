# Harness-mem World-1 実装マスタープラン

最終更新: 2026-02-22  
対象: `harness-mem` を「AI開発チーム向け統一メモリ基盤」で世界1位にするための、実装直結プラン。  
実装担当: Codex（本ファイルを唯一の実装計画ソースとして運用）

---

## 0. 目的と成功条件

### 0.1 目的

`harness-mem` の現行優位（クロスツール統合、運用性、プライバシー）を維持しながら、競合優位がある以下を逆転する。

1. 意味検索品質（Semantic Retrieval）
2. 記憶の自動最適化（抽出・統合・要約）
3. エコシステム接続（Python/主要フレームワーク）

### 0.2 成功条件（Release Gate）

以下を全て満たした時点で「v1.0 完了」とする。

1. 検索品質:
   - `Recall@10 >= 0.80`
   - `MRR@10 >= 0.65`
2. 性能:
   - `search p95 < 300ms`（100k observations、warm）
   - `resume-pack p95 < 800ms`
3. トークン効率:
   - 3層取得（index -> timeline -> details）で、旧方式比 `>=70%` トークン削減
4. プライバシー:
   - private/sensitive の漏えい 0（E2E + 回帰）
5. 運用:
   - `setup -> doctor -> smoke` がクリーン環境で再現可能
6. エコシステム:
   - Python SDK 1.0（search/timeline/get_observations/record/finalize）
   - LangChain(or LangGraph) 公式統合 1本

---

## 1. 完成イメージ（解像度MAX）

### 1.1 プロダクト完成像

1. 開発者は `harness-mem setup` だけで Codex/Cursor/OpenCode/Claude を統一接続できる。
2. セッション開始時、Agentは「軽量インデックス（Layer 1）」のみ受け取り、必要時だけ掘る。
3. メモリ保存は受動ログ保存ではなく、重要事実（意思決定、制約、好み、教訓）が自動抽出される。
4. 重複・矛盾・古い情報はバックグラウンド統合され、長期運用でも文脈汚染しない。
5. private/sensitive は保存前処理と取得時フィルタの二重防御で漏れない。
6. 同じ記憶基盤を Python/TS/CLI から利用できる。

### 1.2 完成時ユーザーフロー（E2E）

1. セッション開始:
   - `resume-pack` で最近要約 + 高関連 index を受信
2. タスク着手:
   - `search` で候補IDのみ取得（コスト可視化）
3. 深掘り:
   - `timeline` で前後文脈を展開
   - `get_observations` で必要IDのみ詳細取得
4. 実装中:
   - 重要な節目で checkpoint 記録
5. セッション終了:
   - finalizeで要約生成 + memory consolidation queue投入
6. 次回セッション:
   - 統合済み知識を再利用し、重複説明不要

### 1.3 競争上の最終ポジション

1. `mem0` に対して: 開発ツール統合と運用性で勝ち、検索品質でも同等以上
2. `claude-mem` に対して: Claude特化を超えて、マルチクライアント運用で勝つ
3. `memos` に対して: AI記憶文脈では別カテゴリで優位を確立

---

## 2. スコープ定義

### 2.1 In Scope

1. Embedding provider 抽象化 + OpenAI/Ollama 実装 + 既存fallback維持
2. Reranker導入（最初は軽量、将来差し替え可能）
3. 3層検索導線の強制（ツール説明/UI/ガイド）
4. Consolidation worker（抽出・統合・圧縮）
5. Python SDK + LangChain統合
6. ベンチマーク/品質測定/運用メトリクス

### 2.2 Out of Scope（v1.0ではやらない）

1. フルマネージドSaaS実装
2. 大規模マルチテナント認可サーバー
3. 全フレームワーク同時対応（優先2本のみ）
4. UI全面刷新（必要機能拡張に限定）

---

## 3. 機能要件（FR）

### FR-100 メモリモデル

FR-101:
- 会話/セッション/ユーザー/組織の4層メモリを論理的に扱えること。
- 受入基準: `search` が層別重みづけ可能。

FR-102:
- 観測種別（decision/pattern/preference/lesson/action/context/summary）を保持できること。
- 受入基準: 種別フィルタが `search_facets` で取得可能。

FR-103:
- エンティティと観測リンクを保存し、関連観測拡張に利用できること。
- 受入基準: `expand_links=true` で shared_entity/follows が反映される。

### FR-200 検索品質

FR-201:
- Embedding provider を選択可能（OpenAI/Ollama/Fallback）。
- 受入基準: 設定値で provider が切り替わり、healthに反映。

FR-202:
- Hybrid検索（lexical + vector + recency + tag + graph）を維持/強化。
- 受入基準: debugメタに各スコアと重みが返る。

FR-203:
- Reranker適用可能（ON/OFF）。
- 受入基準: reranker有効時に最終順位が変化し、性能劣化が閾値内。

FR-204:
- ベクトルカバレッジ不足時の安全な劣化（vector weight=0）。
- 受入基準: 既存互換テスト通過。

### FR-300 3層取得（Progressive Disclosure）

FR-301:
- `search -> timeline -> get_observations` の導線を公式ワークフローとして明示。
- 受入基準: MCPツール説明/README/Setup Guideに明記。

FR-302:
- 各取得の推定トークンコストを返すこと。
- 受入基準: APIレスポンス `meta.token_estimate` 追加。

FR-303:
- 一括詳細取得の乱用を抑止するヒントを返すこと。
- 受入基準: `get_observations` 大量ID時に警告メタ付与。

### FR-400 自動抽出・統合

FR-401:
- イベント流入時に重要事実抽出（Fact Extraction）を行うこと。
- 受入基準: `mem_facts`（新規）へ保存される。

FR-402:
- 類似Factの統合（Consolidation）をバックグラウンド実行すること。
- 受入基準: 重複率がベンチで低下。

FR-403:
- セッション終了時要約をLLMベースで生成可能。
- 受入基準: モード `llm|heuristic` 切替可能、失敗時はheuristicへフォールバック。

### FR-500 プライバシー/ガバナンス

FR-501:
- private/sensitive の既定非表示を維持。
- 受入基準: include_private=false で漏えい0。

FR-502:
- redaction済み本文のみFTS対象にする。
- 受入基準: FTSインデックスから原文機微語が復元不可。

FR-503:
- 監査メタ（誰が/いつ/どの条件で取得）を記録。
- 受入基準: admin監査APIで参照可能。

### FR-600 エコシステム

FR-601:
- Python SDKで主要APIを利用可能。
- 受入基準: pip install後QuickStartが3分以内に動作。

FR-602:
- LangChainまたはLangGraph連携アダプタを提供。
- 受入基準: 公式サンプルがCIで実行成功。

FR-603:
- API契約をOpenAPIで公開。
- 受入基準: CIでspec整合チェック。

### FR-700 運用/可観測性

FR-701:
- health/metricsで provider, coverage, queue を可視化。
- 受入基準: `/v1/admin/metrics` に新規項目。

FR-702:
- reindex, compact, consolidation の管理コマンドを提供。
- 受入基準: CLI + MCP admin tool から実行可。

---

## 4. 非機能要件（NFR）

NFR-001 可用性:
- Daemon start/stop 100回連続でゾンビ0。

NFR-002 性能:
- 100k observationsで `search p95 < 300ms`。

NFR-003 一貫性:
- dedupe_hash衝突時でも重複保存なし。

NFR-004 セキュリティ:
- パス検証・入力検証・SQL/FTS注入対策を維持。

NFR-005 拡張性:
- provider追加時に coreの改変最小（interface実装のみ）。

NFR-006 互換性:
- 既存CLIフラグを破壊しない（非互換は明示ドキュメント化）。

---

## 5. アーキテクチャ拡張方針

### 5.1 追加コンポーネント

1. `memory-server/src/embedding/`
   - `types.ts`（EmbeddingProvider interface）
   - `openai.ts`
   - `ollama.ts`
   - `fallback.ts`（現行ロジック移設）
   - `registry.ts`

2. `memory-server/src/rerank/`
   - `types.ts`
   - `simple-reranker.ts`
   - `registry.ts`

3. `memory-server/src/consolidation/`
   - `extractor.ts`
   - `deduper.ts`
   - `worker.ts`

4. `memory-server/src/db/`
   - `migrations/*.sql`（`mem_facts`, `mem_audit_log` 追加）

5. `python-sdk/`（新規）
   - `harness_mem/client.py`
   - `harness_mem/types.py`
   - `examples/quickstart.py`

6. `integrations/langchain/`（新規）
   - memory backend adapter

### 5.2 既存改修ポイント

1. `memory-server/src/vector/providers.ts`
   - fallback専用へ縮退、provider registry利用へ変更

2. `memory-server/src/core/harness-mem-core.ts`
   - vector/rerank/consolidation/auditの統合

3. `mcp-server/src/tools/memory.ts`
   - token見積メタ、警告メタ、admin拡張

4. `docs/harness-mem-setup.md`, `README.md`
   - 3層導線と新設定を明記

---

## 6. API/契約要件

### 6.1 追加設定（環境変数）

1. `HARNESS_MEM_EMBEDDING_PROVIDER` (`openai|ollama|fallback`)
2. `HARNESS_MEM_OPENAI_API_KEY`
3. `HARNESS_MEM_OPENAI_EMBED_MODEL`
4. `HARNESS_MEM_OLLAMA_BASE_URL`
5. `HARNESS_MEM_OLLAMA_EMBED_MODEL`
6. `HARNESS_MEM_RERANKER_ENABLED` (`true|false`)
7. `HARNESS_MEM_CONSOLIDATION_ENABLED` (`true|false`)
8. `HARNESS_MEM_CONSOLIDATION_INTERVAL_MS`

### 6.2 APIレスポンス拡張

1. `search.meta.token_estimate`
2. `timeline.meta.token_estimate`
3. `get_observations.meta.token_estimate`
4. `meta.warnings[]`（大量取得・品質低下時）

### 6.3 新規管理API

1. `POST /v1/admin/consolidation/run`
2. `GET /v1/admin/consolidation/status`
3. `GET /v1/admin/audit-log`

---

## 7. TDD実行規約（厳格）

### 7.1 原則

1. 1タスク = `Red -> Green -> Refactor -> Docs` を必ず完了
2. 先にテストを書かない実装は禁止
3. 失敗を再現するテストがない修正は禁止
4. 回帰テストを最低1つ追加

### 7.2 テスト階層

1. Unit:
   - provider選択
   - スコア融合
   - redaction
   - fact抽出器
2. Integration:
   - API契約
   - DB migration
   - queue worker
3. E2E:
   - setup/doctor/smoke
   - cross-client search flow
4. Performance:
   - 100k corpus benchmark
5. Security:
   - private leakage
   - FTS injection

### 7.3 失敗時ルール

1. 同一原因で3回失敗したら停止して論点整理
2. フォールバック追加で誤魔化さない
3. テスト改ざん禁止

---

## 8. 実装バックログ（細粒度 / Codex実行用）

凡例:
- `[P]` = 並列実行可能
- `cc:TODO` / `cc:WIP` / `cc:完了` / `blocked`

### Phase 0: ベースライン固定（1-2日）

- [x] `cc:完了` T0-001 既存ベンチライン採取（品質/性能/トークン）
  - 変更: `tests/benchmarks/` 新規
  - テスト先行: 期待フォーマットスナップショット
  - 完了条件: before/after比較可能なJSON出力
  - 変更理由: 品質/性能/トークンを同一JSONスキーマで固定し、改修前後の差分を機械比較できるようにした。
  - 変更理由: 実行手順をREADMEに明記し、誰が実行しても同じベースラインを取得できる状態にした。

- [x] `cc:完了` T0-002 API契約スナップショット作成
  - 変更: `memory-server/tests/integration/api-contract.test.ts`
  - 完了条件: 主要エンドポイントのレスポンス形が固定化
  - 変更理由: 主要APIのレスポンス形状を1つの契約スナップショットに集約し、仕様ドリフトを即検出できるようにした。
  - 変更理由: 取得系エンドポイント（search/timeline/get/resume/facets等）の互換性を統合テストで継続監視する土台を追加した。

- [x] `cc:完了` T0-003 現行Plans運用ルールをREADMEへ反映
  - 変更: `README.md`
  - 完了条件: 実装者が迷わず運用できる
  - 変更理由: `Plans.md` をSSOTとして扱う前提をREADMEに明記し、参画直後の実装者でも運用規律を即参照できるようにした。
  - 変更理由: `cc:TODO / cc:WIP / cc:完了 / blocked` の遷移条件（着手時/完了時/ブロック時）を定義し、運用ドリフトを防止した。
  - 変更理由: Phase順の厳守ルールをREADMEへ統合し、計画順実装をドキュメント側でも強制できる状態にした。

### Phase 1: Embedding Provider化（3-5日）

- [x] `[P] cc:完了` T1-001 EmbeddingProvider interface追加
  - 変更: `memory-server/src/embedding/types.ts`
  - 変更理由: provider差し替え可能な最小interface（embed/health/name/model）を先に固定し、実装差分を疎結合化した。
- [x] `[P] cc:完了` T1-002 fallback provider分離（現行ロジック移設）
  - 変更: `memory-server/src/embedding/fallback.ts`
  - 変更理由: 既存ハッシュ埋め込みを独立provider化し、外部API障害時でも主経路を維持できる基準実装にした。
- [x] `[P] cc:完了` T1-003 OpenAI provider実装
  - 変更: `memory-server/src/embedding/openai.ts`
  - 変更理由: OpenAI埋め込みを同期呼び出しで追加し、APIキー未設定/失敗時は明示的にdegraded状態でfallbackへ退避するようにした。
- [x] `[P] cc:完了` T1-004 Ollama provider実装
  - 変更: `memory-server/src/embedding/ollama.ts`
  - 変更理由: ローカルLLM運用向けにOllama埋め込みを追加し、応答不正時に主経路（fallback）へ自動復帰できるようにした。
- [x] `cc:完了` T1-005 provider registry + configバリデーション
  - 変更: `memory-server/src/embedding/registry.ts`, `memory-server/src/core/harness-mem-core.ts`
  - 変更理由: provider名不正時の警告付きフォールバックと環境変数解決を一元化し、設定ミス起因の起動失敗を防いだ。
- [x] `cc:完了` T1-006 health/metricsにprovider表示
  - 変更: `memory-server/src/core/harness-mem-core.ts`
  - 変更理由: `health/metrics/search` メタへ `embedding_provider` と状態を追加し、運用時の原因切り分けを即時化した。
- [x] `cc:完了` T1-007 migration不要性確認テスト
  - 変更: `memory-server/tests/integration/embedding-provider.test.ts`
  - 変更理由: provider切替前後でDBテーブル構成が不変であることをテスト固定し、移行不要の前提を検証可能にした。

各タスク共通完了条件:
1. Unit test追加
2. Integration test追加
3. 既存テスト非回帰

### Phase 2: 検索品質強化（3-4日）

- [x] `cc:完了` T2-001 reranker interface実装
  - 変更: `memory-server/src/rerank/types.ts`
  - 変更理由: rerank入出力の契約を型で固定し、後続実装が検索本体から独立して差し替え可能な形にした。
- [x] `cc:完了` T2-002 simple-reranker実装
  - 変更: `memory-server/src/rerank/simple-reranker.ts`, `memory-server/tests/unit/reranker.test.ts`
  - 変更理由: 同点時安定順序を維持しつつ、query-token/title一致を加味した軽量rerankerを導入した。
- [x] `cc:完了` T2-003 search pipelineへrerank段追加
  - 変更: `memory-server/src/core/harness-mem-core.ts`
  - 変更理由: 既存hybrid rank後に任意rerank段を挿入し、`HARNESS_MEM_RERANKER_ENABLED` でON/OFFできる構成にした。
- [x] `cc:完了` T2-004 debugメタ拡張（pre/post rank）
  - 変更: `memory-server/src/core/harness-mem-core.ts`, `memory-server/tests/integration/search-rerank.test.ts`
  - 変更理由: debugメタに `rerank_pre`/`rerank_post` と `reranker.enabled/name` を追加し、順位変化を可観測化した。
- [x] `cc:完了` T2-005 quality benchmark CI化
  - 変更: `.github/workflows/quality-benchmark.yml`, `tests/benchmarks/rerank-quality-gate.test.ts`, `tests/benchmarks/baseline-runner.ts`, `tests/benchmarks/run-world1-baseline.sh`, `tests/benchmarks/baseline-output.test.ts`
  - 変更理由: reranker ON/OFF の比較スナップショット生成と品質ゲート（Recall/MRR非劣化 + p95悪化<=10%）をCIに組み込み、回帰をPRで自動検知できるようにした。

受入:
1. Recall@10/MRRが baseline 以上
2. p95悪化 <= 10%

### Phase 3: 3層導線プロダクト化（2-3日）

- [x] `cc:完了` T3-001 token_estimate算出ユーティリティ
  - 変更: `memory-server/src/utils/token-estimate.ts`
  - 変更理由: API横断で再利用できるトークン推定ロジックを独立化し、見積もり計算の一貫性を確保した。
- [x] `cc:完了` T3-002 search/timeline/get_observationsにメタ付与
  - 変更: `memory-server/src/core/harness-mem-core.ts`, `memory-server/tests/integration/token-estimate-meta.test.ts`
  - 変更理由: 3層取得の各レスポンスに `meta.token_estimate` を追加し、呼び出し側がコストを先読みできるようにした。
- [x] `cc:完了` T3-003 get_observations大量取得警告
  - 変更: `memory-server/src/core/harness-mem-core.ts`
  - 変更理由: 大量ID取得時に `meta.warnings[]` を返し、`search -> timeline -> get_observations` の段階取得へ誘導する仕組みを追加した。
- [x] `cc:完了` T3-004 MCP tool description強化
  - 変更: `mcp-server/src/tools/memory.ts`, `tests/mcp-memory-tool-descriptions.test.ts`
  - 変更理由: MCPツール説明に3層導線と `token_estimate` を明記し、ツール利用時の誤用を減らした。
- [x] `cc:完了` T3-005 README/Setup Guide更新
  - 変更: `README.md`, `docs/harness-mem-setup.md`, `mcp-server/README.md`
  - 変更理由: ドキュメント側にも3層導線と大規模取得警告の運用を反映し、実装/運用説明の不一致を解消した。

受入:
1. 3層導線が docs + tool description + tests で一貫
2. 乱用時警告が返る

### Phase 4: Consolidation Worker（4-6日）

- [x] `[P] cc:完了` T4-001 `mem_facts` schema/migration追加
  - 変更: `memory-server/src/db/schema.ts`
  - 変更理由: 抽出済み知識を正規化保存する `mem_facts` と関連indexを追加し、後段dedupe対象を永続化した。
- [x] `[P] cc:完了` T4-002 `mem_audit_log` schema/migration追加
  - 変更: `memory-server/src/db/schema.ts`
  - 変更理由: 取得系/管理系の操作監査を追跡する `mem_audit_log` を追加し、アクセス監査の参照経路を用意した。
- [x] `cc:完了` T4-003 Fact extractor（heuristic + optional LLM）
  - 変更: `memory-server/src/consolidation/extractor.ts`
  - 変更理由: heuristic抽出を主経路に、`HARNESS_MEM_FACT_EXTRACTOR_MODE=llm` 時のみLLM抽出を試行する構成を実装した。
- [x] `cc:完了` T4-004 Deduper（類似fact統合）
  - 変更: `memory-server/src/consolidation/deduper.ts`
  - 変更理由: Jaccard類似度ベースで同種factを統合し、重複知識を `merged_into_fact_id` で圧縮できるようにした。
- [x] `cc:完了` T4-005 Background worker scheduler
  - 変更: `memory-server/src/consolidation/worker.ts`, `memory-server/src/core/harness-mem-core.ts`
  - 変更理由: consolidation queue を定期処理するschedulerを追加し、非同期に抽出/統合が進む運用にした。
- [x] `cc:完了` T4-006 finalize連動でqueue投入
  - 変更: `memory-server/src/core/harness-mem-core.ts`
  - 変更理由: `finalizeSession` 後に対象sessionを自動queue投入し、終了時の知識統合が漏れない経路を作った。
- [x] `cc:完了` T4-007 admin API（run/status）
  - 変更: `memory-server/src/server.ts`, `mcp-server/src/tools/memory.ts`, `scripts/harness-mem-client.sh`, `memory-server/tests/integration/consolidation-admin-api.test.ts`
  - 変更理由: `run/status/audit` の管理APIをHTTP/MCP/CLIから実行可能にし、運用監視と手動実行を統一した。

受入:
1. 重複factの統合率改善がベンチで確認できる
2. worker停止時でも本処理が壊れない

### Phase 5: Python SDK（3-4日）

- [x] `[P] cc:完了` T5-001 `python-sdk/` 雛形 + pyproject
  - 変更: `python-sdk/pyproject.toml`, `python-sdk/README.md`
  - 変更理由: パッケージ雛形/pyprojectを基準に、実行手順（tests + quickstart）をREADMEへ明示して導入導線を固定した。
- [x] `[P] cc:完了` T5-002 typed client（sync）
  - 変更: `python-sdk/harness_mem/client.py`, `python-sdk/harness_mem/types.py`, `python-sdk/harness_mem/__init__.py`
  - 変更理由: 各APIメソッドの戻り型を用途別TypedDictへ分離し、`record_checkpoint` の tags/private tags と `get_observations` の単一ID入力を型付きで扱えるようにした。
- [x] `cc:完了` T5-003 APIエラー型実装
  - 変更: `python-sdk/harness_mem/client.py`, `python-sdk/tests/test_client_unit.py`
  - 変更理由: HTTPエラー時に `error/message/detail` を優先抽出するAPIエラー処理へ拡張し、transport/API例外の判定をテストで固定化した。
- [x] `cc:完了` T5-004 quickstart/example追加
  - 変更: `python-sdk/examples/quickstart.py`, `python-sdk/README.md`
  - 変更理由: `search/timeline/get_observations/checkpoint/finalize` を1本で辿るquickstartを整備し、`python3 examples/quickstart.py` 単体実行で動作するようimport経路を補強した。
- [x] `cc:完了` T5-005 SDK統合テスト（ローカルdaemon）
  - 変更: `python-sdk/tests/test_client.py`, `python-sdk/tests/test_client_unit.py`
  - 変更理由: ローカルdaemon起動の統合テストに checkpoint/finalize を追加し、単体テストでpayload整形とエラー変換の回帰を検知できるTDDセットに更新した。

受入:
1. quickstartが5分以内で動く
2. search/timeline/get_observations/checkpoint/finalize対応

### Phase 6: LangChain統合（2-3日）

- [x] `cc:完了` T6-001 adapter実装
  - 変更: `integrations/langchain/harness_mem_langchain/adapter.py`, `integrations/langchain/harness_mem_langchain/__init__.py`
  - 変更理由: LangChain互換のretriever/chat-memoryアダプタを実装し、harness-mem APIを直接利用できるようにした。
- [x] `cc:完了` T6-002 サンプル（chat memory）追加
  - 変更: `integrations/langchain/examples/chat_memory_sample.py`
  - 変更理由: 記録→履歴ロード→検索の最小フローを再現するサンプルを追加し、導入確認を即実行できるようにした。
- [x] `cc:完了` T6-003 CIでサンプル実行
  - 変更: `.github/workflows/python-sdk-langchain.yml`, `integrations/langchain/tests/test_adapter.py`
  - 変更理由: adapterのユニットテストと実daemonに対するサンプル実行をCIに追加し、統合破壊を検知可能にした。

### Phase 7: Hardening（3-5日）

- [x] `cc:完了` T7-001 security test拡張（漏えい/注入）
  - 変更: `memory-server/tests/integration/security-hardening.test.ts`
  - 変更理由: 注入パターン入力時のフィルタ破壊とprivate漏えいが起きないことを統合テストで固定した。
- [x] `cc:完了` T7-002 performance 100k benchmark
  - 変更: `tests/benchmarks/performance-100k.test.ts`
  - 変更理由: 100k規模性能検証を再現可能テストとして追加し、重負荷時のp95ゲートを明示した。
  - 変更理由: 長時間ベンチの実行完了を担保するため timeout を明示し、5秒既定値による偽陰性を解消した。
  - 変更理由: fallback vector検索の strict_project 時 candidate window を最適化し、100k warm 条件で `search p95 < 300ms` を実測で満たした。
- [x] `cc:完了` T7-003 chaos test（daemon kill/restart）
  - 変更: `tests/test-memory-daemon-chaos.sh`, `.github/workflows/quality-benchmark.yml`
  - 変更理由: `kill -KILL` を含む再起動耐性検証を追加し、CIで定期的に障害復帰経路を確認できるようにした。
- [x] `cc:完了` T7-004 docs最終化（アーキ図・移行・運用）
  - 変更: `docs/world1-architecture-and-ops.md`, `README.md`, `docs/harness-mem-setup.md`
  - 変更理由: Architecture/Migration/Operationsを1文書に統合し、実装完了後の運用参照先を一本化した。

---

## 9. テストケース一覧（抜粋ではなく実装前提）

### 9.1 Unit（必須）

1. provider選択:
   - 設定不正時はfallback
2. openai provider:
   - API失敗時のリトライ/例外
3. ollama provider:
   - タイムアウト/空ベクトル
4. reranker:
   - 同点時の安定順序
5. token_estimate:
   - 境界値（空/巨大）
6. extractor:
   - decision/pattern/preference/lesson分類
7. deduper:
   - 類似閾値境界

### 9.2 Integration（必須）

1. migration:
   - 旧DB -> 新DB
2. search:
   - hybrid + rerank + privacy
3. timeline/get_observations:
   - tokenメタ付与
4. consolidation worker:
   - queue処理完了
5. admin API:
   - run/status/audit-log

### 9.3 E2E（必須）

1. setup->doctor->smoke 全通
2. cross-client記録->検索
3. include_private false/true 切替
4. finalize後にsummary/facts反映

### 9.4 Performance（必須）

1. 10k/50k/100kで検索遅延計測
2. provider別比較（fallback/openai/ollama）
3. reranker ON/OFF比較

---

## 10. 実装順序と並列戦略

1. 依存順:
   - Phase0 -> Phase1 -> Phase2 -> Phase3 -> Phase4 -> Phase5 -> Phase6 -> Phase7
2. 並列可能:
   - Phase1のprovider実装
   - Phase4のschema追加とextractor準備
   - Phase5 SDK雛形とサンプル
3. クリティカルパス:
   - `provider化 -> 品質検証 -> consolidation`

---

## 11. DoD（Definition of Done）

全Phase完了時に以下を満たす。

1. 全必須テスト緑
2. 指標ゲート達成（Section 0.2）
3. ドキュメント更新済み
4. Plans.mdの全タスクが `cc:完了`
5. 既知リスクと残課題が明記されている

---

## 12. Codex運用ルール（実装中）

1. 着手時に対象タスクを `cc:WIP` へ変更
2. 完了時に `cc:完了` へ変更
3. block時は `blocked` + 理由 + 解消条件を追記
4. 1タスク1意図でコミット（ユーザー指示がある場合のみ）
5. 未定事項を勝手にフォールバック実装しない

---

## 13. 直近実行キュー（最初の10タスク）

1. `cc:完了` T0-001 baseline採取
2. `cc:完了` T0-002 API契約スナップショット
3. `cc:完了` T1-001 EmbeddingProvider interface
4. `cc:完了` T1-002 fallback provider分離
5. `cc:完了` T1-003 OpenAI provider
6. `cc:完了` T1-004 Ollama provider
7. `cc:完了` T1-005 registry + config
8. `cc:完了` T2-001 reranker interface
9. `cc:完了` T2-002 simple-reranker
10. `cc:完了` T2-003 search pipeline統合

---

## 15. Phase1 フリーズレビュースクリプト

- [x] freeze-review `cc:完了`
  - 依頼内容: scripts/freeze-review.sh を作成し、E2E検証（proof-pack.sh）を3回実行してfreeze-report.jsonを生成する。docs/harness-mem-setup.md の Section 8 にコマンドを追記する。
  - 追加日時: 2026-02-21
  - 変更: `scripts/freeze-review.sh`, `docs/harness-mem-setup.md`

---

## 14. LOCOMOベンチ拡張計画（2026-02）

### 14.1 目的

`harness-mem` で LoCoMo を再現可能に実行し、同一条件で `mem0` / `claude-mem` / `memos` との比較結果を継続取得できる状態を作る。

### 14.2 Priority Matrix

Required:
1. LoCoMoデータ契約テスト（`locomo10.json` 形式検証）
2. `harness-mem` ingest + QA評価（EM/F1 + category別）導線
3. 再現可能な実行コマンドとJSON出力スキーマ固定
4. `workflow_dispatch` + `schedule` で非ブロッキング定期計測

Recommended:
1. `mem0` / `claude-mem` 比較アダプタ（同一入力/同一評価器）
2. 直近結果との差分レポート（改善/劣化の自動表示）

Optional:
1. `memos` 比較は適用可能性を先に判定し、適合しない場合は比較対象外を明記
2. LLM Judge（コスト高）の自動実行は夜間定期のみ

### 14.3 実装バックログ（LOCOMO）

#### Phase L0: Benchmark土台（最優先）

- [x] `cc:完了 [feature:tdd]` T8-001 LoCoMo契約テスト追加（dataset schema + fixture）
  - 変更: `tests/benchmarks/locomo-dataset-contract.test.ts`
  - 受入: `sample_id / conversation / qa / category` 必須項目を検証し、壊れたデータをfailで検出できる
  - 変更理由: LoCoMo入力を最初に契約テストで固定し、データ破損時に実行前に失敗できるようにした。
  - 変更理由: `locomo10` 最小fixtureを追加して、再現可能なベンチ基盤を作った。

- [x] `cc:完了 [feature:tdd]` T8-002 LoCoMoローダー実装
  - 変更: `tests/benchmarks/locomo-loader.test.ts` -> `tests/benchmarks/locomo-loader.ts`
  - 受入: `locomo10.json` を正規化内部形式へ変換し、最小fixtureでGreen
  - 変更理由: ローダーで文字列正規化と `question_id` 補完を行い、評価前処理の揺れを排除した。
  - 変更理由: 壊れた入力は契約検証で弾き、正規化済み内部形式を安定供給できるようにした。

- [x] `cc:完了 [feature:tdd]` T8-003 harness-mem ingest/replayアダプタ
  - 変更: `tests/benchmarks/locomo-harness-adapter.test.ts` -> `tests/benchmarks/locomo-harness-adapter.ts`
  - 受入: 1会話分のturnを順序保持で投入し、検索/取得APIで再参照できる
  - 変更理由: ingest/replay専用アダプタを分離し、ベンチ入力の投入順序を固定した。
  - 変更理由: 検索結果から予測文字列を返す最小経路を実装し、評価器接続前の動作をテストで保証した。

- [x] `cc:完了 [feature:tdd]` T8-004 QA評価器（EM/F1 + category集計）
  - 変更: `tests/benchmarks/locomo-evaluator.test.ts` -> `tests/benchmarks/locomo-evaluator.ts`
  - 受入: カテゴリ別/全体スコアをJSON出力し、固定fixtureでスナップショット一致
  - 変更理由: EM/F1を文字列正規化+token overlapで実装し、カテゴリ別集計を同時に返せるようにした。
  - 変更理由: 小さなfixtureで計算値を固定し、評価器の回帰を検知可能にした。

- [x] `cc:完了 [feature:tdd]` T8-005 単体実行CLI（harness-mem）
  - 変更: `tests/benchmarks/locomo-runner-smoke.test.ts` -> `tests/benchmarks/run-locomo-benchmark.ts`
  - 受入: `bun run tests/benchmarks/run-locomo-benchmark.ts --system harness-mem` で結果JSON生成
  - 変更理由: `runLocomoBenchmark` をCLI/関数両対応で実装し、ローカル実行とCI呼び出しの経路を統一した。
  - 変更理由: 出力JSONスキーマを固定し、後段の比較/ドリフト検知で再利用できる形にした。

#### Phase L1: 比較アダプタ

- [x] `cc:完了 [feature:tdd]` T8-006 mem0比較アダプタ追加
  - 変更: `tests/benchmarks/locomo-mem0-adapter.test.ts` -> `tests/benchmarks/locomo-mem0-adapter.ts`
  - 受入: 同一会話入力で `harness-mem` と同スキーマ結果を出力
  - 変更理由: mem0応答を比較用レコードスキーマへ正規化し、EM/F1を同一ロジックで算出できるようにした。
  - 変更理由: API呼び出しヘッダとレスポンス写像を単体テストで固定し、比較経路の回帰を防止した。

- [x] `cc:完了 [feature:tdd]` T8-007 claude-mem比較アダプタ追加
  - 変更: `tests/benchmarks/locomo-claude-mem-adapter.test.ts` -> `tests/benchmarks/locomo-claude-mem-adapter.ts`
  - 受入: 同一評価器でスコア算出し、比較表へ統合できる
  - 変更理由: claude-mem検索レスポンスを比較用レコードへ正規化し、同一EM/F1軸で採点可能にした。
  - 変更理由: トークン付きヘッダと予測マッピングをテスト固定し、比較時の認証/形式差分を吸収した。

- [x] `cc:完了 [feature:tdd]` T8-008 memos適用可否ゲート
  - 変更: `tests/benchmarks/locomo-memos-feasibility.test.ts`, `docs/benchmarks/locomo-comparison-scope.md`
  - 受入: API/データモデル適合を判定し、比較可否をドキュメントに明記
  - 変更理由: memosを比較対象に含める可否判定を文書化し、評価スコープの曖昧さを除去した。
  - 変更理由: 判定基準をテスト化し、将来の比較方針変更をレビュー可能にした。

#### Phase L2: CI継続検知

- [x] `cc:完了 [feature:tdd]` T8-009 LOCOMO workflow追加（手動 + 定期）
  - 変更: `.github/workflows/locomo-benchmark.yml`, `tests/benchmarks/locomo-workflow.test.ts`
  - 受入: `workflow_dispatch` + `schedule` 実行、結果JSON/ログをartifact保存
  - 変更理由: LOCOMO計測をPR必須CIと分離した定期workflowへ移し、重い処理を継続監視できるようにした。
  - 変更理由: JSON/ログをartifact保存することで、時系列比較と再検証の証跡を残せるようにした。

- [x] `cc:完了 [feature:tdd]` T8-010 ドリフト検知レポート
  - 変更: `tests/benchmarks/locomo-drift-report.test.ts` -> `tests/benchmarks/locomo-drift-report.ts`
  - 受入: 直近成功runとの差分（改善/劣化）を自動出力
  - 変更理由: 直近runとの差分をEM/F1で定量化し、改善/劣化/横ばいを機械判定できるようにした。
  - 変更理由: 比較ロジックを関数化して、workflowや手動検証で同じ判定基準を再利用できるようにした。

#### Phase L3: ドキュメント/運用

- [x] `cc:完了 [feature:tdd]` T8-011 実行ガイド整備
  - 変更: `docs/benchmarks/locomo-runbook.md`, `README.md`
  - 受入: データ配置・実行手順・再現条件・注意点（APIキー/コスト）を明記
  - 変更理由: LOCOMO実行の前提条件と運用手順をRunbook化し、再現性のばらつきを抑えた。
  - 変更理由: READMEからRunbookへ導線を追加し、導入時の迷いを減らした。

- [x] `cc:完了 [feature:tdd]` T8-012 比較結果テンプレート固定
  - 変更: `docs/benchmarks/locomo-results-template.md`
  - 受入: `harness-mem / mem0 / claude-mem / memos` の比較表を同一フォーマットで記録可能
  - 変更理由: 比較結果の記録フォーマットを固定し、runごとの評価値を横並び比較しやすくした。
  - 変更理由: 主要4システムの欄を事前定義し、比較漏れと表記揺れを防止した。

- [x] `cc:完了 [feature:tdd]` T8-013 LoCoMo評価健全化（cat-5正解補完 + サンプル混線防止）
  - 変更: `tests/benchmarks/locomo-loader.ts`, `tests/benchmarks/locomo-evaluator.ts`, `tests/benchmarks/locomo-harness-adapter.ts`, `tests/benchmarks/run-locomo-benchmark.ts`
  - 変更: `tests/benchmarks/locomo-loader.test.ts`, `tests/benchmarks/locomo-evaluator.test.ts`, `tests/benchmarks/locomo-harness-adapter.test.ts`, `tests/benchmarks/locomo-dataset-contract.test.ts`, `tests/benchmarks/locomo-runner-smoke.test.ts`
  - 受入: `adversarial_answer` を cat-5正解として取り込めること / 検索が sample 単位で分離されること / raw LoCoMo (`conversation.session_n`) を直接読めること
  - 変更理由: cat-5 の空正解混入で評価が過小化されるため、データ解釈をLoCoMo仕様に合わせる。
  - 変更理由: 同一project内の cross-sample 検索混線を除去し、比較可能なベンチ条件へ戻す。
  - 変更理由: 空gold answerを含むデータは fail-fast させ、部分採点結果の誤用を防止した。
  - 検証結果: `.tmp/locomo/locomo10.full.result.json` で `overall.count=1986`, `cat-5.count=446`, `empty_gold_answers=0` を確認。

- [x] `cc:完了 [feature:tdd]` T8-014 LoCoMo公開向けスコアリング拡張（外向け/内向け2階建て）
  - 変更: `tests/benchmarks/run-locomo-benchmark.ts`, `tests/benchmarks/locomo-harness-adapter.ts`
  - 変更: `tests/benchmarks/locomo-harness-adapter.test.ts`, `tests/benchmarks/locomo-runner-smoke.test.ts`
  - 変更: `tests/benchmarks/locomo-judge.ts`, `tests/benchmarks/locomo-score-report.ts`
  - 受入: EM/F1(cat1-5 + cat1-4)と p95/トークンを同時算出し、LLM Judge Accuracy(cat1-4)を同一結果セットから算出可能にする
  - 変更理由: 外部比較に使える分かりやすい指標と、内部品質を担保する厳密指標を両立させる。
  - 実施済み: `.tmp/locomo/locomo10.score-report.full.json` で strict/performance/cost + LLM Judge を算出。
  - 検証結果: `.tmp/locomo/locomo10.judge.cat1-4.json` で `overall_accuracy=0.201948`（1540問）を確認。

- [x] `cc:完了 [feature:tdd]` T8-015 Harness-mem構想準拠 LoCoMo改善計画の実装（Phase1-3）
  - 変更: `tests/benchmarks/locomo-harness-adapter.ts`, `tests/benchmarks/run-locomo-benchmark.ts`
  - 変更: `tests/benchmarks/locomo-harness-adapter.test.ts`
  - 変更: `tests/benchmarks/locomo-repro-report.ts`, `tests/benchmarks/locomo-repro-report.test.ts`
  - 変更: `tests/benchmarks/locomo-failure-backlog.ts`, `tests/benchmarks/locomo-failure-backlog.test.ts`
  - 変更: `docs/benchmarks/locomo-results-template.md`, `docs/benchmarks/locomo-runbook.md`
  - 受入: top-k証拠統合の短答生成 / cat-2,3向け時系列・multi-hop補強 / 3-run平均・分散レポート / 失点上位100問の自動抽出を実装
  - 検証結果: `.tmp/locomo/locomo10.run1.score-report.json` で `cat1-5 F1=0.07062`, `cat1-5 EM=0.00856`, `p95=17ms` を確認（旧 `F1=0.0493` から改善）。
  - 検証結果: `.tmp/locomo/locomo10.repro-report.json` で3-runの平均/分散を確認し、`.tmp/locomo/locomo10.failure-backlog.judged.json` で改善タグ付きTop100失点抽出を確認。

### Shadow Sync 実測統合テスト

- [x] `cc:完了` TX-002 ShadowSyncManager 実測統合テスト作成
  - 依頼内容: dual-write / shadow-read の動作を実測する統合テストを作成。シナリオ: dual-write simulation, shadow-read divergence detection, promotion lifecycle, rollback, promotion denial, high replication failure rate, 実デーモン shadow-read, パフォーマンス計測
  - 追加日時: 2026-02-21
  - テストファイル: `memory-server/tests/integration/shadow-sync-measurement.test.ts`
  - 結果: 24 テスト全通過（1000サイクル 0.0001ms/cycle、SLA < 100ms/cycle 達成）

### PostgreSQL Adapter 統合テスト

- [x] `cc:完了` TX-001 PostgresStorageAdapter 統合テスト作成
  - 依頼内容: mock PgClientLike を使って全 async メソッドを網羅テスト（queryAllAsync/queryOneAsync/runAsync/execAsync/transactionAsync/translateSql/adapter-factory/POSTGRES_INIT_SQL）
  - 追加日時: 2026-02-21
  - テストファイル: `memory-server/tests/integration/postgres-adapter-integration.test.ts`
  - 結果: 39 テスト全通過（実 PostgreSQL 不要、mock PgClientLike のみ）

### Phase 1 証跡収集スクリプト

- [x] `cc:完了` T9-001 proof-pack.sh 作成（Phase1 証拠収集スクリプト）
  - 変更: `scripts/proof-pack.sh`
  - 依頼内容: health/doctor/smoke/setup-timing/search-p95/privacy/boundary の全証拠を収集し `artifacts/proof-pack/` に保存
  - 追加日時: 2026-02-21

### 14.5 LoCoMo クイックチェック実行（2026-02-21）

- [x] `cc:完了` TBENCH-001 15x3 クイックチェック実行
  - 追加日時: 2026-02-21
  - 結果: overall F1=0.196, EM=0.044, p95=4ms

- [x] `cc:完了` TBENCH-002 120件フルデータセット実行
  - 追加日時: 2026-02-21
  - 結果: overall F1=0.181, EM=0.050, p95=3ms

### 14.4 直近実行キュー（LOCOMO最初の10タスク）

1. `cc:完了` T8-001 LoCoMo契約テスト追加
2. `cc:完了` T8-002 LoCoMoローダー実装
3. `cc:完了` T8-003 harness-mem ingest/replayアダプタ
4. `cc:完了` T8-004 QA評価器（EM/F1 + category）
5. `cc:完了` T8-005 単体実行CLI（harness-mem）
6. `cc:完了` T8-006 mem0比較アダプタ
7. `cc:完了` T8-007 claude-mem比較アダプタ
8. `cc:完了` T8-008 memos適用可否ゲート
9. `cc:完了` T8-009 LOCOMO workflow追加
10. `cc:完了` T8-010 ドリフト検知レポート

---

## 16. CloudMem超え 判定達成プラン（2026-02-22）

### 16.1 目的

提示された「CloudMem超え 判定チェックリスト（v1）」を、主観ではなく実測提出物で合否判定できる状態にする。

### 16.2 Priority Matrix（本件専用）

Required:
1. `resume-pack` の失敗黙殺を停止し、失敗時に原因/影響/次コマンドを残す
2. `resume-pack` の privacy/boundary/session除外/correlation を統合テストで固定する
3. `proof-pack` で提出物4点を機械生成する
4. `freeze-review` を 3-run 連続判定 + 必須条件ゲート化する
5. 人間評価（5名以上・80%以上）を機械検証する

Recommended:
1. self-check を health-only から `resume-pack` 実動確認まで拡張する
2. docs/Runbook に新しい合否ゲートと提出物フォーマットを同期する

Optional:
1. UI の補助表示強化（注入履歴/エラー導線を初回導線へ統合）

### 16.3 TDD適用方針（本件）

1. Red:
   - `resume-pack` 失敗時に stale resume が残る再現テストを先に追加
   - 提出物4JSONが欠けても freeze-review が pass する現状を再現テスト化
2. Green:
   - 実装で失敗時アーティファクト出力/削除・合否ゲートを導入
3. Refactor:
   - スクリプト間の共通JSON抽出処理を関数化
4. Docs:
   - setup guide/runbook の検証手順を更新

### 16.4 実装バックログ（CloudMem超え）

- [x] `cc:完了 [feature:tdd]` CMC-001 SessionStart `resume-pack` 失敗検知と stale context 掃除
  - 変更予定: `scripts/hook-handlers/memory-session-start.sh`
  - テスト予定: `tests/memory-session-start-contract.test.ts`（新規）
  - 受入条件:
    1. `resume-pack` 失敗時に `.claude/state/memory-resume-context.md` と `.memory-resume-pending` が削除される
    2. `.claude/state/memory-resume-error.md` に `原因/影響/次コマンド` が残る
  - 変更: `scripts/hook-handlers/memory-session-start.sh`, `tests/memory-session-start-contract.test.ts`
  - 変更理由: `resume-pack` 異常時に stale context を必ず掃除し、`memory-resume-error.md` へ原因/影響/次コマンドを固定出力することで失敗黙殺を停止した。
  - 検証: `bun test tests/memory-session-start-contract.test.ts`

- [x] `cc:完了 [feature:tdd]` CMC-002 client エラー識別子追加（hook で判定可能化）
  - 変更予定: `scripts/harness-mem-client.sh`, `scripts/hook-handlers/memory-session-start.sh`
  - テスト予定: `tests/memory-session-start-contract.test.ts`
  - 受入条件:
    1. `resume-pack` 失敗時レスポンスに機械判定可能な `error_code` が含まれる
    2. hook 側が `error_code` を利用して復旧導線を出せる
  - 変更: `scripts/harness-mem-client.sh`, `scripts/hook-handlers/memory-session-start.sh`
  - 変更理由: client の fallback JSON に `error_code` を追加し、hook 側で `error_code` を読み取って復旧導線を表示できる契約に統一した。
  - 検証: `bun test tests/memory-session-start-contract.test.ts`

- [x] `cc:完了 [feature:tdd] [feature:security]` CMC-003 `resume-pack` 専用統合テスト追加（境界/漏えい/継続）
  - 変更予定: `memory-server/tests/integration/resume-pack-behavior.test.ts`（新規）
  - 必要時変更: `memory-server/src/core/harness-mem-core.ts`
  - 受入条件:
    1. `include_private=false` で private/sensitive 0件
    2. project 境界を越える混入 0件
    3. `session_id` 指定時に同一session除外が効く
    4. `correlation_id` 指定時にチェーン対象のみ取得される
  - 変更: `memory-server/tests/integration/resume-pack-behavior.test.ts`
  - 変更理由: privacy/boundary/session/correlation を API 実行経路で統合固定し、CloudMem 判定の必須条件を回帰テスト化した。
  - 検証: `bun test memory-server/tests/integration/resume-pack-behavior.test.ts`

- [x] `cc:完了 [feature:tdd]` CMC-004 SessionStart self-check を `resume-pack` 実動検証まで拡張
  - 変更予定: `scripts/hook-handlers/memory-self-check.sh`, `tests/session-self-check-contract.test.ts`
  - 受入条件:
    1. health 到達だけでなく `resume-pack` probe 成否も記録される
    2. 異常時 warning に `doctor --fix` と追加復旧導線が出る
  - 変更: `scripts/hook-handlers/memory-self-check.sh`, `tests/session-self-check-contract.test.ts`
  - 変更理由: self-check に `resume-pack` probe を追加し、`resume_probe_ok/error_code` をアーティファクト化。失敗時 warning に段階復旧導線を固定した。
  - 検証: `bun test tests/session-self-check-contract.test.ts`

- [x] `cc:完了 [feature:tdd]` CMC-005 提出物4JSONを proof-pack で標準生成
  - 変更予定: `scripts/harness-mem-proof-pack.sh`, `tests/proof-pack-contract.test.ts`
  - 生成物:
    1. `onboarding-report.json`
    2. `continuity-report.json`
    3. `privacy-boundary-report.json`
    4. `session-selfcheck-report.json`
  - 受入条件:
    1. 4ファイルとも `artifacts/proof-pack/` に生成される
    2. summary と矛盾しない値で埋まる
  - 変更: `scripts/harness-mem-proof-pack.sh`, `tests/proof-pack-contract.test.ts`
  - 変更理由: proof-pack 実行で提出物4JSONを必ず出力し、summary と同一メトリクスから埋める契約を追加した。
  - 検証: `bun test tests/proof-pack-contract.test.ts`

- [x] `cc:完了 [feature:tdd]` CMC-006 freeze-review 合否ゲートを CloudMem判定準拠へ更新
  - 変更予定: `scripts/freeze-review.sh`, `tests/freeze-review-contract.test.ts`（新規）
  - 受入条件:
    1. 必須項目（漏えい0/境界漏れ0/継続率95%以上/1コマンド導入）に1つでも失敗したら fail
    2. 3-run 連続で pass した場合のみ達成扱い
    3. 提出物4JSONが不足したら fail
  - 変更: `scripts/freeze-review.sh`, `tests/freeze-review-contract.test.ts`
  - 変更理由: run ごとに必須ゲートと提出物4JSONの存在を検証し、`3-run consecutive pass` を満たさない限り fail する判定に更新した。
  - 検証: `bun test tests/freeze-review-contract.test.ts`

- [x] `cc:完了 [feature:tdd] [feature:security]` CMC-007 人間評価サマリの契約と検証追加
  - 変更予定: `scripts/verify-human-eval.sh`（新規）, `tests/human-eval-contract.test.ts`（新規）, `docs/harness-mem-setup.md`
  - 受入条件:
    1. 評価者5名以上、重複IDなしを機械検証
    2. 「わかりやすい」評価が 80% 未満の場合は fail
  - 変更: `scripts/verify-human-eval.sh`, `tests/human-eval-contract.test.ts`, `docs/harness-mem-setup.md`
  - 変更理由: human-eval JSON を機械判定し、5名以上/重複なし/平均80以上を満たさない場合は終了コード1で fail するゲートを追加した。
  - 検証: `bun test tests/human-eval-contract.test.ts`

- [x] `cc:完了` CMC-008 docs/runbook 同期（合否ルール・提出物・運用導線）
  - 変更予定: `docs/harness-mem-setup.md`, `README.md`, `docs/benchmarks/locomo-runbook.md`
  - 受入条件:
    1. 実装済みの合否ゲートと提出物名がドキュメントに一致
    2. 手順が `setup -> doctor -> proof-pack -> freeze-review` で再現可能
  - 変更: `README.md`, `docs/harness-mem-setup.md`, `docs/benchmarks/locomo-runbook.md`
  - 変更理由: 提出物4JSON・必須ゲート・3-run 連続 pass・human-eval 検証コマンドを runbook に同期し、運用導線を固定した。
  - 検証: 3ドキュメントで `proof-pack -> freeze-review -> verify-human-eval` の実行手順を明示し、ファイル名を実装値と一致させた。

### 16.5 実行順（2週間）

1. Day1-3:
   - CMC-001, CMC-002（失敗黙殺停止）
2. Day4-7:
   - CMC-003, CMC-004（継続性/境界/privacy の実証）
3. Day8-14:
   - CMC-005, CMC-006, CMC-007, CMC-008（提出物と合否ゲートの固定）

### 16.6 完了判定（このセクションのDoD）

1. 4提出物JSON + 人間評価サマリが揃う
2. 必須項目を満たす run が 3回連続で再現
3. 失敗時に `原因/影響/次コマンド` を1画面で確認できる

---

## 17. ローカル環境インベントリ画面 企画・実装プラン（2026-02-22）

### 17.1 目的

`harness-mem-ui` に「システムインベントリ」画面を1つ追加し、以下を説明付きで扱えるようにする。

1. ローカルで起動中のサーバー一覧（ポート/プロトコル/PID/バインド先を含む）
2. インストール済み言語一覧（Python / Node / Go / Rust など）
3. インストール済みCLIツール一覧
4. LLMからの問い合わせに対して現状を返す専用エンドポイント（出口）

加えて、チームで批判的レビューを回しながら、安全に操作できる仕様へ収束させる。

### 17.2 チーム編成と批判レビュー運用

1. PM（要件と優先順位の最終決定）
2. Security Reviewer（権限境界・監査・コマンド実行の脅威分析）
3. Architecture Reviewer（`memory-server` / `harness-mem-ui` の責務分離）
4. UX Reviewer（情報設計、誤操作防止、a11y）
5. QA Reviewer（契約テスト、E2E、回帰戦略）

レビュー会（設計着手時に固定）:
1. Gate A: 要件凍結レビュー（非機能要件・禁止事項を先に確定）
2. Gate B: 脅威モデルレビュー（admin token境界、allowlist、監査ログ）
3. Gate C: UXレビュー（説明文、操作導線、エラー時文言）
4. Gate D: 実装準備レビュー（API契約・テスト観点・DoD合意）

### 17.3 Priority Matrix（本件）

Required:
1. インベントリ画面を追加し、3カテゴリを同一画面で表示する
2. すべての取得/操作APIを `v1/admin/*` 配下に置き、admin token必須にする
3. データは「説明」「状態」「最終更新時刻」を含める（サーバーはポート/プロトコル/PID/バインド先を必須）
4. 操作は最初に `dry-run` と明示確認を必須化する
5. 監査ログに `who/when/what(result)` を残す
6. LLM問い合わせ向けの read-only エンドポイントを提供し、短いサマリと詳細参照IDを返す

Recommended:
1. カテゴリ別TTLキャッシュ（例: サーバー30秒、言語/CLI 5分）
2. タブ切り替え（`Feed` / `Inventory`）とキーボード操作対応
3. 失敗時の復旧ガイド表示（権限不足 / タイムアウト / 未インストール）

Optional:
1. 追加言語マネージャ（asdf / pyenv / rbenv）検出の詳細化
2. 実行結果の差分表示（前回比較）
3. エクスポート（JSON/Markdown）

### 17.4 TDD採用判定（本件）

判定: 採用する（理由: 条件分岐が多い / 外部コマンド呼び出しを伴う / 権限・安全性が重要）

テスト設計（合意してから実装）:
1. Normal: 3カテゴリが取得でき、説明文付きで表示される（サーバー項目はポート/プロトコル/PID/バインド先を含む）
2. Boundary: 一部カテゴリ取得失敗時でも他カテゴリは表示継続し、失敗理由を明示する
3. Error: 無効トークン時は 401、allowlist外の操作要求は 400/403 で拒否する
4. Security: 引数に `;`, `&&` を含んでもシェル連結されず拒否される
5. Performance: 連続リフレッシュ時もTTL内はキャッシュ応答になる
6. LLM Endpoint: `system/llm-context` が短い要約 + 詳細メタを返し、トークン超過を防ぐ

### 17.5 実装バックログ（Team Critique付き）

#### Phase INV-0: 仕様確定と設計批判（2日）

- [ ] `cc:TODO [feature:tdd] [feature:security]` INV-001 批判レビュー会の実施とADR作成
  - 変更予定: `docs/plans/system-inventory-adr.md`（新規）
  - 受入条件:
    1. Gate A-D の合否と論点が1ファイルに残る
    2. 「今回はやらないこと（非対応操作）」が明記される

- [ ] `cc:TODO [feature:security]` INV-002 脅威モデルと禁止ルール固定
  - 変更予定: `docs/plans/system-inventory-threat-model.md`（新規）
  - 受入条件:
    1. 認証・認可・監査・コマンド実行の脅威一覧がある
    2. `shell=true` 禁止、allowlist必須、dry-run必須が文書化される

#### Phase INV-1: API/Collector基盤（3日）

- [ ] `cc:TODO [feature:security] [feature:tdd]` INV-003 System Inventory API契約追加
  - 変更予定: `memory-server/src/server.ts`, `memory-server/src/core/harness-mem-core.ts`
  - 受入条件:
    1. `GET /v1/admin/system/inventory` が追加される
    2. `GET /v1/admin/system/llm-context` が追加される（LLM向け短文サマリ）
    3. `POST /v1/admin/system/actions` は dry-run/confirm なしで実行不可
    4. すべて admin token 検証を通る

- [ ] `[P] cc:TODO [feature:tdd]` INV-004 macOS向けCollector実装（read-only優先）
  - 変更予定: `memory-server/src/system-inventory/collectors.ts`（新規）
  - 受入条件:
    1. サーバー一覧、言語一覧、CLI一覧を収集できる
    2. サーバー一覧は `port/protocol/pid/process_name/bind_address` を返す
    3. コマンド失敗時にカテゴリ単位で劣化表示可能なエラー情報を返す

- [ ] `[P] cc:TODO [feature:tdd]` INV-012 LLM問い合わせ用サマリ整形ロジック追加
  - 変更予定: `memory-server/src/system-inventory/llm-context.ts`（新規）
  - 受入条件:
    1. サマリは「現在の主要サーバー状況 + 言語/CLI概要」を短文化して返す
    2. 詳細確認用に `inventory_snapshot_id` を返し、UI/APIで追跡できる
    3. 1レスポンスが過大にならない上限制御（例: 件数上限/文字数上限）がある

- [ ] `[P] cc:TODO [feature:tdd]` INV-005 TTLキャッシュとタイムアウト制御
  - 変更予定: `memory-server/src/system-inventory/cache.ts`（新規）
  - 受入条件:
    1. サーバー30秒、言語/CLI 5分のTTLが設定可能
    2. タイムアウト超過時は stale キャッシュまたは明示エラーを返す
    3. `system/llm-context` も同一スナップショット基盤を参照する

- [ ] `cc:TODO [feature:security]` INV-006 監査ログ統合
  - 変更予定: `memory-server/src/core/harness-mem-core.ts`
  - 受入条件:
    1. inventory取得/操作/llm-context取得の監査イベントが `admin audit-log` で追跡できる
    2. 取得者・対象・結果・実行時刻が記録される

#### Phase INV-2: UI画面実装（2日）

- [ ] `cc:TODO [feature:a11y]` INV-007 `Inventory` タブ追加
  - 変更予定: `harness-mem-ui/src/app/App.tsx`, `harness-mem-ui/src/lib/types.ts`, `harness-mem-ui/src/hooks/useSettings.ts`
  - 受入条件:
    1. `Feed` と `Inventory` を切り替え可能
    2. キーボード操作と `aria-selected` が有効

- [ ] `cc:TODO [feature:a11y]` INV-008 Inventory Panel 実装（説明付き）
  - 変更予定: `harness-mem-ui/src/components/SystemInventoryPanel.tsx`（新規）, `harness-mem-ui/src/lib/i18n.ts`, `harness-mem-ui/src/lib/api.ts`
  - 受入条件:
    1. 3カテゴリのカードに「説明」「状態」「最終更新」を表示
    2. サーバーカードに `port/protocol/pid/bind_address` を表示
    3. LLM向けエンドポイントの最終応答サマリを確認できる
    4. 操作ボタンに `dry-run` 表示と確認UIがある
    5. 権限不足/失敗時のガイダンス文言が表示される

#### Phase INV-3: 検証とドキュメント（2日）

- [ ] `cc:TODO [feature:tdd] [feature:security]` INV-009 API統合テスト追加
  - 変更予定: `memory-server/tests/integration/system-inventory-api.test.ts`（新規）
  - 受入条件:
    1. トークン必須、allowlist、dry-run制約をテストで固定
    2. 一部カテゴリ失敗時の劣化応答を固定
    3. `system/llm-context` が短文サマリ + snapshot参照IDを返すことを固定

- [ ] `cc:TODO [feature:tdd] [feature:a11y]` INV-010 UIテスト追加
  - 変更予定: `harness-mem-ui/tests/ui/system-inventory-panel.test.tsx`（新規）, `harness-mem-ui/tests/e2e/inventory.spec.ts`（新規）
  - 受入条件:
    1. タブ切替、表示、エラー表示、操作確認が通る
    2. ポート番号などサーバー詳細項目の表示を固定
    3. 日本語/英語文言切替で崩れない

- [ ] `cc:TODO` INV-011 運用ドキュメント更新
  - 変更予定: `docs/harness-mem-setup.md`, `README.md`
  - 受入条件:
    1. 画面用途、操作制約、監査ログ確認手順を追記
    2. 既知制約（macOS優先対応、非対応操作）を明記

### 17.6 完了判定（DoD）

1. Gate A-D のレビュー記録が残っている
2. Inventory 画面で3カテゴリが説明付きで表示され、サーバーはポート等詳細を確認できる
3. `system/llm-context` でLLM問い合わせに現状サマリを返せる
4. 操作APIが admin token + dry-run + allowlist + 監査ログを満たす
5. API/UI/E2E テストが追加され、回帰テストで再現可能
