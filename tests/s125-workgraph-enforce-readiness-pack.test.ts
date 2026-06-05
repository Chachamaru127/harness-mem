import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runS125WorkGraphEnforceReadinessPack } from "../scripts/s125-workgraph-enforce-readiness-pack";

describe("S125 WorkGraph enforce readiness pack", () => {
  test("current Plans.md remains enforce-ready despite warning-only historical rows", async () => {
    const artifactDir = mkdtempSync(join(tmpdir(), "hmem-s125-readiness-"));
    try {
      const result = await runS125WorkGraphEnforceReadinessPack({
        artifactDir,
        runs: 1,
        plansPath: resolve("Plans.md"),
        project: process.cwd(),
        skipContract: true,
        now: new Date("2026-06-05T00:00:00.000Z"),
      });

      expect(result.gate_runs.every((run) => run.passed)).toBe(true);
      expect(result.real_plans_dry_run.writes).toBe(0);
      expect(result.real_plans_dry_run.plans_import_fidelity).toBeGreaterThanOrEqual(0.97);
      expect(result.real_plans_dry_run.required_task_ids_present).toEqual(["S125-016", "S108-017"]);
      expect(result.real_plans_dry_run.passed).toBe(true);
      expect(result.overall_passed).toBe(true);
    } finally {
      rmSync(artifactDir, { recursive: true, force: true });
    }
  });
});
