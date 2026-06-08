# README 主張マップ

このドキュメントは、README のユーザー向け主張を、それを支える正本に対応付けるものです。
公開文言を変える前に確認してください。対応する SSOT マトリクスは
[`benchmark-claim-ssot-matrix-2026-03-13.md`](./benchmarks/benchmark-claim-ssot-matrix-2026-03-13.md) です。
プロジェクト全体の product boundary は [`Spec.md`](../Spec.md) を正とし、
公開文言はその product spec と下記の実測証拠を超えないようにしてください。

## ルール

- README の公開文言は、記憶ではなく証拠に基づかせる。
- 計測値がある主張は、artifact の path とスコープを明記する。
- 主張が bounded の場合は、注記欄で境界をはっきり書く。
- 歴史値や deprecated な値は、現行値として扱わない。

## 英語 README の主張マップ

| README の主張 | 正本 | 状態 | 注記 |
|---|---|---|---|
| Local project memory for AI coding sessions — a continuity runtime, not a generic memory API. | `README.md`、architecture docs、supported tools 一覧 | bounded | スコープは Claude Code + Codex (Tier 1) / Cursor (Tier 2) の local runtime に限定。Every agent 表現には拡げない。S108-011。 |
| Stop re-explaining yesterday's work. | session continuity docs と `docs/harness-mem-setup.md` の hook 挙動 | bounded | hook path が健全で daemon が動作している場合に成立する。 |
| ~5ms cold start. | `memory-server/src/benchmark/results/ci-run-manifest-latest.json` と Go MCP の bench artifact | measured | スコープは Go MCP 層の cold start であり、アプリ全体ではない。 |
| Zero cloud, zero API keys. | local SQLite の architecture と setup guide | stable | core runtime は local のまま。任意の外部連携まで含めて拡張しない。 |
| Claude Code と Codex が同じ local memory runtime を共有する。 | setup guide と architecture docs | bounded | 対応している Claude Code / Codex 経路にのみ適用される。 |
| 新規 Claude Code / Codex setup は local Streamable HTTP MCP gateway を default にする。 | `Spec.md` MCP Transport Defaults、`docs/adr/ADR-004-local-streamable-http-mcp-default.md`、`CHANGELOG.md` v0.25.0 | stable | スコープは新規 managed Tier 1 setup。既存 stdio は維持され、stdio rollback は引き続き明記し、Hermes は明示 opt-in のまま。 |
| Codex App はこのメンテナ環境で local dogfood green。 | `docs/codex-app-dogfood-2026-05-26.md`、README supported tools note | dogfood | 再現可能な App 固有 smoke が入るまでは Codex App 全般の Tier 1 claim ではない。Codex CLI が Tier 1 の Codex target。 |
| Cursor は Tier 2 supported local client として対応している。 | `Spec.md` の Cursor Conversation Capture / MCP Transport Defaults、`Plans.md` §131/§132、`docs/harness-mem-setup.md`、README の supported tools セクション | bounded | Cursor support は user-scoped `~/.cursor/hooks.json`、`~/.cursor/mcp.json` の `mcpServers.harness-mem`、hook spool ingest、MCP search、`harness-mem setup --platform cursor` / `harness-mem doctor --platform cursor` による検証を意味する。Tier 1 continuity parity claim ではない。設定後、Cursor 側で MCP reload/restart または新 session が必要な場合がある。 |
| 日本語 / 英語 / code の adaptive routing がある。 | adaptive retrieval docs と benchmark docs | measured | 言語ルーティングの主張は、それを定義している benchmark / design docs に紐づける。 |
| main gate / Japanese companion / historical baseline は別物。 | SSOT matrix | strict | 歴史的な日本語 baseline を現行 companion と混同しない。 |
| CodingMemory Bench 提唱（日本語・混在 coding memory） | `docs/benchmarks/codingmemory-bench.md`、charter、`benchmarks/internal-memory/reports/codingmemory-public/` | bounded | 数値 claim は public scorecard の reproduced 表のみ。self-seed 満点・MAB 英語スコア・hash fallback baseline は不可。 |

## 更新ルール

この表のどれかを変える前に、まず支える証拠を更新し、その後に public copy を変えてください。
