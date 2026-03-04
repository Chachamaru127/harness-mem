# §33 評価戦略設計書: 「客観的に改善された」を定義する

> **作成日**: 2026-03-04
> **対象フェーズ**: §33 以降の実装改善サイクル
> **前提**: §32 ベンチマーク基盤（locomo-120 + bilingual-10 + knowledge-update-10 + temporal-10）が稼働中
> **現在スコア**: F1=0.2104 / Freshness@K=0.10 / Temporal Order Score=0.583 / bilingual recall=1.0

---

## エグゼクティブサマリー

**結論を先に述べる**: 「客観的に改善された」と言える最低条件は以下の3つを同時に満たすことである。

1. locomo-120 overall F1 が現 baseline(0.2104) から **+0.03 以上（0.24 以上）** 改善し、かつ
2. 改善が **2回の独立実行で再現** し（同一 commit で2回走らせてどちらも同方向）、かつ
3. **bilingual recall が 1.0 から低下しない**（既存強みの維持）

Freshness@K=0.10 はゲート閾値(0.70)との乖離が大きく、**単独では「改善した」と主張できない**。
次の目標は 0.40 であり、そこまでは「改善中」のステータスとして扱う。

---

## 1. 課題分析: 各スコアの診断

### 1.1 F1=0.2104 の本質

**問いへの直接回答**: これはシステムの問題と評価指標の問題が両方混在している。

#### システム起因（改善可能）

`locomo-harness-adapter.ts` を読むと、`f1Score()` は `prediction` 全文（会話の1ターン丸ごと）と `answer` の短い正解文字列のトークン重複で計算している。

```
prediction = "I think the project is doing well. We are using React 18 now. That was a good decision."
answer     = "React 18"
→ predTokens=13, goldTokens=2, overlap=2
→ precision=2/13=0.15, recall=2/2=1.0, F1=0.26
```

正解が prediction に含まれているのに F1 が低い。**これは検索システムの問題ではなく、答え抽出（extraction）の問題**である。`locomo-harness-adapter.ts` の `extractAnswerDraft()` と `finalizeShortAnswer()` が長い候補文を短い正解形式に絞り込めていない。

#### 評価指標起因（許容範囲内）

locomo データセットの会話形式は本質的に「長い証拠」から「短い事実」を取り出すタスクである。LLM なしのルールベース抽出で競合（LLM 込み 95%+）と同等のスコアを得ることは **設計上不可能**である（測定フレームワーク設計書 §7 に明記済み）。

F1 の絶対値での競合比較は意味をなさないが、**F1 の相対改善（同条件での before/after）は有効な改善指標**である。

**結論**: F1 改善は「答え抽出精度の向上」で対処すべきシステム問題。指標の設計を変える前に実装を改善する。

---

### 1.2 Freshness@K=0.10 の診断

`runner.ts` の `calculateFreshnessAtK()` を確認した。

```typescript
// newRank が -1（Top-K 圏外）→ score=0 を返す
const newRank = topK.indexOf(newId);
if (newRank === -1) return 0;
```

10件中 9件で新しい記録が Top-10 に入っていないか、old より下位にある。
原因仮説:
1. FTS スコアリングが recency（新鮮さ）を全く考慮しない
2. `mem_observations.created_at` は存在するが、検索スコアへの寄与がゼロ
3. old/new エントリのキーワードが類似（「MySQL」「PostgreSQL」両方が React 質問に関係ない）→ FTS がどちらも同等に低スコア

**0.10 → 0.40 は実装で対応可能**（recency ブースト追加）。
**0.40 → 0.70 は実装 + フィクスチャ品質改善が必要**（曖昧なキーワード重複の解消）。

---

### 1.3 Temporal Order Score=0.583 の診断

0.5 が「判定不能（中立）」、1.0 が「完全正順」。0.583 は中立よりわずかに良い程度。
`calculateTemporalOrderScore()` は Kendall tau を使用。Top-10 内に 2件以上の temporal entry が含まれないと測定できない。

現状の問題: クエリに対して時系列的に並んだ複数エントリが Top-10 にまとめて入ってこない。

**0.583 → 0.65 は recency ブーストの副次効果で達成できる可能性がある。**

---

## 2. 統計的検証方法

### 2.1 各データセットのサンプル数と信頼区間

#### locomo-120（180 QA）

F1 スコアは各質問の独立した値の平均。

```
観測値: n=180
現 F1: 0.2104, 標準偏差 σ ≈ 0.20（会話形式の高分散を想定）
標準誤差 (SE) = σ / √n = 0.20 / √180 ≈ 0.0149
95% 信頼区間 = ±1.96 × SE ≈ ±0.029（約±3 pp）
```

**結論: 0.03 以上の改善が必要**（SE の約 2 倍）。これ以下の改善は統計的ノイズと区別できない。
locomo-120 は 180 QA あるため、±3 pp の精度で改善を測定できる。**追加サンプルは不要**。

#### bilingual-10（10 件）

```
n=10, 現スコア=1.0
バイナリ指標（hit/miss）のため SE = √(p(1-p)/n) = √(0×1/10) = 0
「1回でも miss が出ればスコアが低下する」構造で感度が高い
```

この規模で「改善」を測定するのは意味がない（既に天井）。回帰防止の用途のみに限定する。

#### knowledge-update-10（10 件）

```
n=10, 現スコア=0.10
SE = √(0.10×0.90/10) ≈ 0.095
95% CI: 0.10 ± 0.19 → [0, 0.29]
```

**10 件での変動は統計的に意味をなさない（CI が幅広すぎる）。**
「0.10 → 0.20」の改善は CI の範囲内のノイズの可能性がある。
改善が「本物かどうか」は 10 件では判定できない。

**推奨**: knowledge-update-10 を 30 件以上に拡充してから改善判定を行う。

#### temporal-10（10 件）

```
n=10, 現スコア=0.583（Kendall tau ベース、連続値）
各ケースのスコアは 0〜1 の連続値
少サンプルでは分布形状不明、信頼区間計算に bootstrap が必要
```

**推奨**: temporal-10 も 30 件以上に拡充する。

### 2.2 Bootstrap 法の必要性

| データセット | 現サンプル数 | 正規近似可否 | Bootstrap 必要性 |
|------------|:-----------:|:----------:|:-------------:|
| locomo-120 | 180 QA | 可（n>30 の中心極限定理） | 不要 |
| bilingual-10 | 10 件 | 不可 | 天井到達のため無意味 |
| knowledge-update-10 | 10 件 | 不可 | **必要**（または拡充） |
| temporal-10 | 10 件 | 不可 | **必要**（または拡充） |

Bootstrap の実施方法（10 件データセット用）:

```
1. 元の 10 件からランダムに 10 件を復元抽出（重複あり）
2. そのサンプルでスコア計算
3. 1-2 を 1000 回繰り返し
4. 2.5 パーセンタイル〜97.5 パーセンタイルが 95% CI
→ before CI と after CI が重ならなければ有意な改善
```

ただし、**最も効率的な対処は 10 件データセットを 30〜50 件に拡充すること**。
Bootstrap は計算コストが高く、根本解決にならない。

---

## 3. A/B テスト設計

### 3.1 基本方針: 同一データ・同一シードでの before/after

harness-mem の検索は決定論的（乱数なし）のため、純粋な before/after 比較が成立する。

```
手順:
1. git tag v-before（改善前の commit）
2. 改善実装
3. git tag v-after（改善後の commit）
4. 両バージョンで同じ locomo-120 fixture を実行
5. delta = after_score - before_score
```

注意点: `run-ci.ts` は毎回新しい tmpdir に DB を作成するため、**DB 状態のキャリーオーバーはない**。

### 3.2 「改善された」の判定ルール

```
// 主要メトリクス（locomo-120 F1）
改善判定: delta_f1 >= +0.03 かつ delta_em >= 0（EM が悪化しない）

// 副次メトリクス（他が悪化していないこと）
回帰判定: bilingual recall < 1.0（退行）

// 知識更新・時系列
参考値として記録するが、10 件での判定は保留
```

### 3.3 不可分な改善の取り扱い

recency スコアリング改善は Freshness と Temporal の両方に影響する。
この種の変更は以下を同時に確認する:

| チェック項目 | 確認方法 | 合否条件 |
|-----------|--------|---------|
| locomo-120 F1 | run-ci.ts | baseline から -3 pp 以内 |
| bilingual recall | run-ci.ts | 1.0 維持 |
| Freshness@K | run-ci.ts | 前回以上 |
| Temporal Order Score | run-ci.ts | 0.50 以上（ゲート） |

---

## 4. 回帰防止戦略

### 4.1 現行の回帰ゲート（run-ci.ts の実装確認済み）

| メトリクス | ゲート閾値 | 実装箇所 |
|---------|---------|--------|
| locomo-120 F1 | baseline から -5 pp 以下で exit 1 | `checkLocomo120Regression()` |
| bilingual recall | < 0.8 で exit 1 | `runBilingualBenchmark()` |
| Freshness@K | < 0.7 で exit 1 | `runKnowledgeUpdateBenchmark()` |
| Temporal Order Score | < 0.5 で exit 1 | `runTemporalBenchmark()` |

**現状問題**: Freshness@K の実際値 0.10 はゲート 0.70 を大幅に下回っており、CI は常に FAILED 状態である。これは `allPassed` フラグを false にするが、locomo の regression check が pass していれば CI 全体の意図的な「警告運用」として機能している。

**推奨**: Freshness@K ゲートを §33 の改善フェーズ中は `0.30` に一時引き下げ（改善作業中であることを明示した上で）、改善完了後に `0.70` に戻す。

### 4.2 カテゴリ別 F1 の監視

locomo-120 の 4 カテゴリのうち cat-1（単純事実）が最も診断しやすい。

| カテゴリ | 現スコア | 回帰ゲート | 改善目標 |
|--------|------:|------:|------:|
| cat-1（単純事実）| 0.2564 | 0.22 以上 | 0.30 |
| cat-2（複合事実）| 0.1959 | 0.16 以上 | 0.23 |
| cat-3（時系列）| 0.1249 | 0.10 以上 | 0.16 |
| cat-4（Distractor）| 0.2202 | 0.18 以上 | 0.26 |
| **overall** | **0.2104** | **0.18 以上** | **0.24** |

回帰ゲートは `current_f1 < (baseline_f1 - 0.05)` で計算されるが、カテゴリ別の監視は現在 `run-ci.ts` でログ出力のみ。CI ブロックには使用されていない。

**推奨**: cat-1 単体で `< 0.20` になった場合に警告ログを出すコードを追加する（ハードブロックは全体 F1 のみで十分）。

---

## 5. 段階的ゲート戦略

### Phase A: Freshness 修正フェーズ（優先度: 最高）

**目標**: Freshness@K を 0.10 → 0.40 に引き上げる

| ゲート | 値 | 条件 |
|------|--:|-----|
| Freshness@K（ゲート緩和中） | 0.30 | CI pass 条件として使用 |
| locomo-120 F1 | 0.21 以上 | 回帰させない（現 baseline を割らない） |
| bilingual recall | 1.00 | 維持 |

実装アプローチ: `harness-mem-core.ts` の検索スコアリングに recency ブーストを追加。
`created_at` の新しい order が +0.1〜0.2 のスコアボーナスを得る形。

**「改善した」と言える条件**: Freshness@K >= 0.40 かつ locomo-120 F1 が 0.21 以上。

---

### Phase B: Answer Extraction 改善フェーズ（優先度: 高）

**目標**: locomo-120 F1 を 0.21 → 0.27 に引き上げる

| ゲート | 値 | 条件 |
|------|--:|-----|
| locomo-120 F1 | 0.27 以上 | Phase B の完了条件 |
| cat-1 F1 | 0.33 以上 | 単純事実の改善確認 |
| Freshness@K | 0.40 以上 | Phase A の成果を維持 |
| Temporal Order Score | 0.60 以上 | 副次的改善 |
| bilingual recall | 1.00 | 維持 |

実装アプローチ: `locomo-harness-adapter.ts` の `finalizeShortAnswer()` を改善。
長い候補文を短い事実フレーズに圧縮するロジックの精度向上。

**「改善した」と言える条件**:
- overall F1 >= 0.27（現 baseline から +0.03 超）
- 2回の独立実行で両方 0.27 以上
- bilingual recall = 1.0 維持

---

### Phase C: データセット拡充フェーズ（優先度: 中）

**目標**: knowledge-update-10 と temporal-10 を統計的に信頼できるサンプル数に拡充

| データセット | 現サンプル数 | 目標サンプル数 | 最小サンプル数の根拠 |
|-----------|:-----------:|:-----------:|:----------------|
| knowledge-update | 10 件 | 50 件 | SE=0.063（±6 pp の精度）|
| temporal | 10 件 | 30 件 | SE=0.082（±8 pp の精度）|

50 件での Freshness@K の SE 試算:

```
目標スコア p ≈ 0.5, SE = √(p(1-p)/n) = √(0.25/50) = 0.071
95% CI: ±0.14 → 改善 0.10 は CI 内のノイズかもしれない
改善 0.20 以上なら 95% 信頼で有意と言える
```

**この Phase まで完了して初めて、Freshness@K と Temporal Order Score について「統計的に有意な改善」と言えるようになる。**

| ゲート | 値 | 条件 |
|------|--:|-----|
| Freshness@K（50件） | 0.50 以上 | Phase C の完了条件 |
| Temporal Order Score（30件） | 0.65 以上 | Phase C の完了条件 |
| locomo-120 F1 | 0.27 以上 | Phase B の成果を維持 |

---

### Phase D: 長期目標（§33 以降、条件付き）

以下は実装コストが高く、前 Phase の完了が前提となる。

| メトリクス | 現スコア | 長期目標 | 前提条件 |
|---------|------:|------:|--------|
| locomo-120 F1 | 0.2104 | 0.35 | LLM Judge または 384 次元 embedding |
| Freshness@K | 0.10 | 0.70 | recency ブースト + KU フィクスチャ拡充 |
| Temporal Order Score | 0.583 | 0.75 | temporal reranking 実装 |
| competitive rank | 3位/5位 | 2位/5位 | F1 0.35 + Freshness 0.70 |

---

## 6. テストケース数の最低要件

### 数値根拠

統計的に有意な結論を出すための最低サンプル数は、要求する検出力と最小検出差に依存する。

```
要求: 改善 Δ=0.10 を 80% の検出力で検出したい
バイナリ指標（recall, freshness のバイナリ版）の場合:
  p_before=0.50, p_after=0.60
  n = (z_α/2 + z_β)² × p(1-p) / Δ²
  = (1.96 + 0.84)² × 0.25 / 0.01
  ≈ 196 サンプル
```

実用的な妥協点（検出力 70%、Δ=0.15）:

```
n = (1.96 + 0.52)² × 0.25 / 0.0225 ≈ 68 サンプル
```

**最小サンプル数の実用的推奨**:

| 用途 | 最低サンプル数 | 現状 | アクション |
|-----|:-----------:|:---:|---------|
| 開発中スモーク（高速フィードバック）| 15 QA | locomo-15x3: 存在 | 現状維持 |
| 回帰ゲート（CI）| 180 QA | locomo-120 の 180 QA | 現状維持 |
| Freshness の改善判定 | 50 件 | 10 件 | **Phase C で拡充** |
| Temporal の改善判定 | 30 件 | 10 件 | **Phase C で拡充** |
| 競合比較レポート | 180+ QA | locomo-120 の 180 QA | 現状維持 |

---

## 7. 「客観的に改善された」の定義（正規化）

本設計書における「客観的に改善された」の正式な定義:

### 定義 A: 最小条件（Phase A/B レベル）

以下をすべて満たす場合、「改善された」と言える:

```
1. locomo-120 overall F1 >= 0.24（現 baseline +0.03 以上）
2. 同一 commit で 2 回実行して両回とも条件 1 を満たす
3. bilingual recall = 1.0（現水準維持）
4. EM が 0.05 以上（0.0722 → 横ばいか改善）
```

### 定義 B: 強い条件（Phase B/C レベル）

以下をすべて満たす場合、「確実に改善された」と言える:

```
1. locomo-120 overall F1 >= 0.27
2. Freshness@K（50 件以上のデータセット）>= 0.40
3. Temporal Order Score（30 件以上のデータセット）>= 0.65
4. bilingual recall = 1.0
5. カテゴリ別 F1 が全カテゴリで改善（悪化カテゴリなし）
```

### 定義 C: 対外的に主張できる条件

外部ドキュメント・競合比較表での「改善」主張に使う基準:

```
1. 定義 B をすべて満たす
2. 改善が 3 回の独立実行で再現する
3. 測定条件が measurement-framework.md に記録されている
4. 競合比較表に改善日付と測定条件が明記される
```

---

## 8. 実装優先度まとめ

| 優先度 | 対応 | 期待改善 | 工数目安 |
|:-----:|-----|---------|--------|
| 1 | recency ブースト追加（harness-mem-core.ts の検索スコアリング） | Freshness@K 0.10 → 0.40, Temporal 0.583 → 0.62 | 小（1〜2タスク）|
| 2 | `finalizeShortAnswer()` の答え圧縮精度改善 | F1 0.21 → 0.27 | 中（2〜3タスク）|
| 3 | knowledge-update フィクスチャを 50 件に拡充 | 統計的有意性の確保 | 小（1タスク）|
| 4 | temporal フィクスチャを 30 件に拡充 | 統計的有意性の確保 | 小（1タスク）|
| 5 | Freshness@K CI ゲートを 0.30 に一時緩和 | CI FAILED 解消 | 極小（数行）|

---

## 9. 付記: 現行 CI ゲート設定の問題点と修正提案

現在 `run-ci.ts` で Freshness@K のゲートは `>= 0.7` だが、実測値は 0.10 である。
このため CI は常に `knowledge-update-10 FAILED` の状態で動作している。

これは **回帰防止として機能していない**（すでに失敗しているため、さらに悪化しても検出できない）。

修正提案:

```typescript
// 現在（run-ci.ts L245）:
const passed = freshnessAtK >= 0.7;

// 提案（Phase A 改善中は一時緩和）:
const FRESHNESS_GATE = Number(process.env.HARNESS_BENCH_FRESHNESS_GATE ?? "0.30");
const passed = freshnessAtK >= FRESHNESS_GATE;
```

環境変数 `HARNESS_BENCH_FRESHNESS_GATE` を使うことで、CI 設定ファイルで段階的引き上げを管理できる。
ハードコード値の変更なしに Phase A → 0.30 → Phase B → 0.50 → Phase C → 0.70 と遷移できる。

---

## 関連ファイル

| ファイル | 役割 |
|--------|-----|
| `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/memory-server/src/benchmark/run-ci.ts` | CI ランナー（ゲート設定） |
| `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/memory-server/src/benchmark/runner.ts` | Freshness@K / Temporal Order Score 実装 |
| `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/tests/benchmarks/locomo-evaluator.ts` | F1 / EM 計算 |
| `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/tests/benchmarks/locomo-harness-adapter.ts` | 答え抽出（F1 改善の主要対象） |
| `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/tests/benchmarks/fixtures/knowledge-update-10.json` | Freshness@K フィクスチャ（10件 → 50件に拡充予定） |
| `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/tests/benchmarks/fixtures/temporal-10.json` | Temporal フィクスチャ（10件 → 30件に拡充予定） |
| `/Users/tachibanashuuta/Desktop/Code/CC-harness/harness-mem/docs/benchmarks/measurement-framework.md` | 統計的妥当性の基準（本設計書と組み合わせて使用）|
