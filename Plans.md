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
  - DoD: watch slice が warning line を上回る

- [ ] `cc:TODO` **S51-005 [ops:tdd]**: anti-benchmark-hack + live parity guard
  - DoD: 3-run PASS + live replay no-regression

- [ ] `cc:TODO` **S51-006 [ops]**: main gate / companion / failure backlog を再凍結
  - DoD: main gate PASS、dated artifact 再生成

#### Phase B: Proof and Packaging（Tier 1 中心に再編）

- [ ] `cc:TODO` **S51-007 [ops]**: Tier 1（Claude Code + Codex）の live product parity 証明
  - DoD: resume / search / timeline で no-regression（Tier 2/3 は Optional）

- [ ] `cc:TODO` **S51-008 [docs:adr]**: commercial packaging decision を ADR 化
- [ ] `cc:TODO` **S51-009 [docs]**: license / commercial / support / release surface
- [ ] `cc:TODO` **S51-010 [docs]**: README を Claude Code + Codex 中心の buyer language に再編（§55-001 で一部完了）

#### Phase C: Competitive Readiness

- [ ] `cc:TODO` **S51-011 [docs]**: competitive snapshot を Claude Code + Codex 軸で更新
- [ ] `cc:TODO` **S51-012 [ops]**: traction proxy（installs / quickstart completion）

### 着手順

S51-004 → S51-005/006（Gate A）→ S51-007〜010（Gate B/C、Tier 1 中心）→ S51-011/012（Gate D）

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

### 完了サマリー（2026-03-16）

S55-001〜004 全完了。README/package.json を「Claude Code + Codex メモリブリッジ」に書き換え、§51 を Tier 1 中心に再編、Tier 1 統合テスト14本追加。

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

### Codex Review 指摘（未修正・次セッション引き継ぎ）

1. **self-eval snippet**: tail discriminator は `latest-task` で正解トークンを漏洩。ハッシュベースの stable ID が必要
2. **cross-tool tool queries**: コマンド名を直接含みキーワード一致テストになっている。言い換え（paraphrase）クエリに書き直す必要
3. **tool recall 閾値 0.25**: 回帰検知として低すぎる。embedding 改善後に 0.45+ に引き上げる

### 着手順

1. S56 Codex 指摘の修正（self-eval snippet / cross-tool paraphrase / 閾値調整）
2. S56-001〜005 のスコア改善（embedding モデルまたは reranker の導入、§51 連携）
