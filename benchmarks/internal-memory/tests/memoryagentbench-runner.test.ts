import { describe, expect, test } from "bun:test";
import { parseArgs } from "../scripts/run-internal-memory-benchmark";

describe("MemoryAgentBench runner args", () => {
  test("parses dataset, split, cache dir, revision, and reused limit", () => {
    const args = parseArgs([
      "--dataset",
      "memoryagentbench",
      "--mab-split",
      "Conflict_Resolution",
      "--cache-dir",
      "/tmp/mab-cache",
      "--revision",
      "fixture-revision",
      "--limit",
      "3",
      "--competitors",
      "harness-mem",
    ]);

    expect(args.dataset).toBe("memoryagentbench");
    expect(args.mabSplit).toBe("Conflict_Resolution");
    expect(args.cacheDir).toBe("/tmp/mab-cache");
    expect(args.revision).toBe("fixture-revision");
    expect(args.limit).toBe(3);
    expect(args.competitors).toEqual(["harness-mem"]);
  });

  test("parses medium gate row limit", () => {
    const args = parseArgs([
      "--dataset",
      "memoryagentbench",
      "--mab-split",
      "Accurate_Retrieval",
      "--mab-row-limit",
      "1",
      "--competitors",
      "harness-mem",
    ]);

    expect(args.dataset).toBe("memoryagentbench");
    expect(args.mabSplit).toBe("Accurate_Retrieval");
    expect(args.mabRowLimit).toBe(1);
    expect(args.limit).toBeUndefined();
  });

  test("keeps default dataset behavior when --dataset is omitted", () => {
    const args = parseArgs(["--limit", "2"]);
    expect(args.dataset).toBe("default");
    expect(args.limit).toBe(2);
  });
});
