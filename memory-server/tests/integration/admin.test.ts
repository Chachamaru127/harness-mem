import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessMemCore, type Config } from "../../src/core/harness-mem-core";
import { startHarnessMemServer } from "../../src/server";

function createConfig(dir: string): Config {
  return {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 0,
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
}

function createCore(name: string): { core: HarnessMemCore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-admin-${name}-`));
  const config = createConfig(dir);
  return { core: new HarnessMemCore(config), dir };
}

function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
        } else {
          reject(new Error("failed to allocate test port"));
        }
      });
    });
  });
}

async function createRuntime(name: string): Promise<{ baseUrl: string; core: HarnessMemCore; stop: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-admin-api-${name}-`));
  const config = createConfig(dir);
  config.bindPort = await findAvailablePort();
  const core = new HarnessMemCore(config);
  const server = startHarnessMemServer(core, config);
  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    core,
    stop: () => {
      core.shutdown("test");
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("memory admin integration", () => {
  test("reindexVectors and metrics endpoints data shape", async () => {
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

      const reindex = await core.reindexVectors(100);
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

  test("sqlite-vec repair-map admin path defaults to dry-run", () => {
    const { core, dir } = createCore("repair-map-api");
    try {
      core.recordEvent({
        platform: "claude",
        project: "admin-project",
        session_id: "session-admin-repair",
        event_type: "user_prompt",
        ts: "2026-02-25T00:00:00.000Z",
        payload: { content: "repair map endpoint vector content" },
        tags: ["admin"],
        privacy_tags: [],
      });

      const repair = core.repairSqliteVecMap({ limit: 10 });
      expect(repair.ok).toBe(true);
      const item = repair.items[0] as Record<string, unknown>;
      expect(item.dry_run).toBe(true);
      expect(item.vector_count).toBeGreaterThan(0);
      expect(item.repaired).toBe(0);
      expect(item).not.toHaveProperty("missing_after");
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("forget plan endpoint is dry-run and reports impact", async () => {
    const runtime = await createRuntime("forget-plan");
    try {
      const inserted = runtime.core.recordEvent({
        platform: "claude",
        project: "admin-project",
        session_id: "session-admin-forget",
        event_type: "user_prompt",
        ts: "2026-02-25T00:00:00.000Z",
        payload: { content: "old admin forget endpoint content" },
        tags: ["admin"],
        privacy_tags: [],
      });
      const observationId = (inserted.items[0] as { id: string }).id;
      runtime.core.getRawDb()
        .query(`UPDATE mem_observations SET created_at = ?, updated_at = ?, signal_score = 0, access_count = 0 WHERE id = ?`)
        .run("2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z", observationId);

      const response = await fetch(`${runtime.baseUrl}/v1/admin/forget/plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project: "admin-project", limit: 10 }),
      });
      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        ok: boolean;
        items: Array<{
          dry_run: boolean;
          evicted: number;
          candidates: Array<{ observation_id: string }>;
          cross_store_impact: { observations: number };
        }>;
      };
      expect(payload.ok).toBe(true);
      expect(payload.items[0].dry_run).toBe(true);
      expect(payload.items[0].evicted).toBe(0);
      expect(payload.items[0].candidates.map((candidate) => candidate.observation_id)).toContain(observationId);
      expect(payload.items[0].cross_store_impact.observations).toBeGreaterThanOrEqual(1);
    } finally {
      runtime.stop();
    }
  });

  test("vector backfill admin endpoints start, stop, and report status", async () => {
    const runtime = await createRuntime("vector-backfill");
    try {
      const startResponse = await fetch(`${runtime.baseUrl}/v1/admin/vector-backfill/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "test:model",
          dimension: "32",
          compact_batch_size: "7",
          reindex_batch_size: "8",
          interval_ms: "60000",
          target_coverage: "0.99",
          reset: true,
        }),
      });
      expect(startResponse.status).toBe(200);
      const startPayload = (await startResponse.json()) as {
        ok: boolean;
        items: Array<Record<string, unknown>>;
      };
      expect(startPayload.ok).toBe(true);
      expect(startPayload.items[0].model).toBe("test:model");
      expect(startPayload.items[0].dimension).toBe(32);
      expect(startPayload.items[0].compact_batch_size).toBe(7);
      expect(startPayload.items[0].reindex_batch_size).toBe(8);
      expect(startPayload.items[0].interval_ms).toBe(60000);
      expect(startPayload.items[0].target_coverage).toBe(0.99);

      const statusResponse = await fetch(`${runtime.baseUrl}/v1/admin/vector-backfill/status`);
      expect(statusResponse.status).toBe(200);
      const statusPayload = (await statusResponse.json()) as { ok: boolean; items: unknown[] };
      expect(statusPayload.ok).toBe(true);
      expect(statusPayload.items.length).toBe(1);

      const stopResponse = await fetch(`${runtime.baseUrl}/v1/admin/vector-backfill/stop`, { method: "POST" });
      expect(stopResponse.status).toBe(200);
      const stopPayload = (await stopResponse.json()) as { ok: boolean; items: unknown[] };
      expect(stopPayload.ok).toBe(true);
      expect(stopPayload.items.length).toBe(1);
    } finally {
      runtime.stop();
    }
  });
});
