# README 主張マップ

このドキュメントは、README のユーザー向け主張を、それを支える正本に対応付けるものです。
公開文言を変える前に確認してください。対応する SSOT マトリクスは
[`benchmark-claim-ssot-matrix-2026-03-13.md`](./benchmarks/benchmark-claim-ssot-matrix-2026-03-13.md) です。

## ルール

- README の公開文言は、記憶ではなく証拠に基づかせる。
- 計測値がある主張は、artifact の path とスコープを明記する。
- 主張が bounded の場合は、注記欄で境界をはっきり書く。
- 歴史値や deprecated な値は、現行値として扱わない。

## 英語 README の主張マップ

| README の主張 | 正本 | 状態 | 注記 |
|---|---|---|---|
| One project. One memory. Every AI coding agent. | `README.md`、architecture docs、supported tools 一覧 | bounded | 対応している local runtime surface については正しいが、将来の全クライアントを保証するものではない。 |
| Stop re-explaining yesterday's work. | session continuity docs と `docs/harness-mem-setup.md` の hook 挙動 | bounded | hook path が健全で daemon が動作している場合に成立する。 |
| ~5ms cold start. | `memory-server/src/benchmark/results/ci-run-manifest-latest.json` と Go MCP の bench artifact | measured | スコープは Go MCP 層の cold start であり、アプリ全体ではない。 |
| Zero cloud, zero API keys. | local SQLite の architecture と setup guide | stable | core runtime は local のまま。任意の外部連携まで含めて拡張しない。 |
| Claude Code と Codex が同じ local memory runtime を共有する。 | setup guide と architecture docs | bounded | 対応している Claude Code / Codex 経路にのみ適用される。 |
| Cursor は低い tier で対応している。 | README の supported tools セクション | descriptive | これは support tier の表現であり、品質の同等性主張ではない。 |
| 日本語 / 英語 / code の adaptive routing がある。 | adaptive retrieval docs と benchmark docs | measured | 言語ルーティングの主張は、それを定義している benchmark / design docs に紐づける。 |
| main gate / Japanese companion / historical baseline は別物。 | SSOT matrix | strict | 歴史的な日本語 baseline を現行 companion と混同しない。 |

## 更新ルール

この表のどれかを変える前に、まず支える証拠を更新し、その後に public copy を変えてください。
