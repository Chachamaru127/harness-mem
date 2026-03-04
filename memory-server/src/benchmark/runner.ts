/**
 * V5-007: ベンチマークランナー
 *
 * LoCoMo / LongMemEval 風データセットで検索品質を計測する。
 * CI での週次回帰ゲートとして利用する。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface BenchmarkConfig {
  dataset: "locomo" | "longmemeval";
  maxSamples?: number;
  metrics: ("recall@10" | "precision@10" | "mrr" | "ndcg")[];
}

export interface BenchmarkResult {
  dataset: string;
  timestamp: string;
  metrics: Record<string, number>;
  samples: number;
  duration_ms: number;
}

interface DatasetSample {
  id: string;
  content: string;
  query: string;
  relevant_ids: string[];
}

interface Dataset {
  name: string;
  description: string;
  samples: DatasetSample[];
}

const DATASET_FILES: Record<string, string> = {
  locomo: join(import.meta.dir, "datasets", "locomo-mini.json"),
  longmemeval: join(import.meta.dir, "datasets", "longmemeval-mini.json"),
};

export class BenchmarkRunner {
  constructor(private core: {
    recordEvent: (event: {
      event_id?: string;
      platform: string;
      project: string;
      session_id: string;
      event_type: string;
      ts?: string;
      payload?: Record<string, unknown>;
      tags?: string[];
      privacy_tags?: string[];
    }) => void;
    search: (req: {
      query: string;
      project?: string;
      include_private?: boolean;
      limit?: number;
    }) => { items: Array<{ id: string; content?: string }> };
  }) {}

  async run(config: BenchmarkConfig): Promise<BenchmarkResult> {
    const startMs = Date.now();
    const datasetFile = DATASET_FILES[config.dataset];
    const raw = readFileSync(datasetFile, "utf-8");
    const dataset: Dataset = JSON.parse(raw);

    const samples = config.maxSamples
      ? dataset.samples.slice(0, config.maxSamples)
      : dataset.samples;

    // テストデータを投入
    const project = `benchmark-${config.dataset}`;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      this.core.recordEvent({
        event_id: s.id,
        platform: "claude",
        project,
        session_id: `bench-session-${config.dataset}`,
        event_type: "user_prompt",
        ts: new Date(Date.now() - (samples.length - i) * 60_000).toISOString(),
        payload: { prompt: s.content },
        tags: [],
        privacy_tags: [],
      });
    }

    // 各サンプルで search を実行し metrics を集計
    const allRecall10: number[] = [];
    const allPrecision10: number[] = [];
    const allMrr: number[] = [];
    const allNdcg: number[] = [];

    for (const s of samples) {
      const result = this.core.search({
        query: s.query,
        project,
        include_private: true,
        limit: 10,
      });

      // item.id は DB 上で既に "obs_" プレフィックス付き（event-recorder.ts L609）
      const retrievedIds = result.items.map((item) => String(item.id ?? ""));
      // relevant_ids にも同じ "obs_" プレフィックスを付けて形式を合わせる
      const relevantIds = s.relevant_ids.map((rid) => `obs_${rid}`);

      if (config.metrics.includes("recall@10")) {
        allRecall10.push(this.calculateRecallAtK(retrievedIds, relevantIds, 10));
      }
      if (config.metrics.includes("precision@10")) {
        allPrecision10.push(this.calculatePrecisionAtK(retrievedIds, relevantIds, 10));
      }
      if (config.metrics.includes("mrr")) {
        allMrr.push(this.calculateMRR(retrievedIds, relevantIds));
      }
      if (config.metrics.includes("ndcg")) {
        allNdcg.push(this.calculateNDCG(retrievedIds, relevantIds, 10));
      }
    }

    const avg = (arr: number[]) =>
      arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;

    const metrics: Record<string, number> = {};
    if (config.metrics.includes("recall@10")) metrics["recall@10"] = avg(allRecall10);
    if (config.metrics.includes("precision@10")) metrics["precision@10"] = avg(allPrecision10);
    if (config.metrics.includes("mrr")) metrics["mrr"] = avg(allMrr);
    if (config.metrics.includes("ndcg")) metrics["ndcg"] = avg(allNdcg);

    const duration_ms = Date.now() - startMs;

    return {
      dataset: config.dataset,
      timestamp: new Date().toISOString(),
      metrics,
      samples: samples.length,
      duration_ms,
    };
  }

  calculateRecallAtK(retrieved: string[], relevant: string[], k: number): number {
    if (relevant.length === 0) return 1;
    const topK = retrieved.slice(0, k);
    const hits = topK.filter((id) => relevant.includes(id)).length;
    return hits / relevant.length;
  }

  calculatePrecisionAtK(retrieved: string[], relevant: string[], k: number): number {
    if (k === 0) return 0;
    const topK = retrieved.slice(0, k);
    const hits = topK.filter((id) => relevant.includes(id)).length;
    return hits / k;
  }

  calculateMRR(retrieved: string[], relevant: string[]): number {
    for (let i = 0; i < retrieved.length; i++) {
      if (relevant.includes(retrieved[i])) {
        return 1 / (i + 1);
      }
    }
    return 0;
  }

  calculateNDCG(retrieved: string[], relevant: string[], k: number): number {
    const topK = retrieved.slice(0, k);

    // DCG
    let dcg = 0;
    for (let i = 0; i < topK.length; i++) {
      const rel = relevant.includes(topK[i]) ? 1 : 0;
      dcg += rel / Math.log2(i + 2);
    }

    // Ideal DCG
    const idealRel = Math.min(relevant.length, k);
    let idcg = 0;
    for (let i = 0; i < idealRel; i++) {
      idcg += 1 / Math.log2(i + 2);
    }

    return idcg === 0 ? 0 : dcg / idcg;
  }

  /**
   * Freshness@K: 最新の記録が古い記録より上位に来るかを測定する。
   *
   * - retrieved: 検索結果の ID 配列（上位から順）
   * - newId: 新しい記録の ID（上位に来るべき）
   * - oldIds: 古い記録の ID 配列（newId より下位にあるべき）
   * - k: 評価対象の上位 K 件
   * - 戻り値: 1.0（newId が全 oldId より上位）、0.5（部分的に上位）、0.0（newId が見つからない or 全 oldId より下位）
   */
  calculateFreshnessAtK(retrieved: string[], newId: string, oldIds: string[], k: number): number {
    const topK = retrieved.slice(0, k);
    const newRank = topK.indexOf(newId);
    if (newRank === -1) return 0;

    const oldRanksInTopK = oldIds
      .map((id) => topK.indexOf(id))
      .filter((rank) => rank !== -1);

    if (oldRanksInTopK.length === 0) return 1;

    const fresherCount = oldRanksInTopK.filter((oldRank) => newRank < oldRank).length;
    return fresherCount / oldRanksInTopK.length;
  }

  /**
   * §34 FD-004: Weighted Kendall tau
   *
   * 最新情報の順序誤りに大きなペナルティを与えるWeighted Kendall tau。
   * - w_i = exp(-λ * rank_i), λ=0.1 (高ランクほど重み大)
   * - concordant/discordant pairs を重み付きで計算
   * - retrieved: 検索結果の ID 配列（上位から順）
   * - expectedOrder: 期待される時系列順序の ID 配列
   * - k: 評価対象の上位 K 件
   * - 戻り値: [0, 1] に正規化した Weighted Kendall tau
   */
  calculateWeightedKendallTau(retrieved: string[], expectedOrder: string[], k: number): number {
    const LAMBDA = 0.1;
    const topK = retrieved.slice(0, k);
    const filteredRetrieved = topK.filter((id) => expectedOrder.includes(id));
    if (filteredRetrieved.length < 2) return 0.5;

    const ranks = filteredRetrieved.map((id) => expectedOrder.indexOf(id));

    let weightedConcordant = 0;
    let weightedDiscordant = 0;
    let totalWeight = 0;

    for (let i = 0; i < ranks.length; i++) {
      for (let j = i + 1; j < ranks.length; j++) {
        // 検索結果での順位ベースの重み（上位ほど重み大）
        const w = Math.exp(-LAMBDA * i) + Math.exp(-LAMBDA * j);
        totalWeight += w;
        if (ranks[i] < ranks[j]) {
          weightedConcordant += w;
        } else if (ranks[i] > ranks[j]) {
          weightedDiscordant += w;
        }
      }
    }

    if (totalWeight === 0) return 0.5;
    const tau = (weightedConcordant - weightedDiscordant) / totalWeight;
    // [-1, 1] → [0, 1] に正規化
    return (tau + 1) / 2;
  }

  /**
   * §34 FD-004: nDCG@5（Temporal Gain）
   *
   * 時系列距離ベースのゲインを使った nDCG@5。
   * - gain(i) = 1 / (1 + |retrieved_rank - expected_rank|)
   * - 期待順序から近いほど高いゲイン
   * - retrieved: 検索結果の ID 配列（上位から順）
   * - expectedOrder: 期待される時系列順序の ID 配列
   * - k: 評価対象の上位 K 件（通常5）
   * - 戻り値: [0, 1] のnDCG@k スコア
   */
  calculateNDCGAtK(retrieved: string[], expectedOrder: string[], k: number): number {
    const topK = retrieved.slice(0, k);

    // DCG 計算
    let dcg = 0;
    for (let i = 0; i < topK.length; i++) {
      const id = topK[i];
      const expectedIdx = expectedOrder.indexOf(id);
      if (expectedIdx === -1) continue;
      // temporal gain: 期待順位との距離が小さいほど高ゲイン
      const gain = 1 / (1 + Math.abs(i - expectedIdx));
      dcg += gain / Math.log2(i + 2);
    }

    // IDCG: 理想的な順序（expected order の上位 k 件が完全一致）
    let idcg = 0;
    const idealCount = Math.min(k, expectedOrder.length);
    for (let i = 0; i < idealCount; i++) {
      // 理想ゲイン = 1 (distance = 0)
      idcg += 1 / Math.log2(i + 2);
    }

    return idcg === 0 ? 0 : dcg / idcg;
  }

  /**
   * Temporal Order Score: 時系列順序の正しさを Kendall tau 相関係数で測定する。
   *
   * - retrieved: 検索結果の ID 配列（上位から順）
   * - expectedOrder: 期待される時系列順序の ID 配列
   * - k: 評価対象の上位 K 件
   * - 戻り値: [-1, 1] の Kendall tau 係数（1.0 = 完全一致、-1.0 = 逆順）
   *   UI 向けに [0, 1] に正規化して返す: (tau + 1) / 2
   */
  calculateTemporalOrderScore(retrieved: string[], expectedOrder: string[], k: number): number {
    const topK = retrieved.slice(0, k);
    // expectedOrder に含まれる ID のみを対象とし、取得順序を記録
    const filteredRetrieved = topK.filter((id) => expectedOrder.includes(id));
    if (filteredRetrieved.length < 2) return 0.5; // 判定不能は中立値

    // 取得順での位置インデックス（expectedOrder 基準）
    const ranks = filteredRetrieved.map((id) => expectedOrder.indexOf(id));

    // Kendall tau: コンコーダントペア数 - ディスコーダントペア数
    let concordant = 0;
    let discordant = 0;
    for (let i = 0; i < ranks.length; i++) {
      for (let j = i + 1; j < ranks.length; j++) {
        if (ranks[i] < ranks[j]) {
          concordant++;
        } else if (ranks[i] > ranks[j]) {
          discordant++;
        }
      }
    }

    const totalPairs = (ranks.length * (ranks.length - 1)) / 2;
    if (totalPairs === 0) return 0.5;

    const tau = (concordant - discordant) / totalPairs;
    // [-1, 1] → [0, 1] に正規化
    return (tau + 1) / 2;
  }

  /**
   * §34 FD-011: Bootstrap CI（信頼区間推定）
   *
   * 観測スコアのリサンプリングにより 95% Bootstrap 信頼区間を推定する。
   * recall=1.0 のような上限張り付きケースは Wilson CI にフォールバック。
   *
   * - scores: 各サンプルのスコア配列 [0, 1]
   * - numSamples: ブートストラップ反復数（デフォルト 10000）
   * - confidence: 信頼水準（デフォルト 0.95）
   * - 戻り値: { lower, upper, mean, se, method }
   */
  bootstrapCI(
    scores: number[],
    numSamples = 10000,
    confidence = 0.95
  ): { lower: number; upper: number; mean: number; se: number; method: string } {
    if (scores.length === 0) {
      return { lower: 0, upper: 0, mean: 0, se: 0, method: "empty" };
    }

    const n = scores.length;
    const mean = scores.reduce((a, b) => a + b, 0) / n;

    // recall=1.0 / recall=0.0 など上限・下限張り付きは Wilson CI にフォールバック
    const allSame = scores.every((s) => s === scores[0]);
    if (allSame && (mean >= 1.0 || mean <= 0.0)) {
      return this._wilsonCI(mean, n, confidence);
    }

    // Bootstrap リサンプリング
    const bootstrapMeans: number[] = new Array(numSamples);
    for (let b = 0; b < numSamples; b++) {
      let sum = 0;
      for (let i = 0; i < n; i++) {
        sum += scores[Math.floor(Math.random() * n)];
      }
      bootstrapMeans[b] = sum / n;
    }
    bootstrapMeans.sort((a, b) => a - b);

    const alpha = 1 - confidence;
    const lowerIdx = Math.floor((alpha / 2) * numSamples);
    const upperIdx = Math.floor((1 - alpha / 2) * numSamples) - 1;

    const se = Math.sqrt(
      bootstrapMeans.reduce((acc, m) => acc + (m - mean) ** 2, 0) / (numSamples - 1)
    );

    return {
      lower: Number(bootstrapMeans[lowerIdx].toFixed(4)),
      upper: Number(bootstrapMeans[Math.min(upperIdx, numSamples - 1)].toFixed(4)),
      mean: Number(mean.toFixed(4)),
      se: Number(se.toFixed(4)),
      method: "bootstrap",
    };
  }

  /**
   * Wilson スコア信頼区間（比率データの上限張り付き時フォールバック）
   */
  private _wilsonCI(
    p: number,
    n: number,
    confidence: number
  ): { lower: number; upper: number; mean: number; se: number; method: string } {
    // z 値: 95% → 1.96, 99% → 2.576
    const zMap: Record<number, number> = { 0.90: 1.645, 0.95: 1.96, 0.99: 2.576 };
    const z = zMap[confidence] ?? 1.96;
    const z2 = z * z;
    const denom = 1 + z2 / n;
    const center = (p + z2 / (2 * n)) / denom;
    const spread = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
    const se = Math.sqrt((p * (1 - p)) / Math.max(n, 1));
    return {
      lower: Number(Math.max(0, center - spread).toFixed(4)),
      upper: Number(Math.min(1, center + spread).toFixed(4)),
      mean: Number(p.toFixed(4)),
      se: Number(se.toFixed(4)),
      method: "wilson",
    };
  }

  /**
   * §34 FD-011: Holm-Bonferroni 多重比較補正
   *
   * 複数の仮説検定の p 値に Holm-Bonferroni 法を適用し、各仮説の棄却判定を返す。
   * FWER（族全体の第1種誤り率）を alpha 以下に制御する。
   *
   * - pValues: 各仮説の p 値配列
   * - alpha: 有意水準（デフォルト 0.05）
   * - 戻り値: 各仮説を棄却するかどうかの boolean 配列（元の順序を保持）
   */
  holmBonferroni(pValues: number[], alpha = 0.05): boolean[] {
    if (pValues.length === 0) return [];

    const m = pValues.length;
    // インデックス付きでソート（p 値昇順）
    const indexed = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);

    const rejected = new Array<boolean>(m).fill(false);

    for (let k = 0; k < m; k++) {
      // Holm-Bonferroni 補正閾値: alpha / (m - k)
      const threshold = alpha / (m - k);
      if (indexed[k].p <= threshold) {
        rejected[indexed[k].i] = true;
      } else {
        // 棄却できなければ以降は全て棄却しない（単調性）
        break;
      }
    }

    return rejected;
  }
}
