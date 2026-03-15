# Harness-mem 実装マスタープラン

最終更新: 2026-03-15（§52 dependency & tool integration update plan 策定）
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

策定日: 2026-03-16
背景: 現在の日本語ベンチマーク（96問）は統計的信頼性が不足。業界標準（LoCoMo 600問、LongMemEval 500問）の 1/5〜1/6 の規模。さらに、現在の96問は架空のビジネス会話ベースで、harness-mem の本来のユースケース（Claude Code / Codex 等のコーディングセッションの想起）と乖離している。

### 目的

1. 日本語ベンチマークを96問 → 500問以上に拡充
2. コーディングセッション特化の QA スライスを導入（「ちゃんと思い出せるか」を測る）
3. 既存の self-eval-generator.ts / retrospective-eval.ts を活用して自動生成を主体とする
4. 統計的に有意な品質主張を可能にする（スライス別でも 30問以上を確保）

### Success Gates

| Gate | 意味 | 完了条件（DoD） |
|------|------|-----------------|
| Gate A | template-complete | self-eval テンプレートが20種以上、コーディングセッション11スライスをカバー |
| Gate B | volume-complete | 自動生成 + LLM半自動 + 人間検証で合計500問以上の Gold Set が作成される |
| Gate C | runner-integrated | 拡張ベンチマークが既存の benchmark runner / CI gate に統合される |
| Gate D | claim-ready | README / proof bar が新ベンチマーク結果を反映し、SSOT テストが通る |

### QA スライス（10種）

tool-recall / error-resolution / decision-why / file-change / cross-client / temporal-order / session-summary / dependency / noisy-ja / cross-lingual

### Phase 1-4 完了サマリー（2026-03-16）

S54-001〜010 全完了。138テスト/0失敗。詳細: `docs/benchmarks/s54-benchmark-scale-up-summary.md`

| Phase | タスク | 成果 |
|-------|--------|------|
| 1 | S54-001/002/003 | テンプレート6→20種、300問自動生成、品質検証スクリプト |
| 2 | S54-004/005 | retrospective CI wrapper、audit coverage check (16,647 hits) |
| 3 | S54-006/007/008 | LLM QA生成パイプライン、品質フィルタ、396問統合fixture |
| 4 | S54-009/010 | runner gate検証、scale-up summary ドキュメント |

### Phase 5: Follow-up（品質仕上げ + Gate A 到達）

背景: Phase 1-4 完了後のベンチマーク実行で判明した残課題。§51 Gate A（main gate 3連続 PASS）到達に必要。

- [ ] `cc:TODO` **S54-011 [benchmark]**: LLM QA 生成で 500問到達
  - 対象: `llm-qa-generator.ts --generate`、`.env`（ANTHROPIC_API_KEY）
  - 内容: 実DBから100セッション抽出 → Claude API で QA 生成 → qa-review-tool でフィルタ → fixture-integrator で統合
  - DoD: 統合 fixture が 500問以上、品質チェック pass_rate ≥ 50%

- [x] `cc:完了` **S54-012 [benchmark]**: retrospective-eval の embedding prime 待機を追加
  - 対象: `memory-server/src/benchmark/retrospective-eval.ts` の `evaluateAlgo` 関数
  - 内容: `ensureEmbeddingReady()` 相当の待機ロジックを `evaluateAlgo` 内に追加し、sync embed がフォールバックに落ちない状態で検索を実行する
  - DoD: retrospective-eval の recall@10 が 0 ではない実用的な値を返す

- [x] `cc:完了` **S54-013 [benchmark]**: self-eval テンプレートの exact dupe 63→0件に解消
  - 対象: `self-eval-generator.ts` のテンプレート + `generateSelfEvalCases` ロジック
  - 内容: 同一セッション内で content 先頭が一致するエントリに対し、snippet 抽出位置を分散させる（2番目・最後のエントリを使うバリエーション追加 or dedupe フィルタ）
  - DoD: `qa-quality-check.ts` の exact_query_dupes が 10件以下

- [ ] `cc:TODO` **S54-014 [benchmark/§51]**: Layer 2 Relative Regression の解消（§51 Gate A 連携）
  - 対象: `memory-server/src/retrieval/router.ts`、`observation-store.ts`、run-ci gate 定義
  - 背景: LoCoMo F1 0.5296 < mean-2SE 0.5333（-0.0037 の微小回帰）、temporal 0.6403 < mean-2SE 0.6431
  - 方針: §51 S51-002/003 で着手済みの router temporal 改善の続き。ベンチマーク専用ハックではなく汎用改善で対処
  - DoD: `run-ci.ts` の Layer 2 が PASS、3連続実行で安定

### 着手順（Phase 5）

1. `S54-012`（retrospective-eval prime 待機）— 小修正、即効性あり
2. `S54-013`（exact dupe 解消）— テンプレート調整のみ
3. `S54-011`（LLM QA 生成 500問）— API 実行、`.env` の ANTHROPIC_API_KEY を使用
4. `S54-014`（Layer 2 解消）— §51 との連携、最も工数が大きい
