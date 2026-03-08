# Japanese Release Contract v2

Last updated: 2026-03-07

## 1. Goal

`§43` の目的は、日本語対応を雑に強く言うことではありません。

目的は次の 3 つです。

1. `README-safe supplementary evidence` のままになっている日本語評価を、より強い release companion へ引き上げる
2. `temporal / current-value / zero-F1 / long-answer` の残差分を artifact 付きで詰める
3. `README / LP / X` の copy を evidence tier ごとに分離し、過剰主張を防ぐ

## 2. Gate Separation

### Main gate

release 可否の正本は引き続き `run-ci` です。

- `LoCoMo F1`
- `cat-1 / cat-2 / cat-3`
- `bilingual recall`
- `Freshness`
- `temporal`
- `search p95`
- `token avg`

### Japanese companion gate

日本語訴求の companion gate は `ja-release-pack v2` です。

- dataset: `tests/benchmarks/fixtures/japanese-release-pack-96.json`
- expected artifacts:
  - `score-report.json`
  - `repro-report.json`
  - `failure-backlog.json/.md`
  - `risk-notes.md`
- output root:
  - `docs/benchmarks/artifacts/s43-ja-release-v2-latest/`

この gate は `run-ci` の置き換えではなく、`run-ci` を維持した上で release 判断に効かせる companion です。

## 3. What "Japanese Capability" Means in v2

このフェーズで扱う日本語能力は次に限定します。

1. 日本語クエリで、日本語 / 英語 / 混在メモから必要な情報を引ける
2. 日本語で `current / exact / why / list / temporal / yes_no` を短く返せる
3. current-vs-previous の取り違えを減らす
4. long-turn / noisy / colloquial な日本語でも、evidence を外さずに短答できる
5. evidence にない情報を補わない

## 4. Dataset Contract

### Release pack v1

- file: `tests/benchmarks/fixtures/japanese-release-pack-32.json`
- size: 16 samples / 32 QA
- role: README-safe proof の基礎

### Release pack v2

- file: `tests/benchmarks/fixtures/japanese-release-pack-96.json`
- target size: 16 samples / 96 QA
- required additions:
  - `current_vs_previous`
  - `noisy`
  - `yes_no`
  - `relative_temporal`
  - `long_turn`
  - `entity / location`

### Shadow JA pack

- file: `tests/benchmarks/fixtures/shadow-ja-pack-24.json`
- role: anonymized, reality-check oriented, non-README fixture
- note: supplementary monitoring only; main gate の代替にはしない

## 5. Claim Ladder

### Tier 1: safe now

- `Cross-lingual EN<->JA retrieval is benchmarked.`
- `Japanese short-answer quality is evaluated on a dedicated release pack.`
- `Primary release gate remains run-ci; Japanese proof is supplementary.`

### Tier 2: safe after v2 freeze passes

- `Japanese current / exact / why / list / temporal / yes-no slices are tracked in a dedicated release companion gate.`
- `Japanese noisy / long-turn / current-vs-previous regressions are covered by a larger v2 release pack.`
- `README / LP / X copy is constrained by artifact-backed evidence tiers.`

### Tier 3: blocked until separate proof

- `native Japanese quality`
- `works perfectly in Japanese`
- `every Japanese question is accurate`
- `only option`
- `best in market`

`unique / only / best` は competitor audit 完了まで blocked のままです。

## 6. v2 Success Criteria

`§43` の docs/eval 側で最低限そろえるもの:

1. `japanese-release-pack-96.json` が存在し、96 QA を満たす
2. `shadow-ja-pack-24.json` が存在する
3. freeze script が dataset / artifact_dir を可変で受け取れる
4. proof bar / claim audit / copy tier が同じ ceiling を共有する
5. `Temporal is still the weakest slice` のような residual risk が copy に残る

## 7. Disallowed Shortcuts

1. benchmark 専用の日本語キーワード足し込みで score だけを上げない
2. `shadow-ja pack` を release main gate にしない
3. docs の翻訳や README の存在を日本語能力の証拠にしない
4. competitor audit 前に `unique / only / native / perfect` を使わない
