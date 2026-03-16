# Harness-mem 実装マスタープラン

最終更新: 2026-03-16（§55 プロダクトフォーカス戦略策定）
実装担当: Codex / Claude（本ファイルを唯一の実装計画ソースとして運用）

> **アーカイブ**: §0-31 → [`docs/archive/`](docs/archive/) | §32-35 → archive | §36-50 → [`Plans-s36-s50-2026-03-15.md`](docs/archive/Plans-s36-s50-2026-03-15.md) | §52-53 → [`Plans-s52-s53-2026-03-16.md`](docs/archive/Plans-s52-s53-2026-03-16.md)（§52 12完了/1未着手, §53 7完了）

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
| 維持できている価値 | 強い | local-first Claude Code + Codex memory bridge、hybrid retrieval、522問日本語ベンチマーク |
| 次フェーズの焦点 | §55 プロダクトフォーカス | Claude Code + Codex を Tier 1 に集中。README/ポジショニング再編。Cursor は Tier 2 維持、他は Tier 3 降格 |
| CI Gate | **全 PASS** | Layer 1/2/Companion すべて PASS（2026-03-16 §54 完了時点） |

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

- [x] `cc:完了` **S51-002**: router temporal/current-vs-previous 回復（router.ts + 回帰テスト追加）
- [x] `cc:完了` **S51-003**: observation-store temporal retrieval 回復（candidate depth/anchor search 改善）

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

S51-004 → S51-005/006（Gate A）→ S51-007〜010（Gate B/C）→ S51-011/012（Gate D）

> §52（12完了/1未着手）・§53（7完了）→ [`Plans-s52-s53-2026-03-16.md`](docs/archive/Plans-s52-s53-2026-03-16.md)。残: S52-013（HF transformers v4）— 正式リリース待ち

---

## §54 Japanese Benchmark Scale-Up（日本語ベンチマーク拡充）

策定日: 2026-03-16 — **全完了**（96問 → 522問、全 Gate PASS）
スライス: tool-recall / error-resolution / decision-why / file-change / cross-client / temporal-order / session-summary / dependency / noisy-ja / cross-lingual（10種）

### 完了サマリー（2026-03-16）

S54-001〜014 全14タスク完了。詳細: `docs/benchmarks/s54-benchmark-scale-up-summary.md`
成果: 96問→522問（3ソース、22スライス）、8新規ツール、138テスト、全 CI Gate PASS、Layer 2 FAIL 解消

---

## §55 Product Focus Strategy（プロダクトフォーカス戦略）

策定日: 2026-03-16
背景: 競合分析と「必要性ディベート」の結果、harness-mem の真の堀は「マルチクライアント統合 × ローカル完結 × ゼロコスト」であり、5ツール均等サポートより Claude Code + Codex の2軸に集中すべきと判断。日本語優位は先行者利益であって技術的堀ではないため、差別化の主軸にしない。

### ツールティア定義

| Tier | ツール | サポートレベル | 方針 |
|------|--------|--------------|------|
| **Tier 1** | **Claude Code, Codex** | 全力サポート | フック・MCP・テストを最優先維持。バグ即時修正。README 先頭で訴求 |
| **Tier 2** | Cursor | 動作保証・積極投資なし | hooks.json + sandbox.json は現状維持。新機能は Tier 1 完了後のみ |
| **Tier 3** | Gemini CLI, OpenCode | 実験的 / community | README で experimental 明記。コード削除はしない。バグ修正は低優先 |

### ポジショニング変更

```
Before: 「Claude / Codex / Cursor / OpenCode / Gemini CLI で使えるメモリランタイム」
After:  「Claude Code と Codex のメモリを橋渡し。ローカル完結、ゼロコスト。」
```

### タスク

- [ ] `cc:TODO` **S55-001 [docs]**: README.md / README_ja.md のポジショニングを Claude Code + Codex 中心に書き換え
  - 先頭のキャッチコピーを変更
  - 対応ツール表に Tier 1/2/3 ラベルを追加
  - 「Claude Code で学習し、Codex で想起する」ユースケースを最初の例として配置
  - DoD: README のファーストビューが「Claude Code + Codex のメモリブリッジ」として明確

- [ ] `cc:TODO` **S55-002 [docs]**: package.json の keywords / description を更新
  - description: "Memory bridge for Claude Code and Codex — local-first, zero-cost"
  - keywords: `claude-code`, `codex` を先頭に移動
  - DoD: npm 検索で Claude Code / Codex 関連として表示される

- [ ] `cc:TODO` **S55-003 [ops]**: §51 Phase B/C のスコープを Tier 制に合わせて調整
  - S51-007〜012 のうち、Tier 3 ツール固有のタスクを Optional に降格
  - OpenCode フック未発火バグ（#2319）の優先度を低に
  - DoD: §51 の残タスクが Tier 1 中心に再編される

- [ ] `cc:TODO` **S55-004 [test]**: Tier 1 統合テストの強化
  - Claude Code フック全11種の E2E テスト
  - Codex rules + hooks.json + session の統合テスト
  - DoD: Tier 1 の2ツールについて、セットアップからセッション完了までの全パスがテストで保証される

### 着手順

1. `S55-001` + `S55-002`（README + package.json 更新、並列可）
2. `S55-003`（§51 スコープ調整）
3. `S55-004`（Tier 1 テスト強化）
