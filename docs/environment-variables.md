# 環境変数リファレンス

harness-mem で使用する全環境変数の一覧です。

最終更新: 2026-03-26

---

## 目次

1. [Core — ポート・ホスト・データディレクトリ](#core)
2. [Database — SQLite 設定](#database)
3. [LLM — 言語モデル設定](#llm)
4. [Embedding — 埋め込みモデル設定](#embedding)
5. [Security — 認証・レート制限・PII フィルタ](#security)
6. [Ingestion — プラットフォーム別取り込み設定](#ingestion)
7. [Sync — 外部サービス連携](#sync)
8. [Performance — スコアリング・リランク](#performance)
9. [Managed Backend — クラウド連携](#managed-backend)
10. [Session — セッション識別](#session)

---

## Core

コアサーバーの基本動作を制御する変数群です。

| 変数名 | デフォルト値 | 必須 | 説明 | 使用箇所 |
|--------|-------------|------|------|----------|
| `HARNESS_MEM_HOST` | `127.0.0.1` | No | memory-server がバインドするホスト/IPアドレス。`0.0.0.0` にするとリモートからも接続可能 | `core/core-utils.ts`, `mcp-server/src/tools/memory.ts` |
| `HARNESS_MEM_PORT` | `37888` | No | memory-server がリッスンするポート番号 | `core/core-utils.ts`, `mcp-server/src/tools/memory.ts` |
| `HARNESS_MEM_UI_PORT` | `37901` | No | Web UI（ダッシュボード）用ポート番号 | `core/harness-mem-core.ts` |
| `HARNESS_MEM_HOME` | `~/.harness-mem` | No | harness-mem のデータディレクトリルート。state_dir の基準パスとして使用される | `core/harness-mem-core.ts`, `system-environment/collector.ts` |
| `HARNESS_MEM_CONFIG_PATH` | `~/.harness-mem/config.json` | No | 設定 JSON ファイルのパス | `server.ts` |
| `HARNESS_MEM_REMOTE_URL` | `""` (空文字) | No | リモートモードで使用する memory-server の URL（設定すると MCP はリモート接続する） | `mcp-server/src/tools/memory.ts` |
| `HARNESS_MEM_ENABLE_CAPTURE` | `true` | No | 観察情報のキャプチャ（記録）を有効にするか | `core/core-utils.ts` |
| `HARNESS_MEM_ENABLE_RETRIEVAL` | `true` | No | 検索・取得機能を有効にするか | `core/core-utils.ts` |
| `HARNESS_MEM_ENABLE_INJECTION` | `true` | No | システムプロンプトへの自動インジェクションを有効にするか | `core/core-utils.ts` |
| `HOME` | OS依存 | No | ホームディレクトリ。デフォルトパス解決に使用 | `core/core-utils.ts`, `system-environment/collector.ts`, `mcp-server/src/tools/memory.ts` |
| `USERPROFILE` | OS依存 | No | Windows 環境でのホームディレクトリ（`HOME` のフォールバック） | `core/core-utils.ts`, `system-environment/collector.ts` |
| `NODE_ENV` | `""` | No | `test` に設定するとバックグラウンドワーカーが起動しない | `core/harness-mem-core.ts` |

---

## Database

SQLite データベースの設定です。

| 変数名 | デフォルト値 | 必須 | 説明 | 使用箇所 |
|--------|-------------|------|------|----------|
| `HARNESS_MEM_DB_PATH` | `~/.harness-mem/harness-mem.db` | No | SQLite データベースファイルのパス | `core/core-utils.ts` |
| `HARNESS_MEM_SQLITE_VEC_PATH` | `""` (空文字) | No | sqlite-vec 拡張ライブラリ (.so/.dylib) のパス。設定するとベクター検索が有効化される（未設定時は JS フォールバック） | `vector/providers.ts` |
| `HARNESS_MEM_VECTOR_DIM` | `256` | No | ベクターのディメンション数。範囲: 32〜4096 | `core/core-utils.ts` |

---

## LLM

コンソリデーション（記憶の統合・事実抽出）に使用する言語モデルの設定です。

| 変数名 | デフォルト値 | 必須 | 説明 | 使用箇所 |
|--------|-------------|------|------|----------|
| `HARNESS_MEM_LLM_PROVIDER` | 自動検出 | No | 使用するLLMプロバイダー。`openai` / `anthropic` / `ollama` から選択。未設定の場合は API キーの有無で自動決定 | `llm/registry.ts` |
| `HARNESS_MEM_FACT_LLM_PROVIDER` | `openai` | No | 事実抽出に使用するプロバイダー。`openai` / `anthropic` / `gemini` / `ollama` から選択 | `consolidation/extractor.ts` |
| `HARNESS_MEM_FACT_LLM_MODEL` | プロバイダー依存 | No | 事実抽出に使用するモデル名。デフォルト: openai=`gpt-4o-mini`, anthropic=`claude-haiku-4-5-20251001`, gemini=`gemini-2.0-flash`, ollama=`llama3.2` | `consolidation/extractor.ts`, `llm/ollama-provider.ts` |
| `HARNESS_MEM_FACT_EXTRACTOR_MODE` | `heuristic` | No | 事実抽出モード。`heuristic`（ルールベース）または `llm`（LLM使用） | `consolidation/worker.ts`, `consolidation/extractor.ts` |
| `HARNESS_MEM_OPENAI_API_KEY` | `""` | No* | OpenAI API キー（`OPENAI_API_KEY` より優先される）。LLM または embedding に openai を使う場合は必須 | `llm/registry.ts`, `llm/openai-provider.ts`, `core/core-utils.ts`, `consolidation/extractor.ts` |
| `OPENAI_API_KEY` | `""` | No* | OpenAI API キー（`HARNESS_MEM_OPENAI_API_KEY` のフォールバック） | `llm/registry.ts`, `llm/openai-provider.ts`, `ingest/audio-ingester.ts` |
| `HARNESS_MEM_ANTHROPIC_API_KEY` | `""` | No* | Anthropic API キー。`HARNESS_MEM_FACT_LLM_PROVIDER=anthropic` の場合に必須 | `consolidation/extractor.ts` |
| `HARNESS_MEM_GEMINI_API_KEY` | `""` | No* | Google Gemini API キー。`HARNESS_MEM_FACT_LLM_PROVIDER=gemini` の場合に必須 | `consolidation/extractor.ts` |
| `HARNESS_MEM_OLLAMA_HOST` | `http://127.0.0.1:11434` | No | Ollama サーバーエンドポイント（LLM用） | `consolidation/extractor.ts`, `llm/ollama-provider.ts` |
| `HARNESS_MEM_CONSOLIDATION_ENABLED` | `true` | No | コンソリデーション（記憶の定期統合）を有効にするか | `core/core-utils.ts` |
| `HARNESS_MEM_CONSOLIDATION_INTERVAL_MS` | `60000` | No | コンソリデーションの実行間隔（ミリ秒）。範囲: 5000〜600000 | `core/core-utils.ts` |

> \* LLM プロバイダーを使用する場合は対応する API キーが必須です。

---

## Embedding

テキストの埋め込みベクター生成に使用するモデル設定です。

| 変数名 | デフォルト値 | 必須 | 説明 | 使用箇所 |
|--------|-------------|------|------|----------|
| `HARNESS_MEM_EMBEDDING_PROVIDER` | `fallback` | No | 埋め込みプロバイダー。`openai` / `ollama` / `local` / `fallback` から選択 | `core/core-utils.ts` |
| `HARNESS_MEM_EMBEDDING_MODEL` | `ruri-v3-30m` | No | ローカル埋め込みモデルのID。`auto` を指定すると言語に応じて自動選択 | `embedding/registry.ts` |
| `HARNESS_MEM_OPENAI_EMBED_MODEL` | `text-embedding-3-small` | No | OpenAI 埋め込みモデル名。`HARNESS_MEM_EMBEDDING_PROVIDER=openai` の場合に使用 | `core/core-utils.ts` |
| `HARNESS_MEM_OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | No | Ollama サーバーの URL（埋め込み用） | `core/core-utils.ts` |
| `HARNESS_MEM_OLLAMA_EMBED_MODEL` | `nomic-embed-text` | No | Ollama 埋め込みモデル名。`HARNESS_MEM_EMBEDDING_PROVIDER=ollama` の場合に使用 | `core/core-utils.ts` |
| `HARNESS_MEM_RESUME_PACK_MAX_TOKENS` | `4000` | No | resume_pack / continuity briefing の最大トークン数。0 を指定すると resume_pack を無効化 | `core/core-utils.ts`, `core/observation-store.ts` |

---

## Security

認証、レート制限、PII フィルタに関する設定です。

| 変数名 | デフォルト値 | 必須 | 説明 | 使用箇所 |
|--------|-------------|------|------|----------|
| `HARNESS_MEM_ADMIN_TOKEN` | `""` (空文字) | No* | 管理者 API トークン。設定するとすべての API リクエストに Bearer 認証が必要になる | `server.ts`, `mcp-server/src/tools/memory.ts` |
| `HARNESS_MEM_REMOTE_TOKEN` | `""` (空文字) | No* | リモートモード（`HARNESS_MEM_REMOTE_URL` 使用時）の認証トークン | `mcp-server/src/tools/memory.ts` |
| `HARNESS_MEM_RATE_LIMIT` | `120` | No | 1分あたりのリクエスト上限数。`0` でレート制限を無効化 | `middleware/rate-limiter.ts` |
| `HARNESS_MEM_PII_FILTER` | `""` (無効) | No | `true` または `1` に設定すると PII（個人情報）フィルタを有効化 | `mcp-server/src/pii/pii-filter.ts` |
| `HARNESS_MEM_PII_RULES_PATH` | `""` (デフォルトルール) | No | カスタム PII ルールファイル（JSON）のパス。未設定時はデフォルトルールを使用 | `mcp-server/src/pii/pii-filter.ts` |

> \* `HARNESS_MEM_ADMIN_TOKEN` は本番環境では必ず設定することを推奨します。

---

## Ingestion

各プラットフォームからの会話履歴取り込み設定です。

### Codex

| 変数名 | デフォルト値 | 必須 | 説明 | 使用箇所 |
|--------|-------------|------|------|----------|
| `HARNESS_MEM_ENABLE_CODEX_INGEST` | `true` | No | Codex セッション履歴の取り込みを有効にするか | `core/core-utils.ts` |
| `HARNESS_MEM_CODEX_PROJECT_ROOT` | `process.cwd()` | No | Codex プロジェクトルートディレクトリ | `core/core-utils.ts`, `mcp-server/src/tools/memory.ts` |
| `HARNESS_MEM_CODEX_SESSIONS_ROOT` | `~/.codex/sessions` | No | Codex セッションファイルが保存されるディレクトリ | `core/core-utils.ts` |
| `HARNESS_MEM_CODEX_INGEST_INTERVAL_MS` | `5000` | No | Codex 取り込みのポーリング間隔（ミリ秒）。範囲: 1000〜300000 | `core/core-utils.ts` |
| `HARNESS_MEM_CODEX_BACKFILL_HOURS` | `24` | No | 起動時に遡って取り込む Codex 履歴の時間数。範囲: 1〜8760 | `core/core-utils.ts` |

### OpenCode

| 変数名 | デフォルト値 | 必須 | 説明 | 使用箇所 |
|--------|-------------|------|------|----------|
| `HARNESS_MEM_ENABLE_OPENCODE_INGEST` | `true` | No | OpenCode セッション履歴の取り込みを有効にするか | `core/core-utils.ts` |
| `HARNESS_MEM_OPENCODE_DB_PATH` | `~/.local/share/opencode/opencode.db` | No | OpenCode の SQLite データベースパス | `core/core-utils.ts` |
| `HARNESS_MEM_OPENCODE_STORAGE_ROOT` | `~/.local/share/opencode/storage` | No | OpenCode ストレージルートディレクトリ | `core/core-utils.ts` |
| `HARNESS_MEM_OPENCODE_INGEST_INTERVAL_MS` | `5000` | No | OpenCode 取り込みのポーリング間隔（ミリ秒）。範囲: 1000〜300000 | `core/core-utils.ts` |
| `HARNESS_MEM_OPENCODE_BACKFILL_HOURS` | `24` | No | 起動時に遡って取り込む OpenCode 履歴の時間数。範囲: 1〜8760 | `core/core-utils.ts` |

### Cursor

| 変数名 | デフォルト値 | 必須 | 説明 | 使用箇所 |
|--------|-------------|------|------|----------|
| `HARNESS_MEM_ENABLE_CURSOR_INGEST` | `true` | No | Cursor セッション履歴の取り込みを有効にするか | `core/core-utils.ts` |
| `HARNESS_MEM_CURSOR_EVENTS_PATH` | `~/.harness-mem/adapters/cursor/events.jsonl` | No | Cursor イベントログファイルのパス | `core/core-utils.ts` |
| `HARNESS_MEM_CURSOR_INGEST_INTERVAL_MS` | `5000` | No | Cursor 取り込みのポーリング間隔（ミリ秒）。範囲: 1000〜300000 | `core/core-utils.ts` |
| `HARNESS_MEM_CURSOR_BACKFILL_HOURS` | `24` | No | 起動時に遡って取り込む Cursor 履歴の時間数。範囲: 1〜8760 | `core/core-utils.ts` |

### Antigravity

| 変数名 | デフォルト値 | 必須 | 説明 | 使用箇所 |
|--------|-------------|------|------|----------|
| `HARNESS_MEM_ENABLE_ANTIGRAVITY_INGEST` | `false` | No | Antigravity (VS Code fork) 履歴の取り込みを有効にするか | `core/core-utils.ts` |
| `HARNESS_MEM_ANTIGRAVITY_ROOTS` | `""` (空文字) | No | Antigravity ワークスペースルートのパスリスト（カンマまたは改行区切り） | `core/core-utils.ts` |
| `HARNESS_MEM_ANTIGRAVITY_LOGS_ROOT` | `~/Library/Application Support/Antigravity/logs` | No | Antigravity ログディレクトリ（macOS デフォルト） | `core/core-utils.ts` |
| `HARNESS_MEM_ANTIGRAVITY_WORKSPACE_STORAGE_ROOT` | `~/Library/Application Support/Antigravity/User/workspaceStorage` | No | Antigravity ワークスペースストレージルート（macOS デフォルト） | `core/core-utils.ts` |
| `HARNESS_MEM_ANTIGRAVITY_INGEST_INTERVAL_MS` | `5000` | No | Antigravity 取り込みのポーリング間隔（ミリ秒）。範囲: 1000〜300000 | `core/core-utils.ts` |
| `HARNESS_MEM_ANTIGRAVITY_BACKFILL_HOURS` | `24` | No | 起動時に遡って取り込む Antigravity 履歴の時間数。範囲: 1〜8760 | `core/core-utils.ts` |

### Gemini CLI

| 変数名 | デフォルト値 | 必須 | 説明 | 使用箇所 |
|--------|-------------|------|------|----------|
| `HARNESS_MEM_ENABLE_GEMINI_INGEST` | `true` | No | Gemini CLI 履歴の取り込みを有効にするか | `core/core-utils.ts` |
| `HARNESS_MEM_GEMINI_EVENTS_PATH` | `~/.harness-mem/adapters/gemini/events.jsonl` | No | Gemini CLI イベントログファイルのパス | `core/core-utils.ts` |
| `HARNESS_MEM_GEMINI_INGEST_INTERVAL_MS` | `5000` | No | Gemini CLI 取り込みのポーリング間隔（ミリ秒）。範囲: 1000〜300000 | `core/core-utils.ts` |
| `HARNESS_MEM_GEMINI_BACKFILL_HOURS` | `24` | No | 起動時に遡って取り込む Gemini CLI 履歴の時間数。範囲: 1〜8760 | `core/core-utils.ts` |

### Audio（Whisper）

| 変数名 | デフォルト値 | 必須 | 説明 | 使用箇所 |
|--------|-------------|------|------|----------|
| `WHISPER_PROVIDER` | `""` | No | Whisper プロバイダー（`openai` 等）。設定ファイルより優先 | `ingest/audio-ingester.ts` |
| `WHISPER_MODEL` | `""` | No | 使用する Whisper モデル名 | `ingest/audio-ingester.ts` |
| `WHISPER_LANGUAGE` | `""` | No | 音声の言語コード（例: `ja`, `en`） | `ingest/audio-ingester.ts` |
| `WHISPER_ENDPOINT` | `""` | No | Whisper 互換エンドポイント URL（ローカル Whisper サーバー等） | `ingest/audio-ingester.ts` |

---

## Sync

外部サービスとの同期設定です。

| 変数名 | デフォルト値 | 必須 | 説明 | 使用箇所 |
|--------|-------------|------|------|----------|
| `GITHUB_TOKEN` | `""` | No* | GitHub Personal Access Token。GitHub 同期を使用する場合に必要 | `sync/github-connector.ts` |
| `NOTION_TOKEN` | `""` | No* | Notion インテグレーショントークン。Notion 同期を使用する場合に必要 | `sync/notion-connector.ts` |
| `GDRIVE_SERVICE_ACCOUNT_KEY` | `""` | No* | Google Drive サービスアカウントキー（JSON 文字列）。GDrive 同期を使用する場合に必要 | `sync/gdrive-connector.ts` |

> \* 各同期機能を使用する場合は対応するトークンが必須です。

---

## Performance

検索スコアリングとリランクの設定です。

| 変数名 | デフォルト値 | 必須 | 説明 | 使用箇所 |
|--------|-------------|------|------|----------|
| `HARNESS_MEM_SEARCH_RANKING` | `hybrid_v3` | No | 検索スコアリングアルゴリズム。`hybrid_v3` / `bm25` / `vector` 等から選択 | `core/core-utils.ts` |
| `HARNESS_MEM_SEARCH_EXPAND_LINKS` | `true` | No | 検索結果のリンク展開を有効にするか | `core/core-utils.ts` |
| `HARNESS_MEM_RECENCY_HALF_LIFE_DAYS` | `14`（推定） | No | 再新性スコアの半減期（日数）。小さいほど新しい記憶を重視する | `core/core-utils.ts`, `rerank/simple-reranker.ts` |
| `HARNESS_MEM_RERANKER_ENABLED` | `false` | No | リランク（再スコアリング）機能を有効にするか | `core/core-utils.ts` |
| `HARNESS_MEM_RERANKER_PROVIDER` | `simple` | No | リランクプロバイダー。`simple` / `cohere` / `huggingface` / `sentence-transformers` から選択 | `rerank/registry.ts` |
| `HARNESS_MEM_RERANKER_MODEL` | `""` | No | リランクに使用するモデル名（プロバイダー依存） | `rerank/registry.ts` |
| `COHERE_API_KEY` | `""` | No* | Cohere API キー。`HARNESS_MEM_RERANKER_PROVIDER=cohere` の場合に必要 | `rerank/registry.ts` |
| `HF_TOKEN` | `""` | No* | Hugging Face API トークン。`HARNESS_MEM_RERANKER_PROVIDER=huggingface` の場合に必要 | `rerank/registry.ts` |
| `SENTENCE_TRANSFORMERS_ENDPOINT` | `http://localhost:8080` | No | Sentence Transformers サーバーエンドポイント。`HARNESS_MEM_RERANKER_PROVIDER=sentence-transformers` の場合に使用 | `rerank/registry.ts`, `rerank/st-reranker.ts` |

---

## Managed Backend

マネージド（クラウドホスト型）バックエンドとの連携設定です。

| 変数名 | デフォルト値 | 必須 | 説明 | 使用箇所 |
|--------|-------------|------|------|----------|
| `HARNESS_MEM_BACKEND_MODE` | `local` | No | バックエンドモード。`local`（ローカルのみ）/ `managed`（クラウドのみ）/ `hybrid`（ローカル+クラウド同期）から選択 | `core/core-utils.ts` |
| `HARNESS_MEM_MANAGED_ENDPOINT` | `""` | No* | マネージドバックエンドのエンドポイント URL | `core/core-utils.ts` |
| `HARNESS_MEM_MANAGED_API_KEY` | `""` | No* | マネージドバックエンドの API キー | `core/core-utils.ts` |

> \* `HARNESS_MEM_BACKEND_MODE=managed` または `hybrid` の場合は必須です。

---

## Session

セッションおよびユーザー識別に関する設定です。

| 変数名 | デフォルト値 | 必須 | 説明 | 使用箇所 |
|--------|-------------|------|------|----------|
| `HARNESS_MEM_USER_ID` | OS ユーザー名 | No | ユーザー識別子。未設定時は `USER` / `LOGNAME` / ホスト名の順で自動解決 | `core/core-utils.ts`, `mcp-server/src/auth-inject.ts` |
| `HARNESS_MEM_TEAM_ID` | `HARNESS_MEM_USER_ID` と同値 | No | チーム識別子。未設定時は `user_id` が使用される | `core/core-utils.ts`, `mcp-server/src/auth-inject.ts` |
| `HARNESS_SESSION_ID` | `mcp-session` | No | 現在のセッション ID。MCP 経由で broadcast する際に使用 | `mcp-server/src/tools/session.ts` |
| `HARNESS_CLIENT` | `mcp` | No | クライアント識別子（例: `mcp`, `codex`）。broadcast メッセージに付与される | `mcp-server/src/tools/session.ts` |
| `USER` | OS依存 | No | OS ユーザー名。`HARNESS_MEM_USER_ID` の自動解決フォールバック | `mcp-server/src/auth-inject.ts` |
| `LOGNAME` | OS依存 | No | ログイン名。`USER` のフォールバック | `mcp-server/src/auth-inject.ts` |

---

## 変数一覧（アルファベット順）

| 変数名 | カテゴリ |
|--------|---------|
| `COHERE_API_KEY` | Performance |
| `GDRIVE_SERVICE_ACCOUNT_KEY` | Sync |
| `GITHUB_TOKEN` | Sync |
| `HARNESS_CLIENT` | Session |
| `HARNESS_MEM_ADMIN_TOKEN` | Security |
| `HARNESS_MEM_ANTHROPIC_API_KEY` | LLM |
| `HARNESS_MEM_ANTIGRAVITY_BACKFILL_HOURS` | Ingestion |
| `HARNESS_MEM_ANTIGRAVITY_INGEST_INTERVAL_MS` | Ingestion |
| `HARNESS_MEM_ANTIGRAVITY_LOGS_ROOT` | Ingestion |
| `HARNESS_MEM_ANTIGRAVITY_ROOTS` | Ingestion |
| `HARNESS_MEM_ANTIGRAVITY_WORKSPACE_STORAGE_ROOT` | Ingestion |
| `HARNESS_MEM_BACKEND_MODE` | Managed Backend |
| `HARNESS_MEM_CODEX_BACKFILL_HOURS` | Ingestion |
| `HARNESS_MEM_CODEX_INGEST_INTERVAL_MS` | Ingestion |
| `HARNESS_MEM_CODEX_PROJECT_ROOT` | Ingestion |
| `HARNESS_MEM_CODEX_SESSIONS_ROOT` | Ingestion |
| `HARNESS_MEM_CONFIG_PATH` | Core |
| `HARNESS_MEM_CONSOLIDATION_ENABLED` | LLM |
| `HARNESS_MEM_CONSOLIDATION_INTERVAL_MS` | LLM |
| `HARNESS_MEM_CURSOR_BACKFILL_HOURS` | Ingestion |
| `HARNESS_MEM_CURSOR_EVENTS_PATH` | Ingestion |
| `HARNESS_MEM_CURSOR_INGEST_INTERVAL_MS` | Ingestion |
| `HARNESS_MEM_DB_PATH` | Database |
| `HARNESS_MEM_EMBEDDING_MODEL` | Embedding |
| `HARNESS_MEM_EMBEDDING_PROVIDER` | Embedding |
| `HARNESS_MEM_ENABLE_ANTIGRAVITY_INGEST` | Ingestion |
| `HARNESS_MEM_ENABLE_CAPTURE` | Core |
| `HARNESS_MEM_ENABLE_CODEX_INGEST` | Ingestion |
| `HARNESS_MEM_ENABLE_CURSOR_INGEST` | Ingestion |
| `HARNESS_MEM_ENABLE_GEMINI_INGEST` | Ingestion |
| `HARNESS_MEM_ENABLE_INJECTION` | Core |
| `HARNESS_MEM_ENABLE_OPENCODE_INGEST` | Ingestion |
| `HARNESS_MEM_ENABLE_RETRIEVAL` | Core |
| `HARNESS_MEM_FACT_EXTRACTOR_MODE` | LLM |
| `HARNESS_MEM_FACT_LLM_MODEL` | LLM |
| `HARNESS_MEM_FACT_LLM_PROVIDER` | LLM |
| `HARNESS_MEM_GEMINI_API_KEY` | LLM |
| `HARNESS_MEM_GEMINI_BACKFILL_HOURS` | Ingestion |
| `HARNESS_MEM_GEMINI_EVENTS_PATH` | Ingestion |
| `HARNESS_MEM_GEMINI_INGEST_INTERVAL_MS` | Ingestion |
| `HARNESS_MEM_HOME` | Core |
| `HARNESS_MEM_HOST` | Core |
| `HARNESS_MEM_LLM_PROVIDER` | LLM |
| `HARNESS_MEM_MANAGED_API_KEY` | Managed Backend |
| `HARNESS_MEM_MANAGED_ENDPOINT` | Managed Backend |
| `HARNESS_MEM_OLLAMA_BASE_URL` | Embedding |
| `HARNESS_MEM_OLLAMA_EMBED_MODEL` | Embedding |
| `HARNESS_MEM_OLLAMA_HOST` | LLM |
| `HARNESS_MEM_OPENAI_API_KEY` | LLM |
| `HARNESS_MEM_OPENAI_EMBED_MODEL` | Embedding |
| `HARNESS_MEM_OPENCODE_BACKFILL_HOURS` | Ingestion |
| `HARNESS_MEM_OPENCODE_DB_PATH` | Ingestion |
| `HARNESS_MEM_OPENCODE_INGEST_INTERVAL_MS` | Ingestion |
| `HARNESS_MEM_OPENCODE_STORAGE_ROOT` | Ingestion |
| `HARNESS_MEM_PII_FILTER` | Security |
| `HARNESS_MEM_PII_RULES_PATH` | Security |
| `HARNESS_MEM_PORT` | Core |
| `HARNESS_MEM_RATE_LIMIT` | Security |
| `HARNESS_MEM_RECENCY_HALF_LIFE_DAYS` | Performance |
| `HARNESS_MEM_REMOTE_TOKEN` | Security |
| `HARNESS_MEM_REMOTE_URL` | Core |
| `HARNESS_MEM_RERANKER_ENABLED` | Performance |
| `HARNESS_MEM_RERANKER_MODEL` | Performance |
| `HARNESS_MEM_RERANKER_PROVIDER` | Performance |
| `HARNESS_MEM_RESUME_PACK_MAX_TOKENS` | Embedding |
| `HARNESS_MEM_SEARCH_EXPAND_LINKS` | Performance |
| `HARNESS_MEM_SEARCH_RANKING` | Performance |
| `HARNESS_MEM_SQLITE_VEC_PATH` | Database |
| `HARNESS_MEM_TEAM_ID` | Session |
| `HARNESS_MEM_UI_PORT` | Core |
| `HARNESS_MEM_USER_ID` | Session |
| `HARNESS_MEM_VECTOR_DIM` | Database |
| `HARNESS_SESSION_ID` | Session |
| `HF_TOKEN` | Performance |
| `HOME` | Core |
| `LOGNAME` | Session |
| `NODE_ENV` | Core |
| `NOTION_TOKEN` | Sync |
| `OPENAI_API_KEY` | LLM |
| `SENTENCE_TRANSFORMERS_ENDPOINT` | Performance |
| `USER` | Session |
| `USERPROFILE` | Core |
| `WHISPER_ENDPOINT` | Ingestion |
| `WHISPER_LANGUAGE` | Ingestion |
| `WHISPER_MODEL` | Ingestion |
| `WHISPER_PROVIDER` | Ingestion |
