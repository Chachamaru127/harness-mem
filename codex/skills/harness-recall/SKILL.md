---
name: harness-recall
description: User が「思い出して」「覚えてる」「今何してた」「前回」「続き」「resume」「recall」等の recall 意図を発話したときに invoke する Skill。intent を 5 分岐に分類し、適切な MCP tool (harness_mem_resume_pack / harness_mem_sessions_list / harness_mem_search / harness_cb_recall) もしくは SSOT (decisions.md / patterns.md) に routing して、source を明示した 1 行要約で回答する。
trigger_phrases:
  - 思い出して
  - 覚えてる
  - 覚えている
  - 今何してた
  - 今なにしてた
  - 前回
  - 続き
  - resume
  - recall
  - 直近
  - 最後に
  - 先ほど
  - さっき
---

# harness-recall

harness-mem が抱える 5 層の記憶経路 (auto-memory / SSOT / harness-mem DB / checkpoint-bridge / session-notes) を、user の recall 意図に合わせて即座に正しい経路に分岐させるための Skill。配布ユーザーは何も設定せず、「思い出して」と喋るだけで発火する。

## 発火条件

この Skill は次の語を含む user prompt を検知したときに invoke する:

- 「**思い出して**」「**覚えてる**」「**覚えている**」
- 「**今何してた**」「**今なにしてた**」
- 「**前回**」「**続き**」「**直近**」「**最後に**」「**先ほど**」「**さっき**」
- 英語: **resume**, **recall**

発火の冗長化のため、harness-mem の `codex-user-prompt.sh` がこれらの語を検出した際に `harness-recall` invoke を促す追加 instruction を `additionalContext` に注入する。description 経由 + 注入経由の二重化で取りこぼしを防ぐ。

## Intent 分類と Routing

user 発話の意図を次の 5 分岐に分類し、該当 tool / 資料を先に参照する:

| Intent | 典型発話 | 1 次 routing |
|--------|---------|--------------|
| resume / 続き | 「続きから」「resume」「今何してた?」「直前どこまでやった?」 | **harness_mem_resume_pack** |
| decisions / 方針 | 「何を決めた?」「方針は?」「結論は?」 | **decisions.md** (`.claude/memory/decisions.md`) → 併せて `patterns.md` |
| 前に踏んだ同じ問題 | 「前にも見た気が」「既知問題?」「また同じ error」 | **harness_cb_recall** (checkpoint-bridge recall) |
| 直近 session | 「直近のセッション一覧」「最後に開いた session は?」 | **harness_mem_sessions_list** + 必要に応じて `harness_mem_session_thread` |
| 特定キーワード | 「§78 の retrieval 話」「XR-003 の経緯」 | **harness_mem_search** (`project` を推定できる時は必ず渡す。facets は `query` / `project` / `session_id` などで scoped にする) |

複数 intent に跨るときは上から順に試す。1 経路で 0 件なら次経路へ fallback する。

## S127 後の検索安全ルール

S127 以降の search は「固まらないこと」を優先して bounded に動く。recall の UX は、広く探すよりも正しい scope で素早く当てることを優先する。

- 検索前に、現在の cwd / repo / user が言及したプロジェクト名から `project` を解決する。推定できるなら `project` 指定は原則必須。project なし検索は、明示的な横断調査 / forensic / admin か、scoped miss を source に出した後だけにする。
- 複数の Claude / Codex project を並行している時は、まず現在の cwd / repo を `project` として `harness_mem_search` に渡す。現在 project の事実確認では `strict_project=true` を優先する。
- `harness_mem_search_facets` は補助ツール。無指定では呼ばない。`query` か `project`、または tenant/access scope を渡す。`400 search_facets_unbounded` は「記憶なし」ではなく「範囲を絞って」という合図。
- 重い `harness_mem_search` は `503` を返すことがある。これは daemon を固めないための backpressure であり、検索失敗や記憶欠落ではない。`query` を絞る、`project` を渡す、`limit` を下げる、必要なら `vector_search=false` で 1 回だけ再試行する。
- それでも `503` の場合は、`source:` に `503 backpressure` と書き、SSOT (`decisions.md` / `patterns.md`) と現在ファイルで回答を続ける。
- project を推定できない場合は、無言で広域検索せず `source:` に `project=unknown` を明記してから、必要最小限の検索か SSOT 参照に切り替える。

## MCP transport 診断メモ

- 新規 Claude Code / Codex setup は local HTTP MCP gateway default。検索 tool が見えない時は、まず `harness-mem doctor --platform codex` と `harness-mem mcp-gateway status` で client config / gateway / daemon を分けて見る。
- Codex の `url is not supported for stdio` は検索品質や daemon の問題ではなく、`[mcp_servers.harness]` の config 形状衝突。`url` と `command` / `cwd` / `args` / `env` が同じ stanza に混在していないかを先に直す。
- stdio に戻す時は `harness-mem mcp-config --transport stdio --client codex --write`。memory DB は触らない。

## 出力フォーマット

必ず次の 3 項目を 1 応答に含める:

```text
source: <引用元の経路名と具体パス / tool>
summary: <1 行要約 (最長 120 字)>
details: <本文、箇条書き可 / 省略可>
```

`source:` の例:
- `source: harness_mem_resume_pack (meta.summary, daemon 37888)`
- `source: .claude/memory/decisions.md#D3`
- `source: harness_mem_search (project=/path/to/repo, hits=3)`
- `source: harness_mem_search (project=unknown, scoped search skipped; fallback=.claude/memory/decisions.md)`
- `source: harness_mem_search (project=/path/to/repo, 503 backpressure; fallback=.claude/memory/decisions.md)`
- `source: auto-memory point-in-time (2026-04-19 時点)`  ← auto-memory は古い可能性を明示

auto-memory (`~/.claude/projects/.../MEMORY.md`) を引くときは必ず **point-in-time** であることを明示する。現役の決定は SSOT (`decisions.md`) を優先。

## 実行手順

1. **intent 分類**: 発話を 5 分岐のどれに当てはめるか決める。曖昧なら resume を初期仮説に置く。
2. **1 次 routing 呼び出し**: 上表の tool を 1 回だけ呼ぶ。
3. **hit 判定**: 空 / error なら次経路に fallback。3 経路試して全滅なら「該当なし」と明示する。
4. **出力整形**: 上の 3 項目フォーマットを守る。`source:` は必ず先頭。
5. **補強 (optional)**: user が「もっと詳しく」と再質問したとき、はじめて 2 次経路 (session_thread / cb_search / graph) に広げる。

## 呼び出してはいけないケース

- user が実装 / 編集を指示している (例: 「この関数を修正して」) → 通常の Read/Edit フローに戻る
- user が新規の事実を教えている (例: 「X は Y だ」) → memory 記録側の責務、recall ではない
- LSP / semantic 解析が必要な意図 → 既存の LSP/Skills Policy に任せる

## 関連資料

- `Plans.md §97` — Codex parity の設計根拠
- `docs/archive/Plans-s91-s96-2026-04-23.md §96` — Claude 側 `/harness-recall` の正本
- `.claude/memory/decisions.md` / `.claude/memory/patterns.md` — SSOT (recall の第一引き先)
- `scripts/hook-handlers/codex-user-prompt.sh` — Codex 側の発火補強 hook
