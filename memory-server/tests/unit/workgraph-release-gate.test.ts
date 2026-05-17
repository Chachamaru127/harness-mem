import { describe, expect, test } from "bun:test";
import { runWorkGraphReleaseGateSmoke } from "../../src/benchmark/workgraph-release-gate";

describe("WorkGraph release gate smoke (§S125-015)", () => {
  test("emits all WorkGraph MVP metrics at passing thresholds in warn mode", () => {
    const result = runWorkGraphReleaseGateSmoke("warn");

    expect(result.mode).toBe("warn");
    expect(result.passed).toBe(true);
    expect(result.tier).toBe("green");
    expect(result.failed_metrics).toEqual([]);
    expect(result.metrics).toMatchObject({
      plans_import_fidelity: 1,
      ready_precision: 1,
      blocker_recall: 1,
      next_action_accuracy: 1,
      duplicate_work_rate: 0,
      claim_lease_success_rate: 1,
      work_hint_consumed_rate: 0.6,
    });
  });

  test("keeps the documented threshold table in the manifest result", () => {
    const result = runWorkGraphReleaseGateSmoke();

    expect(result.thresholds).toEqual({
      plans_import_fidelity_min: 0.98,
      ready_precision_min: 0.95,
      blocker_recall_min: 0.95,
      next_action_accuracy_min: 0.8,
      duplicate_work_rate_max: 0.05,
      claim_lease_success_rate_min: 0.98,
      work_hint_consumed_rate_yellow_min: 0.3,
      work_hint_consumed_rate_green_min: 0.6,
    });
  });
});
