# Unified Harness Memory 完成計画 v2（情報粒度MAX・UI分離版）

## Summary
この計画は、`Claude Code / Codex / OpenCode` の3環境で同一メモリ機能を1実装で運用するための、実装直前レベルの決定版です。  
`/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/harness-ui` には統合せず、**メモリUIは完全に別アプリ**として新設します。  
既存実装を活かしつつ、未完成部分（OpenCode hooks、実運用級ベクトル検索、テスト網、UI）を埋め、`Claude-mem` 比較で不足している点を解消します。

## 1. 固定決定事項
1. DBは単一固定で `~/.harness-mem/harness-mem.db` を全プラットフォーム共有で使用する。  
2. 書き込み窓口は Bun daemon `harness-memd` のみとし、直接DB書き込みは禁止する。  
3. 検索は `FTS5 + sqlite-vec + recency + 融合ランキング` を標準実装とする。  
4. 既定の privacy 動作は `include_private=false` で `private/sensitive` を除外する。  
5. `block/no_mem` は保存しない。`redact/mask` は保存前にマスキングする。  
6. Codex は `~/.codex/sessions/**/rollout-*.jsonl` 取り込みを標準経路とし、`notify`（after_agent）は低遅延補助、Rules + Skills は運用補助として併用する。  
7. UIは `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/harness-ui` に統合しない。  
8. UIの「TPP」は**挙動・情報設計の参照のみ**とし、AGPL実装コードのコピーは行わない。  

## 2. 完成後アーキテクチャ（決定版）
1. Core Daemon  
`/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/memory-server` がイベント正規化、privacy処理、永続化、インデックス更新、検索、resume生成を担う。  
2. Transport  
`http://127.0.0.1:37888` をローカル限定公開し、MCPは `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/mcp-server/src/tools/memory.ts` からフォワードする。  
3. Adapter  
Claudeは hooks、Codexは sessions ingest（主系）+ notify hook（補助）+ rules+skills、OpenCodeは plugin hooks で同一APIを叩く。  
4. UI  
`/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/harness-mem-ui` を新規作成し、daemon API専用ビューアとして運用する。  

## 3. Public API / 型仕様（最終）
### 3.1 MCP Tools（既存を正式化）
1. `harness_mem_resume_pack(project, session_id?, limit=5, include_private=false)`  
2. `harness_mem_search(query, project?, session_id?, since?, until?, limit=20, include_private=false)`  
3. `harness_mem_timeline(id, before=5, after=5, include_private=false)`  
4. `harness_mem_get_observations(ids[], include_private=false, compact=true)`  
5. `harness_mem_record_checkpoint(session_id, title, content, tags=[], privacy_tags=[])`  
6. `harness_mem_finalize_session(session_id, summary_mode="standard")`  
7. `harness_mem_record_event(event)`  
8. `harness_mem_health()`  

### 3.2 内部HTTPエンドポイント（確定）
1. `GET /health`  
2. `POST /v1/events/record`  
3. `POST /v1/search`  
4. `POST /v1/timeline`  
5. `POST /v1/observations/get`  
6. `POST /v1/checkpoints/record`  
7. `POST /v1/sessions/finalize`  
8. `POST /v1/resume-pack`  
9. `POST /v1/ingest/codex-history`（互換ルート）  
10. `POST /v1/ingest/codex-sessions`（別名）  
11. `POST /v1/admin/reindex-vectors`（新規）  
12. `GET /v1/admin/metrics`（新規）  

### 3.3 共通レスポンス型（固定）
```json
{
  "ok": true,
  "source": "core|merged",
  "items": [],
  "meta": {
    "count": 0,
    "latency_ms": 0,
    "filters": {},
    "ranking": "hybrid_v1"
  }
}
```

### 3.4 Event Envelope（固定）
```json
{
  "event_id": "ulid",
  "platform": "claude|codex|opencode",
  "project": "string",
  "session_id": "string",
  "event_type": "session_start|user_prompt|tool_use|checkpoint|session_end",
  "ts": "ISO8601",
  "payload": {},
  "tags": [],
  "privacy_tags": [],
  "dedupe_hash": "sha256"
}
```

## 4. データモデル / 検索実装仕様
1. テーブルは `mem_sessions`, `mem_events`, `mem_observations`, `mem_tags`, `mem_links`, `mem_observations_fts`, `mem_vectors`, `mem_retry_queue`, `mem_ingest_offsets`, `mem_meta` を維持する。  
2. `UNIQUE(dedupe_hash)` と `platform+project+session_id+created_at` 系複合INDEXを維持・補強する。  
3. `PRAGMA journal_mode=WAL`, `busy_timeout`, 定期 `wal_checkpoint(PASSIVE)` を維持する。  
4. sqlite-vec本体は `mem_vectors` とは別に `mem_vectors_vec`（vec0 virtual table）を追加し、`observation_id` マッピングテーブルで同一ID管理する。  
5. 保存時は `mem_vectors` と `mem_vectors_vec` の二重書き込みを行い、extension未ロード時は `mem_vectors` のみで degraded運用する。  
6. 検索フローは lexical top-k、vector top-k、recency、融合の順で固定する。  
7. 融合式は `final = 0.45 * lexical + 0.40 * vector + 0.15 * recency` を固定する。  
8. recencyは7日半減期指数関数のまま固定する。  
9. 出力は Layer1 search、Layer2 timeline、Layer3 get_observations の3段で展開する。  

## 5. 既存コードへの具体変更（ファイル単位）
| 区分 | パス | 変更 |
|---|---|---|
| Core分割 | `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/memory-server/src/index.ts` | ルーティングと起動処理だけに縮小 |
| Core新規 | `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/memory-server/src/core/*.ts` | 正規化、privacy、ranking、resume、summaryを分離 |
| DB新規 | `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/memory-server/src/db/*.ts` | schema/migration/pragmas/index管理を分離 |
| Vector新規 | `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/memory-server/src/vector/*.ts` | sqlite-vec provider と fallback provider を分離 |
| Ingest新規 | `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/memory-server/src/ingest/codex-sessions.ts` | `~/.codex/sessions/**/rollout-*.jsonl` tail + project分類 |
| Ingest互換 | `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/memory-server/src/ingest/codex-history.ts` | `.codex/history.jsonl` tail（legacy補完） |
| MCP強化 | `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/mcp-server/src/tools/memory.ts` | 新規 admin tool とエラー分類を追加 |
| Daemon CLI | `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/scripts/harness-memd` | `doctor` と `cleanup-stale` を追加 |
| Unified CLI 新規 | `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/scripts/harness-mem` | `setup/doctor/smoke/uninstall` を1コマンド導線として追加 |
| Client CLI | `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/scripts/harness-mem-client.sh` | admin API呼び出しコマンド追加 |
| Claude hooks | `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/scripts/hook-handlers/memory-*.sh` | privacy tag抽出と失敗時requeue metadata追加 |
| Hooks定義 | `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/hooks/hooks.json` | memory hook timeout/retry方針の固定 |
| Codex rules | `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/codex/.codex/rules/harness.rules` | resume/checkpoint/finalize強制文言を明文化 |
| Codex skills | `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/skills/session-init/SKILL.md` | resume pack取得失敗時の標準復旧手順を固定 |
| Codex skills | `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/skills/work/SKILL.md` | checkpoint記録タイミングを明文化 |
| Codex skills | `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/skills/handoff/SKILL.md` | finalize未実行時はhandoff不可ルール追加 |
| OpenCode設定 | `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/opencode/opencode.json` | plugin hooks登録を追加 |
| OpenCode設定 | `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/.opencode/opencode.json` | 同上 |
| OpenCode plugin新規 | `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/opencode/plugins/harness-memory/index.ts` | `chat.message`, `session.idle`, `session.compacted` ハンドラ |
| OpenCode plugin新規 | `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/.opencode/plugins/harness-memory/index.ts` | 配布側テンプレート |
| UI新規 | `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/harness-mem-ui/*` | メモリ専用UIを新設（harness-ui非統合） |
| Quality test 新規 | `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/tests/test-memory-search-quality.sh` | hybrid検索とprivacyの回帰ガードを追加 |

## 6. プラットフォーム別動作仕様
1. Claude Code  
`SessionStart` で `record_event(session_start)` と `resume_pack` 取得、`UserPromptSubmit` で1回注入、`PostToolUse` で `tool_use` 保存、`Stop` で `finalize_session` を固定実行。  
2. Codex  
`~/.codex/sessions` rollout ingest を主系として取り込み、`notify` hook（after_agent）は低遅延反映の補助経路として使う。セッション冒頭で `harness_mem_resume_pack` を必須化し、重要節目で `harness_mem_record_checkpoint`、終了時 `harness_mem_finalize_session` を必須化する。  
3. OpenCode  
plugin hookで `chat.message -> user_prompt/tool_use`、`session.idle -> checkpoint候補`、`session.compacted -> finalize` を捕捉し、すべて daemon APIへ統一投入。  

## 7. Daemon起動停止とゾンビ防止（最終仕様）
1. start  
lock取得、stale lock/pid掃除、既存生存なら再利用、未起動なら起動、health成功まで待機。  
2. stop  
`SIGTERM`、5秒待機、未終了は `SIGKILL`、pid/lock/heartbeat整理。  
3. shutdown  
retry queue drain、WAL checkpoint、DB close、heartbeat final state書き込み。  
4. 競合  
同時起動は lockで直列化、クライアントは既存daemonに自動接続。  
5. orphan対策  
embedding補助プロセスをspawnする実装時のみ child PID管理テーブルを持ち、shutdownで全terminateする。  

## 8. UI分離計画（Harness UI 非統合）
1. 新規アプリとして `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/harness-mem-ui` を作成する。  
2. `harness-mem-ui` は daemon APIだけを使い、`/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/harness-ui` のコンポーネントや状態管理を参照しない。  
3. 初期画面は `Search`, `Timeline`, `Observation`, `Session` の4タブ構成に固定する。  
4. 主要操作は query検索、結果ピン留め、timeline展開、観測詳細表示、session summary閲覧に固定する。  
5. privacy表示は既定でマスク表示とし、`include_private` は明示トグルでのみON可能にする。  
6. UIデザインは claude-mem の情報設計を参考にしつつ、実装コードはゼロから作成する。  
7. 起動コマンドは `bun run dev`、環境変数は `HARNESS_MEM_HOST`, `HARNESS_MEM_PORT` のみ。  

## 9. 並列実装計画（依存関係込み）
### Wave 1（並列開始）
1. Lane A: Core分割とDB migration実装。  
2. Lane B: MCP tools強化とエラーコード統一。  
3. Lane C: Codex rules/skills更新。  
4. Lane D: OpenCode plugin骨格作成。  

### Wave 2（Wave1完了後に並列）
1. Lane A: sqlite-vec provider + fallback provider仕上げ。  
2. Lane B: Claude hooksのprivacy/再試行強化。  
3. Lane C: OpenCode plugin hooks本実装。  
4. Lane D: `harness-mem-ui` 新規実装。  

### Wave 3（統合）
1. Integrationテスト一式。  
2. E2Eクロスプラットフォームテスト。  
3. 100k性能ベンチ。  
4. ドキュメントと運用Runbook更新。  

## 10. テスト計画（実行コマンドまで固定）
### 10.1 Unit
1. dedupe hash一意性。  
2. privacyタグ分岐。  
3. 融合ランキング順序。  
4. daemon lock/pid cleanup。  
5. vector provider切替。  

実装先は `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/memory-server/tests/unit/*.test.ts`。  

### 10.2 Integration
1. daemon APIの全エンドポイント。  
2. MCP -> daemonフォワード。  
3. checkpoint/finalize整合。  
4. codex history ingest offset更新。  
5. OpenCode hookイベントの投入整合。  

実装先は `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/memory-server/tests/integration/*.test.ts` と `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/tests/test-memory-*.sh`。  

### 10.3 E2E
1. Claude記録 -> Codex検索成功。  
2. Codex記録 -> OpenCode検索成功。  
3. OpenCode記録 -> Claude resume注入成功。  
4. `start/stop` 100回でゾンビ0。  
5. daemon強制kill後の自動復帰。  
6. private情報が既定検索で非表示。  
7. UIでsearch/timeline/get_observations一貫動作。  

### 10.4 Performance
1. `resume_pack` p95 < 2.0s。  
2. `search` p95 < 500ms at 100k observations。  
3. daemon cold start < 1.5s。  
4. `ingestCodexHistory` backlog 10k lines < 30s。  

## 11. 受け入れ基準（Definition of Done）
1. 同一 observation ID を3プラットフォームで相互参照できる。  
2. 3プラットフォームすべてで resume pack が自動注入または自動相当導線で必ず適用される。  
3. `ps`, pidfile, lockfile でゾンビ残留が検出されない。  
4. privacy要件が全E2Eで通る。  
5. 既存 Plan→Work→Review を壊さない。  
6. `harness-mem-ui` が単独で起動し、`harness-ui` に依存しない。  

## 12. リスクと対策
1. sqlite-vec環境差異。  
対策は起動時診断、healthに `vector_engine` を明示、degraded時はFTS-onlyで継続。  
2. Codex hooks運用の設定差・payload差異。  
対策は `notify` 契約テスト、rules gate、skills gate、history ingest の四重化。  
3. 一括実装の切り分け難化。  
対策は `HARNESS_MEM_ENABLE_CAPTURE/RETRIEVAL/INJECTION/OPENCODE_HOOKS/UI` のfeature flag分離。  
4. DB肥大化。  
対策は古いraw payload圧縮、アーカイブ、再インデックスジョブ。  
5. ライセンス汚染。  
対策は claude-mem 実装コードの不使用、挙動仕様のみ参照。  

## 13. Assumptions / Defaults
1. 日付基準は 2026-02-14。Codex hooks 実装は利用可能で、標準は `notify`（after_agent）を利用する。  
2. DB既定は `~/.harness-mem/harness-mem.db`。  
3. daemon既定は `127.0.0.1:37888`。  
4. embedding既定はローカル実行モデル、外部API依存なし。  
5. OpenCode hook API は `chat.message`, `session.idle`, `session.compacted` を利用。  
6. UIは `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/harness-mem-ui` 新設で、`/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/harness-ui` 非統合。  
7. claude-mem からの importer は別コマンドとして後付け可能だが、本リリース必須ではない。

---

## 14. 追加確定（Importer/Cutover）
1. Claude-mem importer は `scripts/harness-mem import-claude-mem` で one-shot 実行する。  
2. importジョブ管理APIは以下を正式採用する。  
   - `POST /v1/admin/imports/claude-mem`  
   - `GET /v1/admin/imports/:job_id`  
   - `POST /v1/admin/imports/:job_id/verify`  
3. verify pass 前提で `scripts/harness-mem cutover-claude-mem --job <id> --stop-now` を実行し、Claude-mem を即時停止する。  
4. cutover は process 停止、launch-agent 無効化、既知 JSON 設定内 `claude-mem` 参照の除去を実施する。  
5. import対象は SQLite 直読（`observations`, `session_summaries`, `sdk_sessions`）を優先し、schema introspection で列差異を吸収する。  
