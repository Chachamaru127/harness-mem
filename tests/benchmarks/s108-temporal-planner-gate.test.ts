import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  test("planner keeps temporal anchor self-answer cases in recall", async () => {
    const result = await runTemporalPlannerGate({
      writeArtifacts: false,
      now: new Date("2026-05-27T00:00:00.000Z"),
    });

    expect(result.metrics.answer_hit_at_10).toBeGreaterThanOrEqual(0.90);
    expect(result.metrics.answer_top1_rate).toBeGreaterThanOrEqual(0.80);
    expect(result.metrics.japanese_temporal_slice).toBeGreaterThanOrEqual(0.88);
  });

  test("planner keeps previous status-summary answers in recall", async () => {
    const artifactDir = mkdtempSync(join(tmpdir(), "harness-mem-s108-temp-025-"));
    try {
      const result = await runTemporalPlannerGate({
        artifactDir,
        now: new Date("2026-05-27T00:00:00.000Z"),
      });

      expect(result.metrics.answer_hit_at_10).toBeGreaterThanOrEqual(0.98);
      expect(result.metrics.answer_top1_rate).toBeGreaterThanOrEqual(0.91);
      expect(result.metrics.japanese_temporal_slice).toBe(1);
      expect(result.metrics.current_stale_answer_regressions).toBe(0);

      const cases = JSON.parse(readFileSync(join(artifactDir, "case-results.json"), "utf8")) as {
        cases: Array<{ case_id: string; retrieved_ids: string[]; answer_top1: boolean; answer_hit_at_10: boolean }>;
      };
      const byId = new Map(cases.cases.map((entry) => [entry.case_id, entry]));
      expect(byId.get("s108-temp-023")?.retrieved_ids[0]).toBe("obs_s108-temp-023-s108-api-e4");
      expect(byId.get("s108-temp-024")?.retrieved_ids[0]).toBe("obs_s108-temp-024-s108-api-e4");
      const apiV3After = cases.cases.find((entry) => entry.case_id === "s108-temp-025");
      expect(apiV3After?.retrieved_ids[0]).toBe("obs_s108-temp-025-s108-api-e3");
      expect(apiV3After?.retrieved_ids).toContain("obs_s108-temp-025-s108-api-e4");
      expect(apiV3After?.answer_top1).toBe(true);
      expect(apiV3After?.answer_hit_at_10).toBe(true);
      expect(byId.get("s108-temp-026")?.answer_hit_at_10).toBe(true);
      expect(byId.get("s108-temp-026")?.retrieved_ids[0]).not.toBe("obs_s108-temp-026-s108-api-e4");
    } finally {
      rmSync(artifactDir, { recursive: true, force: true });
    }
  });
});
