---
name: senpai-note
description: 作業ログ、前回作業、セッション、引き継ぎ、runbook、handoff、手順化、再利用、次回使える形、次の人に渡す、replay prompt、このセッションを資産化、などの意図が出たときに invoke する Skill。harness-mem の記憶 (session thread / resume pack / scoped search) または user 提供ログから、次の人が 30 秒で動ける handoff pack (HANDOFF_CARD / RUNBOOK / REPLAY_PROMPT) を、source を明示して生成する。
trigger_phrases:
  - Senpai Note
  - 引き継ぎ
  - 手順化
  - runbook
  - handoff
  - 再利用
  - 次回使える形
  - 次の人に渡す
  - replay prompt
  - 作業ログ
  - このセッションを資産化
---

# senpai-note

Senpai Note Agent は AI coding session の記憶を、次の人がすぐ再利用できる
**handoff pack** に変換する Skill。単なる要約では終わらせない。次の operator /
チームメイト / 未来の自分が、迷いを減らし、同じ失敗を繰り返さず、明確な開始点から
作業を続けられる成果物を出す。

この Skill は harness-mem の既存 primitive の上に薄く乗る product layer であり、
新しい daemon endpoint / DB schema / 外部サービスを追加しない。

## 発火条件

次の意図を含む user prompt を検知したときに invoke する:

- 「**このセッションを Senpai Note にして**」「**資産化**」
- 「**次の人に引き継げる形にして**」「**引き継ぎ**」「**次の人に渡す**」
- 「**作業ログを runbook にして**」「**手順化**」「**再利用できる形**」「**次回使える形**」
- 「**replay prompt を作って**」
- 英語: **make this reusable** / **create a handoff** / **turn this into a runbook**

呼んではいけないケースは末尾の「呼び出してはいけないケース」を参照。

## Product 原則

最適化対象は「現在のセッションが美しく要約されること」ではなく、
**「次の人がすぐ動けること」**。有効な出力は次に答えられること:

- 次の人はどこから始めればよいか
- 何が決まったか
- 何を繰り返してはいけないか
- どのコマンド / チェックをコピーできるか
- どんな失敗の兆候を見張るべきか
- どんな復旧経路があるか
- その出力を支える記憶 / source はどれか

## Routing

入手可能な最良の source を、この優先順で使う。harness-recall と同じく
scoped で bounded に動く。

| 状況 | 1 次 routing |
|------|--------------|
| 現在の `session_id` が分かる | `harness_mem_session_thread` |
| 直近の継続について聞かれている | `harness_mem_resume_pack` |
| 類似の過去作業を探す | `harness_mem_search`（`project` を渡し `limit` は小さく） |
| 検索が重い / `503` が返る | `safe_mode=true`、`limit` を下げる、`vector_search=false` で 1 回だけ再試行 |
| 記憶が使えない | user 提供テキストを使い、source に user-provided と明記 |
| デモ / fallback | `examples/senpai-note/demo-session.md` を使う |

複数状況に跨るときは上から順に試す。1 経路で 0 件なら次経路へ fallback する。

## Retrieval safety rules

harness-recall の S127 検索安全ルールをそのまま継承する。

- 検索前に cwd / repo / user 言及から `project` を解決する。推定できるなら
  `project` 指定は原則必須。
- いきなり広域 unscoped search から始めない。明示的な横断調査 / forensic /
  admin の依頼があるときだけ広げる。
- `503` は「記憶なし」ではなく daemon を固めないための **backpressure**。
  `query` を絞る、`project` を渡す、`limit` を下げる、必要なら
  `vector_search=false` で 1 回だけ再試行する。
- fallback を使ったら `source:` に必ず明記する（user に隠さない）。
- retrieval は bounded に保つ。`limit` は小さく。
- private タグ付き content は、user が明示的に許可しない限り出力に含めない。

## MCP transport 診断メモ

検索 tool が見えない時は、まず `harness-mem doctor --platform codex` と
`harness-mem mcp-gateway status` で client config / gateway / daemon を分けて見る。
memory DB は触らない。

## 出力フォーマット

必ず次の 2 行で始める:

```text
source: <経路, project/session scope, fallback があれば明記>
summary: <handoff pack の 1 行要約 (最長 120 字)>
```

その後、ちょうど次の 3 つの artifact をこの順で出力する:

1. `HANDOFF_CARD`
2. `RUNBOOK`
3. `REPLAY_PROMPT`

### HANDOFF_CARD contract

30 秒で読める card。必須セクション:

```md
## HANDOFF_CARD
### Start here
<次の人が最初にやるべき 1 つ>
### Current conclusion
<最も重要な結論>
### Decisions
- <決定と、それがなぜ重要か>
### Still open
- <残った疑問 / 次の検証>
### Do not repeat
- <避けるべき罠>
### Next best action
<推奨する次の 1 手>
```

### RUNBOOK contract

同種の作業に再利用できる手順。必須セクション:

```md
## RUNBOOK
### Use when
- <この手順が当てはまる状況>
### Preconditions
- <必要な状態 / tool / repo / config / access>
### Steps
1. <action>
2. <action>
3. <action>
### Commands / checks
（bash code block にコピペできるコマンドを置く）
### Expected result
<正常時に起きること>
### Failure signs
- <症状>
### Recovery
- <安全な復旧経路>
### Risks
- <リスク / 注意>
### Evidence
- <memory 経路 / observation id / user 提供ログ>
```

### REPLAY_PROMPT contract

Claude Code / Codex / 他の local coding agent にそのまま貼れる prompt。必須セクション:

```md
## REPLAY_PROMPT
You are continuing a prior AI coding session.
Goal:
<goal>
Known context:
- <fact>
- <decision>
- <constraint>
First actions:
1. <action>
2. <action>
Do not:
- <trap>
Use these checks:
（bash code block に command を置く）
Evidence:
<source>
```

## Evidence rules

生成した handoff pack は必ず source 情報を含める:

- 使った source 経路
- `project`（分かれば）
- `session_id`（分かれば）
- observation id / document id（あれば）
- fallback 理由（あれば）
- 結果が記憶ではなく user 提供テキストから生成されたかどうか

`source:` の例:

- `source: harness_mem_session_thread (session_id=…, project=/path/to/repo)`
- `source: harness_mem_resume_pack (meta.summary, project=/path/to/repo)`
- `source: harness_mem_search (project=/path/to/repo, hits=3, limit=5)`
- `source: harness_mem_search (project=/path/to/repo, 503 backpressure; retried vector_search=false; fallback=user-provided log)`
- `source: user-provided (examples/senpai-note/demo-session.md, memory unavailable)`

## Quality bar

良い Senpai Note は、少なくとも次の 1 つを次の人に回避させる:

- 同じ調査の繰り返し
- 既知の失敗モードの読み違い
- 最初に間違ったコマンドを叩くこと
- 決定の根拠の喪失
- 同じ文脈確認の質問を再度すること

finalize する前に、出力が次を含むことを確認する:

- 明確な開始点
- 現在の結論
- 少なくとも 1 つの決定
- 少なくとも 1 つの「Do not repeat」
- 可能なときは少なくとも 1 つのコピペできるコマンド / チェック
- source / fallback の透明性
- replay prompt

## 実行手順

1. **intent 分類**: handoff / runbook / replay のどれを主目的とするか決める。
   曖昧なら 3 点すべてを出す。
2. **project 解決**: cwd / repo / user 言及から `project` を推定する。
3. **1 次 routing**: 上表の tool を 1 回だけ呼ぶ。`503` は backpressure として
   bounded に再試行する。
4. **hit 判定**: 空 / error なら次経路へ fallback。全滅なら user 提供ログか
   demo fixture に切り替え、`source:` に明記する。
5. **出力整形**: `source:` / `summary:` を先頭に置き、HANDOFF_CARD / RUNBOOK /
   REPLAY_PROMPT を出す。Quality bar を自己チェックする。

## 呼び出してはいけないケース

- user が実装 / 編集を指示している（例:「この関数を修正して」）→ 通常の
  Read/Edit フローに戻る
- user が新規の事実を教えている（例:「X は Y だ」）→ memory 記録側の責務
- 単に「思い出して」「前回」など recall 意図のみ → `/harness-recall` に任せる
  （Senpai Note は recall 結果を handoff pack に**変換**する層）

## 永続化と共有（明示操作のみ）

生成した runbook / handoff を記憶や team に残すのは、user が明示的に頼んだ時だけ:

- `harness_mem_finalize_session`（`persist_skill=true`）で procedural memory 化
- `harness_mem_share_to_team` で team 共有

default は local-first。自動で ADR / durable decision を作らない。

## 関連資料

- `docs/senpai-note-agent.md` — 本 Skill の feature spec（目的 / 非目標 / contract）
- `examples/senpai-note/demo-session.md` — デモ入力 fixture
- `examples/senpai-note/handoff-pack.md` — デモ出力サンプル
- `skills/harness-recall/SKILL.md` — recall 意図の routing（直交する別 Skill）
