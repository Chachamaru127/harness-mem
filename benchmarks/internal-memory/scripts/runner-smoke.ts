#!/usr/bin/env bun
import { runInternalMemoryBenchmark } from "./run-internal-memory-benchmark";

const output = await runInternalMemoryBenchmark({
  competitors: ["harness-mem", "agentmemory", "supermemory", "claude-mem"],
  limit: 6,
});

const harnessOk = output.results.filter(
  (row) => row.competitor_id === "harness-mem" && row.status === "ok",
).length;
const skipped = output.results.filter((row) => row.status === "skipped_missing_credentials").length;

console.log(
  JSON.stringify(
    {
      ok: harnessOk > 0,
      total_results: output.results.length,
      harness_ok: harnessOk,
      skipped,
      summary: output.summaryPath,
    },
    null,
    2,
  ),
);

process.exit(harnessOk > 0 ? 0 : 1);
