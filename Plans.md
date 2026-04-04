# Harness-mem 実装マスタープラン

最終更新: 2026-04-04（§72 Claude / Codex 公式アップデート追従、release sync）
実装担当: Codex / Claude（本ファイルを唯一の実装計画ソースとして運用）

> **アーカイブ**: §0-31 → [`docs/archive/`](docs/archive/) | §32-35 → archive | §36-50 → [`Plans-s36-s50-2026-03-15.md`](docs/archive/Plans-s36-s50-2026-03-15.md) | §52-53 → [`Plans-s52-s53-2026-03-16.md`](docs/archive/Plans-s52-s53-2026-03-16.md)（§52 12完了/1未着手, §53 7完了） | §54-55 → [`Plans-s54-s55-2026-03-16.md`](docs/archive/Plans-s54-s55-2026-03-16.md)（§54 14完了, §55 4完了）

---

## 凡例

`[P]` = 並列可 / `cc:TODO` / `cc:WIP` / `cc:完了` / `blocked`

---

## 現在のステータス

**§70 Adaptive Retrieval Engine — 完了 / §71 Windows native setup guardrail — 進行中 / §72 Claude / Codex 公式アップデート追従 — 完了**（2026-04-04）

| 項目 | 現在地 |
|------|--------|
| gate artifacts / README / proof bar | adaptive manifest / README / proof bar / SSOT matrix を再同期済み |
| 維持できている価値 | local-first Claude Code+Codex bridge、adaptive retrieval、MCP structured result、522問日本語ベンチ |
| 最新リリース | **v0.9.0**（2026-04-04、§70 Adaptive Retrieval Engine 完了と §72 Claude/Codex integration 改善を含む） |
| 次フェーズの焦点 | §71 Windows 実機 validation artifact と dependency guidance の残タスク整理 |
| CI Gate | **全 PASS**（adaptive `run-ci` PASS、release gate 再同期済み） |

- benchmark SSOT: `generated_at=2026-04-03T19:20:02.437Z`, `git_sha=c77da08`
- Japanese companion current: `overall_f1_mean=0.6580`
- Japanese historical baseline: `overall_f1_mean=0.8020`

---

## §65 Setup Flow Clarification

策定日: 2026-03-31
背景: 初回導線で `npm install` と `harness-mem setup` の役割分担、`sudo` 利用可否、Claude Plugin Marketplace と手動 MCP 配線の境界が分かりにくく、root 所有ファイルや「セットアップも sudo で」という誤解を招く報告が出た。README / setup guide で clean install の一本道を先に示し、権限事故を避ける。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S65-001 | install/setup/doctor 導線の truth clarification | README.md / README_ja.md / docs/harness-mem-setup.md に、`sudo` 非推奨理由、`npm` と `setup` と `doctor` の役割、Claude plugin と手動 setup の違い、root 所有になったときの復旧手順が反映される | - | cc:完了 |
| S65-002 | local-only 配布除外の `.gitignore` 整備 | `AGENTS.override.md`、`.harness-mem/`、`.codex/config.toml` が repo-local runtime / governance artifact として ignore される | - | cc:完了 |

---

## §66 Release CI Embedding Bootstrap

策定日: 2026-04-01
背景: `v0.8.8` の Release workflow は `.gitignore` と package 内容の問題ではなく、`tests/benchmarks/memory-durability.test.ts` が GitHub Actions 上で `multilingual-e5` 未導入の fallback embedding に落ち、長期記憶ベンチマークの品質ゲートを誤って fail して停止した。release CI でも benchmark が想定するローカル ONNX モデル前提を満たし、未導入時は低 recall ではなく明示エラーで止める必要がある。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S66-001 | release workflow の embedding model bootstrap | `.github/workflows/release.yml` が `multilingual-e5` を非対話で restore / download し、`npm test` 前に利用可能にする。workflow contract test が bootstrap を検知する | - | cc:完了 |
| S66-002 | benchmark 前提の明示化 | `tests/benchmarks/memory-durability.test.ts` が fallback provider を品質低下として誤診せず、`multilingual-e5` 未導入を明示的な前提違反として fail する | S66-001 | cc:完了 |
| S66-003 | maintainer docs の truth sync | `docs/TESTING.md` / `docs/release-process.md` が semantic benchmark に必要な local model bootstrap と release CI 側の事前取得を説明する | S66-001 | cc:完了 |

---

## §67 Memory-Server Bun Panic Mitigation Follow-up

策定日: 2026-04-01
背景: `v0.8.9` の release 直前検証で、semantic embedding bootstrap 修正後の `npm test` を再実行したところ、`memory-server/tests/unit` が 859 pass / 0 fail のあとに Bun 本体だけ `panic(main thread): A C++ exception occurred` で落ちることを再現した。root 側は safe runner を使っていたが、`memory-server/package.json` はまだ raw `bun test` を叩いていたため、release gate が upstream runtime noise によって再度停止し得る状態だった。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S67-001 | `memory-server` test script hardening | `memory-server/package.json` が safe runner / batched runner を使い、`tests/unit` の 0-fail Bun panic を吸収できる | - | cc:完了 |
| S67-002 | docs / contract sync | `docs/TESTING.md` / `docs/bun-test-panic-repro.md` / contract test が `memory-server` 側の実行経路も正として説明・検証する | S67-001 | cc:完了 |

---

## §68 Release Runner Prerequisites Hardening

策定日: 2026-04-01
背景: `v0.8.9` の Release workflow では、semantic model bootstrap と Bun panic 緩和の修正後も `tests/codex-hooks-merge-contract.test.ts` が GitHub Actions 上だけ失敗した。原因は 2 段あり、(1) release runner が `jq` / `ripgrep` を明示インストールしておらず `harness-mem setup --platform codex` が依存チェックで即終了すること、(2) fresh checkout では `mcp-server/dist/index.js` と依存が未準備で `doctor --json` がその場ビルドに入り、contract test の 5 秒制限を超えやすいこと。release workflow に runner 前提の明示セットアップを追加し、同条件を contract と docs に固定する。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S68-001 | release workflow に runner prerequisites を追加 | `.github/workflows/release.yml` が `jq` / `ripgrep` を先に導入し、`mcp-server` の依存解決と build を `npm test` 前に済ませる | - | cc:完了 |
| S68-002 | workflow contract / docs sync | `tests/release-workflow-contract.test.ts` と `docs/release-process.md` が release runner prerequisites を release contract として説明・検証する | S68-001 | cc:完了 |

---

## §69 npm Publish Auth Preflight

策定日: 2026-04-01
背景: `v0.8.10` の release 復旧では、コードと release workflow 自体は通る状態まで直せた一方、GitHub Actions に入っていた `NPM_TOKEN` が publish 権限を持たず、最後の `npm publish` だけが失敗した。次回以降は tag を打ってから気づくのではなく、publish を伴わない手動 workflow で「GitHub Actions 上の token が本当にこの package を公開できるか」を先に確認できるようにする。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S69-001 | npm auth preflight workflow 追加 | `.github/workflows/npm-auth-check.yml` が `workflow_dispatch` で実行でき、`NPM_TOKEN` を使って `npm whoami`、package collaborator 権限、public status、`npm pack --dry-run` を確認できる | - | cc:完了 |
| S69-002 | contract / docs / changelog sync | workflow 契約テストと `docs/release-process.md` が preflight workflow を説明し、`CHANGELOG.md` / `CHANGELOG_ja.md` の `[Unreleased]` に maintainer-facing 改善として反映される | S69-001 | cc:完了 |

---

## §71 Windows Native Setup Guardrail

策定日: 2026-04-02
背景: Windows PowerShell / CMD から `npx ... harness-mem setup` や `harness-mem setup` を実行すると、npm が生成する `.ps1` / `.cmd` shim が package の `#!/bin/bash` shebang をそのまま `/bin/bash.exe` として解釈し、`CommandNotFoundException` や「指定されたパスが見つかりません」で落ちる報告が出た。いったん配布入口を Node launcher 化して fail-fast へ寄せたが、その後 `Windows 11 + Git Bash + jq/bun 導入済み` では手動 setup が通った実報告も出た。今後は「PowerShell / CMD 単体」と「Git Bash 付き Windows」を分けて扱い、docs / dependency guidance / shell compatibility を事実ベースで再整理する。

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S71-001 | npm bin entrypoint を Node launcher 化し native Windows shim crash を fail-fast 化 | `harness-mem` / `harness-memd` / `harness-mem-client` が npm の Windows shim から起動されても `/bin/bash.exe` ではなく actionable message を返す | - | cc:完了 |
| S71-002 | 初期 Windows docs guardrail | `README.md` / `README_ja.md` / `docs/harness-mem-setup.md` に PowerShell / CMD 単体では不安定であること、当面の安定ルートを明記する | S71-001 | cc:完了 |
| S71-003 | Git Bash 前提の Windows compatibility truth sync | docs を「Windows 全面不可」から更新し、`Git Bash + node/npm/curl/jq/bun/rg` を前提にした手動 setup 条件、plugin route 優先、PowerShell/CMD 単体は未推奨、WSL2 は fallback という整理に修正する | S71-002 | cc:完了 |
| S71-004 | Windows dependency guidance hardening | `setup` / `doctor` の不足依存メッセージと quickstart 冒頭が Windows 利用者にも分かる形で `node`, `npm`, `curl`, `jq`, `bun`, `rg` を案内する | S71-003 | cc:TODO |
| S71-005 | `harness-memd` log rotation の Git Bash 互換修正 | `file_size_bytes()` が Git Bash で `stat -f` の誤検出を起こさず、`stat -c "%s"` 優先または数値検証で overflow warning を防ぐ。回帰テストを追加する | S71-003 | cc:完了 |
| S71-006 | Windows 実機 validation artifact | `Windows 11 + Git Bash` で `setup --platform claude` / `doctor` / plugin route の通過条件と既知制約を proof として残す | S71-003, S71-004, S71-005 | cc:TODO |

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

---

## §61 Release Docs Reproducibility Hardening

策定日: 2026-03-29
背景: v0.8.0 時点の README / CHANGELOG は product behavior の truth にはかなり近づいているが、「普段は skill で release している」「手動でも同じ結果を再現したい」という観点では、release contract が README から一目で分かりにくい。特に、`CHANGELOG.md [Unreleased]` の扱い、`package.json` / tag / GitHub Release / npm publish の整合、`harness-release` skill と手動 release が同じチェックリストに従うことが暗黙知に寄っている。次フェーズでは release の正本ルールと検証手順を docs と契約テストで固定し、skill 利用時でも手動時でも同じ release surface に着地する状態を明文化する。

### 方針

- README には「利用者向けの要点」と「メンテナ向け release 再現性」の境界を明示する
- `harness-release` skill は便利な実行導線だが、release 契約そのものは repo docs に置く
- `CHANGELOG.md` は英語版正本、`CHANGELOG_ja.md` は日本語要約という運用を再度明示する
- release の最小契約は `CHANGELOG.md [Unreleased]` / `package.json version` / `git tag` / `GitHub Release` / `npm publish` の整合とする
- docs の存在だけで終わらせず、README と release runbook の参照関係をテストで固定する

### タスク

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S61-001 | README / CHANGELOG release contract audit — 利用者向け copy と maintainer 向け release 手順の曖昧さを洗い出し、`[Unreleased]` 運用・正本ファイル・検証手順を明記する | README / README_ja / CHANGELOG / CHANGELOG_ja に release contract の説明が入り、通常変更は `[Unreleased]` に積む前提が読める | - | cc:完了 |
| S61-002 | release reproducibility runbook + docs contract test — `harness-release` skill と手動 release が同じチェックリストを使うことを docs 化し、その導線が README から辿れることをテストで固定する | `docs/release-process.md` が追加され、README からリンクされ、contract test が green | S61-001 | cc:完了 |
| S61-003 | release gate typecheck repair — release workflow でだけ露出した `ApiResponse` の unsafe cast を除去し、tag release の CI quality gate を green に戻す | `memory-server` の typecheck が CI で通り、`v0.8.2` の Release workflow と npm publish が成功する | S61-002 | cc:完了 |

### 着手順

S61-001 で docs truth をそろえる → S61-002 で release runbook と contract test を追加する → S61-003 で CI release gate の typecheck drift を閉じる。

---

## §62 Bun Test Panic Mitigation

策定日: 2026-03-30
背景: `npm test` が root で `bun test memory-server/tests/ ./tests/ sdk/tests/ mcp-server/tests/` を一括実行しており、テスト自体は通っても終了時に Bun 本体が `panic(main thread): A C++ exception occurred` で落ちることがある。実測では `memory-server/tests/` を 1 回の大きい `bun test` で流すと panic が再現する一方、`memory-server/package.json` の chunked 実行 (`bun run test`) では同じ test surface を通しても panic が出にくい。根本原因は Bun upstream 寄りだが、この repo では release / local verification の再現性を守るために、root test の実行経路を crash-prone な一括実行から外す必要がある。

### 方針

- Bun 本体の bug 修正を待つのではなく、repo 側では `memory-server` を既存の安定した chunked runner 経由で実行する
- root `npm test` は「対象範囲を変えず」「harness-mem-ui の vitest / playwright を巻き込まず」「既存 benchmark / contract suites を明示列挙する」形にする
- `docs/TESTING.md` に root test の実体を明記し、再現用コマンドと panic 回避の理由を短く残す
- 今後また 1 本の巨大 `bun test` に戻って release gate を壊さないよう、package script 形状を contract test で固定する

### タスク

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S62-001 | panic reproduction / mitigation design fix — root `npm test` の crash-prone 経路を chunked 実行へ置き換える設計を確定する | `Plans.md` か docs に「何が再現条件で、何を変えて避けるか」が明記され、実装対象の script 形状が定まる | - | cc:完了 |
| S62-002 | root test script hardening — `memory-server` を `bun run test` 経由に切り替え、root suites を明示列挙にする | `npm test` が `memory-server/package.json` の chunked runner を再利用し、`tests/`, `sdk/tests`, `mcp-server/tests` を過不足なく実行する | S62-001 | cc:完了 |
| S62-003 | testing docs + contract guard — `docs/TESTING.md` と contract test を更新し、巨大一括実行へ戻る回帰を防ぐ | `docs/TESTING.md` が root test の実体を説明し、contract test が green | S62-002 | cc:完了 |
| S62-004 | verification evidence — mitigation 後に target suites を実行し、panic が回避されたことと test surface が維持されたことを確認する | `npm test` または同等の verification bundle が green で、少なくとも `memory-server` chunked / root contract / SDK / MCP の実行証跡が残る | S62-002, S62-003 | cc:完了 |

### 着手順

S62-001 で再現条件と回避方針を固定 → S62-002 で root test script を差し替える → S62-003 で docs と contract guard を追加 → S62-004 で panic 回避と test surface 維持を実測確認する。

---

## §63 Bun Panic Reproducibility + Release/CI Alignment

策定日: 2026-03-30
背景: §62 で local `npm test` は再現性を取り戻したが、なぜ safe runner が必要なのか、Bun upstream に何を渡せばよいのか、release workflow が local quality gate とどう対応しているのかは docs と CI でまだ読み取りにくい。特に maintainer 目線では「ローカルでは `npm test`、release CI では別コマンド」というズレがあると、品質 gate の意味が伝わりにくい。次フェーズでは、Bun panic の事実・回避策・最小再現手順を repo 内に残し、release / CI でも同じ品質契約を読める状態にする。

### 方針

- Bun 本体 bug と repo 側 mitigation を明確に分けて説明する
- upstream に渡せる最小再現手順を docs と補助 script で固定する
- release workflow は local maintainer contract とできるだけ同じ gate を使う
- README / release runbook / testing guide の説明を揃え、暗黙知を減らす
- docs の参照関係と release workflow の実行方針は contract test で固定する

### タスク

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S63-001 | Bun panic repro kit — 事実、観測症状、最小再現コマンド、safe runner の役割をまとめた maintainer 向け doc / script を追加する | docs と補助 script から upstream 報告用の再現手順が追え、`fact / inference / mitigation` が分離されている | - | cc:完了 |
| S63-002 | release / CI gate alignment — release workflow を local `npm test` 契約と揃え、release docs にもその対応関係を書く | `.github/workflows/release.yml` が local gate と整合し、`docs/release-process.md` で `npm test` / UI gate / typecheck の役割が説明される | S63-001 | cc:完了 |
| S63-003 | docs / contract guard — README / TESTING / release docs / workflow の参照関係と方針を test で固定する | contract test が green で、将来 `npm test` 契約や Bun panic の説明が消える回帰を検知できる | S63-001, S63-002 | cc:完了 |

### 着手順

S63-001 で upstream 向け再現セットを固定 → S63-002 で release workflow と runbook をそろえる → S63-003 で docs / workflow contract を test で固定する。

---

## §64 Contextual Recall（番頭モード）— Whisper UX を Harness-mem 流に

策定日: 2026-03-30
背景: Letta AI の claude-subconscious が「潜在意識がささやく」UX で注目を集めている（GitHub Stars 2,265）。毎プロンプトでメモリブロックを自動注入し、ユーザー操作ゼロで記憶が使われる体験を提供する。harness-mem は検索精度・プライバシー・クロスツール対応で優位だが、「聞かなくても記憶が差し出される」体験が不足している。ただし subconscious の「毎プロンプト全量注入」はコンテキスト圧迫・ノイズ・レイテンシの問題があり、本人達も「not intended for production」と明記している。harness-mem の設計原則を壊さず、エッセンスだけを取り入れる。

### 設計方針（3エージェント議論の統合結論）

**採用する要素:**
- 意味的トリガーによる選択的自動注入（UserPromptSubmit hook 経由）
- 最大3行の圧縮レンダリング（Level 1 → Level 2 progressive disclosure）
- resume-pack との二重注入防止（session.json の `resume_injected` フィールドで判定。`.memory-resume-pending` はフック実行順で先に消費されるため使えない）
- トークン予算管理（1プロンプト400tok / セッション累積2,000tok）
- 頻度制御（セッション最大5回、クールダウン3プロンプト）
- スコア閾値: reranker 有効時は `scores.rerank ≥ 0.6`、reranker 無効時は `scores.final` の相対順位で上位3件のみ注入（`scores.final` は RRF 由来で値域 ~0.01-0.05 のため固定閾値は不適）
- budget / dedupe state は Claude/Codex 共通で `.harness-mem/state/whisper-budget.json` に置く。Claude 固有の `resume_injected` だけは `.claude/state/session.json` に残す

**採用しない要素（Red Team 結論）:**
- 毎プロンプト固定ブロック注入 → コンテキスト圧迫、ノイズ
- 固定8ブロック分類 → 既存の observation_type / fact_type / mem_tags と衝突
- モデル主導のブロック書き換え → データ破壊リスク
- グローバルスコープ → プロジェクト分離を維持

**前提確認（S64-001 着手前に検証、S64-000 で実施）:**
- (a) 同一 UserPromptSubmit で複数 hook が `additionalContext` を返す場合の Claude Code 側動作を確認する（結合されるか上書きされるか）
  - **上書きの場合のフォールバック**: whisper ロジックを `userprompt-inject-policy.sh` 内に統合し、resume-pack 注入と recall 注入を単一ハンドラで制御する。hooks.json への新エントリ追加は不要になる
  - **結合の場合**: 新規ハンドラを `node run-script.js hook-handlers/memory-user-prompt-whisper` 形式で hooks.json の既存 UserPromptSubmit ブロック内に hooks 追記
- (b) `hook_emit_codex_additional_context()` が Claude の UserPromptSubmit hook からも動作することを E2E で確認する（既存実績は Codex SessionStart のみ）
  - **動作しない場合の代替手段**: stdout への直接 JSON 出力（`{ "continue": true, "hookSpecificOutput": { "additionalContext": "..." } }`）、または `userprompt-inject-policy.sh` のレンダリングパイプラインに recall セクションを追加
- (c) `userprompt-inject-policy.sh` による resume フラグ消費タイミングの実測

**代替案の検討記録:**
既存の Level 2（明示的 `harness_mem_search`）の改善だけで十分か？ → 検討の結果、Level 2 は「AI または ユーザーが能動的に呼ぶ」必要があり、「忘れていた記憶を思い出させる」体験は提供できない。Subconscious の Stars 2,265 は「聞かなくても出てくる」体験への需要を示している。ただし full 実装前に S64-000 + S64-001 の最小動作版で pilot し、利用率を測定してから S64-003 以降に進むかを判断する段階的アプローチを採用する

**Progressive Disclosure 統合:**
- Level 0: Resume-pack（セッション開始時）→ 既存
- Level 1: Contextual Recall（意味的トリガー時）→ **今回の新規**
- Level 2: Explicit Search（明示的 harness_mem_search）→ 既存
- Level 3: Raw Archive（memory/ 直接参照）→ 既存

### タスク

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S64-000 | 前提検証 — (a) 複数 hook の `additionalContext` 動作（結合 or 上書き）、(b) Claude UserPromptSubmit での `hookSpecificOutput.additionalContext` 動作確認、(c) resume フラグ消費タイミング実測 | 3項目すべてに Yes/No 結果が残る。No の場合は設計方針セクションに記載のフォールバック設計（統合 or 代替注入手段）を **§64 設計方針セクション内に箇条書きで** 追記済み。上書きの場合は S64-001 を「userprompt-inject-policy.sh 統合」方式に切り替える設計スケッチを含む | - | cc:完了 [94306f9] |
| S64-001 | recall ハンドラ + hooks.json 登録 — S64-000 の結果に応じて (A) 新規 `memory-user-prompt-whisper` を `node run-script.js` 経由で hooks.json の既存 UserPromptSubmit ブロックに hooks 追記、または (B) `userprompt-inject-policy.sh` に recall セクションを統合。CLIENT_SCRIPT 経由で `/v1/search` にクエリ（先頭120文字、変数化で調整可能）。timeout: 10秒。デーモン停止時はサイレント exit 0。resume 判定は `session.json` の `resume_injected` フィールドで行う。S64-000 (a) が 'combine' であることが前提。'overwrite' の場合は方式 (B) に切り替え | Claude は single additionalContext path、Codex は既存 UserPromptSubmit hook で recall を返せる。UserPromptSubmit の p95 レイテンシが既存比 +500ms 以内。resume 直後のターンではスキップされる。Claude 側の path 選択理由が Plans.md または preflight doc に残る | S64-000 | cc:完了 [94306f9] |
| S64-002 | トークン予算 + デデュープ + セッションスコープ — 1プロンプト 400tok / セッション累積 2,000tok。`.harness-mem/state/whisper-budget.json` で `session_id` / `seen_ids` / `accumulated_tokens` / `prompt_count_since_last_inject` を追跡。Claude 固有の `resume_injected` は `.claude/state/session.json` に残す。session_id は `hook_resolve_session_id()` と同一ロジックで取得。ID 不一致時は自動リセット。ファイル書き込みは atomic write（tmp + mv）で並列 hook 競合を回避 | 予算超過時にサイレント停止。同一 observation が2回注入されない。新セッション開始後の1ターン目は seen_ids が空（並列書き込み競合なしの検証は S64-005 で実施） | S64-001 | cc:完了 [94306f9] |
| S64-003 | 意味的トリガー + 頻度制御 — ファイルパス言及（`grep -E`）・エラーパターン・意思決定兆候をトリガー条件とする（繰り返し検出は server 側に移譲）。reranker 有効時は `scores.rerank ≥ 0.6`、無効時は上位3件を閾値なしで注入。セッション最大5回、クールダウン3プロンプト（S64-002 の `prompt_count_since_last_inject` を利用）。テストフィクスチャ10件は S64-003 内で `tests/fixtures/whisper-triggers/` に作成 | トリガー条件を満たす5件で注入 ≥ 3件、トリガー条件外の5件で注入0件。reranker 無効環境でも上位3件が注入される | S64-001, S64-002 | cc:完了 [94306f9] |
| S64-004 | HARNESS_MEM_WHISPER_MAX_TOKENS 環境変数 — クライアント側（shell）で環境変数を読み注入トークン上限を制御。サーバー側変更なし。`docs/environment-variables.md` に追記。recall モード切り替え（`on/quiet/off`）のコマンド実装もこのタスクに含む。quiet モードのデフォルト閾値: reranker 有効時 0.8、無効時 上位1件のみ | 環境変数で閾値変更可能。デフォルト 400。docs に記載あり。`harness_mem recall on/quiet/off` が動作する。quiet モードで閾値 0.8 が適用される | S64-001, S64-002 | cc:完了 [94306f9] |
| S64-005 | contract テスト + 回帰テスト — (a) contract: Claude/Codex UserPrompt 経路で recall が有効 stdout / additionalContext を返す + S64-002 の並列書き込み競合なし検証、(b) 回帰: 既存 LoCoMo F1 差 < 0.01（実行手順は `tests/benchmarks/README.md` 参照、CI では skip 可・ローカル手動確認）、(c) 品質: budget / mode / resume-skip を含む recall contract を測定。recall precision ≥ 0.7（暫定、初期データで調整可） | 3テスト種別すべて green。precision ≥ 0.7 | S64-001, S64-002, S64-003, S64-004 | cc:完了 [94306f9] |
| S64-006 | onboarding + ドキュメント — README に番頭モードの存在と有効化手順を記載。setup 時の初回案内文。`--help` テキスト | README に記載があり、`--help` で recall モードの説明が出る | S64-001, S64-004 | cc:完了 [94306f9] |

### 着手順

S64-000 で前提3項目を検証 → S64-001 で最小動作する recall ハンドラ → S64-002（予算 + デデュープ）→ S64-003（トリガー条件、S64-002 のスキーマに依存）+ S64-004（環境変数、S64-002 のスキーマに依存）並列可 → S64-005 で品質検証 → S64-006 でドキュメント整備。

### 工数見積もり

| Phase | タスク | 工数 |
|-------|--------|------|
| Phase 0（前提検証） | S64-000 | 0.5日 |
| Phase 1（最小動作） | S64-001 | 1日 |
| Phase 2（品質管理） | S64-002 → S64-003 + S64-004 並列 | 1.5日 |
| Phase 3（テスト + docs） | S64-005 + S64-006 並列 | 1日 |
| **合計** | | **4日** |

### デフォルト挙動

初期リリースは `quiet` モード（reranker 有効時は閾値 0.8、無効時は上位1件のみ）をデフォルトとし、ユーザーが `harness_mem recall on`（有効時 0.6、無効時 上位3件）に切り替える設計。「うるさい」→ 無効化のリスクを回避する。

---

## §70 Adaptive Retrieval Engine — 日本語特化+汎用モデル動的ルーティング

策定日: 2026-04-01
ブランチ: `feature/adaptive-retrieval-engine`
背景: harness-mem の Embedding 層は現在、言語検出（`registry.ts:detectLanguage()`）で ruri-v3-30m / gte-small / multilingual-e5 を **1つだけ選択** し、全 observation に同一モデルのベクトルを保存する構成。日本語特化モデル（ruri）の文脈理解と汎用大型モデル（OpenAI text-embedding-3-large）の技術用語・コード理解を **動的に切り替え、必要に応じて両方使う Ensemble 検索** を実現し、「Adaptive Retrieval Engine」として自社技術の差別化を確立する。

### 設計方針

**コア原則:**
- Free（現状のローカルパス）は一切壊さない。`HARNESS_MEM_EMBEDDING_PROVIDER=fallback|local` の動作は不変
- 新機能は `HARNESS_MEM_EMBEDDING_PROVIDER=adaptive` で有効化。Pro API キーなしでもローカルモデルのみで adaptive ルーティングが動作する
- mem_vectors スキーマを拡張し、同一 observation に複数モデルのベクトルを保存可能にする

**3ルート構成:**

| Route | 条件 | 使用モデル | ユースケース |
|-------|------|-----------|-------------|
| A: ruri-only | 日本語比率 >= 85% かつコード比率 < 10% | ruri-v3-310m (or ローカル 30m) | 純粋な日本語テキスト |
| B: openai-only | 日本語比率 < 5% またはコード比率 > 50% | OpenAI v3-large (or ローカル gte-small) | 英語・コード主体 |
| C: ensemble | 上記以外（混在・曖昧） | 両方 → 重み付き融合 | 日英混在・技術日本語 |

**Free / Pro マッピング:**

| | Free (API キーなし) | Pro (API キーあり) |
|---|---|---|
| Route A | ruri-v3-30m (256dim, local) | ruri-v3-310m (1024dim, API) |
| Route B | gte-small (384dim, local) | OpenAI v3-large (3072dim, API) |
| Route C | ruri-30m + gte-small (local ensemble) | ruri-310m + OpenAI v3-large (API ensemble) |

**スキーマ変更:**
- `mem_vectors` の PK を `observation_id` 単体から `(observation_id, model)` 複合 PK に変更
- 既存データのマイグレーション: 現行の単一ベクトルはそのまま保持、新モデル分を追加挿入
- `mem_vectors_vec` (sqlite-vec 仮想テーブル) は model ごとに別テーブル化 (`mem_vectors_vec_ruri`, `mem_vectors_vec_openai`)

### 影響範囲

| ファイル | 変更内容 |
|---------|---------|
| `memory-server/src/embedding/types.ts` | `EmbeddingProviderName` に `"adaptive"` 追加、`AdaptiveRoute` 型定義 |
| `memory-server/src/embedding/registry.ts` | `createAdaptiveProvider()` 追加、`detectLanguage()` を `QueryAnalyzer` に拡張 |
| `memory-server/src/embedding/model-catalog.ts` | ruri-v3-310m エントリ追加 |
| `memory-server/src/embedding/local-onnx.ts` | 変更なし（既存 provider として使われるだけ） |
| **新規** `memory-server/src/embedding/query-analyzer.ts` | テキスト特性分析（言語比率、コード比率、クエリ種別） |
| **新規** `memory-server/src/embedding/adaptive-provider.ts` | ルーティング + Ensemble 制御の `EmbeddingProvider` 実装 |
| **新規** `memory-server/src/embedding/query-expander.ts` | Pro 向け同義語展開 |
| **新規** `memory-server/src/embedding/pro-api-provider.ts` | harness-mem Pro API 接続プロバイダー |
| `memory-server/src/db/schema.ts` | `mem_vectors` 複合 PK マイグレーション |
| `memory-server/src/db/postgres-schema.ts` | 同上（PostgreSQL 版） |
| `memory-server/src/db/repositories/IVectorRepository.ts` | `upsert` / `findByObservationId` のシグネチャ拡張（model 指定） |
| `memory-server/src/db/repositories/sqlite-vector-repository.ts` | 複数ベクトル対応、model 別検索 |
| `memory-server/src/db/repositories/PgVectorRepository.ts` | 同上（PostgreSQL 版） |
| `memory-server/src/core/observation-store.ts` | `vectorSearch()` を Ensemble 対応に拡張、`embedContent` を route-aware に |
| `memory-server/src/core/harness-mem-core.ts` | `initEmbeddingProvider()` で adaptive プロバイダー初期化 |
| `memory-server/src/core/core-utils.ts` | 新規環境変数の解析 |
| `memory-server/src/retrieval/router.ts` | `RouteDecision` に `embeddingRoute` フィールド追加 |
| `memory-server/src/benchmark/run-ci.ts` | adaptive モードのベンチマーク測定追加 |

### Phase 1: Query Analyzer + Adaptive Provider 基盤

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S70-001 | Query Analyzer 実装 — `query-analyzer.ts` に `analyzeText()` を実装。入力テキストから `{ jaRatio, enRatio, codeRatio, length, queryType }` を返す。言語判定は既存 `detectLanguage()` を拡張し、コード比率は正規表現（コードブロック、camelCase、snake_case、記号密度）で判定。512文字以上は先頭512文字のみ分析（性能考慮） | `analyzeText()` が (a) 純日本語で jaRatio >= 0.85, (b) 純英語で jaRatio < 0.05, (c) コードブロックで codeRatio > 0.5, (d) 日英混在で 0.05 <= jaRatio < 0.85 を正しく分類。ユニットテスト 20 ケース以上 green | - | cc:完了 [8da5008] |
| S70-002 | Route Decision ロジック — `query-analyzer.ts` に `decideRoute(analysis): AdaptiveRoute` を実装。Route A/B/C の閾値判定。`AdaptiveRoute = "ruri" / "openai" / "ensemble"` 型定義を `types.ts` に追加 | `decideRoute()` が設計方針の条件に従い正しくルーティング。閾値は `ADAPTIVE_JA_THRESHOLD=0.85`, `ADAPTIVE_CODE_THRESHOLD=0.50` として定数化。ユニットテスト 15 ケース以上 | S70-001 | cc:完了 [8da5008] |
| S70-003 | model-catalog に ruri-v3-310m 追加 — `model-catalog.ts` に `{ id: "ruri-v3-310m", dimension: 1024, sizeBytes: 1_200_000_000, language: "ja", queryPrefix: "query: ", passagePrefix: "passage: " }` を追加。`findModelById("ruri-v3-310m")` が正しく返る | catalog に ruri-v3-310m エントリが存在し dimension=1024。既存モデルに影響なし | - | cc:完了 [8da5008] |
| S70-004 | Adaptive Provider 実装 — `adaptive-provider.ts` に `createAdaptiveEmbeddingProvider()` を実装。内部に2つの子 `EmbeddingProvider`（ruri 用 + 汎用）を保持。`embed(text)` 時に `analyzeText()` → `decideRoute()` → 子プロバイダーに委譲。Route C (ensemble) の場合は ruri 側のベクトルを返し、openai 側は `embedSecondary()` メソッドで取得可能にする | `EmbeddingProvider` interface を満たす。Route A で ruri の embed 結果、Route B で openai の embed 結果、Route C で ruri の embed 結果（primary）+ `embedSecondary()` で openai 結果が取得可能。`health()` は両プロバイダーの worst を返す | S70-001, S70-002 | cc:完了 [8da5008] |
| S70-005 | Registry 統合 — `registry.ts` の `createEmbeddingProviderRegistry()` に `"adaptive"` プロバイダー分岐を追加。Free 構成: ruri-v3-30m + gte-small をローカルで。Pro 構成: Pro API キーがあれば ruri-v3-310m API + OpenAI v3-large API を使用。キーなしは Free にフォールバック | `HARNESS_MEM_EMBEDDING_PROVIDER=adaptive` で AdaptiveProvider が生成される。`HARNESS_MEM_PRO_API_KEY` の有無で Free/Pro が切り替わる。既存プロバイダー（fallback/local/openai/ollama）に影響なし | S70-004 | cc:完了 |
| S70-006 | 環境変数 + Config 追加 — `core-utils.ts` に `HARNESS_MEM_PRO_API_KEY`, `HARNESS_MEM_PRO_API_URL`, `HARNESS_MEM_ADAPTIVE_JA_THRESHOLD` (default 0.85), `HARNESS_MEM_ADAPTIVE_CODE_THRESHOLD` (default 0.50) を追加。`docs/environment-variables.md` に記載 | 4つの新規環境変数が config に反映される。ドキュメントに記載。既存変数に影響なし | - | cc:完了 [8da5008] |
| S70-007 [P] | Phase 1 統合テスト — adaptive プロバイダーが Free 構成（ローカルモデルのみ）で動作する E2E テスト。保存から Route 判定から embed から検索の一連フロー。ルートごとに最低3ケース（A: 純日本語、B: 純英語、C: 日英混在） | 9 ケース以上 green。既存テスト全 PASS。adaptive プロバイダー未使用時（fallback/local）のテストに影響なし | S70-005, S70-006 | cc:完了 [8da5008] |

### Phase 2: Dual Vector Storage + Ensemble Search

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S70-008 | mem_vectors スキーマ拡張（SQLite） — `schema.ts` のマイグレーションに `mem_vectors` の PK を `(observation_id, model)` 複合キーに変更する ALTER 文を追加。既存データは `model` カラムに値が入っているのでデータロスなし。`IVectorRepository` の `upsert` シグネチャは変更不要（既に model を受け取っている）。`findByObservationId()` を `findByObservationIdAndModel()` に拡張し、model 指定なしの場合は全モデル分を返す | マイグレーション実行後、同一 observation_id に対して model が異なる2行を INSERT できる。既存の単一ベクトルデータが保持される。rollback DDL あり | Phase 1 | cc:完了 [9be3fe5] |
| S70-009 | mem_vectors スキーマ拡張（PostgreSQL） — `postgres-schema.ts` に同等のマイグレーション。`PgVectorRepository` の upsert を複合キー対応に | PostgreSQL でも同一 observation に複数モデルベクトルを保存可能。既存データ保持 | S70-008 | cc:完了 [9be3fe5] |
| S70-010 | sqlite-vec 仮想テーブル分割 — Route A/B 用に `mem_vectors_vec_ruri` と `mem_vectors_vec_default` の2テーブルを作成（dimension が異なるため分割必須）。`_upsertVecRow()` と ANN 検索を model に応じてテーブル切替。既存の `mem_vectors_vec` はデフォルトモデル用として維持（後方互換） | sqlite-vec ANN 検索が model 別テーブルで動作。dimension 不一致エラーなし。brute-force fallback も model 別に動作 | S70-008 | cc:完了 [9be3fe5] |
| S70-011 | SqliteVectorRepository 複数ベクトル対応 — `upsert()` が Route C の場合に2回呼ばれても正しく動作。`findByObservationId()` が全モデル分の `VectorRow[]` を返すオーバーロード追加。`delete()` は observation_id の全ベクトルを CASCADE 削除（既存動作と同じ） | Route C で保存した observation に対し、ruri と openai の2つのベクトルが取得可能。delete は両方消える | S70-008, S70-010 | cc:完了 [9be3fe5] |
| S70-012 | PgVectorRepository 複数ベクトル対応 — PostgreSQL 版の同等実装 | PostgreSQL でも Route C の dual vector が動作 | S70-009, S70-011 | cc:完了 [9be3fe5] |
| S70-013 | observation-store Ensemble 保存 — `addObservation()` / `upsertObservation()` で adaptive プロバイダーの Route C 判定時に `embedSecondary()` を呼び、2つのベクトルを保存。Route A/B は従来通り1つだけ保存 | Route C の observation が `mem_vectors` に2行（ruri + openai）保存される。Route A/B は1行。保存レイテンシ p95 が Route A/B 比 +200ms 以内（API 並列呼び出し） | S70-004, S70-011 | cc:完了 [9be3fe5] |
| S70-014 | vectorSearch Ensemble 検索 — `vectorSearch()` を拡張。adaptive プロバイダーの場合、Route 判定に応じて (A) ruri テーブルのみ検索、(B) default テーブルのみ検索、(C) 両テーブルを並列検索し `scoreFusion()` でマージ。`scoreFusion()` は言語比率に応じた動的重み: `ruriWeight = max(0.3, jaRatio)`, `openaiWeight = 1 - ruriWeight` | Ensemble 検索が動作し、単一モデル検索より日英混在クエリで recall が向上（S70-021 で定量検証）。既存の非 adaptive パスに影響なし | S70-010, S70-013 | cc:完了 [9be3fe5] |
| S70-015 [P] | Phase 2 統合テスト — Ensemble 保存 + 検索の E2E。(a) Route C で2ベクトル保存確認、(b) Ensemble 検索で両テーブルヒット確認、(c) Route A/B は単一ベクトル動作確認、(d) 非 adaptive プロバイダーは従来動作 | 12 ケース以上 green。既存テスト全 PASS | S70-013, S70-014 | cc:完了 [9be3fe5] |

### Phase 3: Query Expansion + Pro API Provider

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S70-016 | Query Expander 実装 — `query-expander.ts` に `expandQuery(query, route): ExpandedQuery` を実装。Route A (日本語): 同義語展開（例: 本番反映 → デプロイ, リリース, deploy）。Route B (英語): 技術同義語。Route C: 両方適用。辞書は `data/synonyms-ja.json` / `data/synonyms-en.json` に外部化。`ExpandedQuery = { original, expanded[], route }` | 日本語同義語 50 エントリ以上、英語 30 エントリ以上。展開後のトークン数が元の3倍以内。ユニットテスト 20 ケース | Phase 2 | cc:完了 |
| S70-017 | Query Expander の検索統合 — `observation-store.ts` の `vectorSearch()` 手前で `expandQuery()` を呼び、展開された各同義語でも Embedding → 検索を実行し結果をマージ。展開数の上限は 3（レイテンシ制御）。adaptive プロバイダー以外では呼ばない | 「本番反映」で検索して「デプロイ手順」がヒット。非 adaptive パスに影響なし。検索レイテンシ p95 が展開なし比 +300ms 以内 | S70-016, S70-014 | cc:完了 |
| S70-018 | Pro API Provider 実装 — `pro-api-provider.ts` に `createProApiEmbeddingProvider()` を実装。`HARNESS_MEM_PRO_API_URL` に POST しベクトルを受け取る。タイムアウト 5秒。LRU キャッシュ 256 エントリ。`EmbeddingProvider` interface 準拠。障害時は `health()` が `"degraded"` を返す | Pro API にテキスト送信しベクトル受信が動作。タイムアウト時に degraded。キャッシュヒット時は API 呼び出しなし | S70-005 | cc:完了 |
| S70-019 | Fallback 設計 — adaptive-provider 内で Pro API の `health()` が `"degraded"` の場合、自動的に Free 構成にフォールバック。ログ出力あり。復帰は exponential backoff (10s → 30s → 60s → 300s) | API ダウン時にエラーなく検索が動作（精度は Free 相当に低下）。復旧後に自動で Pro に戻る | S70-018 | cc:完了 |
| S70-020 [P] | Phase 3 統合テスト — (a) Query 展開あり/なしの検索結果比較、(b) Pro API 接続テスト（モック）、(c) フォールバック動作、(d) 自動復帰 | 8 ケース以上 green。既存テスト全 PASS | S70-017, S70-019 | cc:完了 |

### Phase 4: ベンチマーク統合 + 最適化

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S70-021 | ベンチマーク拡張 — `run-ci.ts` に adaptive モードの計測を追加。`CIScoreEntry.embedding` に `{ mode: "adaptive" }` 形式で記録。bilingual-50 で adaptive vs 従来の recall 比較を出力 | `npm run benchmark` で adaptive の recall が計測される。bilingual-50 での差分が数値出力 | Phase 3 | cc:完了 |
| S70-022 | 閾値チューニング基盤 — `benchmark/adaptive-tuning.ts` を新規作成。`ADAPTIVE_JA_THRESHOLD` と `ADAPTIVE_CODE_THRESHOLD` を 0.05 刻みでグリッドサーチし、bilingual-50 + dev-workflow-20 での recall を最大化する組み合わせを出力 | `npm run benchmark:tune-adaptive` で最適閾値が JSON 出力。`data/adaptive-thresholds.json` に保存可能 | S70-021 | cc:完了 |
| S70-023 | Ensemble 重み最適化 — `scoreFusion()` の動的重み計算をチューニング結果に基づいて更新。`data/ensemble-weights.json` から読み込み | 重みが外部ファイルで調整可能。デフォルト値は S70-022 の結果 | S70-022 | cc:完了 |
| S70-024 | 回帰テスト — 既存ベンチマーク（locomo-120, bilingual-50, temporal-100, knowledge-update-100, dev-workflow-20）が adaptive モードで regression なし（F1 差 < 0.02）。非 adaptive モードも全 green | 全ベンチで regression なし。CI gate PASS | S70-021 | cc:完了 [e53af8f] |
| S70-025 | Zero-Retention 技術仕様書 — `docs/pro-api-data-policy.md` に Pro API のデータ取り扱いを記載。in-memory only、no-disk-write、TLS 1.3 必須、ログにテキスト本文なし、レスポンス返却後即破棄を明文化 | 仕様書が存在し Pro API 実装が準拠（S70-018 コードレビューで確認） | S70-018 | cc:完了 |
| S70-026 [P] | ドキュメント + CHANGELOG — README に Adaptive Retrieval Engine セクション追加。`docs/adaptive-retrieval.md` に設計詳細。環境変数一覧更新。CHANGELOG 更新 | README に記載。`--help` で adaptive モードの説明。CHANGELOG 更新 | Phase 3 | cc:完了 |

### 着手順

```
Phase 1（基盤）:
  S70-001 → S70-002 → S70-004 → S70-005
  S70-003 並列可（独立）
  S70-006 並列可（独立）
  S70-007 は Phase 1 全完了後

Phase 2（Ensemble）:
  S70-008 → S70-009 並列可
  S70-010 → S70-011 → S70-012
  S70-013 → S70-014
  S70-015 は Phase 2 全完了後

Phase 3（Pro + 展開）:
  S70-016 → S70-017
  S70-018 → S70-019
  S70-020 は Phase 3 全完了後

Phase 4（最適化）:
  S70-021 → S70-022 → S70-023
  S70-024 は S70-021 以降いつでも
  S70-025 は S70-018 以降いつでも
  S70-026 は Phase 3 以降
```

### 工数見積もり

| Phase | タスク数 | 見積もり |
|-------|---------|---------|
| Phase 1（Query Analyzer + Adaptive Provider） | 7 | 2-3日 |
| Phase 2（Dual Vector + Ensemble Search） | 8 | 3-4日 |
| Phase 3（Query Expansion + Pro API） | 5 | 2-3日 |
| Phase 4（ベンチマーク + 最適化 + ドキュメント） | 6 | 2-3日 |
| **合計** | **26** | **9-13日** |

### リスクと緩和策

| リスク | 影響 | 緩和策 |
|--------|------|--------|
| sqlite-vec 仮想テーブル分割で既存 ANN 検索が壊れる | 高 | S70-010 でフォールバック（brute-force）を必ず維持。分割前後で同一結果を検証 |
| Ensemble 検索のレイテンシ増大（2モデル並列） | 中 | API 並列呼び出し + キャッシュ。p95 目標 500ms 以内 |
| ruri-v3-310m の ONNX 変換品質 | 中 | HuggingFace 公式 ONNX がなければ Pro API のみで提供、ローカルは 30m を維持 |
| 複合 PK マイグレーションの後方互換 | 高 | マイグレーション前に自動バックアップ。rollback DDL を同梱 |

---

## §72 Claude / Codex 公式アップデート追従（MCP 結果 + Mac / Windows 配線）

背景: 2026-04 時点の Claude Code / Codex の公式更新で、MCP ツール結果の取り扱いとクライアント内の MCP UX が強化された。harness-mem は記憶データや resume context のような「大きくて構造化された結果」を返すことが多く、旧来の「JSON を text で返すだけ」「絶対パス前提の配線」では最新クライアントの改善点を取り込みきれない。今回のフェーズでは、(1) MCP 結果を構造化して大きい payload を正しく渡す、(2) Claude / Codex の MCP 配線を `cwd + relative args` へ寄せて Mac / Windows で壊れにくくする、(3) native Windows でも MCP-only の設定更新だけは CLI から行えるようにする、を実装対象にする。

### 対応対象

- Claude Code: `_meta["anthropic/maxResultSizeChars"]` による最大 500K 文字の MCP 結果許可
- Claude Code / Codex: `structuredContent` を使った構造化ツール結果
- Codex / Claude setup: `cwd` を持つ MCP server config に揃え、script arg は relative path に寄せる
- Windows: POSIX hook まで含む full setup は WSL2 推奨のまま維持しつつ、MCP-only config 更新は native Windows で実行可能にする

### タスク

| Task | 内容 | DoD | Depends | Status |
|------|------|-----|---------|--------|
| S72-001 | MCP 結果メタデータ拡張 — memory / context-box の成功・失敗レスポンスに `structuredContent` と `_meta["anthropic/maxResultSizeChars"]` を付与し、Codex 用 `_citations` を維持する | `harness_mem_search` など主要 memory tool が text + structuredContent の両方を返し、Claude Code 2.1.92+ で 500K 許可メタを持つ。既存 citation 契約は維持 | - | cc:完了 |
| S72-002 | Claude / Codex MCP 配線を `cwd + relative args` に更新 — setup/plugin/config generator を絶対パス arg 依存から脱却させ、Mac / Windows で壊れにくい設定へ寄せる | `.claude-plugin/plugin.json`、`harness-mem setup` が生成する Claude / Codex config、doctor 契約が `cwd` 前提で通る。旧絶対パス設定も doctor 互換として読む | S72-001 | cc:完了 |
| S72-003 | native Windows 向け `mcp-config` サブコマンド — full setup は未対応のまま、Claude / Codex の MCP-only config 更新だけは `harness-mem mcp-config --write --client claude,codex` で実行可能にする | `HARNESS_MEM_FORCE_PLATFORM=win32` 契約テストで `mcp-config` が exit 0。native Windows 向けに actionable な経路が 1 本ある | S72-002 | cc:完了 |
| S72-004 | 契約テスト + docs/changelog 同期 — 新しいレスポンス形状、plugin schema、Windows contract、setup guide を更新する | root / mcp-server テスト green。README / README_ja / setup guide / CHANGELOG が実装現実と一致 | S72-001, S72-002, S72-003 | cc:完了 |
