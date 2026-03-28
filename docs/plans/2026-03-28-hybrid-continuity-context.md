# Hybrid Continuity Context

策定日: 2026-03-28

## 目的

`Pinned Continuity` による chain-first UX を維持したまま、Claude-mem 的な「最近この project で何があったか」も薄く見える状態を作る。

今回の前提は次の 2 つである。

- 主役はあくまで `この会話の続き`
- recent project context は補助表示であり、主役を上書きしてはいけない

## 採用する hierarchy

SessionStart でモデル可視になる順序は次で固定する。

1. `# Continuity Briefing`
2. `## Pinned Continuity`
3. `## Current Focus`
4. `## Recent Update` / `## Carry Forward` / `## Latest Exchange`
5. `## Also Recently in This Project`

`Also Recently in This Project` は `Continuity Briefing` の本文に埋め込まず、secondary ABI (`meta.recent_project_context`) として分離する。

理由:

- chain-first の不変条件を test で固定しやすい
- Claude/Codex parity を renderer 1 箇所で保ちやすい
- 将来 opt-in / default を切り替えるときに adapter 層だけで制御しやすい

## 選択ルール

recent project context の候補は、`project` 内の recent sessions / interactions から取る。

優先順位:

1. 直近 session summary
2. 直近 completed interaction
3. 直近 pending prompt

件数上限:

- 表示は最大 3 bullet
- 同一 session からは 1 bullet まで

## Suppression / Dedup Rules

次に当てはまる候補は recent project context に出さない。

### 必ず除外

- current source session と同じ `session_id`
- `request.correlation_id` がある場合の same-chain session
- `visibility_suppressed` tag 付き observation
- `session_start` / `session_end`
- `continuity_handoff` / `pinned_continuity`
- `session_start:` や raw wrapper JSON のような機械ノイズ

### 重複として除外

- `Pinned Continuity` / `Carry Forward` / `Recent Update` に既に出ている内容
- 同じ topic を別表現で繰り返す bullet
- 同じ session から複数候補が出た場合の 2 件目以降

### low-signal として除外

- 事実や作業内容が分からない一般文
- AGENTS / skill / command wrapper のような運用文
- 100 文字を大きく超える長文 dump

## 出力形式

`meta.recent_project_context` は次の形を持つ。

- `content`: markdown
- `cache_hint`: `"volatile"`
- `source_scope`: `"project"`
- `source_session_ids`: bullet に使った session_id の一覧
- `item_count`: 表示 bullet 数

markdown 形式:

```md
## Also Recently in This Project
- README docs truth correction landed
- Benchmark runner now compares chain recall and recent-project awareness
```

bullet は 1 行で読める teaser に丸める。詳細 dump はしない。

## Acceptance

次を満たしたときに hybrid 化は合格とみなす。

1. focused continuity の required facts は落ちない
2. `false carryover` は悪化しない
3. recent project context から parallel-topic の気づきが 1 件以上増える
4. Claude/Codex の SessionStart artifact hierarchy が一致する

## Default 化の判断基準

default にする条件:

- `chain recall` が現行比で悪化しない
- `false carryover` が現行比で悪化しない
- `recent project awareness` が改善する

1 つでも崩れた場合は opt-in か adapter feature flag に留める。
