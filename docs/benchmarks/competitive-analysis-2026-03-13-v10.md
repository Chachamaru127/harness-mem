# Competitive Analysis v10

Snapshot date: 2026-03-13 JST

## Verdict

harness-mem の current self-score は `108/140`、換算で `77/100 (B+)`。

コード基盤は強いままですが、current main gate が `FAIL` のため、公開競争力はまだ `A` へ戻していません。§49 で最大の失点要因だった benchmark / claim drift は修復済みです。

## Evidence order

1. `memory-server/src/benchmark/results/ci-run-manifest-latest.json`
2. `docs/benchmarks/artifacts/s43-ja-release-v2-latest/summary.json`
3. `docs/benchmarks/artifacts/s40-ja-baseline-latest/summary.json`
4. `README.md` / `README_ja.md` / `docs/benchmarks/japanese-release-proof-bar.md`
5. GitHub official repo metadata (`2026-03-13` pull)

## Current scorecard

| Axis | Score | Note |
|---|---:|---|
| Memory Model | 8/10 | event/session/resume は強い |
| Search / Retrieval | 9/10 | hybrid retrieval と benchmark 投資は上位圏 |
| Storage Flexibility | 8/10 | SQLite/Postgres abstraction は有効 |
| Platform Integration | 10/10 | multi-tool breadth が最大の強み |
| Security | 7/10 | local-first は強いが enterprise proof は薄い |
| UI / Dashboard | 8/10 | Mem UI と analytics 面はある |
| Consolidation / Dedup | 8/10 | consolidation / dedupe 実装あり |
| Graph / Relations | 7/10 | graph API はあるが Graphiti 級ではない |
| Privacy / Local-first | 9/10 | default local は明確な強み |
| Multi-user / Team | 7/10 | productization はまだ弱い |
| Cloud / Hosted | 5/10 | local-first の裏返しで hosted 面は弱い |
| Multi-modal | 6/10 | artifact-backed 訴求はまだ薄い |
| Benchmark / Eval | 7/10 | SSOT drift は修復したが current main gate は fail |
| Temporal Reasoning | 9/10 | companion temporal は改善したが main gate fail が残る |

Total: `108/140`

## Public traction snapshot

GitHub official metadata pulled on 2026-03-13:

| Project | Stars | pushed_at (UTC) | Positioning note |
|---|---:|---|---|
| `mem0ai/mem0` | 49,561 | 2026-03-12T15:08:15Z | ecosystem / SDK / hosted story が強い |
| `thedotmack/claude-mem` | 34,318 | 2026-03-11T03:40:38Z | traction は大きいが Claude-centric |
| `getzep/graphiti` | 23,635 | 2026-03-11T19:23:05Z | graph / temporal positioning が明確 |
| `supermemoryai/supermemory` | 16,891 | 2026-03-11T03:57:18Z | benchmark / connectors / MCP story が強い |
| `Chachamaru127/harness-mem` | 3 | 2026-03-11T00:21:26Z | local-first multi-tool runtime として差別化 |

## Safe copy after v10

- `A local-first option designed for multi-tool workflows.`
- `Cross-lingual EN<->JA retrieval is benchmarked.`
- `Japanese short-answer quality is evaluated on dedicated release packs.`
- `Current Japanese companion passes while the main release gate is currently failing.`

## Still blocked

- `only option`
- `unique`
- `best in market`
- `current release gate passes`
