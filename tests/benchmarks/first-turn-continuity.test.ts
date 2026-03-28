import { describe, expect, test } from "bun:test";
import { runHarnessFirstTurnContinuityBenchmark } from "../../scripts/benchmarks/session-continuity-shared";

describe("S59-005: first-turn continuity benchmark", () => {
  test(
    "Claude and Codex preserve chain facts, avoid carryover noise, and surface recent project context secondarily",
    async () => {
      const report = await runHarnessFirstTurnContinuityBenchmark();

      expect(report.claude.recall).toBe(1);
      expect(report.claude.falseCarryoverCount).toBe(0);
      expect(report.claude.recentProjectRecall).toBe(1);
      expect(report.codex.recall).toBe(1);
      expect(report.codex.falseCarryoverCount).toBe(0);
      expect(report.codex.recentProjectRecall).toBe(1);
      expect(report.parity.normalizedEqual).toBe(true);
    },
    120_000
  );
});
