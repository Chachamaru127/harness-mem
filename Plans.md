# Harness-mem 実装マスタープラン

最終更新: 2026-03-06（§38 完了 — /breezing all, 3-run freeze PASS, locomo F1=0.3147）
実装担当: Codex / Claude（本ファイルを唯一の実装計画ソースとして運用）

> **アーカイブ**: §0-31 → [`docs/archive/`](docs/archive/) | §32 17タスク完了 | §33 15タスク完了 | §34 20タスク完了 | §35 18完了+2blocked（CI PASS, F1+7.4pp） | §36 15タスク完了（CI PASS, F1+1.43pp, cat-3+9.5pp） | §37 10タスク完了（run-ci PASS, bilingual=0.90） | §38 12タスク完了（3-run freeze PASS, F1=0.3147）

---

## 凡例

`[P]` = 並列可 / `cc:TODO` / `cc:WIP` / `cc:完了` / `blocked`

---

## 現在のステータス

**§38 Retrieval Quality Reform（Trust Lock + Cat2/3改善）— 完了**（2026-03-06, `/breezing all`, 3-run freeze PASS）

| 指標 | §37 | §38 | 変化 |
|------|-----|-----|------|
| locomo F1 (overall) | 0.2651 | 0.3147 | +4.96pp ✅ |
| cat-2 F1 | - | 0.2859 | （§38で新規ゲート化） |
| cat-3 F1 | - | 0.3189 | （§38で新規ゲート化） |
| bilingual recall@10 | 0.90 | 0.90 | ±0 |
| Freshness@K | 0.96 | 0.96 | ±0 |
| temporal score | 0.5667 | 0.5667 | ±0 |
| 3-run span (overall F1 max-min) | - | 0.0000 | ✅ |
| panic/fallback | - | 0件 | ✅ |

成果物:
- `docs/benchmarks/s38-retrieval-quality-freeze-report-2026-03-06.md`（統合報告）
- `scripts/bench-freeze-locomo.sh`（3-run freeze + panic/fallback検知 + summary生成）
- `memory-server/src/benchmark/run-ci.ts`（strict ONNX, manifest履歴, fail-fast厳格化）
- `tests/benchmarks/locomo-harness-adapter.ts`（category強制撤廃 + slot-first抽出）

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
