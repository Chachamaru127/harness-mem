# `τ³-bench` §84 retrospective — 2026-04-17

Task: `84.5`
Domain: `retail` / split `base`
Models: agent `gpt-5-mini` / user `gemini/gemini-2.5-flash-lite`
Sample: `2 tasks × 2 trials = 4 paired runs`
Source artifacts:

- `.tmp/tau3/harness-mem-off-retail-base-2tasks-2trials-84_4_20260417/results.json`
- `.tmp/tau3/harness-mem-on-retail-base-2tasks-2trials-84_4_20260417/results.json`
- `docs/benchmarks/tau3-retail-multitask-paired-compare-2026-04-17.md`

## ひとことで

`on > off` をついに **multi-task で達成**した (`pass_rate 0.50 → 0.75`)。
ただし turn / confirmation 圧は **下がっておらず、むしろ少し増えた**。
つまり「memory が答えを救う」段階には到達したが、「memory が会話を軽くする」段階には届いていない。

## 事実整理

### Headline

| Metric | `off` | `on` | Δ |
|---|---:|---:|---:|
| pass rate | 0.50 (2/4) | **0.75 (3/4)** | **+0.25** |
| avg total turns | 10.00 | 10.50 | +0.50 |
| avg confirm turns | 3.00 | 3.25 | +0.25 |
| avg clarification turns | 2.25 | 2.50 | +0.25 |
| total cost (USD) | 0.0622 | 0.0733 | +0.0112 |
| recall items used | 0 | 7 | +7 |

### Paired rows

| Task | Trial | `off` reward | `on` reward | turns Δ | confirm Δ | 結果 |
|---|---:|---:|---:|---:|---:|---|
| 0 | 1 | 1.0 | 1.0 | **−2** | 0 | tie + 短縮 ✅ |
| 1 | 1 | 0.0 | **1.0** | +2 | 0 | **救出 ✅** |
| 0 | 2 | 1.0 | 1.0 | +2 | +1 | tie だが膨張 ⚠️ |
| 1 | 2 | 0.0 | 0.0 | 0 | 0 | 両方失敗（ベースライン弱点） |

### 失敗 row の中身 (`task 1 / trial 2`)

両モードとも **同じ失敗の仕方** (wrong product variant pick)。
on の `summary` に余分な `get_user_details` 呼び出しはなく、敗因は memory 層ではなく
underlying model の product 選択判断。**memory の責任ではない** と切り分けできる。

### task 0 / trial 2 の膨張

on は `get_user_details` を 1 回追加で呼び、turn が 8→10、confirm が 2→3 に増えた。
recall (recall_item_count=2) が「user 情報を改めて確認しよう」という挙動を誘発した可能性が高い。

## 判定

| 軸 | 結果 |
|---|---|
| memory 配線が通っているか | ✅ yes |
| `on` が一段悪化していないか | ✅ yes (v2 → v3-tuned で解消) |
| multi-task で `on > off` を主張できるか | ✅ **yes** (+0.25) |
| `on = off` でも turn/confirmation が減るか | ❌ **no** (むしろ +0.50 turns) |

§84 Global DoD のうち **「`on > off`」は満たした**。
ただし「`on = off` で turn/confirmation が減る」の方は未達のまま。
DoD は or 条件なので **§84 はクローズ可能**。次の改善は §85 として切り出す。

## 敗因 / 次に効く箇所 (top 3)

1. **recall が user 確認系の挙動を誘発する**
   `task 0 / trial 2` で `get_user_details` が増えた。recall の中身に user identity 系が含まれると、
   agent が「念のため再確認」へ流れる。**recall payload から user identity 関連 observation を除外**
   するだけで confirmation 圧が下がる可能性が高い。

2. **product variant の選択は memory 範囲外**
   `task 1 / trial 2` の失敗は両モード共通。memory 改善ではなく、
   product attribute の reasoning 強化（first-turn の attribute 抽出 prompt 追加）が必要。
   §84 の本道ではないが、retail benchmark の天井を上げる別仮説として記録。

3. **embedding async prime warning が常時発火**
   `write embedding is unavailable: local ONNX model multilingual-e5 requires async prime before sync embed`
   が全 on run で出ている。recall 自体は機能しているが、書き込みパスが degraded。
   write が安定すれば multi-trial 間で memory が積み重なり、effect size が伸びる余地。

## 次の最有力仮説（§85 候補）

### 仮説 A — recall payload の user identity 抑制

**変更点**: recall に乗せる observation から `user_id`, `name`, `zip`, `address` 系の identity 値を
省くか mask する。

**期待効果**: confirmation pressure を `0.61 → 0.50` に圧縮。`on = off` ではなく `on < off` (turn 数) を狙う。

**コスト**: runner 側の recall filter 1 つ。低リスク。

### 仮説 B — embedding write path の async prime fix

**変更点**: bench-tau3-runner.py の checkpoint 書き込み前に embedding model を prime する
warm-up 呼び出しを 1 回入れる。

**期待効果**: trial 間で memory が積層 → 後続 trial で recall hit 率が上がり、
4-run の cumulative effect が見えやすくなる。

**コスト**: 起動コスト数百 ms。runner 限定。

### 仮説 C — sample 拡大

`2 tasks × 2 trials = 4 runs` は noise 圧が高い。`5 tasks × 2 trials = 10 runs` まで拡大して
`+0.25` が安定するか確認する。

**期待効果**: claim を「bench で偶然勝った」ではなく「再現する勝ち」へ昇格。

**コスト**: 1 run 約 100 sec → 追加 ~10 min。

## 優先順位

1. **§85.1**: 仮説 A (recall identity 抑制) — **最有力。改善仮説そのもの**
2. **§85.2**: 仮説 C (sample 拡大) — 仮説 A 適用後の検証兼用
3. **§85.3**: 仮説 B (embedding prime fix) — 副次効果。runner stability の改善

仮説 A → C の順で回せば、`on > off` の主張に「効率改善」の側面を追加できる。

## research brief との整合

`docs/benchmarks/tau3-improvement-research-brief-2026-04.md` の優先度 A
(「recall の発火タイミングを遅らせる / 本人確認や order lookup の前に recall を出しすぎない」)
は **多 task では効ききっておらず、recall payload の中身まで踏み込む必要がある** ことが分かった。
research brief の「優先度 B (recall 件数を少なく)」に **「identity field を入れない」** を追記すべき。

## 結論

- §84 Global DoD の主条件 (`on > off`) を満たしたので **§84 はクローズ**
- 効率側 DoD (turn/confirmation 減) は未達 → **§85 として継続**
- §85 の最有力仮説は **recall payload の user identity 抑制**
