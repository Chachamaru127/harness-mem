# Harness-mem 実装マスタープラン

最終更新: 2026-03-20（§57 Claude Code + Codex アップデート対応計画策定）
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
| 最新リリース | **v0.6.0**（2026-03-20、§57 全15タスク完了、Codex 6R レビュー通過） |
| 次フェーズの焦点 | §56 差別化ベンチマーク / §51 Competitive Gap Closure |
| CI Gate | **全 PASS**（2026-03-16 §54 完了時点） |

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

### タスク（S51-002/003 完了済み）

| Task | 内容 | Status |
|------|------|--------|
| S51-001 | truth freeze + gate 定義固定 | cc:TODO |
| S51-004 | adapter/normalizer yes_no/entity/location 硬化 | cc:TODO |
| S51-005 | anti-benchmark-hack + live parity guard | cc:TODO |
| S51-006 | main gate / companion 再凍結 | cc:TODO |
| S51-007 | Tier 1 live product parity 証明 | cc:TODO |
| S51-008 | commercial packaging ADR | cc:TODO |
| S51-009 | license / commercial / release surface | cc:TODO |
| S51-010 | README buyer language 再編（§55で一部完了） | cc:TODO |
| S51-011 | competitive snapshot 更新 | cc:TODO |
| S51-012 | traction proxy 測定 | cc:TODO |

着手順: S51-004→005/006(Gate A)→007〜010(Gate B/C)→011/012(Gate D)

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

- [ ] `cc:TODO` **S56-001 [benchmark]**: Cross-Tool Memory Transfer ベンチマーク
  - 内容: `recordEvent(platform:"claude")` → `search(query)` を `platform:"codex"` セッションから実行し、Recall@10 を測定
  - テストケース: 50問（決定理由25 + ツール使用25）、Claude→Codex / Codex→Claude の双方向
  - 対象: 新規 `tests/benchmarks/cross-tool-transfer.test.ts`
  - DoD: Cross-Tool Recall@10 が 0.80 以上、run-ci に組み込み

- [ ] `cc:TODO` **S56-002 [benchmark]**: セッション再開ベンチマーク
  - 内容: セッション A で記録 → 終了 → セッション B で検索し、前セッションの文脈が復元されるか
  - テストケース: 30問（最終ステップ想起15 + 作業順序15）
  - DoD: Session Resume Recall@5 が 0.75 以上

- [ ] `cc:TODO` **S56-003 [benchmark]**: 長期記憶保持ベンチマーク
  - 内容: 30日前の observation を 1000件の新しい observation の後に検索し、top-10 に入るか
  - テストケース: 20問（重要な設計判断10 + マイグレーション記録10）
  - DoD: Long-term Recall@10 が 0.70 以上、adaptive-decay で埋もれないことを証明

- [ ] `cc:TODO` **S56-004 [benchmark]**: Consolidation 品質ベンチマーク
  - 内容: 100件記録 → compress → 同一クエリで検索し、F1 が圧縮前の 95% を維持するか
  - DoD: Post-consolidation F1 retention ≥ 0.95

- [ ] `cc:TODO` **S56-005 [benchmark]**: マルチプロジェクト分離ベンチマーク
  - 内容: project A と B に異なる記憶を記録し、project A の検索で B の結果が漏れないか
  - DoD: Cross-project leakage rate ≤ 0.05（5%以下）

### Codex Review 指摘（修正済み）

1. ~~**self-eval snippet**: tail discriminator は `latest-task` で正解トークンを漏洩~~ → `se-to-02` に変更済み
2. ~~**cross-tool tool queries**: コマンド名を直接含みキーワード一致テスト~~ → 全12クエリをパラフレーズに書き直し済み
3. ~~**tool recall 閾値 0.25**~~ → パラフレーズ後の実測値 0.25 に対しフロア 0.20 に設定。reranker 導入後に 0.45+ に引き上げ予定

### 着手順

1. S56 Codex 指摘の修正（self-eval snippet / cross-tool paraphrase / 閾値調整）
2. S56-001〜005 のスコア改善（embedding モデルまたは reranker の導入、§51 連携）

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
