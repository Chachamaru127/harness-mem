import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessMemCore, type Config } from "../../src/core/harness-mem-core";

function createCore(name: string): { core: HarnessMemCore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-admin-${name}-`));
  const config: Config = {
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
  };
  return { core: new HarnessMemCore(config), dir };
}

describe("memory admin integration", () => {
  test("reindexVectors and metrics endpoints data shape", () => {
    const { core, dir } = createCore("reindex");
    try {
      core.recordEvent({
        platform: "claude",
        project: "admin-project",
        session_id: "session-admin",
        event_type: "user_prompt",
        ts: "2026-02-14T00:00:00.000Z",
        payload: { content: "vector test content" },
        tags: ["admin"],
        privacy_tags: [],
      });

      const reindex = core.reindexVectors(100);
      expect(reindex.ok).toBe(true);
      const payload = reindex.items[0] as { reindexed: number };
      expect(payload.reindexed).toBeGreaterThan(0);

      const metrics = core.metrics();
      expect(metrics.ok).toBe(true);
      const metricsItem = metrics.items[0] as {
        coverage: { observations: number; mem_vectors: number; mem_vectors_vec_map: number };
      };
      expect(metricsItem.coverage.observations).toBeGreaterThan(0);
      expect(metricsItem.coverage.mem_vectors).toBeGreaterThan(0);
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
