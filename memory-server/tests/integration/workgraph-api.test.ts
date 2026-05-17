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

async function postJson(
  baseUrl: string,
  path: string,
  body: Record<string, unknown>
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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

  test("POST /v1/work/update action=claim rejects double claim through existing lease", async () => {
    const runtime = createRuntime("claim");
    const project = "/repo/harness-mem";
    try {
      seedWorkGraph(runtime.core, project);
      const first = await postJson(runtime.baseUrl, "/v1/work/update", {
        action: "claim",
        project,
        work_id: "S125-009",
        agent_id: "agent-a",
        session_id: "session-s125",
        ttl_ms: 600_000,
        now: "2026-05-17T10:00:00.000Z",
      });
      const second = await postJson(runtime.baseUrl, "/v1/work/update", {
        action: "claim",
        project,
        work_id: "S125-009",
        agent_id: "agent-b",
        now: "2026-05-17T10:01:00.000Z",
      });

      expect(first.status).toBe(200);
      expect((first.body.items as Array<Record<string, unknown>>)[0]).toMatchObject({
        work_id: "S125-009",
        status: "in_progress",
        assignee: "agent-a",
        lease_status: "active",
      });
      expect(second.status).toBe(409);
      expect(second.body).toMatchObject({ ok: false, error: "already_leased", held_by: "agent-a" });
      expect(createWorkStore(runtime.core.getRawDb()).getWorkItem("S125-009")).toMatchObject({
        status: "in_progress",
        assignee: "agent-a",
      });
    } finally {
      runtime.stop();
    }
  });

  test("POST /v1/work/update action=close releases lease and closes work", async () => {
    const runtime = createRuntime("close");
    const project = "/repo/harness-mem";
    try {
      seedWorkGraph(runtime.core, project);
      const claimed = await postJson(runtime.baseUrl, "/v1/work/update", {
        action: "claim",
        project,
        work_id: "S125-009",
        agent_id: "agent-a",
        ttl_ms: 600_000,
        now: "2026-05-17T10:00:00.000Z",
      });
      const leaseId = ((claimed.body.items as Array<Record<string, unknown>>)[0]?.lease_id ?? "") as string;
      const closed = await postJson(runtime.baseUrl, "/v1/work/update", {
        action: "close",
        project,
        work_id: "S125-009",
        agent_id: "agent-a",
        lease_id: leaseId,
        reason: "Fixed and tested",
        now: "2026-05-17T10:05:00.000Z",
      });

      expect(claimed.status).toBe(200);
      expect(closed.status).toBe(200);
      expect((closed.body.items as Array<Record<string, unknown>>)[0]).toMatchObject({
        work_id: "S125-009",
        status: "closed",
        lease_status: "released",
      });
      expect(createWorkStore(runtime.core.getRawDb()).getWorkItem("S125-009")).toMatchObject({
        status: "closed",
        closeReason: "Fixed and tested",
      });
    } finally {
      runtime.stop();
    }
  });

  test("POST /v1/work/update action=handoff sends threaded signal and links work", async () => {
    const runtime = createRuntime("handoff");
    const project = "/repo/harness-mem";
    try {
      seedWorkGraph(runtime.core, project);
      const first = await postJson(runtime.baseUrl, "/v1/work/update", {
        action: "handoff",
        project,
        work_id: "S125-009",
        agent_id: "agent-a",
        to_agent: "agent-b",
        content: "Continue with S125-011 verification.",
        session_id: "session-s125",
        observation_id: "obs-s125",
        now: "2026-05-17T10:00:00.000Z",
      });
      const firstItem = (first.body.items as Array<Record<string, unknown>>)[0];
      const reply = await postJson(runtime.baseUrl, "/v1/work/update", {
        action: "handoff",
        project,
        work_id: "S125-009",
        agent_id: "agent-b",
        to_agent: "agent-a",
        content: "Acknowledged.",
        reply_to: firstItem?.signal_id,
        now: "2026-05-17T10:01:00.000Z",
      });

      expect(first.status).toBe(200);
      expect(reply.status).toBe(200);
      expect((reply.body.items as Array<Record<string, unknown>>)[0]?.thread_id).toBe(firstItem?.thread_id);
      const links = createWorkStore(runtime.core.getRawDb()).listLinks("S125-009");
      expect(links).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ targetType: "signal", targetId: firstItem?.signal_id, relation: "handoff" }),
          expect.objectContaining({ targetType: "session", targetId: "session-s125", relation: "context" }),
          expect.objectContaining({ targetType: "observation", targetId: "obs-s125", relation: "evidence" }),
        ])
      );
    } finally {
      runtime.stop();
    }
  });
});
