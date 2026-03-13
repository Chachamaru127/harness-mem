# Benchmark / Claim SSOT Matrix

Last updated: 2026-03-13

## Current truth

| Artifact | Role | Current value | Notes |
|---|---|---|---|
| `memory-server/src/benchmark/results/ci-run-manifest-latest.json` | main ship / no-ship gate | `generated_at=2026-03-12T17:02:35.532Z`, `git_sha=5c009a9`, `all_passed=false` | latest current main gate |
| `docs/benchmarks/artifacts/s43-ja-release-v2-latest/summary.json` | current Japanese companion | `96 QA`, `overall_f1_mean=0.6580`, `verdict=pass` | README-safe current Japanese claim source |
| `docs/benchmarks/artifacts/s40-ja-baseline-latest/summary.json` | historical baseline | `32 QA`, `overall_f1_mean=0.8020`, `verdict=pass` | baseline only, not current claim source |

## Public copy

| File | Role | Source of truth | Rule |
|---|---|---|---|
| `README.md` | public English copy | main manifest + current companion + historical baseline | never write `PASS` when current manifest says `FAIL` |
| `README_ja.md` | public Japanese copy | main manifest + current companion + historical baseline | do not present historical Ruri numbers as current ship gate |
| `docs/benchmarks/japanese-release-proof-bar.md` | proof contract | same as above | keep current, historical, and deprecated aliases separate |
| `Plans.md` | status snapshot | same as above | top status block must include current `generated_at`, `git_sha`, and alias split |

## Derived / deprecated

| Path | Status | Replacement |
|---|---|---|
| `docs/benchmarks/artifacts/s40-ja-release-latest/` | deprecated | historical -> `s40-ja-baseline-latest`, current -> `s43-ja-release-v2-latest` |
| `docs/benchmarks/artifacts/s43-ja-release-v2-latest/run3-old` | removed from latest | canonical family is `run1/run2/run3` |
| `docs/benchmarks/artifacts/s43-ja-release-v2-latest/run3-new` | removed from latest | canonical family is `run1/run2/run3` |

## License surface

| Surface | Truth | Rule |
|---|---|---|
| `LICENSE` + root `package.json` | root repo is `BUSL-1.1` | use this for repo-level licensing |
| `sdk/`, `mcp-server/`, `vscode-extension/` package metadata | package-level SPDX remains package-specific | treat each package `package.json` as authoritative for published subpackages |
| GitHub repo header / API | may show `Other` / `NOASSERTION` | do not use GitHub autodetect badge as SSOT |
