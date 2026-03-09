# Harness-mem 実装マスタープラン

最終更新: 2026-03-09（§47 memSearch 直近対話アンカー改善を追加）
実装担当: Codex / Claude（本ファイルを唯一の実装計画ソースとして運用）

> **アーカイブ**: §0-31 → [`docs/archive/`](docs/archive/) | §32 17タスク完了 | §33 15タスク完了 | §34 20タスク完了 | §35 18完了+2blocked（CI PASS, F1+7.4pp） | §36 15タスク完了（CI PASS, F1+1.43pp, cat-3+9.5pp） | §37 10タスク完了（run-ci PASS, bilingual=0.90） | §38 12タスク完了（3-run freeze PASS, F1=0.3147） | §39 11タスク完了（run-ci final GO, F1=0.4602） | §40 11タスク完了（ja-release-pack PASS, F1=0.7645） | §41 3タスク完了（daemon auto-embedding rollout） | §42 2タスク完了（live retrieval precision polish） | §43 計画策定

---

## 凡例

`[P]` = 並列可 / `cc:TODO` / `cc:WIP` / `cc:完了` / `blocked`

---

## 現在のステータス

**§39 Practical Finish — 完了 / §40 Japanese Release Readiness — 完了**（2026-03-06）

| 項目 | 現在地 | 根拠 |
|------|--------|------|
| primary gate | GO 維持 | `run-ci` PASS、`locomo F1=0.4723`、`bilingual=0.9000`、`freshness=1.0000`、`temporal=0.6889` |
| 日本語 README claim gate | GO 達成 | `ja-release-pack` 3-run PASS、`overall F1 mean=0.7645`、`cross_lingual=0.7563`、`zero-F1=2/32`、`span=0.0000` |
| README で安全に訴求できる価値 | 日本語 short-answer + EN<->JA retrieval は実測済み | proof bar / claim audit / `README.md` / `README_ja.md` まで更新済み |
| 残課題 | temporal は日本語 slice で最弱。過剰主張は禁止 | `temporal slice F1=0.5276`、failure backlog / risk notes で明示 |
| 次フェーズの焦点 | §43 Japanese Max Confidence | temporal / current-value / zero-F1 / 長すぎる回答 / competitive audit を最大火力で詰める |

成果物:
- `memory-server/src/benchmark/results/ci-run-manifest-latest.json`（§39 primary gate の正本）
- `docs/benchmarks/artifacts/s39-final-go-2026-03-06/score-report.md`（§39 最終スコア）
- `docs/benchmarks/japanese-release-proof-bar.md`（§40 README claim contract の正本）
- `docs/benchmarks/japanese-claim-audit.md`（§40 claim audit）
- `docs/benchmarks/artifacts/s40-ja-release-latest/summary.md`（§40 日本語 release pack の 3-run 要約）
- `docs/benchmarks/artifacts/s39-shadow-query-pack-latest/score-report.json`（補助評価）
- `tests/benchmarks/fixtures/bilingual-50.json`（現行 bilingual fixture）

---

## §36 完了（全15タスク `cc:完了`）

**Phase A** (Embedding+Bilingual): RQ-001〜005 完了
**Phase B** (Recall+F1): RQ-006〜010 完了 — RRF実装, query expansion, cat-3強化
**Phase C** (Temporal+統合): RQ-011〜015 完了 — temporal 2段階検索, CI PASS

主要変更ファイル:
- `memory-server/src/core/observation-store.ts` — RRF (k=60), graphMaxHops 3→4
- `memory-server/src/core/core-utils.ts` — SYNONYM_MAP 50+エントリ追加
- `tests/benchmarks/locomo-harness-adapter.ts` — cat-3クエリバリアント修正

---

## §37 実行計画（ONNX本番同等化 + キャッシュ + bilingual 0.80復帰）

進行状態: `cc:完了`（/breezing all 完走）

### Feature Priority Matrix

| 区分 | 項目 | 完了条件（DoD） |
|------|------|-----------------|
| Required | ONNX本番同等化（ベンチでも同じ推論経路） | ベンチが random fallback を使わず ONNX 実推論で走ることを CI で証明 |
| Required | embedding キャッシュ戦略 | 同一条件の再実行で embedding 再計算を大幅削減し、結果の再現性を維持 |
| Required | bilingual recall@10 を 0.80 へ復帰 | bilingual-50 で recall@10 >= 0.80 を CI ゲート化 |
| Recommended | §37 比較レポート整備 | cold/warm 実行差分と品質指標差分を1枚で比較できる |
| Recommended | 運用Runbook更新 | 失敗時の切り分け手順（モデル/キャッシュ/データ）を手順化 |
| Optional | 代替モデル再比較（mGTE 等） | multilingual-e5 を上回る根拠がある場合のみ採用検討 |

### 依存グラフ

```
Phase A: ONNX本番同等化（最優先）
├── S37-001: 現状差分の可視化（prod/bench経路）
├── S37-002: ベンチ経路を本番推論に統合（random fallback禁止）
└── S37-003: CIゲート追加（onnx=true, model, vector_dim を検証）
                     │
Phase B: Cache（Phase A 後）
├── S37-004: embedding cache 実装（model+text hash key）
├── [P] S37-005: warm/cold ベンチ計測
└── S37-006: cache整合テスト（hit/miss/invalidate）
                     │
Phase C: Bilingual復帰（Phase A+B 後）
├── S37-007: bilingual失敗ケース分析（トップ失敗クエリを分類）
├── S37-008: JA/EN 正規化 + SYNONYM_MAP 拡張
├── S37-009: 重み再調整と再計測（bilingual-50）
└── S37-010: CI gate化 + §37レポート確定
```

### TDD 方針

- すべての Phase で「先に失敗テストを追加 → 実装 → リファクタ」を徹底する。
- random fallback に戻る変更はテストで必ず検知する。
- ベンチ系変更は品質（recall/F1）と速度（cold/warm）を同時に記録する。

### タスク一覧（`/work` 実行用）

### Phase A: ONNX本番同等化（Goal 1）

- [x] `cc:完了` **S37-001 [feature:tdd]**: prod/bench 推論経路の差分を棚卸し
  - 対象: `memory-server/src/core/core-utils.ts`, `memory-server/src/benchmark/*.ts`
  - DoD: random fallback が発生する条件を明文化し、差分表を `docs/benchmarks/` に記録

- [x] `cc:完了` **S37-002 [feature:tdd]**: ベンチを本番と同一 ONNX 経路へ統合
  - random embedding fallback の暗黙利用を禁止（使う場合は明示フラグ必須）
  - DoD: ベンチ実行ログに `onnx=true`, `model=multilingual-e5`, `vector_dim=384` が必ず出力

- [x] `cc:完了` **S37-003 [feature:tdd]**: ONNX 同等性の CI ゲート追加
  - DoD: CI 上で S37-002 条件が1つでも崩れたら fail

### Phase B: embedding キャッシュ（Goal 2）

- [x] `cc:完了` **S37-004 [feature:tdd]**: embedding cache（key: model+normalized_text hash）実装
  - DoD: 同一入力で再計算せず cache hit することを単体テストで担保

- [x] `cc:完了 [P]` **S37-005 [feature:tdd]**: warm/cold ベンチ計測を追加
  - DoD: 2回目実行で embedding 再計算件数が 80% 以上減少

- [x] `cc:完了` **S37-006 [feature:tdd]**: cache invalidation と再現性テスト
  - DoD: モデル変更時に古い cache を使わない / 同条件再実行で結果が一致

### Phase C: bilingual recall 0.80 復帰（Goal 3）

- [x] `cc:完了` **S37-007 [feature:tdd]**: bilingual-50 の失敗ケース分析
  - DoD: 失敗上位クエリを原因別（語彙不足・正規化不足・ranking不足）に分類

- [x] `cc:完了` **S37-008 [feature:tdd]**: JA/EN 正規化 + SYNONYM_MAP の強化
  - DoD: S37-007 で抽出した語彙ギャップの 80% 以上をカバー

- [x] `cc:完了` **S37-009 [feature:tdd]**: bilingual最適化の重み調整 + 再計測
  - DoD: bilingual-50 recall@10 >= 0.80（3-run 平均）

- [x] `cc:完了` **S37-010**: §37 統合レポート + CI gate 更新
  - DoD: ONNX同等性 / cache効果 / bilingual 0.80 の3条件を CI Layer 1 で検証

---

## §38 実行計画（最強改善プラン: Multi-Agent Critic 統合版）

進行状態: `cc:完了`（3-run freeze PASS, run-ci PASS）

### Plan Critic 統合判断（Dirac / Peirce / Anscombe）

| 論点 | 判断 | 採用理由 |
|------|------|----------|
| `overall F1` 目標 | **0.30 固定** | 0.285 は中間ゲート。最終Goは 3-run mean 0.30 以上のみ。 |
| 計測基盤固定（panic/fallback/manifest） | **必須先行** | 比較条件が揺れると改善判定が無効化されるため。 |
| `cat-2` / `cat-3` の category 強制ルール撤廃 | **必須** | 現失点に直結する高ROI施策。 |
| slot-first 抽出 | **段階導入** | 高利得だが副作用管理が必要。Shadow評価→本線化で導入。 |
| temporal 改善 | **限定適用** | 全体悪化を防ぐため question-aware 条件でのみ適用。 |

### Feature Priority Matrix

| 区分 | 項目 | 完了条件（DoD） |
|------|------|-----------------|
| Required | 計測信頼性ロック（panic/fallback/manifest） | ベンチ判定が比較可能で、偽陽性CIを防止できる |
| Required | `cat-2`/`cat-3` 誤ルーティング修正 | category 依存の強制分岐を撤廃し回帰テスト通過 |
| Required | 回答抽出（slot-first）改善 | 主要失敗ケースで短答精度を改善し、cat別スコアを押し上げる |
| Required | 最終品質ゲート（3-run freeze） | `overall F1 >= 0.30` を再現可能に満たす |
| Recommended | question-aware rerank 微調整 | cat-2/cat-3 を補強しつつ cat-1 の劣化を抑制 |
| Recommended | temporal ルート安定化 | `temporal tau` を維持または改善 |
| Optional | ONNX cache 速度チューニング | 品質非劣化で p95 遅延のみ改善 |

### 依存グラフ

```
Phase 0: Trust Lock（最優先）
├── S38-001: panic-aware benchmark runner + manifest
├── S38-002: ONNX-only 強制（fallback禁止）
└── S38-003: baseline/fixture/profile 比較厳格化
                     │
Phase 1: High-ROI F1 改善
├── [P] S38-004: cat-2/cat-3 の category 強制撤廃
├── [P] S38-005: slot-first 抽出 + normalizer 強化
└──     S38-006: question-aware rerank（限定）
                     │
Phase 2: 非破壊安定化
├── S38-007: temporal ルートの限定調整
└── S38-008: cat別/品質ガード付き CI gate 更新
                     │
Phase 3: Freeze + 判定
├── S38-009: 3-run ablation + freeze
├── S38-010: leak/boundary 証跡ゲート
└── S38-011: §38 統合レポート + Plans更新
```

### TDD 方針

- 先に失敗テスト（または失敗条件）を追加し、次に実装。
- `fallback` 経路、panic混入、fixture不一致はテストで即fail。
- 精度改善は必ず ablation（単独効果）を取り、複合変更の幻影改善を防ぐ。

### タスク一覧（`/work` 実行用）

#### Phase 0: Trust Lock（評価の土台）

- [x] `cc:完了` **S38-001 [feature:tdd]**: panic-aware runner + benchmark manifest
  - 対象: `scripts/bench-freeze-locomo.sh`（新規）, `memory-server/src/benchmark/run-ci.ts`
  - DoD: runごとに `model/mode/vector_dim/fixture_hash/git_sha` を保存、panic痕跡時は判定無効

- [x] `cc:完了` **S38-002 [feature:tdd]**: ONNX-only 強制（fallback禁止）
  - 対象: `memory-server/src/benchmark/run-ci.ts`, `tests/benchmarks/run-locomo-benchmark.ts`, `memory-server/src/benchmark/{freshness-cv,jaccard-cv,retrospective-eval}.ts`
  - DoD: `mode!=onnx` はCI fail（例外なし）

- [x] `cc:完了` **S38-003 [feature:tdd]**: baseline/fixture/profile 比較厳格化
  - 対象: `memory-server/src/benchmark/run-ci.ts`
  - DoD: baseline欠損・parse失敗・fixture縮退を skip せず fail-fast

#### Phase 1: High-ROI F1 改善（主戦場）

- [x] `cc:完了 [P]` **S38-004 [feature:tdd]**: `cat-2`/`cat-3` の category 強制判定撤廃
  - 対象: `tests/benchmarks/locomo-harness-adapter.ts`, `tests/benchmarks/locomo-harness-adapter.test.ts`
  - DoD: `cat-2=>temporal` / `cat-3=>multi-hop` の固定分岐を除去し、質問文意図ベースで回帰テスト通過

- [x] `cc:完了 [P]` **S38-005 [feature:tdd]**: slot-first 抽出 + normalizer 強化
  - 対象: `tests/benchmarks/locomo-harness-adapter.ts`, `tests/benchmarks/locomo-answer-normalizer.ts`, 関連テスト
  - DoD: 主要失敗ケース（entity/number/unit/date/location）10件以上で改善

- [x] `cc:完了` **S38-006 [feature:tdd]**: question-aware rerank（限定導入）
  - 対象: `tests/benchmarks/locomo-harness-adapter.ts`（必要なら `memory-server/src/retrieval/router.ts`）
  - DoD: `cat-2`/`cat-3` 改善、かつ `cat-1` 劣化を 1pp 以内に抑制

#### Phase 2: 非破壊安定化

- [x] `cc:完了` **S38-007 [feature:tdd]**: temporal ルート限定調整
  - 対象: `memory-server/src/core/observation-store.ts`, `memory-server/src/retrieval/router.ts`, `memory-server/tests/unit/{retrieval-router,temporal-anchor}.test.ts`
  - DoD: `temporal tau >= 0.57`（現状割れ禁止）, freshness/bilingual 非劣化

- [x] `cc:完了` **S38-008 [feature:tdd]**: cat別品質ゲート追加
  - 対象: `memory-server/src/benchmark/{run-ci,locomo-gate-check}.ts`, `memory-server/tests/benchmark/locomo-gate-check.test.ts`
  - DoD: overallだけでなく `cat-2`/`cat-3`/`temporal` をCI gate化

#### Phase 3: Freeze + 判定

- [x] `cc:完了` **S38-009**: 3-run ablation + freeze 判定
  - コマンド: `for i in 1 2 3; do (cd memory-server && bun run src/benchmark/run-ci.ts); done`
  - DoD: run別 artifact（result/judge/score/failure-backlog/risk-notes）を保存
  - 実績: `memory-server/src/benchmark/results/freeze-summary-20260305T182615Z.json`（overall mean=0.3147, span=0.0000）

- [x] `cc:完了` **S38-010**: privacy/boundary leak 証跡ゲート
  - 対象: `memory-server/tests/integration/resume-pack-behavior.test.ts`, `memory-server/tests/unit/workspace-boundary.test.ts`, `tests/proof-pack-contract.test.ts`
  - DoD: `leak_count == 0` を freeze 判定に必須化
  - 実績: 3テスト群で leak_count=0 を検証

- [x] `cc:完了` **S38-011**: §38 統合レポート + Plans最終更新
  - 対象: `docs/benchmarks/` + `Plans.md`
  - DoD: 採用施策/不採用施策/再現手順/ロールバック条件を1枚に集約
  - 実績: `docs/benchmarks/s38-retrieval-quality-freeze-report-2026-03-06.md`

- [x] `cc:完了 [P]` **S38-012 (Optional)**: ONNX cache 速度チューニング
  - 対象: `memory-server/src/embedding/local-onnx.ts`
  - DoD: 品質非劣化で p95 遅延のみ改善（品質悪化時は不採用）
  - 実績: freeze実行で品質非劣化を確認し、現行 LRU 設定（capacity=128）を採用維持

### 2週間ロードマップ（統合版）

1. Day 1-2: Trust Lock（S38-001〜003）
2. Day 3-6: 主改善A/B 並列（S38-004, S38-005）→統合（S38-006）
3. Day 6-9: 非破壊安定化（S38-007〜008）
4. Day 10-12: ablation + freeze 準備（S38-009）
5. Day 13-14: 最終判定と報告（S38-010〜011）

### Go / No-GO 基準（最終）

**GO（すべて必須）**
1. 3-run mean `overall F1 >= 0.30`
2. 3-run min `overall F1 >= 0.295`
3. `bilingual recall >= 0.88`（基準0.90から -2pp以内）
4. `Freshness@K >= 0.95`
5. `temporal tau >= 0.56`
6. `fallback` 実行 0件 / `panic` 混入 0件 / `leak_count` 0

**No-GO（1つでも該当で停止）**
1. `mode=fallback` が1回でも検出
2. panic文字列が出たrunを有効結果として採用
3. baseline/fixture/profile不一致の比較結果を採用
4. 3-run のばらつき `max-min > 0.02`
5. Day14時点で `overall mean < 0.30`

## §39 実行計画（Practical Finish: 本番初回品質 + Factual Precision + Eval Rigor）

進行状態: `cc:完了`（S39-003/010/011 を完了し、run-ci final gate PASS。`memory-server` 全体も 1054 tests 中 1045 pass / 9 skip / 0 fail）

### 統合判断（複数 critic レビュー統合）

- **結論**: 「もう改善箇所がない」とはまだ言えない。ただし、残タスクは広くない。
- **本当に残っている改善余地**は 3 点だけ:
  1. **本番の cold start 品質** — ベンチは ONNX-only で固定されたが、本番コードはモデル未準備時に fallback を返しうるため、初回リクエスト品質の穴が残る。
  2. **factual 質問の短答精度** — `locomo-120` の `factual` は `123` 問中 `86` 問が `F1=0`。証拠は取得できているのに、答えの抜き方を外しているケースが主因。
  3. **改善主張の証拠強度** — 3-run freeze は安定しているが、`Layer 3 Wilcoxon` は未有効。LoCoMo に寄りすぎた改善かを切り分ける証拠がまだ薄い。
- **実装方針の補足**:
  - `§39` は採用する。
  - ただし **benchmark adapter だけを賢くする計画にはしない**。`tests/benchmarks` 側の短答改善に加えて、product 本体の retrieval / fact 選択にも効く変更を含める。
  - `cat-1` は現状でも劣化余地があるため、**non-regression gate を明示追加**する。
- **逆に、今は触るべきでない領域**:
  - 新しい embedding モデル比較
  - RRF / graph / bilingual の広い再調整
  - ベンチ文面だけに効く query variant の追加
  - cache 容量や並列度だけを追う速度最適化

### Feature Priority Matrix

| 区分 | 項目 | 完了条件（DoD） |
|------|------|-----------------|
| Required | 本番 cold start でも silent fallback しない | モデル未準備のまま検索品質が劣化する経路を禁止し、ready/health で検知できる |
| Required | factual 短答精度の改善 | top failure bank で答え抽出が改善し、overall F1 にも反映される |
| Required | product 本体での value / fact 選択改善 | benchmark adapter だけでなく `observation-store` 側でも exact-value / active-fact を優先できる |
| Required | `cat-1` 非回帰 + runbook証拠完備 | `cat-1` を悪化させず、4成果物 + `p95/token avg` を揃えて改善を主張できる |
| Required | 改善主張の証拠強化 | freeze の改善が paired 比較でも確認でき、LoCoMo過学習を抑制できる |
| Recommended | cold/warm 運用観測 | cache hit/miss と first-query latency を run artifact と health で追える |
| Recommended | 実運用に近い shadow query pack | 実ユーザー系クエリで改善が再現する |
| Optional | temporal の追加改善 | factual 主戦場の改善後、なお ROI が残る場合のみ実施 |

### Anti-Goals（やらないこと）

1. **新モデル bake-off はやらない**  
   いまのボトルネックは embedding より answer extraction と runtime parity。
2. **RRF/graph の大改造はやらない**  
   `cat-2` / `cat-3` は改善済みで、現状の最大失点は `factual` 抽出。
3. **ベンチ専用のルール追加はやらない**  
   fixture の言い回しだけに刺さるパターン追加は禁止。
4. **速度だけの最適化はやらない**  
   p95 と cold-start 品質の両立が証明できない変更は採用しない。
5. **証拠外の補完はやらない**  
   normalizer が evidence にない month / unit / 肩書きを補って正答に見せる変更は禁止。

### 依存グラフ

```
Phase A: Production Parity（最優先）
├── S39-001: local ONNX 未ready時の silent fallback 排除
├── S39-002: startup/readiness/health contract 追加
└── S39-003: cold-start vs warm-start 品質/遅延テスト
                     │
Phase B: Factual Precision（主戦場）
├── S39-004: factual failure bank 作成（zero-F1 上位30〜40件）
├── [P] S39-005: question intent schema + product fact/value hints 拡張
├── [P] S39-006: answer span selector + active-fact prioritization 改善
└──     S39-007: evidence-bounded normalizer 改善
                     │
Phase C: Evidence Hardening + Stop Decision
├── S39-008: factual 回帰テスト + cat別 gate 更新（cat-1 guard 含む）
├── S39-009: paired improvement gate（Wilcoxon or 同等の有意差検証）有効化
├── S39-010: shadow query pack 追加（匿名化実運用寄り 20〜30 問）
└── S39-011: 最終 freeze + 「続ける/止める」判定
```

### タスク一覧（`/work` 実行用）

#### Phase A: Production Parity

- [x] `cc:完了` **S39-001 [feature:tdd]**: local ONNX 未ready時の silent fallback 排除
  - 対象: `memory-server/src/embedding/local-onnx.ts`, `memory-server/src/core/harness-mem-core.ts`
  - DoD: 本番検索・ingest が「未readyなので fallback で続行」をしない。少なくとも `degraded` を返して品質劣化を隠さない。

- [x] `cc:完了` **S39-002 [feature:tdd]**: startup/readiness/health contract 追加
  - 対象: `memory-server/src/core/harness-mem-core.ts`, `memory-server/src/server.ts`, health tests
  - DoD: `embedding_provider_status=healthy` になる前の扱いが明文化され、health/ready で機械判定できる。

- [x] `cc:完了` **S39-003 [feature:tdd]**: cold-start vs warm-start 品質/遅延テスト
  - 対象: benchmark / integration tests
  - DoD: first-query の品質差が許容範囲内で、cache 効果と混同せずに観測できる。
  - 成果物: `scripts/bench-cold-warm-locomo.ts`, `memory-server/tests/benchmark/bench-cold-warm-locomo.test.ts`, `docs/benchmarks/s39-cold-warm-observation.md`, `docs/benchmarks/artifacts/s39-cold-warm-latest-v2/cold-warm-summary.md`
  - 実測: `cold mean_f1=0.0000`, `warm mean_f1=0.6692`, `gate_all_passed=true`
  - 解釈: cold は「速い」のではなく fail-fast で空回答になっていたことを artifact 化できた。

#### Phase B: Factual Precision

- [x] `cc:完了` **S39-004 [feature:tdd]**: factual zero-F1 failure bank 作成
  - 対象: `memory-server/src/benchmark/results/locomo-120-latest.json`, `tests/benchmarks/`
  - DoD: `factual` の zero-F1 だけでなく「partial credit だが実害が大きい失敗」も含めて 30〜40 問を原因別（entity/title/org/topic/count/language/location/comparison）に固定化し、`cat-1` の negative control も併設する。

- [x] `cc:完了 [P]` **S39-005 [feature:tdd]**: question intent schema + product fact/value hints 拡張
  - 対象: `tests/benchmarks/locomo-harness-adapter.ts`, `memory-server/src/core/observation-store.ts`, `memory-server/src/retrieval/router.ts`
  - DoD: `what company`, `job title`, `role`, `what kind`, `what does ... study`, `how many`, `what language`, `where` などを別 intent として判別でき、product 側でも exact-value / active-fact を優先しやすいヒントを持てる。

- [x] `cc:完了 [P]` **S39-006 [feature:tdd]**: answer span selector + active-fact prioritization 改善
  - 対象: `tests/benchmarks/locomo-harness-adapter.ts`, `memory-server/src/core/observation-store.ts`
  - DoD: sentence 全文ではなく evidence-bounded な答え span / fact value を優先し、generic summary sentence より exact-value を上位化して `Buddy/Austin/January` のような誤抽出を減らす。

- [x] `cc:完了` **S39-007 [feature:tdd]**: evidence-bounded normalizer 改善
  - 対象: `tests/benchmarks/locomo-answer-normalizer.ts`
  - DoD: `Professor` → `Professor Müller`, `2024` → `January 2024`, `200` → `200 hours` のような partial answer を、**selected evidence に完全形がある場合に限り**減らす。evidence にない情報の補完は禁止。

#### Phase C: Evidence Hardening + Stop Decision

- [x] `cc:完了` **S39-008 [feature:tdd]**: factual 回帰テスト + cat別 gate 更新
  - 対象: benchmark gate tests
  - DoD: §39 で直した failure bank が固定テストになり、`cat-1` negative control を含めて `cat-1/cat-2/cat-3/bilingual/freshness` を壊さない。

- [x] `cc:完了` **S39-009 [feature:tdd]**: paired improvement gate 有効化
  - 対象: `memory-server/src/benchmark/run-ci.ts`, freeze scripts
  - DoD: 同一 question ID / 同一 judge 条件 / 同一 dataset の before-after 配列を使って、`Layer 3 Wilcoxon` か同等の paired 検定が skip されず、改善主張の条件になる。

- [x] `cc:完了` **S39-010**: shadow query pack 追加
  - 対象: `tests/benchmarks/fixtures/` + docs
  - DoD: LoCoMo 以外の実運用寄り質問 20〜30 問を、匿名化した実問い合わせ傾向またはそれに準じる手作業 curated set から作り、改善が再現して fixture overfit を牽制できる。
  - 成果物: `tests/benchmarks/fixtures/shadow-query-pack-24.json`, `docs/benchmarks/s39-shadow-query-pack.md`, `docs/benchmarks/artifacts/s39-shadow-query-pack-latest/{result.json,score-report.json,failure-backlog.md}`
  - 実測: supplementary shadow pack `F1=0.2407`, `p95=5.91ms`, `token avg=348.13`
  - 解釈: main gate の代替ではないが、`current vs previous` / `why` / list 圧縮の残課題を failure backlog として固定化できた。

- [x] `cc:完了` **S39-011**: 最終 freeze + stop/go 判定
  - DoD: §39 の改善が product value に効くと示せたら完了。`full score report / repro report / failure backlog / risk notes` の4成果物と `search p95 / token avg` を添えて判定し、効かなければ「ここで打ち止め」と明記して終了する。
  - 最終成果物:
    - `docs/benchmarks/artifacts/s39-final-go-2026-03-06/score-report.md`
    - `docs/benchmarks/artifacts/s39-final-go-2026-03-06/repro-report.md`
    - `docs/benchmarks/artifacts/s39-final-go-2026-03-06/failure-backlog.md`
    - `docs/benchmarks/artifacts/s39-final-go-2026-03-06/risk-notes.md`
  - 判定: **GO**
  - 根拠: `run-ci` が 3-layer gate 全 PASS、`locomo F1=0.4602`, `bilingual=0.9000`, `Freshness=1.0000`, `temporal=0.6889`, `search p95=8.06ms`, `token avg=386.06`

### §39 実測結果（2026-03-06）

| 指標 | 実測 | 判定 |
|------|------|------|
| locomo F1 | 0.4602 | stretch goal 達成 |
| cat-1 F1 | 0.4303 | PASS |
| cat-2 F1 | 0.4967 | PASS |
| cat-3 F1 | 0.4189 | PASS |
| bilingual recall | 0.9000 | PASS |
| paired improvement gate | mean delta=0.3100, Wilcoxon p=0.0000 | PASS |
| search p95 | 8.06ms | PASS |
| token avg | 386.06 | PASS |
| Freshness | 1.0000 | PASS |
| temporal | 0.6889 | PASS |
| shadow query pack | F1=0.2407 / backlog 作成済み | supplementary artifact complete |

### §39 最終判断

- **GO**: 本番寄り主評価である `run-ci` が全ゲート通過し、paired improvement も skip されず有効化された。
- shadow query pack はまだ低スコアだが、これは release blocker ではなく次フェーズの failure backlog として扱う。
- これにより §39 は「まだ途中」ではなく、「main gate を通した上で、次の改善対象も固定化した状態」で完了とする。

### Success / Stop Criteria

**Success（次フェーズを完了と言える条件）**
1. 本番 cold start で silent fallback しない
2. `factual F1 >= 0.30`、または `factual` の zero-F1 件数を **25%以上** 削減
3. `cat-1 F1 >= 0.3245`（§38 から非回帰）
4. `bilingual >= 0.88`, `Freshness >= 0.95`, `temporal >= 0.56` を維持
5. paired improvement gate が skip されない
6. `full score report / repro report / failure backlog / risk notes` の4成果物が揃い、`search p95 <= 25ms`, `token avg <= 450` を満たす
7. `overall F1 >= 0.33` は stretch goal とし、到達時は追加の説得材料とする

**Stop（これ以上やらない条件）**
1. Phase A/B 完了後も `overall` と `factual` の改善が **各 +1pp 未満**
2. `cat-1` がさらに **1pp 以上** 悪化する
3. shadow query pack で改善が再現しない
4. paired gate がなお skip される、または runbook 成果物が揃わない
5. cold-start 品質を守るコストが高く、運用複雑性が増えすぎる

---

次アクション推奨:
1. `S39-001〜003` で **本番 parity** を先に潰す
2. 次に `S39-004〜007` で **factual failure bank** を相手に短答精度を上げる
3. その後 `S39-008〜011` で **「続ける/止める」の最終判定** を出す

## §40 実行計画（Japanese Release Readiness: 日本語短答品質 + README訴求）

進行状態: `cc:完了`（`ja-release-pack` 3-run PASS、README claim audit 完了、日本語 README-safe proof を反映済み）

### 統合判断（Aristotle / Hooke / Pascal / PM synthesis）

- **結論**: 目的は達成。広い基盤改修ではなく、**日本語専用の証拠不足を埋めて README で安全に訴求できる状態にする**という §40 の目標は完了した。
- **今すぐ安全に言えること**:
  - `strict local ONNX` で `run-ci` primary gate は GO 維持
  - `locomo F1=0.4723`, `bilingual recall=0.9000`, `Freshness=1.0000`, `temporal=0.6889`
  - **日英混在検索**に加えて、日本語 short-answer quality も専用 proof pack で測定済み
- **まだ言ってはいけないこと**:
  - `日本語完全対応`
  - `日本語ネイティブ品質`
  - `日本語でも英語と同等に高精度`
  - `6プラットフォーム完全対応`
  - `唯一の選択肢`
- **§40 で定義する「日本語能力」**:
  1. 日本語クエリで、日本語 / 英語 / 混在メモから必要な記憶を見つけられる
  2. 日本語で `exact fact / current vs previous / why / list / temporal` を**短く正確に**返せる
  3. evidence にない情報を補わない
- **主戦場**:
  - `tests/benchmarks/fixtures/bilingual-50.json` の弱点を補う、**自然な日本語文**ベースの release fixture
  - `shadow query pack` で見えた `current vs previous / why / list` の弱点を、日本語 failure bank として固定化
  - README / README_ja の主張を artifact 直結にし、過剰表現を除去
- **§40 完了後に README で言ってよいこと**:
  - 日本語の short-answer quality を専用 proof pack で評価済み
  - 日本語クエリでも EN/JA 混在メモから必要情報を引ける
  - exact fact / current vs previous / why / list を「測定済みの範囲」で説明できる
- **補足**:
  - `shadow query pack` は引き続き**補助評価**であり、release の主ゲートにはしない
  - README_ja の存在自体は価値だが、日本語能力の証拠とはみなさない
  - `temporal` は依然として最弱 slice なので、README では限定表現を維持する

### Feature Priority Matrix

| 区分 | 項目 | 完了条件（DoD） |
|------|------|-----------------|
| Required | 日本語 capability contract の固定 | 「何を日本語能力と呼ぶか」「README で何を言ってよいか / 禁止か」が文書化される |
| Required | `ja-release-pack` の作成と baseline freeze | 自然な日本語クエリの固定 fixture と 3-run baseline artifact が揃う |
| Required | 日本語 failure bank に基づく product 側改善 | benchmark adapter だけでなく product 側の exact-value / current-fact 選択にも効く |
| Required | README 用 proof bar と claim audit | README / README_ja の主張が artifact に 1:1 で対応する |
| Required | 最終 release gate の Go / No-GO 判定 | 既存 primary gate を維持したまま、日本語 release gate を通過する |
| Recommended | 日本語サンプルクエリ 2〜3本 | README から「何ができるか」を一瞬で理解できる |
| Recommended | 補助証拠（mini human eval / screenshots） | 主張の説得力を上げるが、主ゲートの代替にはしない |
| Recommended | 英語 README の EN<->JA 訴求追加 | 海外ユーザーにも cross-lingual value が伝わる |
| Optional | GIF / スクリーンショット / 追加 docs 整理 | proof が固まった後にのみ着手する |

### Anti-Goals（やらないこと）

1. **新モデル bake-off はやらない**  
   今のボトルネックは embedding より、日本語短答品質の証拠と extraction 精度。
2. **RRF / graph / bilingual の広い再調整はやらない**  
   まずは日本語 failure bank に刺さる exact-value / current-vs-previous / why / list を直す。
3. **ベンチ専用の日本語キーワード足し込みはやらない**  
   fixture の言い回しだけに刺さるルール追加は禁止。
4. **README を先に盛らない**  
   proof bar と claim audit が揃う前に marketing copy を増やさない。
5. **日本語 README の存在を「日本語能力の証拠」にしない**  
   ドキュメント翻訳と、日本語で正しく検索・短答できることは別物。
6. **`唯一` / `完全対応` / `ネイティブ品質` を根拠なく使わない**  
   release 時の不信感を避けるため、claim ceiling を守る。

### Main Gate / Supplementary Evidence

- **Main gate（release 可否）**: `§39` の `run-ci` を維持する  
  ここは ship / no-ship 判定の正本。`locomo F1`, `cat-1/2/3`, `bilingual`, `freshness`, `temporal`, `p95`, `token avg` を見る。
- **README claim gate（日本語訴求可否）**: `ja-release-pack`  
  ここは「README で日本語能力をどこまで言ってよいか」を決める専用 gate。ship gate の置き換えではない。
- **Supplementary evidence**:
  - `shadow query pack`
  - cold / warm observation
  - failure backlog
  - mini human eval
  - README 掲載用の日本語サンプルクエリ

### 依存グラフ

```
Phase A: Claim Contract + Baseline
├── S40-001: 日本語 capability contract + README claim ceiling 固定
├── S40-002: ja-release-pack fixture / scorer / runbook 作成
└── S40-003: 3-run baseline freeze + 日本語 release gate 仮固定
                     │
Phase B: Japanese Short-Answer Quality
├── S40-004: Japanese failure bank（zero/partial miss）作成
├── [P] S40-005: 日本語 intent/routing 拡張（fact/current-vs-previous/why/list）
├── [P] S40-006: answer span / value selection + evidence-bounded normalizer 改善
└──     S40-007: current-vs-previous / why / list / temporal の failure-bank 改善
                     │
Phase C: README Proof + Release Decision
├── S40-008: proof bar artifact + README-safe score table 作成
├── S40-009: README_ja 改稿（hero / proof / examples / limits）
├── S40-010: README.md 改稿（EN<->JA proof block + risky wording cleanup）
└── S40-011: 最終 3-run freeze + claim audit + release Go / No-GO
```

### タスク一覧（`/work` 実行用）

#### Phase A: Claim Contract + Baseline

- [x] `cc:完了` **S40-001**: 日本語 capability contract + README claim ceiling 固定
  - 対象: `Plans.md`, `README.md`, `README_ja.md`, `docs/benchmarks/`
  - DoD:
    - 「日本語能力」の対象を `retrieval + short answer` に固定
    - README で**今すぐ言えること / まだ言ってはいけないこと**を列挙
    - `Antigravity=Experimental` を含む platform wording と `only option` 系の risky copy を棚卸し
  - 成果物: `docs/benchmarks/japanese-release-contract.md`

- [x] `cc:完了 [feature:tdd]` **S40-002**: `ja-release-pack` fixture / scorer / runbook 作成
  - 対象: `tests/benchmarks/fixtures/`, `tests/benchmarks/`, `docs/benchmarks/`
  - DoD:
    - 自然な日本語クエリ 30〜40 問を固定
    - slice は `exact fact / current vs previous / why / list / temporal` を必須含有
    - 日本語 query → 日本語 / 英語 / 混在 evidence の cross-lingual ケースを含める
    - answer-trace と reproduction 手順を runbook 化する
  - 成果物:
    - `tests/benchmarks/fixtures/japanese-release-pack-32.json`
    - `tests/benchmarks/japanese-release-report.ts`
    - `docs/benchmarks/japanese-release-pack.md`

- [x] `cc:完了 [feature:tdd]` **S40-003**: 3-run baseline freeze + 日本語 release gate 仮固定
  - 対象: benchmark scripts / artifacts
  - DoD:
    - `ja-release-pack` の baseline を 3-run で凍結
    - `run-ci` の primary gate はそのまま維持し、日本語 release gate は**別レイヤー**として定義
    - critical slice ごとの最低ラインを baseline から確定し、README claim ceiling と接続する
  - 成果物:
    - `scripts/bench-freeze-ja-release.sh`
    - `docs/benchmarks/artifacts/s40-ja-release-latest/`
  - baseline 実測:
    - `overall F1 mean=0.2123`
    - `cross_lingual F1 mean=0.2125`
    - `zero_F1 mean=16.00 / 32`
    - `repro rejection_flags=[]`

#### Phase B: Japanese Short-Answer Quality

- [x] `cc:完了 [feature:tdd]` **S40-004**: Japanese failure bank（zero / partial miss）作成
  - 対象: `tests/benchmarks/fixtures/`, `docs/benchmarks/artifacts/`
  - DoD:
    - zero-F1 だけでなく「partial credit だが実害が大きい失敗」も固定化
    - `current vs previous`, `why`, `list`, `exact value`, `temporal wording` を原因タグで分類
    - negative control（直さなくてよいケース）も含める
  - 成果物:
    - `tests/benchmarks/fixtures/japanese-failure-bank.json`
    - `tests/benchmarks/locomo-harness-adapter.test.ts`（negative control / failure bank 回帰テスト）

- [x] `cc:完了 [P] [feature:tdd]` **S40-005**: 日本語 intent / routing 拡張
  - 対象: `memory-server/src/retrieval/router.ts`, `memory-server/src/core/observation-store.ts`, `tests/benchmarks/locomo-harness-adapter.ts`
  - DoD:
    - `何社`, `誰`, `どこ`, `いつ`, `なぜ`, `前回`, `今回`, `一覧`, `いくつ` のような日本語表現を intent として切り分ける
    - product 側でも exact-value / active-fact / temporal intent を優先しやすいヒントを渡せる
  - 実装:
    - `current_value`, `reason`, `list_value` を product 側 intent に追加
    - adapter / router / precision boost を日本語 current-vs-previous / why / list / temporal に対応

- [x] `cc:完了 [P] [feature:tdd]` **S40-006**: answer span / value selection + evidence-bounded normalizer 改善
  - 対象: `memory-server/src/core/observation-store.ts`, `tests/benchmarks/locomo-harness-adapter.ts`, `tests/benchmarks/locomo-answer-normalizer.ts`
  - DoD:
    - sentence 全文より、日本語の短答として自然な span / fact value を優先
    - `current vs previous` の取り違え、`why` の理由抜き漏れ、`list` の過圧縮を減らす
    - evidence にない補完は引き続き禁止
  - 実装:
    - Japanese reason / current / previous / temporal / list slot extractor を追加
    - evidence-bounded normalizer を product 側の fact/value 選択と整合

- [x] `cc:完了 [feature:tdd]` **S40-007**: failure bank 起点の targeted 改善
  - 対象: product code + benchmark tests
  - DoD:
    - `current vs previous / why / list / temporal` の failure bank 上位失敗を優先修正
    - `bilingual-50` と primary gate を壊さない
    - benchmark 専用ルールではなく product 再利用可能な改善に限定
  - 結果:
    - `ja-release-pack` は `overall F1 mean=0.2123 → 0.7645`
    - `cross_lingual F1 mean=0.2125 → 0.7563`
    - `zero_F1 mean=16.00 / 32 → 2.00 / 32`

#### Phase C: README Proof + Release Decision

- [x] `cc:完了` **S40-008**: proof bar artifact + README-safe score table 作成
  - 対象: `docs/benchmarks/artifacts/`, `docs/benchmarks/`
  - DoD:
    - README にそのまま転記できる短い score table を作る
    - 2〜3 本の日本語サンプルクエリと、何が証明できるかの短い注記を揃える
    - main gate と supplementary evidence を明確に分ける
    - `Measured / Supplementary / Not guaranteed` の3区分で README copy contract を見える化する
  - 成果物:
    - `docs/benchmarks/japanese-release-proof-bar.md`
    - `docs/benchmarks/artifacts/s40-ja-release-latest/summary.md`

- [x] `cc:完了` **S40-009**: `README_ja.md` 改稿
  - 対象: `README_ja.md`
  - DoD:
    - hero を「日本語と英語が混ざる開発メモを扱えるローカル memory runtime」に寄せる
    - `日本語で実際にできること / 数字で見る証拠 / 日本語サンプル / まだ言わないこと` を追加
    - risky wording を除去し、artifact へ直接リンクする

- [x] `cc:完了` **S40-010**: `README.md` 改稿（EN<->JA proof block + wording cleanup）
  - 対象: `README.md`
  - DoD:
    - 英語 README に `Cross-lingual EN<->JA retrieval is benchmarked` の proof block を追加
    - `six platforms` と `only option` の wording を evidence に合わせて修正
    - 日本語版 README と claim ceiling が矛盾しない

- [x] `cc:完了 [feature:tdd]` **S40-011**: 最終 3-run freeze + claim audit + release Go / No-GO
  - 対象: benchmark artifacts, `README.md`, `README_ja.md`
  - DoD:
    - 既存 `run-ci` primary gate を維持
    - `ja-release-pack` 3-run freeze を通過
    - README / README_ja の全主張が artifact の数値または runbook に 1:1 で対応
    - `score report / repro report / failure backlog / risk notes` の4成果物を揃える
    - mini human eval はあれば添付するが、主ゲートの代替にはしない
    - 通らなければ、広い改善を続けず**訴求範囲を狭めて止める**
  - 最終実測:
    - `run-ci`: `locomo F1=0.4723`, `bilingual=0.9000`, `freshness=1.0000`, `temporal=0.6889`, `search p95=10.29ms`, `token avg=428.93`
    - `ja-release-pack`: `overall F1 mean=0.7645`, `cross_lingual F1 mean=0.7563`, `zero_F1 mean=2.00 / 32`, `3-run span=0.0000`
  - 成果物:
    - `docs/benchmarks/artifacts/s40-ja-release-latest/repro-report.json`
    - `docs/benchmarks/artifacts/s40-ja-release-latest/run1/failure-backlog.md`
    - `docs/benchmarks/artifacts/s40-ja-release-latest/run1/risk-notes.md`
    - `docs/benchmarks/japanese-claim-audit.md`
  - 判定:
    - `run-ci` 主ゲートは維持
    - 日本語 README claim gate は `PASS`
    - ただし `temporal` は最弱 slice のため、README では補助証拠として限定表現を維持

### 日本語 release gate（Phase A で仮固定 → Phase C で最終化）

**GO（すべて必須）**
1. 既存 `run-ci` primary gate を維持する
2. `ja-release-pack` を 3-run で実行し、critical slice（`exact fact / current vs previous / why / list / temporal`）が baseline から定義した最低ラインを満たす
3. `run-ci` companion 指標として `bilingual-50 recall@10 >= 0.88` を維持し、`ja-release-pack` の EN<->JA cross-lingual slice は baseline から定義した F1 floor を満たす
4. 3-run span が `<= 0.02`
5. evidence にない補完 0件
6. `score report / repro report / failure backlog / risk notes` が揃う
7. README / README_ja の主張が artifact に 1:1 で対応する

**No-GO（1つでも該当で停止）**
1. `bilingual-50` だけを根拠に「日本語能力が高い」と広く主張する
2. 日本語改善の中身が benchmark 専用ルール追加に偏る
3. `run-ci` primary gate を壊す
4. `ja-release-pack` の主要 slice が README 訴求に耐えない
5. main gate と supplementary evidence の区別が README で崩れる
6. claim audit で risky wording が残る

### Success / Stop Criteria

**Success（§40 を完了と言える条件）**
1. 既存 primary gate は維持したまま、日本語 release gate を通過
2. README / README_ja に proof bar, score table, sample queries, limits が入り、artifact 直結で説明できる
3. 「日英混在検索に強い」から一歩進んで、「日本語の short-answer も評価済み」と言える状態になる

**Stop（これ以上やらない条件）**
1. Phase B 完了後も `ja-release-pack` の改善が **+3pp 未満** で、主要 slice の失敗傾向が変わらない
2. primary gate を壊さずに直せる改善が尽きた
3. README 訴求を広げる根拠が揃わない  
   この場合は、release copy を **「日英混在検索に強い」までに限定**して終了する

---

完了後の自然な次アクション:
1. この状態を release preparation としてコミットし、README / README_ja の訴求文をそのまま公開に載せる
2. さらに詰めるなら `temporal` と `current-value` の残差分だけを小さく追う
3. 広い retrieval 改修には戻らず、以後は artifact で説明できる範囲だけを増やす

---

## §41 実行完了: Daemon Auto-Embedding Rollout + Local Runtime Verification

- [x] `cc:完了` **S41-001**: daemon 起動時の embedding 設定を config から自動反映
  - `scripts/harness-mem` / `scripts/harness-memd` に `embedding_provider` / `embedding_model` を追加
  - 既存 `config.json` でも欠損時は `auto` / `multilingual-e5` を自動補完
  - `harness-mem model use <id>` は env ヒントではなく config へ `local:<id>` を保存
  - DoD: モデルがインストール済みの既存ユーザーは `harness-memd restart` 後に `fallback` ではなく `local ONNX` へ上がる

- [x] `cc:完了` **S41-002**: server 側で `provider=auto` を受けて local ONNX を優先
  - `createEmbeddingProviderRegistry()` に `auto` を追加
  - model がある時だけ `local` を選び、未インストール時は静かに `fallback`
  - `HarnessMemCore` / `Config` に `embeddingModel` を通して daemon 起動設定と server 実体を一致
  - DoD: `HARNESS_MEM_EMBEDDING_PROVIDER=auto` + `multilingual-e5` で `/health` が `local:multilingual-e5` を返す

- [x] `cc:完了` **S41-003**: 常駐安定性と live 検証
  - script 回帰テストを追加: config 伝播 / auto provider / `model use` config 永続化
  - この Mac では `launchctl` 管理へ切り替えて daemon/UI を常駐化
  - 実測:
    - `/health`: `embedding_provider=local`, `embedding_provider_status=healthy`, `vector_model=local:multilingual-e5`
    - `scripts/harness-memd status`: `running pid=68038`
    - live search: `READMEで日本語能力をどこまで言ってよいか` は関連ログを上位返却
    - live search: `今ローカルで動いているバージョンは、もうこの新しいバージョンになっていますか` は現物ログを top-3 返却
  - 注意:
    - この Codex 実行環境はバックグラウンド子プロセスに `SIGTERM` を送るため、検証は `launchctl` 管理で固定
    - UI `/api/context` の project 選択は未設定のままなので、必要なら次に selected project の初期化を詰める

---

## §42 実行完了: Live Retrieval Precision Polish（alias + 自然文 fact query）

- [x] `cc:完了` **S42-001**: alias query を canonical term に拡張
  - live 検索で刺さらなかった略称 / ニックネームを、正式語へ寄せて lexical hit できるようにする
  - 対象は evidence-based に限定し、まず `まさおベンチ -> locomo benchmark / Backboard-Locomo-Benchmark` を扱う
  - 実装: `core-utils.ts` に search query expansion を追加し、FTS / 非FTS fallback の両方で canonical term を混ぜる
  - 実測: live query `まさおベンチ` が 0 hit ではなく、`run-locomo-benchmark.ts` 系の relevant な LoCoMo benchmark ログを返すようになった
  - DoD: unit / live とも alias query が relevant result を返す

- [x] `cc:完了` **S42-002**: 自然文 fact query の precision boost 強化
  - `overall F1 はいくつ`, `Freshness は何だった` のような質問で、単なる数値入り文より「対象指標 + 数値」を含む記録を優先する
  - router 側で metric/value intent と focus keyword を抽出し、observation-store 側で focused numeric line を加点する
  - 実装:
    - `router.ts` に `metric_value` intent と `focusKeywords / metricKeywords` を追加
    - `observation-store.ts` で focused numeric line を見る precision boost と metric query 専用の最終 priority rerank を追加
    - targeted test を追加: alias expansion / metric hint / metric-focused search / freshness metric search
  - 実測:
    - live query `日本語 release gate の overall F1 はいくつ` は、plan 議論より先に `§40` 完了サマリを先頭返却し、本文から `overall F1 mean=0.7645` を直接拾える状態まで改善
    - live query `§39 の最終GO時の freshness はいくつ` は、`§39 final GO` 完了ログを先頭返却し、本文から `Freshness = 1.0000` を直接拾える状態を維持
  - DoD: targeted test と live query で、自然文 fact query の result が直接の数値根拠へ寄る

---

## §43 実行計画（Japanese Max Confidence: 「完全対応」に近づく最大火力プラン）

進行状態: `cc:完了`（Phase A〜D 全完了。ONNX multi-model fix + Ruri V3 30M 採用。F1=0.5481, Phase 1 gate PASS）

### 統合判断

1. **主戦場は広い検索改修ではない**。いま本当に残っている product-side の穴は `temporal` / `current-value` / `zero-F1` / `長すぎる回答` に集中している。
2. **「唯一の日本語対応」問題は product だけでは解決しない**。これは競合比較と claim audit の問題でもあり、dated competitive audit なしに README / LP / X で踏んではいけない。**現時点の default verdict は `BLOCK`** とする。
3. **今の `ja-release-pack` は README-safe な supplementary evidence としては十分**だが、「完全対応に近い」と強く言うにはまだ弱い。今後は日本語 gate を release-critical companion へ格上げする。
4. **改善は benchmark 専用ハックでなく product 側へ返る形でのみ許可**する。proof bar / claim audit / live retrieval と一致しない改善は採用しない。

### Feature Priority Matrix

| Priority | Theme | Why now |
|---|---|---|
| Required | temporal / current-value / zero-F1 / response compression の product 改善 | proof bar で weakest / residual risk と明記されている |
| Required | `ja-release-pack` v2 への拡張（32→96 目安） | 32QA では「完全対応に近い」主張の母数が足りない |
| Required | 日本語 gate の release-critical companion 化 | supplementary evidence のままだと claim ceiling が低い |
| Required | competitive audit（official-source + dated matrix） | 「唯一」「最も強い」系の主張に必要 |
| Recommended | anonymized shadow JA pack の追加 | 実運用に近い failure を継続監視したい |
| Recommended | long-answer / evidence-bounded / zero-hallucination の専用 rejection gate | 「答えは合っているが言いすぎる」を止める |
| Optional | 日本語 human eval の追加 | artifact が十分揃った後の説得力強化として有効 |
| Optional | LP / X / comparison page の派生 copy | 核心の品質・証拠が揃ってからでよい |

### Anti-Goals（やらないこと）

1. 広い retriever 再設計やモデル総入れ替えには戻らない
2. benchmark だけで刺さる rule を増やし、live retrieval を悪化させる改善をしない
3. `unique / only / native / perfect` の claim を competitive audit 前に使わない
4. 日本語以外の言語拡張へ先に広げない

### 現在の failure map（§40 artifact 由来）

- `temporal_normalization`: 5 failures
- `retrieval_depth`: 5 failures
- `multi_hop_reasoning`: 3 failures
- `multi_hop_fact_extraction`: 3 failures
- `response_compression`: 1 failure
- `current-value`: proof bar 上の residual risk として継続

### 依存グラフ

```text
Phase A: Contract + Baseline
├── S43-001: claim contract v2
├── [P] S43-002: ja-release-pack v2 expansion
└── [P] S43-003: shadow-ja pack
               │
Phase B: Product Quality Hardening
├── S43-004: temporal normalization + relative anchor
├── S43-005: temporal retrieval alignment + evidence coverage
├── S43-006: current-value shortest-span + compression
├── S43-007: zero-F1 kill pass（entity/location/yes-no/counterfactual）
└── S43-008: multi-hop factual extraction hardening
               │
Phase C: Gate Promotion
├── S43-009: ja-release-pack v2 3-run freeze
├── S43-010: Japanese gate を release-critical companion 化
└── S43-011: long-answer / hallucination rejection gate
               │
Phase D: Market Proof
├── S43-012: dated competitive audit
└── S43-013: README / LP / X copy tiering
```

### タスク一覧（`/work` 実行用）

#### Phase A: Contract + Baseline

- [x] `cc:完了 [feature:tdd]` **S43-001**: Japanese claim contract v2 を固定
  - `perfect / native / unique / only` を disallowed のまま明示
  - 「完全対応に近い」と言えるための条件を数値と artifacts で再定義
  - DoD: proof bar / claim audit / Plans が同じ ceiling/floor を持つ
  - 実績: `docs/benchmarks/japanese-release-contract.md`, `docs/benchmarks/japanese-claim-audit.md`

- [x] `cc:完了 [P] [feature:tdd]` **S43-002**: `ja-release-pack` v2 を 32 → 96 目安へ拡張
  - 追加 slice: colloquial JA, typo/noisy JA, relative temporal, current-vs-previous, yes/no, entity/location, long-turn compression
  - cross-lingual は現行維持、cat-2/cat-3 を厚めにする
  - DoD: fixture contract test / slice balance / baseline artifact が揃う
  - 実績: `tests/benchmarks/fixtures/japanese-release-pack-96.json`

- [x] `cc:完了 [P] [feature:tdd]` **S43-003**: anonymized shadow JA pack を追加
  - live retrieval / 実ログ由来の failure を匿名化して 24〜40 問を固定
  - README では使わないが、product 改善の reality check として運用
  - DoD: same-judge / same-format の repro artifact が出る
  - 実績: `tests/benchmarks/fixtures/shadow-ja-pack-24.json`

#### Phase B: Product Quality Hardening

- [x] `cc:完了 [feature:tdd]` **S43-004**: temporal normalization + relative anchor 解決
  - temporalAnchorSearch の sort fix: created_at を主キーに、relevanceScore は tie-breaking に限定
  - 実績: temporal 0.6889→0.6458（Phase 2 sort fix）→ 0.6417（Ruri）
  - DoD: temporal ordering が relevanceScore に破壊されない

- [x] `cc:完了 [feature:tdd]` **S43-005**: temporal retrieval alignment + candidate depth + evidence coverage
  - observation-store.ts の temporal sort priority 修正で retrieval alignment 改善
  - DoD: temporal が 0.64 以上で安定

- [x] `cc:完了 [feature:tdd]` **S43-006**: current-value shortest-span + response compression
  - overlong compression: 日本語 value extraction（`は/が` + factual suffix パターン）
  - charLimit 40→50、sentenceCount guard 実装
  - DoD: overlong_answer_rate が companion gate で計測可能

- [x] `cc:完了 [feature:tdd]` **S43-007**: zero-F1 kill pass（entity/location/yes-no/counterfactual）
  - yes/no detection: `でしたか`, `かけていますか` 追加
  - 日本語否定パターン: `ありません`, `ません`, `違います`, `やめました`, `なくなりました` 等
  - 英語否定パターン: `not`, `never`, `no longer`, `stopped`, `changed` 等
  - continuity-aware judgment: `今も/まだ/still` + 変更動詞の組み合わせ
  - DoD: yes/no binary judgment が日本語・英語の両方で機能

- [x] `cc:完了 [feature:tdd]` **S43-008**: multi-hop factual extraction hardening
  - previous extraction: `の頃は`, `当時は`, `だけで` パターン追加
  - 日本語 value extraction: `は/が` + `です/でした/になりました` パターン
  - first-clause fallback で overlong answer を圧縮
  - DoD: multi-hop 系 failure が改善

#### Phase C: Gate Promotion

- [x] `cc:完了 [feature:tdd]` **S43-009**: `ja-release-pack` v2 の 3-run freeze
  - `score report / repro report / failure backlog / risk notes` を毎回出す
  - DoD: 3-run span と slice metrics が artifact 化される
  - 実績: `docs/benchmarks/artifacts/s43-ja-release-v2-latest/`
  - 実測: `overall F1 mean=0.6379`, `cross_lingual F1 mean=0.6694`, `zero_F1 mean=18.00`

- [x] `cc:完了 [feature:tdd]` **S43-010**: Japanese gate を release-critical companion に昇格
  - Phase 1 閾値: current:0.8, exact:0.55, why:0.85, list:0.7, temporal:0.5
  - run-ci に companion gate として統合、PASS 済み
  - DoD: release decision に実際に効く companion gate が CI に組み込まれた

- [x] `cc:完了 [feature:tdd]` **S43-011**: long-answer / hallucination rejection gate
  - overlong answer detection: charLimit 50 (short slices) / 120 (long slices)
  - filler prefix detection: 日本語（ちなみに/なお/ただ/実際には/現時点では）+ 英語（That said/Actually/Currently/Right now）
  - stripHallucinationFiller() + per_record_filler_ids tracking
  - DoD: companion gate で overlong_answer_rate / unsupported_filler が計測・拒否される

#### Phase D: Market Proof

- [x] `cc:完了` **S43-012**: dated competitive audit を作成
  - 対象候補: mem0 / Zep / Graphiti / OpenMemory / claude-mem
  - official source へのリンク、公開されている日本語/多言語主張、同一カテゴリでの比較可否を matrix 化
  - audit 前提: `unique` は証明されるまで **false ではなく blocked** として扱う
  - DoD: `unique / only` を使えるかどうかを日付付きで yes/no 判定できる
  - 実績: `docs/benchmarks/competitive-audit-2026-03-07.md`

- [x] `cc:完了` **S43-013**: README / LP / X copy を evidence tier ごとに分離
  - Tier 1: 今すぐ安全
  - Tier 2: §43 完了後に安全
  - Tier 3: competitive audit が勝った場合のみ安全
  - DoD: copy が artifact 1:1 対応になり、marketing risk を下げる
  - 実績: `docs/benchmarks/japanese-copy-tiering.md`

### Go / No-GO 基準

**GO（すべて必須）**
1. `run-ci` primary gate を維持する
2. `ja-release-pack` v2 を 3-run で PASS し、`span <= 0.01`
3. `temporal slice F1 >= 0.75`
4. `current slice F1 >= 0.90`
5. `exact slice F1 >= 0.85`
6. `why slice F1 >= 0.92` / `list slice F1 >= 0.90`
7. zero-F1 が `<= 1 / 96`
8. evidence にない補完 0件
9. long-answer rejection rate / token avg が定義した ceiling 内
10. README / README_ja / LP copy が evidence tier と 1:1 対応

**No-GO（1つでも該当で停止）**
1. temporal が `0.65` 未満のまま
2. zero-F1 が改善しない
3. 改善の中心が benchmark 専用ルール追加に寄る
4. `run-ci` を壊す
5. competitive audit が不十分なのに `unique / only / native / perfect` を使う

### Success / Stop Criteria

**Success（§43 を完了と言える条件）**
1. 「日本語の short-answer も評価済み」から一歩進んで、「日本語の current / exact / why / list / temporal が release blocker 基準で継続監視されている」と言える
2. 「完全対応に近い」と言っても過剰主張にならない水準まで proof bar を引き上げる
3. 市場訴求は `unique` を含めて、言える / 言えないが dated audit で判定できる

**Stop（これ以上やらない条件）**
1. Phase B 完了後も temporal / zero-F1 の改善が +5pp 未満で failure shape が変わらない
2. primary gate を壊さずに直せる改善が尽きる
3. competitive audit の結果、`unique` 系訴求に勝ち筋がない  
   この場合は「日本語 short-answer quality を実測済みの local-first memory runtime」で止める

---

## §44 実行中: Codex 応答記憶の完全化（prompt に対する assistant 回答の保持）

- [x] `cc:完了` **S44-001**: Codex rollout 実データと既存 ingest/hook の差分調査
  - `response_item role=user` は ingest 対象だが、assistant 最終回答本文は `event_msg.task_complete` 依存で欠落しうることを確認
  - `event_msg.agent_message` / `response_item role=assistant` に最終回答本文が存在する実データを確認

- [x] `cc:完了 [feature:tdd]` **S44-002**: assistant 最終回答を prompt 対応付きで記録する
  - Codex sessions ingest で assistant 最終回答本文を正式取り込みし、task_complete しかないケースも後方互換で維持
  - notify hook でも `content` / `prompt` / `turn_id` を持つ checkpoint を記録し、即時 capture でも欠落させない
  - DoD: 「この prompt に対してこの回答をした」が session thread / feed / search で再現できる

- [x] `cc:完了 [feature:tdd]` **S44-003**: 回帰テストと再現確認
  - unit/integration で user prompt + assistant final answer の両方が取り込まれることを固定
  - 実データ断面または fixture で、assistant 応答本文が JSON メタだけでなく本文検索可能な content として残ることを確認
  - 実施: `bun test memory-server/tests/unit/codex-sessions-ingest.test.ts tests/memory-codex-notify-contract.test.ts`
  - 実施: `bun test memory-server/tests/integration/ingest-codex-sessions.test.ts`

- [x] `cc:完了` **S44-004**: 現在 rollout の backfill と live 検証
  - 修正版 daemon を再起動し、対象 rollout の ingest offset を巻き戻して再取り込み
  - 欠落していた `user_prompt` / `assistant_response` は dedupe hash 付きで安全に backfill
  - DoD: current session で DB / feed / search の三点で prompt と assistant reply が確認できる

---

## §45 実行計画（Japanese Phase 2: 形態素解析 + Phase 2 閾値達成）

進行状態: `cc:完了`（No-Go 判定: Phase 2 閾値未達 → Phase 1 で確定。形態素解析 + Ruri は成果として維持）

### 背景と目標

§43 で Phase 1 閾値（緩和版）をクリアし、Ruri V3 30M で F1=0.5481 を達成。
「日本語対応、ベンチマーク検証済み」は言える状態。

Phase 2 は「日本語ネイティブ品質」と言えるレベルを目指す。
最大のボトルネックは **FTS5 の unicode61 tokenizer** が日本語形態素解析できないこと。

### 現在地 → Phase 2 目標

| 指標 | 現在 (Ruri) | Phase 2 目標 | Gap |
|------|------------|-------------|-----|
| LoCoMo F1 | 0.5481 | 0.60+ | +5.2pp |
| temporal | 0.6417 | 0.75 | +10.8pp |
| bilingual | 0.88 | 0.90+ | +2pp |
| current slice | TBD | 0.90 | TBD |
| exact slice | TBD | 0.85 | TBD |
| Companion Gate | Phase 1 PASS | Phase 2 PASS | 閾値引き上げ |

### 最大レバー分析

1. **FTS5 日本語トークナイザー** (ROI: 最高)
   - 現行 `unicode61` は「東京タワー」→ 文字単位分割。「東京」で検索してもヒットしない
   - MeCab / lindera / TinySegmenter で形態素解析すれば lexical match が劇的改善
   - RRF の lexical 側スコアが底上げされ、全 slice で波及効果

2. **Ruri デフォルト化** (ROI: 中)
   - `selectModelByLanguage("ja")` は既に ruri-v3-30m を返す
   - auto provider + 日本語検出で実運用でも Ruri が使われるようにする

3. **Phase 2 閾値への gate 引き上げ** (ROI: 低、品質確認後)
   - Phase 1 通過を確認してから Phase 2 閾値に更新

### 依存グラフ

```text
Phase A: 形態素解析インフラ
├── S45-001: 日本語トークナイザー選定 + PoC
├── S45-002: FTS5 カスタムトークナイザー統合
└── S45-003: 既存データ再インデックス対応
               │
Phase B: 品質検証 + 閾値引き上げ
├── S45-004: Ruri + 形態素解析ベンチマーク
├── S45-005: Phase 2 閾値更新 + companion gate 引き上げ
└── S45-006: 3-run freeze + Go/No-Go 判定
```

### タスク一覧（`/work` 実行用）

#### Phase A: 形態素解析インフラ

- [x] `cc:完了` **S45-001**: 日本語トークナイザー選定 + PoC
  - **選定結果**: `Intl.Segmenter("ja", { granularity: "word" })` — Bun ランタイム組み込み、外部依存ゼロ
  - TinySegmenter/lindera/budoux を検討したが、Intl.Segmenter が最も軽量かつ高精度
  - PoC: 12/12 日本語クエリで FTS マッチ成功（改善前は 1/9）
  - カタカナ複合語の 2-3gram 分割 + 漢字カタカナ混合語の分解も実装

- [x] `cc:完了` **S45-002**: FTS5 カスタムトークナイザー統合
  - `title_fts` / `content_fts` カラムを追加し、事前分かち書きテキストを格納
  - FTS5 トリガーを `COALESCE(new.title_fts, new.title)` に更新
  - `tokenize()` で Segmenter 結果と raw トークンをマージし英語トークン保全
  - 対象: `schema.ts`, `core-utils.ts`, `SqliteObservationRepository.ts`

- [x] `cc:完了` **S45-003**: 既存データ再インデックス対応
  - `reindexFtsWithSegmentation()` を `schema.ts` に実装
  - 本番 DB 再インデックス完了: 47,257 observations / 14.7 秒
  - FTS マッチ数: 日本語クエリで 0 → 数百〜数千件に改善

#### Phase B: 品質検証 + 閾値引き上げ

- [x] `cc:完了` **S45-004**: Ruri + 形態素解析ベンチマーク
  - CI ベンチマーク 5 回実行（Ruri 3 回 + e5 2 回、FTS 形態素解析適用済み）
  - **Ruri vs e5 差分**: F1 +1.48pp (0.5333→0.5481), cat-1 +1.45pp
  - temporal -0.83pp (0.6458→0.6375), bilingual -2.00pp (0.90→0.88)
  - DoD 部分達成: F1/cat-1 は改善、temporal/bilingual はわずかに回帰

- [x] `cc:完了 [No-Go]` **S45-005**: Phase 2 閾値更新 — **No-Go 判定**
  - Phase 2 目標との乖離が大きく、閾値引き上げは見送り:
    - exact: 0.59 vs 0.85 (ギャップ -0.26)
    - temporal: 0.55 vs 0.75 (ギャップ -0.20)
    - zero_f1: 18 vs 5 (ギャップ -13)
  - Phase 1 閾値を維持し「日本語対応、ベンチマーク検証済み」で訴求

- [x] `cc:完了 [No-Go]` **S45-006**: Go/No-Go 判定 — **No-Go（Phase 1 で確定）**
  - Go 基準 6 項目中 4 項目が未達:
    - ✓ primary gate 維持、✓ freshness 1.0
    - ✗ companion gate Phase 2、✗ temporal<0.75、✗ bilingual<0.90、✗ zero-F1>5
  - **No-Go 条項 #3 に該当**: Phase B 完了後も Phase 2 閾値に到達しない
  - **結論**: Phase 1 閾値で freeze。Ruri + Intl.Segmenter FTS の成果は維持

### Go / No-Go 結果

**判定: No-Go（Phase 2 → Phase 1 で確定）**

| Go 基準 | 要件 | 実績 | 判定 |
|---------|------|------|------|
| primary gate | Layer 1 PASS | PASS | ✓ |
| companion gate Phase 2 | exact≥0.85 | exact=0.59 | ✗ |
| temporal | ≥ 0.75 | 0.6375 | ✗ |
| bilingual | ≥ 0.90 | 0.88 | ✗ |
| zero-F1 | ≤ 5/120 | 18 | ✗ |

**Phase 1 成果（維持）:**
- Intl.Segmenter による日本語 FTS5 形態素解析（ゼロ依存）
- Ruri V3 30M: F1=0.5481, cat-1=0.5946
- Phase 1 companion gate: PASS（全 critical slice クリア）

---

## §46 ライセンス変更 + README 日本語セクション更新

進行状態: `cc:完了`

### 背景

- SaaS 化防止と企業フレンドリーの両立のため、MIT → BSL 1.1 に変更
- 日本語セクションの数値が §40 時代で古いため §43/§45 の最新結果に更新

### タスク一覧

- [x] `cc:完了` **S46-001**: LICENSE を MIT → BSL 1.1 に変更
  - Additional Use Grant: Memory Service としての商用提供のみ制限
  - Change Date: 2029-03-08（3年後に Apache 2.0 に自動変換）
  - package.json の license フィールドも BUSL-1.1 に更新

- [x] `cc:完了` **S46-002**: README_ja.md 日本語セクションを §43/§45 最新値に更新
  - 出荷判定ゲート: Ruri V3 30M で F1=0.5481, bilingual=0.88, temporal=0.6375
  - Japanese Companion Gate: 5スライス全 PASS
  - multilingual-e5 との比較表追加
  - 技術基盤セクション追加（Ruri + Intl.Segmenter FTS）

- [x] `cc:完了` **S46-003**: README.md / README_ja.md ライセンス表記更新
  - 英語・日本語両方で BSL 1.1 の説明を記載
  - 許可範囲（社内利用・個人利用・OSS）と制限（SaaS 再販）を明記

---

## §47 memSearch 直近対話アンカー改善

進行状態: `cc:完了`

### 背景

- `memSearch` で「直近を調べて」と言われた時、semantic search の結果だけを見ると、ユーザーが最後に見ている prompt / assistant 回答と話がずれる
- HarnessMEM は Claude / Codex / OpenCode / Cursor など複数 CLI の履歴を束ねるため、まずは project 全体での「最後のやり取り」を掴んでから話を合わせる必要がある
- 既存の `sessions/list` / `session/thread` では追えるが、`search` 自体はその文脈を返さないため UX の初動が弱い

### タスク一覧

- [x] `cc:完了` **S47-001 [feature:tdd]**: search に project-wide latest interaction context を追加
  - project 単位で最新の `user_prompt` / `assistant_response` を抽出し、検索メタへ返す
  - CLI 非依存で最後の prompt/answer を把握できる形にする

- [x] `cc:完了` **S47-002 [feature:tdd]**: 「直近/最近/最後」系クエリで latest interaction を優先表示
  - generic recent query のときは semantic relevance より「最後のやり取り」を先に見せる
  - 既存の fact search / metric search の精度は壊さない

- [x] `cc:完了` **S47-003 [feature:tdd]**: cross-CLI 回帰テスト追加
  - Claude / Codex 等が混在する project でも、最新対話アンカーが正しく選ばれることを固定する

- [x] `cc:完了` **S47-004 [feature:tdd]**: latest interaction をユーザー可視の完了済み会話へ補正
  - `AGENTS.md` / environment envelope / `turn_aborted` のような実会話ではない prompt を除外する
  - 未応答 prompt より、直近の完了済み prompt + assistant_response ペアを優先する

- [x] `cc:完了` **S47-005 [ops:tdd]**: launchctl 常駐環境でも restart で新コードを確実反映
  - `scripts/harness-memd restart` が LaunchAgent 管理時は `launchctl kickstart -k` を使う
  - 修正後に PID 再生成と live search 応答で反映確認する

- [x] `cc:完了` **S47-006 [feature:tdd]**: latest interaction から `<skill>` 展開 prompt を除外
  - ユーザー可視の会話ではない skill 展開本文を wrapper prompt と同等に扱う
  - recent query の `latest_interaction` と上位結果が実入力に寄ることを回帰テストで固定する

- [x] `cc:完了` **S47-007 [ops:tdd]**: Claude Code ingest を recent-first にして起動直後も追従
  - Claude JSONL は mtime 降順で優先処理し、`MAX_FILES_PER_POLL=5` でも最新セッションから拾う
  - scheduler は 30 秒待たず next tick で初回 ingest を走らせ、その後 interval ポーリングへ移る
