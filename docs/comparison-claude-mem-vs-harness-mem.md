# claude-mem vs harness-mem 比較採点レポート

## 1. プロジェクト概要

| 項目 | claude-mem (thedotmack) | harness-mem (Chachamaru127) |
|---|---|---|
| バージョン | v10.3.3 | v0.1.24 |
| ライセンス | AGPL-3.0 | MIT |
| GitHub Stars | ~30.3k | 新規 |
| 言語 | TypeScript (Node.js/Bun) | TypeScript (Bun) + Shell |
| 目的 | Claude Code専用の永続メモリ圧縮システム | 複数ツール横断の統一メモリランタイム |
| 対応ツール | Claude Code (プラグイン) | Codex, OpenCode, Cursor, Claude, Antigravity |

---

## 2. アーキテクチャ比較

### claude-mem
```
Plugin (hooks) → Worker Service (Express, port 37777) → SQLite + Chroma (vector DB)
                                                      → AI Agent (圧縮/要約)
                                                      → MCP Server (4 tools)
                                                      → Web Viewer UI (React)
```
- **5つのライフサイクルフック**: SessionStart, UserPromptSubmit, PostToolUse, Stop, SessionEnd
- **Worker Service**: ~2000行のモノリスから ~300行のオーケストレータに再構築済み
- **AI圧縮**: Claude/Gemini/OpenRouterを使ったobservation圧縮
- **Chroma Vector DB**: 外部Pythonプロセスでセマンティック検索

### harness-mem
```
CLI (setup/doctor) → Daemon (harness-memd, Bun) → Memory Server (HarnessMemCore)
                                                  → SQLite + FTS5 + sqlite-vec
                                                  → MCP Server (18 tools)
                                                  → Mem UI (React, SSR)
Hooks (hooks.json) → Platform adapters (Codex/OpenCode/Cursor/Claude)
```
- **HarnessMemCore**: 5,700行の統一コアクラス（全ロジック集約）
- **組み込みSQLite**: bun:sqlite直接使用、外部DBプロセス不要
- **sqlite-vec**: ベクトル検索もSQLite内で完結
- **FTS5**: 全文検索もSQLite内蔵
- **Retrieval Router**: クエリ種別（profile/timeline/graph/vector/hybrid）自動分類

---

## 3. 採点（各10点満点）

### 3.1 マルチプラットフォーム対応

| 項目 | claude-mem | harness-mem |
|---|---|---|
| スコア | **3/10** | **9/10** |

**claude-mem**: Claude Code専用。Cursorフック対応はあるがメインはClaude Codeプラグイン。
**harness-mem**: Codex, OpenCode, Cursor, Claude, Antigravityの5プラットフォームを統一サポート。インジェスターが各ツールのネイティブ形式を解析。`setup --platform codex,cursor,claude`で一括セットアップ。

### 3.2 検索・取得アーキテクチャ

| 項目 | claude-mem | harness-mem |
|---|---|---|
| スコア | **7/10** | **8/10** |

**claude-mem**: 3層ワークフロー（search → timeline → get_observations）でトークン効率を最適化。ChromaベクトルDBによるハイブリッド検索。Progressive disclosureで~10xトークン節約を謳う。
**harness-mem**: 同じ3層ワークフローを採用しつつ、さらに以下を追加：
- **Retrieval Router**: クエリをprofile/timeline/graph/vector/hybridに自動分類し重み付けを変更
- **Reranker**: 検索結果の再ランキング（Ollama/OpenAI/フォールバック対応）
- **Entity/Link/Fact**: グラフ構造による関係性検索
- **sqlite-vec**: 外部プロセス不要の組み込みベクトル検索
- **token_estimate**: 各レスポンスにトークン推定値を付与

### 3.3 データモデル

| 項目 | claude-mem | harness-mem |
|---|---|---|
| スコア | **5/10** | **9/10** |

**claude-mem**: sessions, observations の基本モデル。SQLite永続化。
**harness-mem**: 14テーブルの包括的スキーマ:
- `mem_sessions` (セッション管理)
- `mem_events` (イベントエンベロープ、重複排除ハッシュ付き)
- `mem_observations` (プライバシー制御付きobservation)
- `mem_tags`, `mem_entities`, `mem_observation_entities` (エンティティグラフ)
- `mem_links` (関係性グラフ、重み付き)
- `mem_vectors`, `mem_vectors_vec`, `mem_vectors_vec_map` (ベクトル検索)
- `mem_facts` (事実抽出、信頼度スコア付き)
- `mem_audit_log` (監査ログ)
- `mem_consolidation_queue` (統合キュー)
- `mem_retry_queue` (リトライキュー)
- `mem_import_jobs` (インポートジョブ管理)
- `mem_ingest_offsets` (インジェストオフセット管理)

### 3.4 MCP Tool設計

| 項目 | claude-mem | harness-mem |
|---|---|---|
| スコア | **5/10** | **9/10** |

**claude-mem**: 4+1 tools (`__IMPORTANT`, `search`, `timeline`, `get_observations`, `save_observation`)
**harness-mem**: 18 tools (検索系 + セッション管理 + 管理系 + コードインテリジェンス + ワークフロー)
- 検索: `search`, `timeline`, `get_observations`, `search_facets`, `resume_pack`
- セッション: `sessions_list`, `session_thread`, `finalize_session`, `record_event`, `record_checkpoint`
- 管理: `import_claude_mem`, `import_status`, `verify_import`, `reindex_vectors`, `metrics`, `consolidation_run`, `consolidation_status`, `audit_log`
- パス検証、セキュリティチェック付き

### 3.5 エンベディング・ベクトル検索

| 項目 | claude-mem | harness-mem |
|---|---|---|
| スコア | **6/10** | **8/10** |

**claude-mem**: Chroma (Python外部プロセス) を使用。セットアップにPython/uvが必要。
**harness-mem**: 3段階フォールバック付きプロバイダレジストリ:
1. **OpenAI** (`text-embedding-3-small`) - API経由
2. **Ollama** - ローカルLLM経由
3. **Fallback** - API不要のハッシュベース擬似ベクトル

外部プロセス不要。sqlite-vecでSQLite内ベクトル検索完結。

### 3.6 セットアップ・運用性

| 項目 | claude-mem | harness-mem |
|---|---|---|
| スコア | **7/10** | **8/10** |

**claude-mem**: `/plugin marketplace add thedotmack/claude-mem` でワンコマンドインストール。ただしPython/uv/Chromaの依存関係が複雑。
**harness-mem**: `npx harness-mem setup --platform codex,cursor,claude` でセットアップ。`doctor --fix`で自動修復。`uninstall --purge-db`でクリーン削除。Python不要（Bun + SQLiteで完結）。

### 3.7 テスト・品質保証

| 項目 | claude-mem | harness-mem |
|---|---|---|
| スコア | **7/10** | **9/10** |

**claude-mem**: テストスイート有り（SQLite, agents, search, context, infrastructure, server）。16テストファイル + 9サブディレクトリ。
**harness-mem**:
- **70テストファイル**（.test.ts + .test.sh）
- **LoCoMoベンチマーク**: 学術的メモリ評価フレームワーク（locomo-loader, locomo-evaluator, locomo-judge等）
- **パフォーマンスベンチ**: 100Kワークフローテスト
- **Rerank品質ゲート**: rerank-quality-gate.test.ts
- **カオステスト**: daemon-chaos, zombie テスト
- **契約テスト**: doctor-json-contract, proof-pack-contract, human-eval-contract等
- **Drift Report**: バージョン間の品質劣化検出

### 3.8 プライバシー・セキュリティ

| 項目 | claude-mem | harness-mem |
|---|---|---|
| スコア | **6/10** | **8/10** |

**claude-mem**: `<private>`タグで除外可能。
**harness-mem**:
- `privacy_tags`フィールドで粒度の細かいプライバシー制御
- `content_redacted`と`content`の分離（FTSはredacted版を使用）
- `include_private`フラグで検索時制御
- Admin Token認証（Bearer/ヘッダー）
- パス検証（ディレクトリトラバーサル防止）
- 監査ログ（全管理操作を記録）

### 3.9 AI圧縮・統合

| 項目 | claude-mem | harness-mem |
|---|---|---|
| スコア | **8/10** | **6/10** |

**claude-mem**: コア機能としてAI圧縮を実装。Claude/Gemini/OpenRouterのフォールバック付き。observationの自動圧縮がプロジェクトの根幹。
**harness-mem**: consolidation workerで統合処理を実装しているが、AI圧縮は外部サービスに依存するオプション機能。主にルールベースの事実抽出・重複排除が中心。

### 3.10 コミュニティ・エコシステム

| 項目 | claude-mem | harness-mem |
|---|---|---|
| スコア | **9/10** | **4/10** |

**claude-mem**: 30k+ Stars、2k Forks。活発なコミュニティ、Discord、ドキュメントサイト (docs.claude-mem.ai)、30+言語の翻訳、OpenClawゲートウェイ。
**harness-mem**: 新規プロジェクト。npm公開済み。日本語ドキュメント有り。コミュニティは未形成。

---

## 4. 総合スコア

| カテゴリ | claude-mem | harness-mem |
|---|---|---|
| マルチプラットフォーム対応 | 3 | **9** |
| 検索・取得アーキテクチャ | 7 | **8** |
| データモデル | 5 | **9** |
| MCP Tool設計 | 5 | **9** |
| エンベディング・ベクトル検索 | 6 | **8** |
| セットアップ・運用性 | 7 | **8** |
| テスト・品質保証 | 7 | **9** |
| プライバシー・セキュリティ | 6 | **8** |
| AI圧縮・統合 | **8** | 6 |
| コミュニティ・エコシステム | **9** | 4 |
| **合計** | **63/100** | **78/100** |

---

## 5. 総括

### claude-mem の強み
- **確立されたコミュニティ** (30k+ stars) と豊富なドキュメント
- **AI圧縮がコア機能**: observationの自動圧縮・要約が差別化ポイント
- **プラグインマーケットプレイス**: Claude Codeプラグインとしてワンコマンドインストール
- **Endless Modeなど実験的機能**: ベータチャンネルによる先進機能

### claude-mem の弱み
- **Claude Code専用**: マルチプラットフォーム対応が限定的
- **外部依存が重い**: Python/uv/Chroma が必要
- **データモデルがシンプル**: エンティティグラフ・関係性・事実抽出が未実装
- **AGPL-3.0ライセンス**: 商用利用に制約

### harness-mem の強み
- **マルチプラットフォーム統一**: 5ツール横断の一貫したメモリ体験
- **自己完結型アーキテクチャ**: Bun + SQLite（FTS5 + sqlite-vec）で外部依存最小
- **包括的データモデル**: 14テーブル、エンティティグラフ、事実抽出、監査ログ
- **高度な検索**: Retrieval Router による質問種別自動分類 + Reranker
- **堅牢なテスト**: LoCoMoベンチマーク、カオステスト、品質ゲート
- **MITライセンス**: 商用利用に制約なし
- **claude-memからの移行パス**: import/verify/cutover コマンド提供

### harness-mem の弱み
- **コミュニティ未形成**: 新規プロジェクトのため利用実績が少ない
- **AI圧縮が弱い**: claude-memほどのAI統合圧縮機能がない
- **HarnessMemCoreが巨大**: 5,700行の単一ファイルはメンテナンス課題

---

## 6. 結論

**技術的完成度ではharness-memが優位**。特にマルチプラットフォーム対応、データモデルの豊かさ、検索アーキテクチャの高度さ、テスト基盤の充実度で上回る。自己完結型のSQLiteアーキテクチャは運用面でも有利。

**エコシステムではclaude-memが圧倒的**。30k+ starsの実績、活発なコミュニティ、豊富なドキュメント、AI圧縮のコア機能は大きな差別化要因。

harness-memがclaude-memからの移行パス（`import-claude-mem`/`verify-import`/`cutover-claude-mem`）を提供していることは、両プロジェクトの関係性を明確に示している。harness-memはclaude-memの「次のステップ」として設計されており、マルチツール時代のメモリ統一を目指すポジショニングが明確。
