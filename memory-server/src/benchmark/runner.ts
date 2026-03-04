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
}
