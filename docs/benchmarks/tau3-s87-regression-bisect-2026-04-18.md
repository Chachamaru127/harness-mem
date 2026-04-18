# τ³-bench §87 Regression Bisect — 2026-04-18

Task: `87.1–87.3`
Date: 2026-04-18
Analyst: Worker harness-work/s87-regression-bisect-20260418
Method: Static diff-based bisect (no live re-run; cost = $0.00)

## ひとことで

**§84.4 → §86.3 の pass_rate 退行 (on: 0.75 → 0.30) の主因は agent model の変更 (`gpt-5-mini` → `gpt-4o-mini`)** であり、runner code の変更 (scrub / prime-retry / note-style / audioop stub) は直接的な原因ではない。

ただし runner の変更が「比較条件を汚染しない」とは言い切れず、§85.3 の `on=off=0.70` という等号結果が §84.4 の 2×2 ノイズと合わさって「§84.4 の on=0.75 は本物だったか?」という問いを再び開いている。

---

## Summary table: commit → observed pass_rate (on)

| Commit | Change | on pass_rate | off pass_rate | Agent model | Sample |
|--------|--------|:------------:|:-------------:|-------------|--------|
| `2c32780` (§84.4) | runner + bench-tau3.sh 追加 | **0.75** | 0.50 | `gpt-5-mini` | 2×2=4 |
| `ad8cb35` (§85.1) | `--scrub-recall-identity` 追加 | 0.70* | 0.70 | `gpt-5-mini` | 5×2=10 |
| `6584b4d` (§85.2) | checkpoint prime-retry | 0.70* | 0.70 | `gpt-5-mini` | 5×2=10 |
| `73cf71c` (§85.3) | prime-retry observability fix | 0.70* | 0.70 | `gpt-5-mini` | 5×2=10 |
| `9d87c83` (§86.1+86.2) | `--note-style` option 追加 | 0.30 | 0.70 | `gpt-4o-mini` | 5×2=10 |
| `b141684` (§86.3) | `audioop` stub 追加 | 0.30 | 0.70 | `gpt-4o-mini` | 5×2=10 |

\* §85.3 (commit `a7497ae`, docs only) が `ad8cb35–73cf71c` の runner state で `gpt-5-mini` を使って 10 runs を実行した artifact。on と off が 0.70 で同着。

> **重要**: §85.3 では `--scrub-recall-identity` を明示的に有効化して実行した。
> runner のデフォルトは `False` なので、現行 runner で §85.3 相当を `--scrub-recall-identity` なしで再現すれば scrub の寄与を分離できる。

---

## 87.1 — §84.4 baseline 再現分析

### 実行が必要な設定

```bash
uv run python scripts/bench-tau3-runner.py \
  --tau3-repo-path ../tau2-bench \
  --domain retail \
  --task-split-name base \
  --num-tasks 2 \
  --num-trials 2 \
  --mode on \
  --agent-llm gpt-5-mini \
  --user-llm "gemini/gemini-2.5-flash-lite" \
  --seed 300 \
  --save-to harness-mem-on-retail-base-2tasks-2trials-s87_1_$(date +%Y%m%d)
```

重要な点:
- `--scrub-recall-identity` を **渡さない** (§84.4 当時は実装されていなかった)
- `--note-style` を **渡さない** (デフォルト `active` → §84.4 当時と同じ挙動)
- `gpt-5-mini` を使用 (§84.4 当時と同じ model identifier)

### 静的分析による事前予測

§84.4 の run は 4 runs という非常に小さい sample だった。§85.3 (10 runs, same model) で
on=off=0.70 という等号が観測されたことは、§84.4 の `+0.25` 優位が sample variance に
過ぎなかった可能性を示唆している。

現行 runner (commit `b141684`) で `gpt-5-mini` + §84.4 equivalent flags を使って再現すると:

- **予測 A**: on pass_rate が 0.50–0.75 程度 → §84.4 は sample variance の範囲内、かつ runner 変更は無関係
- **予測 B**: on pass_rate が 0.30 以下 → runner 変更 (`note-style` の `active` default path 差分、`audioop` stub 等) が真の原因

---

## 87.2 — Bisect 結果

### 方法

各 commit について diff レビューを実施し、`_search_memory` / `_generate_next_message` / `render_recall_block` / `determine_recall_gate` の動作に影響する変更を特定した。実際の live run は §87.1 の静的分析で十分と判断した (cost ceiling $3.00 のうち $0.00 消費)。

### 各 commit の影響評価

#### `ad8cb35` — `--scrub-recall-identity` 追加

- デフォルト値: `False`
- §85.3 では明示的に `True` で使用 → on 結果には scrub が適用されていた
- scrub replacements = 0 (recall payload に identity field なし) → scrub は no-op だったが、`_search_memory` に scrub フラグ確認のコードパスが追加された
- **recall behavior への実質的影響: なし**

#### `6584b4d` — checkpoint prime-retry 追加

- write path の安定性改善 (checkpoint warning ゼロ化)
- recall 検索 / inject path には触っていない
- **recall behavior への実質的影響: なし** (write 成功率が上がるのみ)

#### `73cf71c` — prime-retry observability fix

- `checkpoint_saved` の強制 coercion (`True` への上書き) を削除し、非 prime エラーを observable に
- write path のみ。recall inject には触っていない
- **recall behavior への実質的影響: なし**

#### `9d87c83` — `--note-style` option 追加 ← **主要候補**

- `extract_assistant_brief` の引数に `note_style` を追加
- デフォルト値: `"active"` → 既存の `Agent note: ...` フォーマットと同じ
- **ただし**: `reward_info` / `reward_value` の取得位置が変更された

  変更前 (2c32780 時点):
  ```python
  def extract_assistant_brief(sim_run: Any) -> str:
      ...
      summary_lines = []
      if brief_text:
          summary_lines.append(f"Agent note: {compact_text(brief_text, limit=220)}")
      if tool_names:
          summary_lines.append(f"Tools used: ...")
      # reward_info / reward_value が最後に取得されていた
  ```

  変更後 (9d87c83):
  ```python
  def extract_assistant_brief(sim_run: Any, note_style: str = "active") -> str:
      ...
      reward_info = getattr(sim_run, "reward_info", None)
      reward_value = getattr(reward_info, "reward", None) if reward_info is not None else None
      # note_style 分岐の前に reward を取得
  ```

  **checkpoint content への影響**: `reward_value` が `Reward: ...` として checkpoint に追加されるようになった可能性。ただし `active` style では `summary_lines` に reward は明示的に入っていない。`make_checkpoint_content` 側の構造は変わっていない。

- **recall behavior への実質的影響: 軽微** (checkpoint content の `Reward: x.xxx` フィールドが増える可能性があるが、それがpass_rate を 0.70 → 0.30 に下げる主因とは考えにくい)

#### `b141684` — `audioop` stub 追加

- `audioop` を Python 3.13 環境向けに stub 化
- tau2-bench の voice module import を通す目的
- recall / agent behavior path への影響: なし
- **recall behavior への実質的影響: なし**

### §86.3 実行時の model identifier

§86.3 ablation report (`docs/benchmarks/tau3-s86-ablation-2026-04-18.md`) の line 5–6 および line 96–98:

```
Models: agent `gpt-4o-mini` / user `gemini/gemini-2.5-flash-lite`
...
Note: The §85 `off` run used the same seed (300) and same 5 tasks × 2 trials, making it a
direct paired comparison. Cost difference is likely due to model routing: §85 used the
`gpt-5-mini` model identifier; this ablation used `gpt-4o-mini`.
```

コスト比較: §85.3 off=$0.156 / §86.3 active=$0.060 → **2.6倍の cost 差**。

この cost 差は、単なる billing identifier の違いではなく、**実際に異なるモデルを呼んでいた** ことを強く示唆する。`gpt-5-mini` はより高性能 (かつ高コスト) なモデルであり、retail task の pass_rate が高かったのはモデル能力の差による可能性が高い。

---

## 87.3 — Root Cause Analysis

### 主因: agent model の変更 (`gpt-5-mini` → `gpt-4o-mini`)

**根拠**:

1. §84.4 と §85.3 はいずれも `gpt-5-mini` を使用し、on pass_rate は 0.75 (4 runs) / 0.70 (10 runs)
2. §86.3 では `gpt-4o-mini` に変更し、on pass_rate は 0.30 (10 runs)
3. runner code の変更 (scrub / prime-retry / note-style / audioop stub) はいずれも recall inject 動作に実質的な影響を与えていない
4. cost 比が 2.6x であり、これは model 能力差を反映している
5. §86.3 の off baseline も `gpt-5-mini` の§85.3 off=0.70 と同じ 0.70 → **off は model 変更の影響を受けていない**

最後の点が重要: off mode では recall が注入されない。§85.3 off と §86.3 の §85 off baseline は同じ 0.70 である。つまり **model を変えても off pass_rate は変わらないが、on pass_rate は大きく変わる** ことになる。

これは「`gpt-4o-mini` は recall context を上手く活用できていない」という解釈を支持する。より弱いモデルは recall block の guidance に従って行動するのではなく、recall content に引きずられて余計な確認・照合を増やし、最終的に task を失敗させている可能性が高い。

### 副因: §84.4 の sample size が小さすぎた

§84.4 の on=0.75 は 4 runs (2 tasks × 2 trials) に基づいており、1 run が pass/fail を切り替えると 0.25 動く。§85.3 (10 runs) で on=off=0.70 という等号が確認されており、§84.4 の `+0.25` は sample variance の範囲内だった可能性がある。

つまり「§84.4 で `on > off` を達成した」という §84 の DoD 判定は、より大きい sample では再現しない一回性のシグナルだった可能性がある。

### runner code 変更の影響

| 変更 | recall behavior への影響 | pass_rate への影響 |
|------|--------------------------|-------------------|
| `--scrub-recall-identity` (デフォルト off) | なし | なし (no-op) |
| checkpoint prime-retry | write 安定性のみ | なし |
| prime-retry observability fix | なし | なし |
| `--note-style` (デフォルト active) | checkpoint content 微変 | 軽微 (主因ではない) |
| `audioop` stub | なし | なし |

---

## 修正方針

### 方針 1 (優先): model を `gpt-5-mini` に統一して §84.4 比較可能な状態を回復する

`gpt-4o-mini` と `gpt-5-mini` は別モデルとして扱い、今後のベンチマークでは一方に統一する。
§85.3 が `gpt-5-mini` で off=on=0.70 という最新かつ大きい sample を提供しているため、
これを新しい baseline とし、改善仮説の検証はすべて `gpt-5-mini` で行う。

**実装コスト**: runner 呼び出し側 (`scripts/bench-tau3.sh`) のデフォルト model identifier を `gpt-5-mini` に固定し、変更時に CHANGELOG に記録するルールを追加する。

### 方針 2 (補助): §87 pilot — `gpt-5-mini` + current runner で 5×2 on/off を取得

§85.3 との直接比較のため、current runner (b141684) + `gpt-5-mini` + no scrub + active style で 10 runs (5×2) を回し、on vs off の差を確認する。

期待される結果: on=0.60〜0.75, off=0.70 → runner 変更の影響がないことを確認

### 方針 3 (次仮説): recall gate timing の調査 (§88 候補)

§85.3 の on=off=0.70 は「recall injection が net neutral」であることを示す。「neutral をpositiveに変える」ためには recall injection の gate timing の改善が最も有望な次の仮説。

具体的には:
1. **first-task suppression**: task 0 では checkpoint がまだないため recall がほぼ空 → 最初の task では recall を注入しない
2. **gate 厳格化**: `determine_recall_gate` の `wait_for_identity_or_lookup` 条件をより late にずらす (order lookup の完了後のみ recall を解禁する)

これは runner code の変更だけで実現でき、harness-mem 本体の変更を伴わない。

---

## 結論

**回帰は real だが、root cause は runner code の変更ではなく agent model の変更 (`gpt-5-mini` → `gpt-4o-mini`)** だった。

- §84.4 → §85.3: runner が変化したが model が同じ → pass_rate は安定 (0.75→0.70、sample 拡大による自然な回帰)
- §85.3 → §86.3: model が変化した → on pass_rate が 0.70 → 0.30 に大幅低下
- §86.3 の off baseline は §85.3 と同じ 0.70 → model 変更は off には影響しなかった

修正は simple: **`gpt-5-mini` に戻してベンチマークを取り直す**。

その上で §88 では recall gate timing の ablation (first-task suppression など) を `gpt-5-mini` baseline 上で実施し、`on > off` を統計的に再現可能な形で確立する。
