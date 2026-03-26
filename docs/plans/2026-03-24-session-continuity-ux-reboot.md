# Session Continuity UX Reboot

策定日: 2026-03-24

## 目的

新しい Claude/Codex セッションを開いた直後に、「今まで何を話していたか」「次に何を続けるべきか」が初手で伝わる UX を再設計する。

今回の結論は次の一文に尽きる。

- 正本は Claude-mem の Claude 専用 hook 契約ではなく、`harness-mem` の client-agnostic な `Continuity Briefing`
- ただし Tier 1 adapter では Claude-mem と同等以上に「最初から知っている感」を出す

## Claude-mem 再確認で分かったこと

Claude-mem の強さは、単に検索結果が良いことではない。

- `SessionStart` でモデル可視な context を強く注入している
- 注入内容は flat dump ではなく、recent summary と recent exchange に寄っている
- fail-open で hook 不調でも起動は止めない
- deep retrieval は別レイヤーに分離している

一方で、その UX は Claude Code の hook 契約に強く依存している。

- `additionalContext`
- client-specific な session ID / resume 契約
- `CLAUDE.md` / rules / hook glue

この部分を `harness-mem` の core にコピーすると、Claude 固有の都合が runtime に逆流する。

## harness-mem の現状失敗

複数エージェントの議論で、失敗は次の 4 点に収束した。

1. `resume_pack` の source selection が chain-first になっていない
2. `resume_pack` が「前回会話 briefing」より「最近 item の圧縮列挙」に近い
3. Claude/Codex の注入経路が repo 内 SSOT として閉じていない
4. benchmark が `first-turn continuity` を測らず、`core.search()` に偏っている

特に大きいのは 1 と 3 である。

- `correlation_id` は server / MCP / test に存在する
- しかし SessionStart の実運用経路では transport されていない
- その結果、busy project では「別会話の最近 summary」を拾い得る

## 採用するモデル

採用するのは `Continuity Briefing + On-demand Deep Retrieval` である。

### 1. Continuity Briefing

新規セッション開始時に、短い briefing を必ず取得し、client が最初に参照する。

briefing に最低限含めるもの:

- scope: `chain` か `project`
- source session
- latest turn timestamp
- last session summary
- latest visible exchange
- memory anchors
- citation IDs

### 2. On-demand Deep Retrieval

深掘りは現行の 3-layer を維持する。

- `search`
- `timeline`
- `get_observations`

briefing で十分な場合はここまで行かない。必要なときだけ降りる。

## Owner Boundary

### harness-mem owner

- `resume_pack` の ABI
- continuity briefing の生成
- privacy / project / session / correlation 境界
- structured handoff artifact
- runtime benchmark / integration test

### sibling adapter owner

- Claude/Codex の hook wiring
- first-turn への注入方法
- rules / skills / policy
- adapter E2E

この線を守らないと、Claude 専用実装が core に漏れる。

## 実装順

1. `resume_pack` に `latest_interaction` と `continuity_briefing` を追加する
2. hook script は raw item dump より `continuity_briefing` を優先表示する
3. `correlation_id` transport を chain-first にする
4. `finalize_session` を structured handoff に置き換える
5. `first-turn continuity` benchmark を追加する

## 今回の repo 内反映

今回この repo では次を着手した。

- `resume_pack` が `meta.latest_interaction` を返す
- `resume_pack` が `meta.continuity_briefing` を返す
- Claude/Codex SessionStart script が briefing を優先表示する
- その contract / integration test を追加する

これは最終形ではない。まだ不足しているものは明確である。

- `correlation_id` transport の実運用化
- structured handoff
- adapter E2E benchmark
- README / setup docs の truth correction

## 却下した案

### Claude-mem の Claude 固有注入をそのまま core に持ち込む

却下理由:

- multi-client runtime の中立性を壊す
- hook 契約の差分が core に漏れる
- Claude/Codex/Gemini 追加時に実装が分岐し続ける

### deep retrieval 強化を最優先にする

却下理由:

- いまの主苦情は「掘れない」より「初手で分からない」
- briefing source と delivery が弱いままでは改善が UX に乗らない

## 評価指標

今後は次を主要 KPI にする。

- briefing recall
- first-turn continuity success
- false carryover
- cross-project leakage
- token overhead

検索品質だけで continuity UX を語らない。
