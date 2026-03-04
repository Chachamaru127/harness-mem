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
}
