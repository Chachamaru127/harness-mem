#!/usr/bin/env bun
/**
 * ONNX/embedding smoke for internal-memory benchmark.
 * Run outside default bun test to avoid Bun+ONNX teardown crashes.
 *
 *   HARNESS_MEM_INTERNAL_BENCH_EMBEDDING=1 bun run benchmarks/internal-memory/scripts/smoke-embedding.ts
 */
import { HarnessMemAdapter } from "../adapters/harness-mem";
import { scoreCase } from "../lib/score-case";
import type { BenchmarkCase } from "../lib/types";

const sampleCase: BenchmarkCase = {
  case_id: "smoke-001",
  layer: "ja_coding",
  category: "ja_requirements",
  language_profile: "ja",
  project: "bench-smoke",
  memories: [
    {
      id: "smoke-001-m1",
      content: "内部ベンチでは Plans.md を正本にし、cc:WIP と cc:完了 を使う。",
    },
  ],
  query: "Plans.md のマーカー運用は？",
  relevant_ids: ["smoke-001-m1"],
};

const adapter = new HarnessMemAdapter();
const context = {
  run_id: "embedding-smoke",
  competitor_id: "harness-mem",
  project_prefix: "bench-embed-smoke",
};

try {
  await adapter.prepareCase(sampleCase, context);
  const queryResult = await adapter.query(sampleCase, context);
  const scored = scoreCase(sampleCase, "harness-mem", queryResult);
  console.log(
    JSON.stringify(
      {
        ok: queryResult.status === "ok" && scored.recall_at_10 > 0,
        recall_at_10: scored.recall_at_10,
        hits: queryResult.hits.length,
        latency_ms: queryResult.latency_ms,
      },
      null,
      2,
    ),
  );
  process.exit(queryResult.status === "ok" && scored.recall_at_10 > 0 ? 0 : 1);
} finally {
  await adapter.dispose();
}
