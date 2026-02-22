import { describe, expect, test } from "bun:test";
import { buildLocomoDriftReport } from "./locomo-drift-report";

describe("LOCOMO drift report", () => {
  test("flags improvements and regressions against previous run", () => {
    const report = buildLocomoDriftReport(
      {
        overall: { em: 0.4, f1: 0.5, count: 10 },
      },
      {
        overall: { em: 0.5, f1: 0.45, count: 10 },
      }
    );

    expect(report.delta.em).toBeCloseTo(0.1, 5);
    expect(report.delta.f1).toBeCloseTo(-0.05, 5);
    expect(report.status.em).toBe("improved");
    expect(report.status.f1).toBe("regressed");
  });
});
