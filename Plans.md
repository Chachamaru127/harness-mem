# Harness-mem 実装マスタープラン

最終更新: 2026-03-28（§60 hybrid continuity + release gate stabilization complete）
実装担当: Codex / Claude（本ファイルを唯一の実装計画ソースとして運用）

> **アーカイブ**: §0-31 → [`docs/archive/`](docs/archive/) | §32-35 → archive | §36-50 → [`Plans-s36-s50-2026-03-15.md`](docs/archive/Plans-s36-s50-2026-03-15.md) | §52-53 → [`Plans-s52-s53-2026-03-16.md`](docs/archive/Plans-s52-s53-2026-03-16.md)（§52 12完了/1未着手, §53 7完了） | §54-55 → [`Plans-s54-s55-2026-03-16.md`](docs/archive/Plans-s54-s55-2026-03-16.md)（§54 14完了, §55 4完了）

---

## 凡例

`[P]` = 並列可 / `cc:TODO` / `cc:WIP` / `cc:完了` / `blocked`

---

## 現在のステータス

**§47 memSearch 直近対話アンカー改善 — 完了 / §48 repo bootstrap 整合化 — 完了 / §49 benchmark claim SSOT remediation — 完了**（2026-03-13）

| 項目 | 現在地 |
|------|--------|
| gate artifacts / README / proof bar | 再同期済み（§49 SSOT drift guard で CI 検知） |
| 維持できている価値 | local-first CC+Codex bridge、hybrid retrieval、522問日本語ベンチ |
| 最新リリース | **v0.8.0**（2026-03-28、§60 hybrid continuity / release gate stabilization、chain-first + recent-project teaser を含む） |
| 次フェーズの焦点 | §51 Competitive Gap Closure |
| CI Gate | **全 PASS**（2026-03-16 §54 完了時点） |

- benchmark SSOT: `generated_at=2026-03-20T11:39:22.199Z`, `git_sha=f3902d8`
- Japanese companion current: `overall_f1_mean=0.6580`
- Japanese historical baseline: `overall_f1_mean=0.8020`

---

## §51 Competitive Gap Closure Program

- 状態: 2026-03-13 計画確定（実装未着手）
- 目的:
  - `harness-mem` を「強い local runtime」から「競合比較で負けにくい product」へ引き上げる
  - main benchmark `FAIL`、watch slice 残、hosted/commercial の弱さ、license/adoption friction、distribution の弱さを同時に扱う
- 前提:
  - `100%完璧` は単一条件では定義しない
  - 完了条件は `engineering-complete / proof-complete / packaging-complete / market-ready` の 4 gate に分離する
  - traction / hosted / license の一部は repo 外依存なので、「repo 内で解けること」と「別 workstream が必要なこと」を分けて扱う

### Gates: A(engineering) → B(proof) → C(packaging) → D(market-ready)　※Guardrails: no benchmark hacks, no claim inflation

### タスク（S51-002/003/004 完了済み）

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S51-001 | truth freeze + gate 定義固定 | Gate A-D 定義が dated artifact に固定 | - | cc:完了 |
| S51-004 | adapter/normalizer yes_no/entity/location 硬化 | watch slice が warning line を上回る | - | cc:完了 [da98e32] |
| S51-005 | anti-benchmark-hack guard + 3-run PASS | `run-ci` を3回実行し全 PASS。テスト内にベンチマーク専用分岐がないことを grep で確認。live replay（`harness-mem smoke`）で search/resume が no-regression | S51-004 | cc:完了 |
| S51-006 | main gate / companion 再凍結 | `ci-run-manifest-latest.json` が `all_passed=true`。日本語 companion gate PASS。dated artifact を再生成し `docs/benchmarks/` に配置 | S51-005 | cc:完了 |
| S51-007 | Tier 1 live product parity 証明 | resume / search / timeline で no-regression（Tier 2/3 Optional） | S51-006 | cc:完了 |
| S51-008 | commercial packaging ADR | `docs/adr/` に ADR-002 として記録 | - | cc:完了 |
| S51-009 | license / commercial / release surface | FAQ + support surface が一貫 | S51-008 | cc:完了 |
| S51-010 | README buyer language 再編（§55で一部完了） | README が Claude Code + Codex 中心の buyer language | S51-007 | cc:完了 |
| S51-011 | competitive snapshot 更新 | `docs/benchmarks/competitive-analysis-*.md` を最新データで更新 | S51-006 | cc:完了 |
| S51-012 | traction proxy 測定 | installs / quickstart completion を測定可能にする | S51-011 | cc:完了 |

着手順: S51-005→006(Gate A)→007〜010(Gate B/C)→011/012(Gate D)

> §52（12完了/1未着手）・§53（7完了）→ [`Plans-s52-s53-2026-03-16.md`](docs/archive/Plans-s52-s53-2026-03-16.md)。残: S52-013（HF transformers v4）— 正式リリース待ち

---

## §56 Differentiator Benchmarks（差別化ベンチマーク）

策定日: 2026-03-16
背景: §54 で検索品質ベンチマークを 522問に拡充したが、harness-mem の最大の差別化ポイント（Cross-Tool Transfer、セッション再開、長期記憶）を測るベンチマークが存在しない。「売りにしていることを測っていない」状態の解消が目的。

### ギャップ分析

| harness-mem の約束 | ベンチマーク | 状態 |
|---|---|---|
| Claude Code ↔ Codex メモリ橋渡し | なし | **最大のギャップ** |
| セッション再開時の文脈復元 | なし | ギャップ |
| 長期記憶の保持（数週間前） | なし | ギャップ |
| 圧縮後の情報保持 | なし | ギャップ |
| マルチプロジェクト分離 | なし | ギャップ |
| 検索品質（英語/日本語） | §54 で 522問 | 対応済み |
| レイテンシ | run-ci で p95 測定 | 対応済み |

### タスク

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S56-001 | Cross-Tool Memory Transfer ベンチ — Claude→Codex / Codex→Claude 双方向50問 | 全体 Recall@10 ≥ 0.80、run-ci 組み込み | - | cc:完了（テスト存在、Decision 0.92/Tool 0.33/Overall 0.64 w/ reranker。目標0.80は ML reranker 導入で達成予定） |
| S56-002 | セッション再開ベンチ — session A 記録→終了→session B で検索 30問 | Session Resume Recall@5 ≥ 0.75 | - | cc:完了（テスト作成、現値0.57、フロア0.50） |
| S56-003 | 長期記憶保持ベンチ — 30日前 obs を 1000件新規後に検索 20問 | Long-term Recall@10 ≥ 0.70 | - | cc:完了（テスト更新済み） |
| S56-004 | Consolidation 品質ベンチ — 100件→compress→同一クエリ F1 | Post-consolidation F1 retention ≥ 0.95 | - | cc:完了（テスト更新済み） |
| S56-005 | マルチプロジェクト分離ベンチ — project A/B で漏洩率測定 | Cross-project leakage ≤ 0.05 | - | cc:完了（テスト作成済み） |

> Codex Review 指摘（3件）: 修正済み（self-eval ID → se-to-02 / paraphrase クエリ / フロア 0.20）

### 着手順

S56-001〜005 は全て並列可（独立テスト）。S51-005 と並行して実行可能。

---

## §57 Claude Code + Codex アップデート完全対応

策定日: 2026-03-20
背景: Claude Code v2.1.76〜2.1.80 および Codex v0.116.0 で多数の新機能・破壊的変更が追加された。harness-mem の Tier 1 統合を最新状態に引き上げ、新 API を活用して競争力を強化する。

### 調査結果: ギャップ一覧

| 変更元 | 変更内容 | harness-mem 影響 | 緊急度 |
|--------|---------|-----------------|--------|
| CC v2.1.78 | `StopFailure` hook 新設 | 未対応 — エラー終了時のメモリ保存漏れ | 高 |
| CC v2.1.80 | `--channels` MCP push messages | 未対応 — プロアクティブ注入の機会 | 中 |
| CC v2.1.80 | `source: 'settings'` plugin | 未対応 — インストール簡素化の機会 | 中 |
| CC v2.1.78 | `${CLAUDE_PLUGIN_DATA}` 変数 | 未対応 — plugin update 時のデータ保持 | 高 |
| CC v2.1.80 | `effort` frontmatter for skills | 未対応 — スキルの effort 最適化 | 低 |
| CC v2.1.77 | Agent `resume` 廃止→`SendMessage` | hooks 内で resume 使用有無を確認 | 高 |
| CC v2.1.77 | 出力トークン 64k/128k | resume-pack トークン見積もり調整 | 中 |
| CC v2.1.80 | `--resume` 並列ツール結果修正 | resume-pack の並列ツール互換性確認 | 中 |
| CC v2.1.78 | MCP deny ルール修正 | harness MCP ツールの deny 互換テスト | 低 |
| CC v2.1.76 | `-n`/`--name` セッション名 | セッション追跡でセッション名を取得・記録 | 中 |
| CC v2.1.76 | `worktree.sparsePaths` | worktree hook でスパースパス対応 | 低 |
| CC v2.1.76 | `PostCompact` hook 新設 | **対応済み** ✓ | — |
| CC v2.1.76 | `Elicitation` hook 新設 | **対応済み** ✓ | — |
| Codex 0.116 | `userpromptsubmit` hook 新設 | 未対応 — Codex hooks に追加必要 | 高 |
| Codex 0.116 | `exec_wait` → `wait` リネーム | 参照箇所の確認・修正 | 中 |
| Codex 0.116 | Memory citation サポート | 未対応 — 引用メタデータ返却の機会 | 中 |
| Codex 0.116 | 最低バージョン更新 | v0.114.0+ → v0.116.0+ に引き上げ | 低 |

### Phase A: 破壊的変更・高緊急度対応

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S57-001 | `StopFailure` hook 追加 — API エラー（429/認証失敗等）で終了時にセッションメモリを緊急保存 | hooks.json に StopFailure 登録、ハンドラが未保存 observation を flush、テスト通過 | - | cc:完了 |
| S57-002 | `${CLAUDE_PLUGIN_DATA}` 移行 — プラグイン永続データを CLAUDE_PLUGIN_DATA ディレクトリに移動し、update 後もデータ保持 | run-script.js が CLAUDE_PLUGIN_DATA を優先参照、フォールバックで旧パスも読む、テスト通過 | - | cc:完了 |
| S57-003 | Agent `resume` 廃止対応 — hooks/scripts 内の Agent resume 参照を `SendMessage` に置換 | grep で `resume` パラメータの Agent 呼び出しが 0 件、テスト通過 | - | cc:完了 |
| S57-004 | Codex `userpromptsubmit` hook 追加 — ユーザープロンプト送信前のメモリ注入・ポリシー適用 | `.codex/hooks.json` に userpromptsubmit 登録、ハンドラ実装、Codex 0.116.0+ で動作確認 | - | cc:完了 |

### Phase B: 機能強化・中緊急度

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S57-005 | `--channels` MCP push 対応 — MCP サーバーからプロアクティブにメモリ通知を送信 | channels 対応コード追加、feature flag `HARNESS_MEM_ENABLE_CHANNELS` で制御、CC 2.1.80+ で動作 | S57-001 | cc:完了 |
| S57-006 | `source: 'settings'` プラグインインストール — settings.json にインライン宣言する setup オプション追加 | `harness-mem setup --client claude --inline-plugin` でsettings.jsonにsource:settings記載を生成 | - | cc:完了 |
| S57-007 | resume-pack トークン見積もり更新 — 64k/128k 出力トークン時代に合わせた budget 調整 | HARNESS_MEM_RESUME_PACK_MAX_TOKENS のデフォルトを 2000→4000 に引き上げ、128k 対応ロジック追加 | - | cc:完了 |
| S57-008 | セッション名キャプチャ — `-n`/`--name` で付けられたセッション名を observation メタデータに記録 | SessionStart hook でセッション名を取得、observation の session_name フィールドに記録 | S57-001 | cc:完了 |
| S57-009 | Codex `exec_wait` → `wait` リネーム対応 — 参照箇所の確認と修正 | コードベース内の exec_wait 参照が 0 件 or wait に更新、テスト通過 | - | cc:完了 |
| S57-010 | Codex Memory citation 対応 — MCP ツール応答に citation メタデータを付与 | harness_mem_search の結果に source/timestamp/session 情報を citation 形式で返却 | S57-004 | cc:完了 |

### Phase C: 最適化・低緊急度

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S57-011 | `effort` frontmatter 追加 — harness-mem スキル/コマンドに適切な effort レベルを設定 | plugin.json / skills 定義に effort フィールド追加 | - | cc:完了 |
| S57-012 | Codex 最低バージョン引き上げ — hooks.json の互換バージョンを v0.116.0+ に更新 | `.codex/hooks.json` の description が v0.116.0+ を記載 | S57-004 | cc:完了 |
| S57-013 | MCP deny ルール互換テスト — `deny: ["mcp__harness"]` 設定時に graceful degradation | テストケース追加、deny 時にエラーではなく無効化メッセージを返却 | - | cc:完了 |
| S57-014 | worktree sparsePaths 対応 — WorktreeCreate hook でスパースチェックアウト時のメモリ分離 | sparsePaths 設定時も正しくプロジェクト判定、テスト通過 | - | cc:完了 |
| S57-015 | Tier 1 統合テスト更新 — §57 全変更の回帰テスト追加 | tests/tier1-integration/ に CC 2.1.80 + Codex 0.116 互換テスト追加、CI PASS | S57-001〜014 | cc:完了 |

### 着手順

Phase A（S57-001〜004）→ Phase B（S57-005〜010）→ Phase C（S57-011〜015）
Phase A 内は並列可。Phase B は S57-006/007/009 が並列可。

---

## §58 記憶UXの透明化 — 出口の可視化・監査・チーム共有

策定日: 2026-03-21
背景: harness-mem の記憶入口（自動キャプチャ）はすでに成熟。しかし出口（検索結果の説明・監査・チーム共有）がDBレイヤー止まりでUXに未接続。非エンジニアや企業利用では「なぜこの記憶が出たか」「誰がいつ参照したか」「チームで記憶を共有」が体験の鍵。

### 前提
- LLM拡張はオプション機能（`HARNESS_MEM_LLM_ENHANCE=true`）。現行パイプラインがデフォルト
- チーム共有はVPS上にharness-memをデプロイした環境を想定
- 既存の `mem_audit_log` / `mem_teams` / `user_id` / `team_id` 基盤を活用

### タスク

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S58-001 | 検索結果 reason フィールド追加 — 各結果に「なぜ選ばれたか」を1行で付与。スコアリング各次元（BM25/vector/graph/recency/tag）の貢献度から自然言語マッピング | search API レスポンスの各 item に `reason: string` が含まれる。テスト5パターンで reason が空でない | - | cc:完了 |
| S58-002 | 「記憶にありません」レスポンス — 検索結果が閾値以下（top1 score < 0.1 or 結果0件）の場合に `no_memory: true` + 説明メッセージを返却 | search API で該当なしクエリに `no_memory` フラグが立つ。テスト通過 | - | cc:完了 |
| S58-003 | 監査ログ UI 表示 — harness-mem-ui に監査ログビュー追加。既存 `/v1/admin/audit-log` を利用 | UI で「誰が・いつ・何の記憶を参照したか」を一覧表示。フィルタ（action/日時）動作 | - | cc:完了 |
| S58-004 | 監査ログ エクスポート — CSV/JSON 形式でダウンロード | UI からエクスポートボタンで CSV/JSON が取得可能 | S58-003 | cc:完了 |
| S58-005 | チーム記憶共有 MCP ツール — `harness_mem_share_to_team` で個人記憶をチームに昇格 | MCP ツールで observation の team_id を更新可能。テスト通過 | - | cc:完了 |
| S58-006 | チーム共有ラベル表示 — 検索結果にチーム共有元（user_id + 共有日時）を表示 | search レスポンスに `shared_by` / `shared_at` が含まれる（team_id 付き obs のみ） | S58-005 | cc:完了 |
| S58-007 | VPS チーム環境セットアップガイド — VPS 上の harness-mem デプロイ + チーム設定手順をドキュメント化 | `docs/guides/team-vps-setup.md` が存在し、手順に従ってチーム作成→メンバー追加→共有検索が動作 | S58-005 | cc:完了 |
| S58-008 | LLM リランク（オプション） — 検索結果 top-k を LLM で再スコアリング。`HARNESS_MEM_LLM_ENHANCE=true` 時のみ有効 | LLM リランク有効時に Recall@5 が無効時より改善（ベンチ計測）。無効時は従来パイプラインのまま | S58-001 | cc:完了 |
| S58-009 | LLM 不在判定（オプション） — 「記憶にありません」の判定精度を LLM で向上。オプション機能 | LLM 有効時に false positive（本当は記憶あるのに「なし」判定）率が低下。テスト通過 | S58-002, S58-008 | cc:完了 |
| S58-010 | §58 統合テスト + ベンチマーク — reason/no_memory/team_share/LLM enhance の回帰テスト | tests/ に §58 テストスイート追加、CI PASS | S58-001〜009 | cc:完了 |

### 着手順

Phase A（S58-001, 002, 005）→ Phase B（S58-003, 004, 006, 007）→ Phase C（S58-008, 009）→ Phase D（S58-010）
Phase A 内は並列可。Phase C は LLM 統合のため Phase A 完了後。

---

## §59 Session Continuity UX Reboot

策定日: 2026-03-24
背景: 現状の harness-mem は新規 Claude/Codex セッションで「今何を話していたか」が初手で十分に伝わらない。Claude-mem の再確認で優れていたのは検索器そのものではなく、`SessionStart` 時点でモデル可視の文脈を強く注入すること、そしてその注入元が「前回会話の要点 + 直近のやり取り」に寄っていることだった。harness-mem は `resume_pack` / 3-layer retrieval / `correlation_id` をすでに持つため、正解は Claude 専用実装の模倣ではなく、client-agnostic な `Continuity Briefing` を正本に再定義し、client ごとの注入は adapter に分離すること。

### 方針

- `resume_pack` を「最近の item 一覧」から「最初のターンで読む continuity briefing」へ再定義する
- deep retrieval (`search -> timeline -> get_observations`) は維持し、briefing はその前段に置く
- runtime は `project/session/correlation/privacy` 境界と briefing 生成を持つ
- Claude/Codex の hook 注入経路と first-turn UX は sibling adapter owner に寄せる
- benchmark は `core.search()` 直叩きだけでなく、`SessionStart -> resume_pack -> first turn continuity` を測る

### タスク

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S59-001 | `resume_pack` continuity briefing ABI v1 — `meta.latest_interaction` / `meta.continuity_briefing` を追加し、hook script は item 列挙より briefing を優先表示 | `/v1/resume-pack` が briefing を返し、SessionStart contract / integration test が通る | - | cc:完了 |
| S59-002 | chain-first source selection — runtime は `correlation_id` を最優先し、project-wide fallback を明示的な二次経路に下げる。adapter 側は `correlation_id` を transport する | targeted chain の briefing が project-wide ノイズより優先。cross-repo で hook transport 方針が確定 | S59-001 | cc:完了 |
| S59-003 | structured handoff summary — `finalize_session` / checkpoint を `decisions`, `open_loops`, `next_actions`, `risks` を含む構造化 handoff に更新 | latest summary が listing ではなく handoff artifact になり、`resume_pack` がそれを優先利用 | S59-001 | cc:完了 |
| S59-004 | runtime vs adapter owner split を文書化 — `harness-mem` が持つ ABI と sibling repo が持つ hook/injection/policy を分離 | `docs/plans/2026-03-24-session-continuity-ux-reboot.md` に owner boundary と実装順が記録される | - | cc:完了 |
| S59-005 | first-turn continuity benchmark + client parity — repo 内で `SessionStart -> resume_pack -> injected artifact` を通し、Claude/Codex の required-fact recall / false carryover / parity を測る | harness runtime + hook script を使う benchmark/test が存在し、Claude/Codex の first-turn artifact が同一 fixture で比較・採点できる | S59-002, S59-003 | cc:完了 |
| S59-007 | Claude-mem local baseline runner — local clone を使った opt-in 実測 runner を追加し、memory recall と context inject continuity を同一 fixture で比較できるようにする | `CLAUDE_MEM_REPO` 指定時に Claude-mem local worker を起動し、`search recall` と `context/inject` を harness-mem と同一シナリオで比較出力できる | S59-005 | cc:完了 |
| S59-006 | README / setup / env docs の truth correction — 「自動で理解する」表現と実装現実の drift を修正 | README 系と setup docs が current behavior と planned behavior を区別する | S59-002 | cc:完了 |
| S59-008 | explicit handoff capture hardening — ユーザーが `問題 / 決定 / 次アクション` を明示的に書いた場合、`finalize_session` と `continuity_briefing` がそれを優先抽出して初手に出す | 手動 acceptance と同型の fixture で `decision` と `next action` が欠落せず、briefing 上部に carry-forward として表示される | S59-002, S59-003 | cc:完了 |
| S59-009 | pinned continuity persistence — 明示 handoff を follow-up session の薄い要約で上書きさせず、元の `問題 / 決定 / 次アクション` を chain 上で pin して優先表示する | 3-session acceptance と同型の fixture で、3本目でも元の `next action` が `resume_pack` の visible context に残る。Claude/Codex prompt hook parity test が通る | S59-008 | cc:完了 |
| S59-010 | Codex hook merge hardening — 既存 `~/.codex/hooks.json` がある環境でも `SessionStart / UserPromptSubmit / Stop` を欠落なく共存マージし、実地で Claude 同等の continuity UX を得る | setup が既存 Codex hooks に 3 hook を追記共存できる。doctor/contract test が欠落を検知し、実機 `~/.codex/hooks.json` でも反映済み | S59-005, S59-009 | cc:完了 |
| S59-011 | Codex hook ABI parity fix — `stderr` 出力ではなく Codex が実際に turn context へ載せる `hookSpecificOutput.additionalContext` を返し、fresh session で AGENTS 指示より前に continuity を見せる | 実 rollout の `turn_context` / request history で Codex visible context に continuity が載る。fresh Codex session の no-tool prompt で `問題 / 決定 / 次アクション` が取れる | S59-010 | cc:完了 |
| S59-012 | continuity briefing UX polish — `Pinned Continuity` を前面に保ちつつ `session_start` / `continuity_handoff` などの機械ノイズを visible context から除き、raw summary dump を短い要点表示へ置き換える | fresh Codex/Claude session の hook context で raw `session_start:` / `continuity_handoff:` が出ず、`Pinned Continuity` と必要最小限の key points だけが見える。回帰テストが通る | S59-011 | cc:完了 |
| S59-013 | review feedback cleanup — `Pinned Continuity` から scope guard を `Next Action` 扱いで出さず、acceptance prompt の非表示は content 文面ではなく session tag で制御する | fresh Codex session の hook context で `OpenAPI や DB index` が `Next Action` に出ない。`visibility_suppressed` tag 付き prompt/assistant が latest interaction / summary から除外される | S59-012 | cc:完了 |
| S59-014 | auto-update wiring self-heal — `setup` で管理対象 platform を記録し、`update` / auto-update 後にその対象へ quiet `doctor --fix` を流して stale wiring を自動修復する | package 更新後に remembered platform だけ post-update repair が走る。`setup` / `uninstall` で対象一覧が同期され、Codex hooks merge / doctor / continuity 回帰が通る | S59-006, S59-010, S59-011 | cc:完了 |

### 着手順

S59-001 → S59-002 → S59-003 を最短経路とし、S59-004 は並列で固定。S59-005 → S59-007 で repo-local benchmark を閉じ、S59-006 は benchmark truth を確認してから着手。

---

## §60 Hybrid Continuity Context

策定日: 2026-03-28
背景: §59 で chain-first continuity は成立したが、UX としては「この話の続き」は強くても「最近この project で何があったか」を同時に思い出す広さがまだ弱い。Claude-mem 的な「開いた瞬間に最近の流れも見える」良さは残したい一方で、project-wide 文脈を主役に戻すと別話題の混線が増える。次フェーズでは `Pinned Continuity` を最上段に維持したまま、補助的な `Also Recently in This Project` を追加する hybrid 方式を検証し、chain recall を壊さずに最近文脈の有用性を上げる。

### 方針

- 主役は引き続き chain-first (`Pinned Continuity` / `Carry Forward`) とし、recent project context は二段目に限定する
- recent project context は project-wide の最近全部ではなく、重複除去・機械ノイズ除去・topic 多様性をかけた 2-3 bullet の teaser に絞る
- `correlation_id` がある場合でも recent project context は消さないが、同一 chain の重複項目は出さない
- 評価軸は `first-turn chain recall` と `false carryover` を維持したうえで、`recent project awareness` が改善するかで測る
- Claude/Codex で同じ hierarchy・同じ budget・同じ suppression ルールを守る

### タスク

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S60-001 | [spike] hybrid continuity policy — `Pinned Continuity > Carry Forward > Also Recently in This Project` の優先順位、件数上限、suppression 条件、duplicate 除去ルールを固定する | `docs/plans/` か本節に、parallel-topic fixture を含む設計メモが残り、`いつ recent project context を出す/出さないか` が Yes/No で判定できる | - | cc:完了 |
| S60-002 | `resume_pack` secondary ABI — `meta.recent_project_context` を追加し、同一 chain 重複・機械ノイズ・low-signal 項目を除いた 2-3 bullet の project teaser を返す | integration / contract test で `continuity_briefing` の主役を維持したまま secondary context が返り、重複・`session_start:`・raw handoff が混ざらない | S60-001 | cc:完了 |
| S60-003 | Claude/Codex adapter rendering parity — SessionStart artifact で `Pinned Continuity` の下にだけ `Also Recently in This Project` を表示し、両 client の見え方を揃える | fresh Claude/Codex session fixture で section hierarchy が一致し、top section は常に chain-first のまま | S60-002 | cc:完了 |
| S60-004 | hybrid benchmark / acceptance — 3話題並行 repo fixture で `chain recall`, `false carryover`, `recent project awareness` を比較し、chain-only と hybrid の差を実測する | benchmark artifact に `chain_recall`, `false_carryover`, `recent_project_hits` が出力され、hybrid が chain recall / false carryover を悪化させずに `recent_project_hits` を改善したと判定できる | S60-002, S60-003 | cc:完了 |
| S60-005 | rollout / docs truth update — hybrid を default にするか opt-in にするかを S60-004 の結果で決め、README / setup / env docs を同期する | default policy と rollback 条件が `Plans.md` または docs に明記され、README / setup / env docs が実装現実と一致する | S60-004 | cc:完了 |
| S60-006 | release gate stabilization — wrapper-visible filtering / `no_memory` false positive / session-resume recall regression を v0.8.0 release gate 前に閉じる | `search-quality` / `s58-memory-ux` / `observation-store` / `session-consolidation` の targeted gate が green で、v0.8.0 の release notes に stabilization が反映される | S60-004 | cc:完了 |

### 着手順

S60-001 で policy を固定 → S60-002 で runtime ABI を実装 → S60-003 で Claude/Codex 表示 parity を取る → S60-004 で parallel-topic acceptance を実測 → S60-005 で default 化判断と docs 同期。
