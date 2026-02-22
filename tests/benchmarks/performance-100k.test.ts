import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessMemCore, type Config } from "../../memory-server/src/core/harness-mem-core";

function makeConfig(dir: string): Config {
  return {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 37888,
    vectorDimension: 64,
    captureEnabled: true,
    retrievalEnabled: true,
    injectionEnabled: true,
    codexHistoryEnabled: false,
    codexProjectRoot: process.cwd(),
    codexSessionsRoot: process.cwd(),
    codexIngestIntervalMs: 5000,
    codexBackfillHours: 24,
    opencodeIngestEnabled: false,
    cursorIngestEnabled: false,
    antigravityIngestEnabled: false,
  };
}

function percentile(values: number[], q: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor((sorted.length - 1) * q);
  return sorted[idx];
}

describe("performance 100k benchmark", () => {
  const heavy = process.env.HARNESS_MEM_RUN_100K_BENCH === "1" ? test : test.skip;

  heavy("search p95 stays under 300ms on 100000 observations", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-perf-100k-"));
    const core = new HarnessMemCore(makeConfig(dir));
    try {
      const baseTs = Date.parse("2026-01-01T00:00:00.000Z");
      const total = 100000;
      for (let i = 0; i < total; i += 1) {
        core.recordEvent({
          event_id: `perf-100k-${i}`,
          platform: "codex",
          project: `perf-project-${i % 5}`,
          session_id: `perf-session-${i % 50}`,
          event_type: "user_prompt",
          ts: new Date(baseTs + i * 1000).toISOString(),
          payload: { content: `performance benchmark feature-${i % 200} observation ${i}` },
          tags: ["perf", `feature-${i % 200}`],
          privacy_tags: [],
        });
      }

      const latencies: number[] = [];
      for (let i = 0; i < 60; i += 1) {
        const response = core.search({
          query: `feature-${i % 200} performance benchmark`,
          project: `perf-project-${i % 5}`,
          limit: 20,
          include_private: false,
          strict_project: true,
        });
        expect(response.ok).toBe(true);
        latencies.push(Number(response.meta.latency_ms || 0));
      }

      expect(percentile(latencies, 0.95)).toBeLessThan(300);
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  }, 600000);
});
