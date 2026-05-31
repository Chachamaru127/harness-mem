# Handoff Pack (sample output)

これは `examples/senpai-note/demo-session.md` を入力にしたときに、Senpai Note Agent が
生成する handoff pack の完成イメージです。非メンテナでも読めることを目標にしています。

---

source: user-provided (examples/senpai-note/demo-session.md, memory unavailable / demo mode)
summary: harness-mem search が重い時の安全な調査手順を、次の人が 30 秒で引き継げる handoff pack に変換した。

## HANDOFF_CARD

### Start here
`harness-mem mcp-gateway status` で daemon と gateway が生きているかを最初に確認する。

### Current conclusion
search が遅い / `503` を返すのは記憶が無いからではなく、daemon を固めないための
backpressure。範囲を絞って bounded に再試行すれば回復する。

### Decisions
- まず project-scoped search から始める（広域 unscoped search は forensic/admin 時のみ）。
- `503` は retry/fallback の signal として扱う。
- memory が degraded なときは SSOT ファイルで回答を続け、fallback を source に明記する。

### Still open
- どの `limit` 値が「広げる前の最小」として最適かは未確定。まず 5 から。
- embedding warmup 中の挙動はこのデモ範囲外。

### Do not repeat
- `503` を「記憶なし」と誤解して調査を打ち切ること。
- いきなり unscoped 広域 search を叩くこと。
- fallback mode を user に黙って使うこと。

### Next best action
現在の repo を `project` に渡し、`limit=5` で `harness_mem_search` を 1 回だけ叩く。

## RUNBOOK

### Use when
harness-mem の recall/search が遅い、固まる、`503` を返すとき。

### Preconditions
- harness-mem daemon と local MCP gateway が起動している。
- 対象 repo / project 名が分かる（cwd から推定可）。

### Steps
1. gateway と daemon の生存を確認する。
2. cwd / repo から `project` を解決する。
3. `project` を渡し、小さい `limit` で scoped search を 1 回叩く。
4. `503` や遅延なら、範囲を絞って bounded に再試行する。
5. それでもダメなら SSOT ファイルに切り替え、source に fallback を明記する。

### Commands / checks
（実際の出力では bash code block にコマンドを置く）
- `harness-mem doctor --platform codex`
- `harness-mem mcp-gateway status`

### Expected result
gateway/daemon が green。scoped search が数件を bounded に返す。再試行で 503 が解消する。

### Failure signs
- 連続して `503` が返る。
- search が無応答で固まる。
- gateway status が daemon 未起動を示す。

### Recovery
- `limit` を下げ、`project` を渡し、必要なら `vector_search=false` で 1 回だけ再試行。
- 回復しなければ SSOT (`decisions.md` / `patterns.md`) と現在ファイルで回答を続ける。

### Risks
- unscoped 広域 search は daemon をさらに固めるので避ける。
- private タグ付き content は user の明示許可なしに出さない。

### Evidence
- user-provided: examples/senpai-note/demo-session.md（Decisions / Gotchas）

## REPLAY_PROMPT

You are continuing a prior AI coding session.
Goal:
harness-mem の recall/search が遅い/503 を返す状況を、安全に調査して回復させる。
Known context:
- 503 は記憶なしではなく backpressure。
- project-scoped + small limit から始めるのが正しい。
- degraded 時は SSOT ファイルで回答を続け、fallback を source に明記する。
First actions:
1. gateway/daemon の生存を確認する。
2. project を渡して limit=5 で scoped search を 1 回叩く。
Do not:
- 503 を「記憶なし」と解釈して調査を止めない。
- unscoped 広域 search から始めない。
Use these checks:
（実際の出力では bash code block に command を置く）
- harness-mem mcp-gateway status
Evidence:
user-provided: examples/senpai-note/demo-session.md
