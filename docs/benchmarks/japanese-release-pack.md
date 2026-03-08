# Japanese Release Pack v2

Last updated: 2026-03-07

## 1. Purpose

`japanese-release-pack` は README-safe proof から一段進めて、日本語 gate をより強い companion gate にするための fixture 群です。

この文書は次の 3 ファイルを扱います。

- v1: `tests/benchmarks/fixtures/japanese-release-pack-32.json`
- v2: `tests/benchmarks/fixtures/japanese-release-pack-96.json`
- shadow: `tests/benchmarks/fixtures/shadow-ja-pack-24.json`

## 2. Dataset Roles

### v1 (`32 QA`)

- README-safe proof bar の基礎
- current / exact / why / list / temporal の基本性能を示す

### v2 (`96 QA`)

- current / exact / why / list / temporal を維持したまま、
  - `current_vs_previous`
  - `noisy`
  - `yes_no`
  - `relative_temporal`
  - `long_turn`
  - `entity`
  - `location`
  を追加で監視する

### shadow-ja (`24 QA`)

- anonymized reality check
- README には直接使わない
- product 改善の方向が実運用感からズレていないかを見る

## 3. v2 Fixture Shape

- samples: 16
- QA: 96
- expected slices:
  - `current`
  - `current_vs_previous`
  - `exact`
  - `why`
  - `list`
  - `temporal`
  - `relative_temporal`
  - `yes_no`
  - `noisy`
  - `long_turn`
  - `entity`
  - `location`

## 4. 実行方法

### Single run

```bash
bun run tests/benchmarks/run-locomo-benchmark.ts \
  --system harness-mem \
  --dataset tests/benchmarks/fixtures/japanese-release-pack-96.json \
  --output .tmp/japanese-release-pack-96.result.json
```

### Slice report

```bash
bun run tests/benchmarks/japanese-release-report.ts \
  --dataset tests/benchmarks/fixtures/japanese-release-pack-96.json \
  --result .tmp/japanese-release-pack-96.result.json \
  --output .tmp/japanese-release-pack-96.slice-report.json
```

### 3-run freeze

```bash
scripts/bench-freeze-ja-release.sh \
  --dataset tests/benchmarks/fixtures/japanese-release-pack-96.json \
  --artifact-dir docs/benchmarks/artifacts/s43-ja-release-v2-latest \
  --label s43-ja-release-v2
```

### Shadow JA run

```bash
bun run tests/benchmarks/run-locomo-benchmark.ts \
  --system harness-mem \
  --dataset tests/benchmarks/fixtures/shadow-ja-pack-24.json \
  --output .tmp/shadow-ja-pack.result.json
```

## 5. 4成果物

Each freeze must produce:

1. `score-report.json`
2. `repro-report.json`
3. `failure-backlog.json/.md`
4. `risk-notes.md`

## 6. Reading Rules

- `run-ci` を置き換えない
- `ja-release-pack v2` は companion gate として扱う
- `shadow-ja pack` は reality check のみ
- copy は必ず `Measured / Supplementary / Blocked` に分ける

## 7. Anti-Goals

1. 日本語の言い回しだけに刺さる benchmark hack を増やさない
2. `noisy` や `long_turn` を README の派手な claim に直結させない
3. `shadow-ja pack` を proof bar の代わりにしない
4. competitor audit がない段階で `only / unique` を混ぜない
