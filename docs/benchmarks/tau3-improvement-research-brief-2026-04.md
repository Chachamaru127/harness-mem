# τ³-bench Improvement Research Brief — 2026-04

## ひとことで

`τ³-bench` の `on > off` を狙うなら、今の主戦場は **「長い memory を強く押し込む」ことではなく、「必要な記憶だけを、軽く、行動を邪魔しない形で渡す」こと** です。

## たとえると

前回の会話メモを丸ごと机に積むより、  
**付箋を 1 枚だけ渡して「必要なら見てね」とする** ほうが、会話 agent には効きやすい、という流れです。

---

## 今回の loop で使う観点

### 1. `NoLiMa` が示すこと

- `NoLiMa` は、**単語の表面一致に頼らない long-context retrieval** を見る benchmark です。
- 論文の主張は、長い文脈で literal match が消えると、モデルの retrieval がかなり崩れる、という点です。
- 今回の runner 改善に引きつけると、**raw な長文 JSON を再注入するより、意味だけ残した short brief のほうが安全** という示唆になります。

今回の loop での使い方:

- checkpoint summary は短く保つ
- recall は 1 件ずつに寄せる
- 同じ observation を重複注入しない

Sources:
- NoLiMa paper: https://arxiv.org/abs/2502.05167
- NoLiMa repo: https://github.com/adobe-research/NoLiMa

### 2. `LongBench v2` が示すこと

- `LongBench v2` は、**長い文脈を読めるか** ではなく、**長い文脈を使って reasoning できるか** を見る benchmark です。
- ここでは、単に recall を増やすより、**本当に必要な情報だけを残す圧縮** が重要です。

今回の loop での使い方:

- prompt に入れる recall は compact brief を優先
- turn 数と confirmation 圧も、accuracy と同じくらい重視する

Sources:
- LongBench v2 paper: https://arxiv.org/abs/2412.15204
- ACL Anthology entry: https://aclanthology.org/2025.acl-long.183/

### 3. `τ-knowledge` が示すこと

- `τ-knowledge` の公開記事では、**terminal-based retrieval** が dense retrieval より強い条件が複数あると報告されています。
- 要点は、agent が “検索結果の要約” だけ受け取るより、**必要な時に自分で狭めていける retrieval** のほうが強いことがある、という点です。

今回の loop での使い方:

- 初手から recall を押し込まない
- first-turn では本人確認や注文取得を優先
- recall は「詳細を詰める段階」で使う候補として扱う

Sources:
- τ-knowledge article: https://taubench.com/blog/tau-knowledge.html
- τ² / τ³ repo: https://github.com/sierra-research/tau2-bench

### 4. Memory layer 系の競合が示すこと

- `Mem0` は、**production-ready memory layer** を前面に出し、必要な記憶だけを取り出す構成を推しています。
- `A-MEM` は、memory を agentic に整理する発想で、**全部保存するより、どの記憶をどう残すか** を重視しています。

今回の loop での使い方:

- 何でも recall するより、**残す note の設計** を改善対象にする
- `checkpoint` は「行動に効く short note」に寄せる

Sources:
- Mem0 paper: https://arxiv.org/abs/2504.19413
- A-MEM paper: https://arxiv.org/abs/2502.12110

### 5. 2025-2026 の security trend が示すこと

- memory を persistent にすると、**memory poisoning / memory injection** が重要な攻撃面になります。
- `MINJA` や memory poisoning 系の論点は、単に security の話だけでなく、**benchmark でも memory を “命令” にしない** 方向を後押しします。

今回の loop での使い方:

- recall は `Reference only` を維持する
- recall から tool 実行を直接誘導しない
- user がすでに明示した yes/no や item choice を上書きしない

Sources:
- MINJA paper: https://arxiv.org/abs/2503.03704
- A-MemGuard paper: https://arxiv.org/abs/2510.02373

---

## いまの benchmark 改善に落とすとどうなるか

### 優先度 A

- recall の **発火タイミング** を遅らせる
- 本人確認や order lookup の前に recall を出しすぎない

### 優先度 B

- recall 件数は少なく保つ
- 同じ内容を重複して再注入しない
- recall payload の **構造** (フィールドラベル) を整える前に、**中身** (assistant note の文体・動詞・主語) が agent 挙動に与える影響を測る ← §85.3 で検証

### 優先度 C

- checkpoint summary を **action-oriented brief** に寄せる
- final JSON 全体ではなく、`何をやろうとしていたか` だけを残す

### 優先度 D

- success rate だけでなく、**turn / confirmation / extra clarification** を計測する
- `on = off` でも、会話が短くなれば改善候補として扱う

---

## loop で次に試す仮説

1. **first-turn recall suppression**
   - 最初の user message では recall を使わず、order details を取った後から使う

2. **retail confirmation compression**
   - final confirmation の前の「中間確認」を 1 回減らす

3. **action-only checkpoint**
   - 保存する summary を、`selected items / chosen replacement / pending confirmation` のような短い構造に寄せる

4. **confirmation metrics**
   - reward だけでなく、confirmation が何回あったかを artifact に残す

5. **recall 文体の ablation**
   - §85.3 で identity scrub が no-op と判明したため、次は recall に乗る `Agent note:` の文体 (動詞の能動/受動、主語の有無、命令調か事実調か) を 2-3 パターン用意して比較
   - 例: 「Customer chose A」 vs 「The agent applied A」 vs 「Selection: A」

---

## §85 で実測してわかったこと

### §85.1 — recall payload の identity scrub (no-op)

- §85.1 として、recall payload に含まれうる `user_id` / labeled name / labeled address / 5-digit zip の scrub を実装した。
- §85.3 (10 paired runs) で測定した結果、**scrub replacements = 0** across all runs。
- 解釈: recall payload (compact summary) には identity field が元々含まれていなかった。仮説の **対象を間違えていた**。
- pass_rate は on/off ともに 0.70 で差なし。avg_turns は on: 10.0 / off: 9.6 で僅かに on 不利 (+0.4)。

### §85.2 — embedding async prime retry fix (機能した)

- §85.2 として、embedding の async prime に retry ロジックを加えた。
- §85.3 の測定で checkpoint warning が全消滅。**§85.2 は正常に機能した。**

### まとめ

- recall は 14 items が確かに注入されており、memory injection そのものは動いている。
- しかし pass_rate も turn も off と差が出なかった。
- つまり **「中身がどう書かれているか」** が次の改善余地である可能性が高い。

---

## なぜこの方針か

今の `τ³-bench` では、memory の中身が悪いというより、  
**memory を渡した結果、会話が慎重になりすぎる** のがボトルネックでした。

なので、次に効きやすいのは、

- retrieval をさらに増やすこと
- recall 文量を増やすこと

ではなく、

- **いつ**
- **どのくらい**
- **どんな調子で**

memory を見せるかの調整です。

### §85.3 で確認できた事実

§85.3 の 10-run sample では、recall 14 items が確かに注入されており、memory injection は動いていた。しかし pass_rate (0.70) も avg_turns (on: 10.0 / off: 9.6) も off との差は統計的に無視できる水準だった。これは、**何を注入するかではなく、どう書かれているかが agent 挙動を左右する** という次の仮説を強く示唆する。

---

## §86 で実測してわかったこと

### §86 Hypothesis B (note-style ablation) — **not supported** (2026-04-18)

**Setup**: 5 tasks × 2 trials × 3 styles (active/passive/label), retail domain, `gpt-4o-mini` both sides, seed 300, commit `b141684`.

**Finding**: confirm_pressure spread across styles ≤ 0.025 (noise). Pass rates: active 0.30, passive 0.10, label 0.10. None reached off baseline of 0.70.

**Adopted style**: `active` (current default). Rationale: it has the best pass_rate of the three. No change to runner default required.

**Next lever (priority A)**: the recall injection **gate/timing** itself — not the note format. §86.3 also surfaced a regression from §84.4's on=0.75 vs off=0.50 to §86.3's on∈{0.10, 0.30} vs off=0.70 despite same fixture and harness, suggesting the recall payload is actively harmful in the current state. Candidate investigations:

1. Whether recall injection is firing **too early** (first turn instead of mid-task).
2. Whether `--scrub-recall-identity` (§85.1) interacted with §86.1's note-style path in an unexpected way.
3. Whether the `audioop` stub added during §86.3 preflight changed any tau2-bench behavior subtly.

§87 should investigate the recall gate (timing + content), not the note format.
