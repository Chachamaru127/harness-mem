import { describe, expect, test } from "bun:test";
import { runTemporalPlannerGate } from "../../scripts/s108-temporal-planner-gate";

describe("S108-008 temporal query planner gate", () => {
  test("planner keeps current and historical temporal answers separated", async () => {
    const result = await runTemporalPlannerGate({
      maxCases: 12,
      writeArtifacts: false,
      now: new Date("2026-05-07T00:00:00.000Z"),
    });

    expect(result.schema_version).toBe("s108-temporal-planner.v1");
    expect(result.metrics.temporal_order_score).toBeGreaterThanOrEqual(0.70);
    expect(result.metrics.current_stale_answer_regressions).toBe(0);
  });
});
