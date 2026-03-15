# Harness-mem 実装マスタープラン

最終更新: 2026-03-15（§52 dependency & tool integration update plan 策定）
実装担当: Codex / Claude（本ファイルを唯一の実装計画ソースとして運用）

> **アーカイブ**: §0-31 → [`docs/archive/`](docs/archive/) | §32-35 → archive | §36-50 → [`Plans-s36-s50-2026-03-15.md`](docs/archive/Plans-s36-s50-2026-03-15.md)（§36 15完了, §37 10完了, §38 12完了, §39 11完了, §40 11完了, §41 3完了, §42 2完了, §43 計画, §44 4完了, §45 6完了, §46 3完了, §47 9完了, §48 2完了, §49 完了, §50 9完了）

---

## 凡例

`[P]` = 並列可 / `cc:TODO` / `cc:WIP` / `cc:完了` / `blocked`

---

## 現在のステータス

**§47 memSearch 直近対話アンカー改善 — 完了 / §48 repo bootstrap 整合化 — 完了 / §49 benchmark claim SSOT remediation — 完了**（2026-03-13）

| 項目 | 現在地 | 根拠 |
|------|--------|------|
| primary gate artifact | 再同期済み | `memory-server/src/benchmark/results/ci-run-manifest-latest.json` は `generated_at=2026-03-12T17:02:35.532Z` / `git_sha=5c009a9` / `model=multilingual-e5` / `all_passed=false`。current truth は最新 rerun に揃った |
| 日本語 companion artifact | 再同期済み | current=`docs/benchmarks/artifacts/s43-ja-release-v2-latest/summary.json`（`96 QA`, `overall_f1_mean=0.6580`, verdict `pass`）、historical=`docs/benchmarks/artifacts/s40-ja-baseline-latest/summary.json`（`32 QA`, `overall_f1_mean=0.8020`）、deprecated=`s40-ja-release-latest` |
| README / proof bar / Plans | 再同期済み | `README.md` / `README_ja.md` / `docs/benchmarks/japanese-release-proof-bar.md` / 本節を current main gate + current companion + historical baseline の3層に揃え、FAIL を PASS と書かない状態へ修正した |
| drift guard | 追加済み | `tests/benchmark-claim-ssot.test.ts` で README / proof bar / Plans / license badge のズレを CI で検知する |
| 維持できている価値 | 強い | local-first multi-tool runtime、hybrid retrieval、Japanese / EN<->JA benchmark investment、recent interaction UX 改善は有効 |
| 次フェーズの焦点 | temporal regression recovery | current main gate の Layer 2 FAIL 是正、watch slice (`current_vs_previous`, `relative_temporal`, `yes_no`, `entity`, `location`) 改善、competitive snapshot 定期更新 |

監査対象:
- `memory-server/src/benchmark/results/ci-run-manifest-latest.json`（main benchmark artifact。current main gate の正本）
- `docs/benchmarks/artifacts/s43-ja-release-v2-latest/summary.json`（current Japanese companion の正本）
- `docs/benchmarks/artifacts/s40-ja-baseline-latest/summary.json`（historical baseline の正本）
- `docs/benchmarks/japanese-release-proof-bar.md`（public claim contract）
- `README.md` / `README_ja.md`（公開 copy 面）
- `package.json` / `LICENSE`（license / metadata 整合面）
- `docs/benchmarks/benchmark-claim-ssot-matrix-2026-03-13.md`（§49 truth matrix）

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

### Success Gates

| Gate | 意味 | 完了条件（DoD） |
|------|------|-----------------|
| Gate A | engineering-complete | `run-ci` が 3 連続 `PASS`、`relative_temporal` / `current_vs_previous` が release blocker から外れ、改善が benchmark 専用ハックではない |
| Gate B | proof-complete | live replay / search sanity / resume parity で no-regression を確認し、artifact / README / proof bar / comparison page が同じ current truth を指す |
| Gate C | packaging-complete | local-first の勝ち筋、commercial boundary、managed / hosted 方針、license FAQ、release surface が外部説明として一貫する |
| Gate D | market-ready | stars ではなく `installs / quickstart completion / demo reproducibility / migration completions` のような leading indicators を測定し、dated competitive snapshot を更新できる |

### Guardrails

- benchmark 専用分岐や hardcode を入れない
- Japanese companion `PASS` で main gate `FAIL` を相殺しない
- hosted を full multi-tenant SaaS 前提で開始しない
- `BUSL-1.1` の変更を engineering 判断だけで確定しない
- `best / leader / unique / perfect` の claim は Gate A-D 完了前に解禁しない

### Workstreams

#### Phase A: Benchmark Winback

- [ ] `cc:TODO` **S51-001 [ops:tdd]**: competitive closure の truth freeze と gate 定義を固定
  - 対象: `Plans.md`, `README.md`, `docs/benchmarks/japanese-release-proof-bar.md`, `docs/benchmarks/competitive-analysis-*.md`
  - DoD: Gate A-D と unlock 条件が dated artifact に基づいて固定される

- [x] `cc:完了` **S51-002 [feature:tdd]**: router の relative temporal / current-vs-previous 判断を回復
  - 対象: `memory-server/src/retrieval/router.ts`, `memory-server/tests/unit/retrieval-router.test.ts`, `memory-server/tests/unit/temporal-anchor.test.ts`
  - DoD: relative anchor canonicalization、query classification、answer hints が watch slice failure に対して改善し、単体テストで question-id 付き回帰を固定する
  - 2026-03-14 follow-up: 英語 `before switching` / `previous` 系の route classification を `timeline` 優先へ補正し、`What was the default region before switching to the new setup?` と `Who was the previous CEO?` の回帰テストを追加

- [x] `cc:完了` **S51-003 [feature:tdd]**: observation-store の temporal / previous-value retrieval を回復
  - 対象: `memory-server/src/core/observation-store.ts`, 関連 core tests
  - DoD: candidate depth、temporal anchor search、current/previous cue 優先、short span extraction が `relative_temporal` / `current_vs_previous` に対して改善する

- [ ] `cc:TODO` **S51-004 [feature:tdd]**: adapter / normalizer で `yes_no / entity / location` を硬化
  - 対象: `tests/benchmarks/locomo-harness-adapter.ts`, `tests/benchmarks/locomo-answer-normalizer.ts`, 各 benchmark tests
  - DoD: `yes_no`, `entity`, `location` が warning line を上回り、relative weekday / short exact span の正規化が再発しない

- [ ] `cc:TODO` **S51-005 [ops:tdd]**: anti-benchmark-hack + live parity guard を追加
  - 対象: live replay tests, search sanity tests, benchmark diff review scripts
  - DoD: `3-run PASS` に加えて live replay no-regression を必須化し、「なぜ改善したか」を slice 別に説明できる

- [ ] `cc:TODO` **S51-006 [ops]**: main gate / companion / failure backlog を再凍結
  - 対象: `memory-server/src/benchmark/run-ci.ts`, benchmark artifacts, proof docs
  - DoD: current main gate が `PASS`、watch slice 数値と failure taxonomy が dated artifact として再生成される

#### Phase B: Proof and Packaging

- [ ] `cc:TODO` **S51-007 [ops]**: live product parity を `resume / search / timeline / graph` で証明
  - 対象: live API checks, smoke tests, parity docs
  - DoD: benchmark 側の改善が live API でも再現し、「ベンチだけ強い」状態を排除できる

- [ ] `cc:TODO` **S51-008 [docs:adr]**: commercial packaging decision を ADR 化
  - 対象: hosted / managed / operator kit の 3 案比較
  - DoD: `full hosted SaaS` ではなく、次に出す offering を 1 つに絞り、repo 内対応と repo 外依存を明文化する

- [ ] `cc:TODO` **S51-009 [docs]**: license / commercial / support / release surface を完成させる
  - 対象: `README.md`, `README_ja.md`, `LICENSE`, `package.json`, `CHANGELOG.md`, 新規 `docs/licensing.md`, `COMMERCIAL.md`, `SUPPORT.md`, `SECURITY.md`
  - DoD: `BUSL-1.1` の許容/制限/Change Date/問い合わせ導線が 1 つの説明体系に統一される

- [ ] `cc:TODO` **S51-010 [docs]**: README と distribution surface を buyer language に再編
  - 対象: README 上部 positioning、badge、keywords、topics、release summary
  - DoD: `local-first multi-tool coding memory runtime` の勝ち筋が 5 分で伝わり、workflow-failure badge が公開 trust を毀損しない

#### Phase C: Competitive Readiness

- [ ] `cc:TODO` **S51-011 [docs]**: dated competitive snapshot を current proof 基準で更新
  - 対象: `docs/benchmarks/competitive-analysis-*.md`, `docs/benchmarks/competitive-audit-*.md`
  - DoD: Mem0 / Supermemory / Graphiti / OpenMemory / claude-mem との比較が official-source + dated metrics で再生成され、unlock claim を再判定できる

- [ ] `cc:TODO` **S51-012 [ops]**: traction proxy を計測可能にする
  - 対象: install verification, quickstart completion, migration completions, demo reproducibility
  - DoD: `stars` ではなく制御可能な leading indicators をダッシュボードまたは dated report で継続観測できる

### 着手順

1. `S51-002 -> S51-003` で `relative_temporal` / `current_vs_previous` を戻す
2. `S51-004` で `yes_no / entity / location` を詰める
3. `S51-005 -> S51-006 -> S51-007` で Gate A/B を閉じる
4. `S51-008 -> S51-010` で packaging / license / distribution surface を揃える
5. `S51-011 -> S51-012` で market-ready 判定と claim unlock を行う

---

## §52 Dependency & Tool Integration Update（依存更新 + 対応ツール最新化）

策定日: 2026-03-15
背景: 7エージェント並列調査により、依存パッケージの最新版・対応ツール5種（Claude Code / Codex CLI / Gemini CLI / OpenCode / Cursor）の仕様変更を洗い出した。

### 調査サマリー

| 対象 | 現在 | 最新 | 緊急度 |
|------|------|------|--------|
| `@modelcontextprotocol/sdk`（root） | ^0.5.0 | 不要（削除推奨） | 高 |
| `@modelcontextprotocol/sdk`（mcp-server） | ^1.27.1 | 1.27.1（最新） | — |
| `@huggingface/transformers` | ^3.8.1 | 3.8.1（v3最終）/ v4.0.0-next.7 | 低（正式版待ち） |
| pg | ^8.13.3 | 8.20.0（semver内） | 低 |
| tesseract.js | ^7.0.0 | 7.0.0（最新） | — |
| pdf-parse | ^2.4.5 | 2.4.5（最新） | — |
| vite | ^7.1.10 | 8.0.0（Rolldown移行） | 中 |
| vitest | ^3.2.4 | 4.1.0 | 中 |
| @vitejs/plugin-react | ^5.1.0 | 6.0.1（Vite 8必須） | 中 |
| jsdom | ^26.1.0 | 28.1.0 | 低 |
| Claude Code hooks | PreToolUse旧形式 | `hookSpecificOutput` 形式 | **高** |
| Codex CLI hooks | 未対応 | 実験的（SessionStart/Stop） | 低 |
| Gemini CLI hooks | 6イベント | +BeforeModel/BeforeToolSelection | 中 |
| OpenCode plugin | 6フック | MCP→フック未発火バグ(#2319) | 中 |
| Cursor hooks | 5イベント | 並列実行+Marketplace | 低 |

### Feature Priority Matrix

| 区分 | 項目 | DoD |
|------|------|-----|
| Required | Claude Code PreToolUse 形式移行 | `hookSpecificOutput.permissionDecision` を使用し、旧 `decision`/`reason` を廃止 |
| Required | ルート MCP SDK 不要依存の削除 | root `package.json` から `@modelcontextprotocol/sdk` を除去 |
| Required | MCP Tool Annotations 追加 | memory 系ツールに `readOnlyHint`/`destructiveHint` を付与 |
| Recommended | Claude Code 新イベント対応 | `PostCompact`/`Elicitation` のフックハンドラー実装 |
| Recommended | Gemini CLI 新イベント対応 | `BeforeModel`/`BeforeToolSelection` のマッピング追加 |
| Recommended | OpenCode MCP フック回避策 | MCP ツール呼び出し時のログ漏れを MCP サーバー側で補完 |
| Recommended | Vitest 3→4 アップグレード | harness-mem-ui テストが Vitest 4 で全パス |
| Optional | Vite 7→8 + plugin-react 6 移行 | Rolldown 移行でビルド高速化、React Compiler 対応 |
| Optional | Cursor Marketplace / SKILL.md 対応 | Cursor 向け配布チャネル拡大 |
| Optional | @huggingface/transformers v4 移行準備 | v4.0.0 正式リリース後に ONNX Runtime 1.24 の恩恵を取り込む |

### 依存グラフ

```
Phase A: Housekeeping（即座実行、並列可）
├── [P] S52-001: ルート MCP SDK 不要依存の削除
├── [P] S52-002: semver 範囲内の依存更新確認
└── [P] S52-003: MCP Tool Annotations 追加
                     │
Phase B: Claude Code Hooks 移行（最優先）
├── S52-004: PreToolUse hookSpecificOutput 形式への移行
├── [P] S52-005: PostCompact / Elicitation イベントハンドラー実装
└── S52-006: Auto Memory (MEMORY.md) との棲み分け方針決定
                     │
Phase C: マルチツール統合強化（並列可）
├── [P] S52-007: Gemini CLI 新イベント対応
├── [P] S52-008: OpenCode MCP フック未発火の補完実装
├── [P] S52-009: Codex CLI hooks エンジン対応準備
└── [P] S52-010: Cursor sandbox.json / Marketplace 対応調査
                     │
Phase D: Frontend 近代化（段階的）
├── S52-011: Vitest 3→4 先行アップグレード
└── S52-012: Vite 7→8 + plugin-react 6 + jsdom 28 同時移行
                     │
Phase E: 将来準備
└── S52-013: @huggingface/transformers v4 移行準備
```

### Phase A: Housekeeping（即座実行可能）

- [x] `cc:完了` **S52-001 [deps]**: ルート package.json から不要な `@modelcontextprotocol/sdk: ^0.5.0` を削除
  - 対象: `package.json`
  - 理由: mcp-server は独自に `^1.27.1` を持ち、ルートの 0.5.0 はどのソースからも import されていない不要な残骸
  - DoD: `npm install` / `bun install` でエラーなし、mcp-server の動作に影響なし

- [x] `cc:完了` **S52-002 [deps]**: semver 範囲内の依存更新を確認・適用
  - 対象: 全サブパッケージの lock ファイル
  - 確認項目: pg 8.20.0（SCRAM-SHA-256-PLUS対応）、react 19.2.4、typescript 5.9.3、@playwright/test 1.58.2
  - DoD: `bun install` 後に全テストパス

- [x] `cc:完了` **S52-003 [mcp]**: MCP Tool Annotations を harness_mem_* ツールに追加
  - 対象: `mcp-server/src/tools/memory.ts`
  - 内容: `harness_mem_search`/`harness_mem_timeline` → `readOnlyHint: true`、`harness_mem_bulk_delete` → `destructiveHint: true`、`harness_mem_record_event`/`harness_mem_ingest` → `idempotentHint: true`
  - DoD: MCP SDK 1.11.0+ の annotations フィールドを使用、クライアント側で確認 UI が改善される

### Phase B: Claude Code Hooks 移行（最優先）

- [x] `cc:完了` **S52-004 [hooks/claude]**: PreToolUse の出力を `hookSpecificOutput` 形式へ移行
  - 対象: `scripts/hook-handlers/pretooluse-guard*`、`hooks/hooks.json` 内の PreToolUse エントリ
  - 背景: Claude Code が `decision`/`reason` トップレベルフィールドを deprecated にし、`hookSpecificOutput.permissionDecision`（`allow`/`deny`/`ask`）と `hookSpecificOutput.permissionDecisionReason` を推奨に変更
  - DoD: 旧形式 `approve`/`block` を `allow`/`deny` に置換、`hookSpecificOutput` 形式で出力、Claude Code 最新版で動作確認

- [x] `cc:完了` **S52-005 [hooks/claude]**: PostCompact / Elicitation イベントのフックハンドラー実装
  - 対象: `hooks/hooks.json`、新規 `scripts/hook-handlers/memory-post-compact.sh`、`scripts/hook-handlers/memory-elicitation.sh`
  - PostCompact: コンパクション完了後にメモリのチェックポイントを記録（PreCompact と対になる）
  - Elicitation: MCP サーバーからのユーザー入力要求をイベントとして記録
  - DoD: hooks.json に新イベント登録、ハンドラーが daemon API にイベント送信

- [x] `cc:完了` **S52-006 [design]**: Claude Code Auto Memory (MEMORY.md) と harness-mem の棲み分け方針を決定
  - 背景: Claude Code v2.1.59+ で Auto Memory がデフォルト有効。harness-mem の外部メモリシステムと機能重複あり
  - 検討項目: `autoMemoryDirectory` 設定による共存、harness-mem 側での MEMORY.md 取り込み、役割分離（短期 vs 長期）
  - DoD: ADR（Architecture Decision Record）として方針を文書化

### Phase C: マルチツール統合強化

- [x] `cc:完了` **S52-007 [hooks/gemini]**: Gemini CLI の新イベント `BeforeModel` / `BeforeToolSelection` 対応
  - 対象: `scripts/hook-handlers/memory-gemini-event.sh`、`gemini/GEMINI.md`
  - 背景: Gemini CLI v0.27.0 で Hooks がデフォルト有効化、新イベントが追加
  - DoD: 新イベントを daemon の event_type にマッピング、GEMINI.md を最新仕様に更新

- [x] `cc:完了` **S52-008 [plugin/opencode]**: OpenCode の MCP ツール呼び出し時フック未発火バグの補完
  - 対象: `opencode/plugins/harness-memory/index.ts`、`mcp-server/src/tools/memory.ts`
  - 背景: OpenCode Issue #2319 — MCP ツール呼び出し時に `tool.execute.before/after` フックが発火しない
  - 方針: MCP サーバー側（memory.ts）で OpenCode 検出時にイベント記録を自律的に行うフォールバックを追加
  - DoD: OpenCode 経由の MCP ツール利用がトラッキングされる

- [x] `cc:完了` **S52-009 [hooks/codex]**: Codex CLI hooks エンジン対応準備
  - 対象: `codex/.codex/`、新規 `codex/.codex/hooks.json`
  - 背景: Codex v0.114.0 で実験的 hooks エンジン追加（SessionStart/Stop のみ）。harness.rules の先頭コメントで移行予定を既にマーク済み
  - DoD: `SessionStart`/`Stop` のフックハンドラーを hooks.json に登録、既存 rules との共存を確認

- [x] `cc:完了` **S52-010 [integration/cursor]**: Cursor sandbox.json 互換性 + Marketplace 対応調査
  - 対象: `.cursor/`
  - 背景: Cursor が sandbox.json（ネットワーク/FS アクセス制御）と Marketplace（プラグインバンドル配布）を導入
  - DoD: sandbox.json で `localhost:37888` 通信許可のテンプレート作成、Marketplace 配布可否の調査レポート

### Phase D: Frontend 近代化

- [ ] `cc:TODO` **S52-011 [deps/ui]**: Vitest 3→4 先行アップグレード
  - 対象: `harness-mem-ui/package.json`、テストファイル群
  - 背景: Vitest 4 は Vite 7 のままでも利用可能（peerDeps: `vite ^6|^7|^8`）
  - DoD: `vitest: ^4.1.0` に更新、全テストパス、breaking changes 対応

- [ ] `cc:TODO` **S52-012 [deps/ui]**: Vite 7→8 + plugin-react 5→6 + jsdom 26→28 同時移行
  - 対象: `harness-mem-ui/package.json`、`harness-mem-ui/vite.config.ts`
  - 背景: Vite 8 は Rollup→Rolldown 移行でビルド数倍高速化。plugin-react 6 は Vite 8 必須。jsdom 28 は Node.js 20.19+ 要件
  - リスク: Rolldown プラグイン互換性、Rollup 固有オプション使用箇所の確認が必要
  - DoD: ビルド・テスト・typecheck 全パス、dev サーバー動作確認

### Phase E: 将来準備

- [ ] `cc:TODO` **S52-013 [deps/future]**: @huggingface/transformers v4 移行準備
  - 対象: `memory-server/package.json`、`memory-server/src/core/local-onnx.ts`
  - 背景: v4.0.0 は現在 next.7 プレリリース。ONNX Runtime 1.21→1.24 によるパフォーマンス改善、@huggingface/tokenizers 新依存
  - トリガー: v4.0.0 正式リリース後に着手
  - DoD: local-onnx.ts の API 互換性確認、embedding 品質のベンチマーク比較、ONNX Runtime ネイティブバイナリ互換性テスト

### 着手順

1. `S52-001 + S52-002 + S52-003`（Phase A 全並列）で housekeeping を片付ける
2. `S52-004`（PreToolUse 移行）を最優先で実施 → `S52-005 + S52-006` を並列
3. `S52-007 + S52-008 + S52-009 + S52-010`（Phase C 全並列）でマルチツール対応
4. `S52-011`（Vitest 4）→ `S52-012`（Vite 8 同時移行）を段階的に
5. `S52-013` は v4.0.0 正式リリースをトリガーとして着手

---

## §53 Technical Debt Remediation（技術的負債の解消）

策定日: 2026-03-15
背景: /simplify の3エージェント並列レビューで検出された技術的負債3件について、3つのアーキテクト・エージェントが並列で解決策を設計した。

### 依存グラフ

```
Phase A: hook-common.sh 共通ライブラリ作成（最優先・他の前提）
├── S53-001: lib/hook-common.sh 新規作成
├── S53-002: codex系2本を移行（最も単純）
├── S53-003: claude系シンプル4本を移行
├── S53-004: claude系複雑3本を移行
└── S53-005: memory-session-start + self-check を移行
                     │
Phase B: Gemini スクリプト統一（Phase A 完了後）
└── S53-006: memory-gemini-event.sh を統一パターンに書き換え
                     │
Phase C: MCP ツール重複解消（独立）
└── [P] S53-007: compress / admin_consolidation_run の共通関数化
```

### Phase A: hook-common.sh 共通ライブラリ（段階的移行）

- [x] `cc:完了` **S53-001 [refactor]**: `lib/hook-common.sh` を新規作成
  - 対象: `scripts/hook-handlers/lib/hook-common.sh`（新規）
  - 内容: 4つの共通関数を実装
    - `hook_init_paths [has_daemon]` — SCRIPT_DIR/PARENT_DIR/CLIENT_SCRIPT/PROJECT_CONTEXT_LIB を解決
    - `hook_init_context [require_input]` — stdin 読み取り + PROJECT_ROOT/PROJECT_NAME 解決
    - `hook_resolve_session_id <platform> [session_file] [mode]` — SESSION_ID 解決を3パターンに統一
    - `hook_check_deps` — CLIENT_SCRIPT/jq の存在チェック
  - DoD: 新規ファイル作成のみ、既存スクリプトは変更しない（リスクゼロ）

- [x] `cc:完了` **S53-002 [refactor]**: codex系2本を hook-common.sh に移行
  - 対象: `codex-session-start.sh`, `codex-session-stop.sh`
  - DoD: 初期化部分を共通関数呼び出しに置換（約22行→6行）、動作維持確認

- [x] `cc:完了` **S53-003 [refactor]**: claude系シンプル4本を移行
  - 対象: `memory-stop.sh`, `memory-post-compact.sh`, `memory-elicitation.sh`, `memory-skill-finalize.sh`
  - DoD: 同上

- [x] `cc:完了` **S53-004 [refactor]**: claude系複雑3本を移行
  - 対象: `memory-post-tool-use.sh`, `memory-user-prompt.sh`, `memory-codex-notify.sh`
  - DoD: プライバシータグ処理など固有ロジックを保持しつつ初期化を共通化

- [x] `cc:完了` **S53-005 [refactor]**: 最も複雑な2本を移行
  - 対象: `memory-session-start.sh`, `memory-self-check.sh`
  - DoD: attempt_daemon_restart 等の複雑なフォールバックを保持しつつ共通化

### Phase B: Gemini スクリプト統一

- [x] `cc:完了` **S53-006 [refactor]**: memory-gemini-event.sh を統一パターンに書き換え
  - 対象: `scripts/hook-handlers/memory-gemini-event.sh`
  - 変更7点:
    1. `set -euo pipefail` → `set +e`（耐障害性向上）
    2. `curl` 直接 → `$CLIENT_SCRIPT record-event` / `finalize-session`
    3. `basename` → `resolve_project_context`（Git ルート解決対応）
    4. SESSION_ID: 環境変数→stdin→session.json→フォールバックの順に統一
    5. ペイロード: `{event:{..., tags:["hook","gemini"]}}` ラッパー追加
    6. `echo '{}'` の Gemini CLI 必須戻り値は維持
    7. `$1` でのイベント名受け取り規約は維持
  - 前提: S53-001 完了後（hook-common.sh を利用）
  - DoD: `bash memory-gemini-event.sh SessionStart < /dev/null` で `{}` 出力、デーモン未起動でも正常終了

### Phase C: MCP ツール重複解消

- [x] `cc:完了` **S53-007 [refactor]**: compress / admin_consolidation_run の共通関数化
  - 対象: `mcp-server/src/tools/memory.ts`
  - 方法（案B採用）: `runConsolidation(input)` 共通関数を追加し、両 case から委譲
  - 追加: `admin_consolidation_run` の annotations を `compress` と統一（`destructiveHint: false, idempotentHint: false` を追加）
  - DoD: typecheck パス、両ツール名は MCP クライアントに引き続き公開

### 着手順

1. `S53-001`（hook-common.sh 作成）→ `S53-002`（codex系移行）で安全に検証
2. `S53-003` → `S53-004` → `S53-005` で段階的に残りを移行
3. `S53-006`（Gemini 統一）は Phase A 完了後
4. `S53-007`（MCP 重複解消）は独立して並列実行可能

### 期待効果

- 初期化コード: 各スクリプト約22行 → 約6行（10本合計で約160行削減）
- SESSION_ID ロジック: 3パターンが1関数に集約、テスト可能に
- バグ修正の伝播: hook-common.sh 1ファイルの修正で全スクリプトに反映
- 新スクリプト追加コスト: 3〜4行の初期化で即使用可能
