import { describe, expect, test } from "bun:test";
import { runCodeTokenTuningGate } from "../../scripts/s108-code-token-tuning";

describe("S108-004 code-aware lexical tuning gate", () => {
  test("3-run code-token gate meets dev-workflow and bilingual guardrails", () => {
    const result = runCodeTokenTuningGate({
      runs: 3,
      writeArtifacts: false,
      now: new Date("2026-05-07T00:00:00.000Z"),
    });

    expect(result.schema_version).toBe("s108-code-token-tuning.v1");
    expect(result.runs).toHaveLength(3);
    expect(result.gates.dev_workflow_recall_at_10.min).toBeGreaterThanOrEqual(0.70);
    expect(result.gates.search_p95_local_ms.max).toBeLessThanOrEqual(50);
    // v0.28.8 rebaseline (docs/benchmarks/bilingual-baseline-2026-07-07.md):
    // s154-152 FTS segmentation moved the coarse 50-sample fixture 0.86 -> 0.82.
    expect(result.gates.bilingual_recall_at_10.threshold).toBe(0.82);
    expect(result.gates.bilingual_recall_at_10.value).toBeGreaterThanOrEqual(0.82);
    expect(result.overall_passed).toBe(true);
  });
});
