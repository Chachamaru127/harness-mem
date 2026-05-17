import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessMemCore, type Config } from "../../src/core/harness-mem-core";
import { startHarnessMemServer } from "../../src/server";
import { createWorkStore } from "../../src/workgraph/work-store";

function createRuntime(name: string): {
  core: HarnessMemCore;
  baseUrl: string;
  stop: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-workgraph-api-${name}-`));
  const config: Config = {
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
    opencodeIngestEnabled: false,
    cursorIngestEnabled: false,
    antigravityIngestEnabled: false,
  };
  const core = new HarnessMemCore(config);
  const server = startHarnessMemServer(core, config);
  return {
    core,
    baseUrl: `http://127.0.0.1:${server.port}`,
    stop: () => {
      core.shutdown("test");
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function getJson(baseUrl: string, pathWithQuery: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${pathWithQuery}`);
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

function seedWorkGraph(core: HarnessMemCore, project: string): void {
  const store = createWorkStore(core.getRawDb());
  store.upsertWorkItem({
    workId: "S125-009",
    title: "Next scoring and HTTP query",
    project,
    status: "open",
    priority: 1,
    sessionId: "session-s125",
    createdAt: "2026-05-17T09:50:00.000Z",
    updatedAt: "2026-05-17T09:55:00.000Z",
  });
  store.upsertWorkItem({
    workId: "S125-010",
    title: "Claim integration",
    project,
    status: "open",
    priority: 1,
    createdAt: "2026-05-17T09:51:00.000Z",
    updatedAt: "2026-05-17T09:51:00.000Z",
  });
  store.upsertWorkItem({
    workId: "S125-011",
    title: "Handoff integration",
    project,
    status: "open",
    priority: 2,
    createdAt: "2026-05-17T09:52:00.000Z",
    updatedAt: "2026-05-17T09:52:00.000Z",
  });
  store.upsertWorkItem({
    workId: "S125-015",
    title: "Release gate",
    project,
    status: "open",
    priority: 2,
    createdAt: "2026-05-10T09:00:00.000Z",
    updatedAt: "2026-05-10T09:00:00.000Z",
  });
  store.addDependency({ fromWorkId: "S125-009", toWorkId: "S125-010", relation: "blocks" });
  store.addDependency({ fromWorkId: "S125-009", toWorkId: "S125-011", relation: "blocks" });
}

describe("WorkGraph HTTP query API", () => {
  test("GET /v1/work/query requires project or cwd scope", async () => {
    const runtime = createRuntime("scope-required");
    try {
      const { status, body } = await getJson(runtime.baseUrl, "/v1/work/query");
      expect(status).toBe(400);
      expect(body.ok).toBe(false);
      expect(body.error).toBe("project or cwd is required");
    } finally {
      runtime.stop();
    }
  });

  test("GET /v1/work/query returns ranked next work within project scope", async () => {
    const runtime = createRuntime("next");
    const project = "/repo/harness-mem";
    try {
      seedWorkGraph(runtime.core, project);
      const { status, body } = await getJson(
        runtime.baseUrl,
        `/v1/work/query?project=${encodeURIComponent(project)}&mode=next&current_session_id=session-s125&now=${encodeURIComponent("2026-05-17T10:00:00.000Z")}`
      );

      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.source).toBe("workgraph");
      expect((body.meta as Record<string, unknown>).ranking).toBe("work_next_v1");
      expect((body.meta as Record<string, unknown>).next_work_id).toBe("S125-009");
      const items = body.items as Array<Record<string, unknown>>;
      expect(items[0]).toMatchObject({ rank: 1, work_id: "S125-009" });
      expect(items.map((item) => item.work_id)).not.toContain("S125-010");
    } finally {
      runtime.stop();
    }
  });

  test("GET /v1/work/query accepts cwd scope for ready work", async () => {
    const runtime = createRuntime("ready");
    const cwd = "/repo/harness-mem";
    try {
      seedWorkGraph(runtime.core, cwd);
      const { status, body } = await getJson(
        runtime.baseUrl,
        `/v1/work/query?cwd=${encodeURIComponent(cwd)}&mode=ready&now=${encodeURIComponent("2026-05-17T10:00:00.000Z")}`
      );

      expect(status).toBe(200);
      expect((body.meta as Record<string, unknown>).ranking).toBe("work_ready_v1");
      const items = body.items as Array<Record<string, unknown>>;
      expect(items.map((item) => item.work_id)).toEqual(["S125-009", "S125-015"]);
    } finally {
      runtime.stop();
    }
  });
});
