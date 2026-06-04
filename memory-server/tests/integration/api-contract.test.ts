import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessMemCore, type Config } from "../../src/core/harness-mem-core";
import { startHarnessMemServer } from "../../src/server";

function createRuntime(name: string): {
  core: HarnessMemCore;
  dir: string;
  baseUrl: string;
  stop: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-contract-${name}-`));
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
  const port = server.port;
  return {
    core,
    dir,
    baseUrl: `http://127.0.0.1:${server.port}`,
    stop: () => {
      core.shutdown("test");
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function postJson(baseUrl: string, path: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.ok).toBe(true);
  return response.json();
}

async function getJson(baseUrl: string, pathWithQuery: string): Promise<unknown> {
  const response = await fetch(`${baseUrl}${pathWithQuery}`);
  expect(response.ok).toBe(true);
  return response.json();
}

async function getReadyProbe(baseUrl: string): Promise<{ ready: boolean; latencyMs: number }> {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/health/ready`, {
    signal: AbortSignal.timeout(200),
  });
  const latencyMs = performance.now() - started;
  expect(response.ok).toBe(true);
  const payload = (await response.json()) as Record<string, unknown>;
  const item = ((payload.items || []) as Array<Record<string, unknown>>)[0];
  return { ready: item?.ready === true, latencyMs };
}

function shapeOf(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return ["empty"];
    }
    const variants = [...new Set(value.map((entry) => JSON.stringify(shapeOf(entry))))].map((entry) =>
      JSON.parse(entry)
    );
    return variants.length === 1 ? [variants[0]] : variants;
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, shapeOf(entryValue)] as const);
    return Object.fromEntries(entries);
  }
  return typeof value;
}

describe("API contract snapshot", () => {
  test("major endpoints keep stable response shape", async () => {
    const runtime = createRuntime("shape");
    const { baseUrl } = runtime;
    const project = "contract-project";
    const sessionId = "contract-session";

    try {
      const recordResponse = await postJson(baseUrl, "/v1/events/record", {
        event: {
          event_id: "contract-1",
          platform: "codex",
          project,
          session_id: sessionId,
          event_type: "user_prompt",
          ts: "2026-02-19T00:00:00.000Z",
          payload: { content: "contract baseline query alpha" },
          tags: ["contract"],
          privacy_tags: [],
        },
      });
      await postJson(baseUrl, "/v1/events/record", {
        event: {
          event_id: "contract-2",
          platform: "codex",
          project,
          session_id: sessionId,
          event_type: "tool_use",
          ts: "2026-02-19T00:01:00.000Z",
          payload: { content: "contract baseline query beta" },
          tags: ["contract"],
          privacy_tags: [],
        },
      });

      const search = (await postJson(baseUrl, "/v1/search", {
        query: "contract baseline query",
        project,
        limit: 10,
        include_private: true,
        strict_project: true,
      })) as Record<string, unknown>;
      const searchItems = (search.items || []) as Array<Record<string, unknown>>;
      expect(searchItems.length).toBeGreaterThan(0);
      const firstId = String(searchItems[0].id);

      const timeline = await postJson(baseUrl, "/v1/timeline", {
        id: firstId,
        before: 1,
        after: 1,
        include_private: true,
      });
      const observations = await postJson(baseUrl, "/v1/observations/get", {
        ids: [firstId],
        include_private: true,
      });
      const finalize = await postJson(baseUrl, "/v1/sessions/finalize", {
        platform: "codex",
        project,
        session_id: sessionId,
        summary_mode: "standard",
      });
      const resumePack = await postJson(baseUrl, "/v1/resume-pack", {
        project,
        session_id: sessionId,
        include_private: true,
        limit: 5,
      });
      const sessionsList = await getJson(baseUrl, `/v1/sessions/list?project=${encodeURIComponent(project)}&limit=10`);
      const sessionsThread = await getJson(
        baseUrl,
        `/v1/sessions/thread?project=${encodeURIComponent(project)}&session_id=${encodeURIComponent(sessionId)}&limit=10`
      );
      const facets = await getJson(
        baseUrl,
        `/v1/search/facets?project=${encodeURIComponent(project)}&query=${encodeURIComponent("contract baseline query")}`
      );
      const projectsStats = await getJson(baseUrl, "/v1/projects/stats");
      const health = await getJson(baseUrl, "/health");

      const healthPayload = health as Record<string, unknown>;
      const healthItems = ((healthPayload.items || []) as Array<Record<string, unknown>>).map((item) => ({
        status: item.status,
        host: item.host,
        port: item.port,
        vector_engine: item.vector_engine,
        fts_enabled: item.fts_enabled,
        counts_status: item.counts_status,
      }));

      const contract = {
        events_record: shapeOf(recordResponse),
        health: shapeOf({
          ok: healthPayload.ok,
          source: healthPayload.source,
          meta: healthPayload.meta,
          items: healthItems,
        }),
        search: shapeOf(search),
        timeline: shapeOf(timeline),
        observations: shapeOf(observations),
        finalize: shapeOf(finalize),
        resume_pack: shapeOf(resumePack),
        sessions_list: shapeOf(sessionsList),
        sessions_thread: shapeOf(sessionsThread),
        search_facets: shapeOf(facets),
        projects_stats: shapeOf(projectsStats),
      };

      expect(contract).toMatchSnapshot();
    } finally {
      runtime.stop();
    }
  });

  test("GET /v1/health is a compatibility alias for GET /health", async () => {
    const runtime = createRuntime("v1-health-alias");

    try {
      const canonical = (await getJson(runtime.baseUrl, "/health")) as Record<string, unknown>;
      const alias = (await getJson(runtime.baseUrl, "/v1/health")) as Record<string, unknown>;

      expect(alias.ok).toBe(canonical.ok);
      expect(alias.source).toBe(canonical.source);
      expect(Array.isArray(alias.items)).toBe(true);
      expect((alias.items as unknown[]).length).toBeGreaterThan(0);
    } finally {
      runtime.stop();
    }
  });

  test("GET /health can include exact counts only when requested", async () => {
    const runtime = createRuntime("health-counts");

    try {
      const defaultHealth = (await getJson(runtime.baseUrl, "/health")) as Record<string, unknown>;
      const defaultItem = ((defaultHealth.items || []) as Array<Record<string, unknown>>)[0];
      expect(defaultItem.counts).toBeUndefined();
      expect(defaultItem.counts_status).toBe("omitted");

      const countedHealth = (await getJson(runtime.baseUrl, "/health?include_counts=1")) as Record<string, unknown>;
      const countedItem = ((countedHealth.items || []) as Array<Record<string, unknown>>)[0];
      expect(countedItem.counts_status).toBe("exact");
      expect(typeof (countedItem.counts as Record<string, unknown>).events).toBe("number");
    } finally {
      runtime.stop();
    }
  });

  test("GET /health/ready stays on lightweight readiness path", async () => {
    const runtime = createRuntime("ready-lightweight");
    const originalHealth = runtime.core.health.bind(runtime.core);
    let healthCalls = 0;

    try {
      (runtime.core as unknown as { health: typeof runtime.core.health }).health = () => {
        healthCalls += 1;
        throw new Error("full health path should not be used by /health/ready");
      };

      const response = await fetch(`${runtime.baseUrl}/health/ready`, {
        signal: AbortSignal.timeout(200),
      });
      expect(response.status).toBe(200);
      const payload = (await response.json()) as Record<string, unknown>;
      const item = ((payload.items || []) as Array<Record<string, unknown>>)[0];
      expect(payload.meta).toMatchObject({ ranking: "ready_v1" });
      expect(item.ready).toBe(true);
      expect(item.counts).toBeUndefined();
      expect(healthCalls).toBe(0);
    } finally {
      (runtime.core as unknown as { health: typeof runtime.core.health }).health = originalHealth;
      runtime.stop();
    }
  });

  test("projects stats keeps health/ready responsive while offloaded aggregate is pending", async () => {
    const oldNodeEnv = process.env.NODE_ENV;
    const oldOffload = process.env.HARNESS_MEM_PROJECTS_STATS_OFFLOAD;
    const oldQueueMax = process.env.HARNESS_MEM_PROJECTS_STATS_CHILD_QUEUE_MAX;
    const oldTimeout = process.env.HARNESS_MEM_PROJECTS_STATS_CHILD_TIMEOUT_MS;
    const oldDelay = process.env.HARNESS_MEM_TEST_PROJECTS_STATS_CHILD_DELAY_MS;
    process.env.NODE_ENV = "test";
    process.env.HARNESS_MEM_PROJECTS_STATS_OFFLOAD = "1";
    process.env.HARNESS_MEM_PROJECTS_STATS_CHILD_QUEUE_MAX = "1";
    process.env.HARNESS_MEM_PROJECTS_STATS_CHILD_TIMEOUT_MS = "5000";
    process.env.HARNESS_MEM_TEST_PROJECTS_STATS_CHILD_DELAY_MS = "500";

    const runtime = createRuntime("s127-projects-stats-ready");
    const project = "s127-projects-stats-ready-project";

    try {
      await postJson(runtime.baseUrl, "/v1/events/record", {
        event: {
          event_id: "s127-projects-stats-1",
          platform: "codex",
          project,
          session_id: "s127-projects-stats-session",
          event_type: "user_prompt",
          ts: "2026-05-20T00:00:00.000Z",
          payload: { content: "project stats offload fixture" },
          tags: ["s127"],
          privacy_tags: [],
        },
      });

      const statsUrl = `${runtime.baseUrl}/v1/projects/stats?project=${encodeURIComponent(project)}`;
      const first = fetch(statsUrl);

      await Bun.sleep(30);
      const ready = await getReadyProbe(runtime.baseUrl);
      expect(ready.ready).toBe(true);
      expect(ready.latencyMs).toBeLessThan(200);

      const second = await fetch(statsUrl);
      expect(second.status).toBe(503);
      const rejected = (await second.json()) as Record<string, unknown>;
      expect(rejected.ok).toBe(false);
      expect((rejected.meta as Record<string, unknown>).error_code).toBe("projects_stats_offload_queue_full");

      const firstResponse = await first;
      expect(firstResponse.status).toBe(200);
      const stats = (await firstResponse.json()) as Record<string, unknown>;
      expect(stats.ok).toBe(true);
      expect((stats.meta as Record<string, unknown>).projects_stats_offload).toMatchObject({
        mode: "child_process",
      });
    } finally {
      runtime.stop();
      if (oldNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = oldNodeEnv;
      }
      if (oldOffload === undefined) {
        delete process.env.HARNESS_MEM_PROJECTS_STATS_OFFLOAD;
      } else {
        process.env.HARNESS_MEM_PROJECTS_STATS_OFFLOAD = oldOffload;
      }
      if (oldQueueMax === undefined) {
        delete process.env.HARNESS_MEM_PROJECTS_STATS_CHILD_QUEUE_MAX;
      } else {
        process.env.HARNESS_MEM_PROJECTS_STATS_CHILD_QUEUE_MAX = oldQueueMax;
      }
      if (oldTimeout === undefined) {
        delete process.env.HARNESS_MEM_PROJECTS_STATS_CHILD_TIMEOUT_MS;
      } else {
        process.env.HARNESS_MEM_PROJECTS_STATS_CHILD_TIMEOUT_MS = oldTimeout;
      }
      if (oldDelay === undefined) {
        delete process.env.HARNESS_MEM_TEST_PROJECTS_STATS_CHILD_DELAY_MS;
      } else {
        process.env.HARNESS_MEM_TEST_PROJECTS_STATS_CHILD_DELAY_MS = oldDelay;
      }
    }
  });

  test("checkpoint record keeps health/ready responsive while the queued write is pending", async () => {
    const oldNodeEnv = process.env.NODE_ENV;
    const oldDelay = process.env.HARNESS_MEM_TEST_WRITE_QUEUE_DELAY_MS;
    const oldOffload = process.env.HARNESS_MEM_CHECKPOINT_OFFLOAD;
    const oldTimeout = process.env.HARNESS_MEM_CHECKPOINT_CHILD_TIMEOUT_MS;
    process.env.NODE_ENV = "test";
    process.env.HARNESS_MEM_TEST_WRITE_QUEUE_DELAY_MS = "500";
    process.env.HARNESS_MEM_CHECKPOINT_OFFLOAD = "1";
    process.env.HARNESS_MEM_CHECKPOINT_CHILD_TIMEOUT_MS = "5000";

    const runtime = createRuntime("s127-checkpoint-ready");
    const sessionId = "s127-checkpoint-ready-session";
    const project = "s127-checkpoint-ready-project";

    try {
      const checkpointPromise = fetch(`${runtime.baseUrl}/v1/checkpoints/record`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          platform: "codex",
          project,
          session_id: sessionId,
          title: "S127 checkpoint ready",
          content: "Checkpoint write is delayed in the queue so ready probes can run concurrently.",
          tags: ["s127"],
          privacy_tags: [],
        }),
      });

      await Bun.sleep(30);
      const probes: Array<{ ready: boolean; latencyMs: number }> = [];
      for (let i = 0; i < 4; i += 1) {
        probes.push(await getReadyProbe(runtime.baseUrl));
      }

      expect(probes.every((probe) => probe.ready)).toBe(true);
      expect(Math.max(...probes.map((probe) => probe.latencyMs))).toBeLessThan(200);

      const checkpointResponse = await checkpointPromise;
      expect(checkpointResponse.ok).toBe(true);
      const checkpoint = (await checkpointResponse.json()) as Record<string, unknown>;
      expect(checkpoint.ok).toBe(true);
      const checkpointItems = checkpoint.items as Array<Record<string, unknown>>;
      const observationId = String(checkpointItems[0]?.id ?? "");
      expect(observationId).toMatch(/^obs_/);
      expect((checkpoint.meta as Record<string, unknown>).embedding_write_status).toBe("deferred");
      const checkpointOffload = (checkpoint.meta as Record<string, unknown>).checkpoint_offload as Record<string, unknown>;
      expect(checkpointOffload.mode).toBe("child_process");
      expect(((checkpointOffload.derived_materialization as Record<string, unknown>).status)).toBe("scheduled");

      const thread = (await getJson(
        runtime.baseUrl,
        `/v1/sessions/thread?project=${encodeURIComponent(project)}&session_id=${encodeURIComponent(sessionId)}&limit=10`,
      )) as Record<string, unknown>;
      const items = (thread.items || []) as Array<Record<string, unknown>>;
      expect(items.some((item) => item.title === "S127 checkpoint ready")).toBe(true);

      const db = (runtime.core as unknown as { db: {
        query: <T, P extends unknown[] = unknown[]>(sql: string) => { get: (...params: P) => T | null };
      } }).db;
      let derivedCounts = { vectors: 0, nuggets: 0, nuggetVectors: 0 };
      for (let i = 0; i < 40; i += 1) {
        const vectors = db
          .query<{ count: number }, [string]>(`SELECT COUNT(*) AS count FROM mem_vectors WHERE observation_id = ?`)
          .get(observationId)?.count ?? 0;
        const nuggets = db
          .query<{ count: number }, [string]>(`SELECT COUNT(*) AS count FROM mem_nuggets WHERE observation_id = ?`)
          .get(observationId)?.count ?? 0;
        const nuggetVectors = db
          .query<{ count: number }, [string]>(`SELECT COUNT(*) AS count FROM mem_nugget_vectors WHERE observation_id = ?`)
          .get(observationId)?.count ?? 0;
        derivedCounts = { vectors, nuggets, nuggetVectors };
        if (vectors > 0 && nuggets > 0 && nuggetVectors > 0) {
          break;
        }
        await Bun.sleep(50);
      }
      expect(derivedCounts.vectors).toBeGreaterThan(0);
      expect(derivedCounts.nuggets).toBeGreaterThan(0);
      expect(derivedCounts.nuggetVectors).toBeGreaterThan(0);
    } finally {
      runtime.stop();
      if (oldNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = oldNodeEnv;
      }
      if (oldDelay === undefined) {
        delete process.env.HARNESS_MEM_TEST_WRITE_QUEUE_DELAY_MS;
      } else {
        process.env.HARNESS_MEM_TEST_WRITE_QUEUE_DELAY_MS = oldDelay;
      }
      if (oldOffload === undefined) {
        delete process.env.HARNESS_MEM_CHECKPOINT_OFFLOAD;
      } else {
        process.env.HARNESS_MEM_CHECKPOINT_OFFLOAD = oldOffload;
      }
      if (oldTimeout === undefined) {
        delete process.env.HARNESS_MEM_CHECKPOINT_CHILD_TIMEOUT_MS;
      } else {
        process.env.HARNESS_MEM_CHECKPOINT_CHILD_TIMEOUT_MS = oldTimeout;
      }
    }
  });

  test("search offload queue full is bounded and does not spawn fallback children", async () => {
    const oldNodeEnv = process.env.NODE_ENV;
    const oldOffload = process.env.HARNESS_MEM_SEARCH_OFFLOAD;
    const oldWorker = process.env.HARNESS_MEM_SEARCH_WORKER;
    const oldQueueMax = process.env.HARNESS_MEM_SEARCH_CHILD_QUEUE_MAX;
    const oldDelay = process.env.HARNESS_MEM_TEST_SEARCH_CHILD_DELAY_MS;
    process.env.NODE_ENV = "test";
    process.env.HARNESS_MEM_SEARCH_OFFLOAD = "1";
    process.env.HARNESS_MEM_SEARCH_WORKER = "0";
    process.env.HARNESS_MEM_SEARCH_CHILD_QUEUE_MAX = "1";
    process.env.HARNESS_MEM_TEST_SEARCH_CHILD_DELAY_MS = "500";

    const runtime = createRuntime("s127-search-child-queue");

    try {
      const first = fetch(`${runtime.baseUrl}/v1/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "bounded search child queue first",
          project: "s127-search-child-queue",
          limit: 1,
          vector_search: false,
        }),
      });

      await Bun.sleep(30);
      const second = await fetch(`${runtime.baseUrl}/v1/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "bounded search child queue second",
          project: "s127-search-child-queue",
          limit: 1,
          vector_search: false,
        }),
      });
      expect(second.status).toBe(503);
      const rejected = (await second.json()) as Record<string, unknown>;
      expect(rejected.ok).toBe(false);
      expect((rejected.meta as Record<string, unknown>).error_code).toBe("search_offload_queue_full");
      expect(((rejected.meta as Record<string, unknown>).search_offload as Record<string, unknown>).fallback).toBe("none");

      const firstResponse = await first;
      expect(firstResponse.ok).toBe(true);
    } finally {
      runtime.stop();
      if (oldNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = oldNodeEnv;
      }
      if (oldOffload === undefined) {
        delete process.env.HARNESS_MEM_SEARCH_OFFLOAD;
      } else {
        process.env.HARNESS_MEM_SEARCH_OFFLOAD = oldOffload;
      }
      if (oldWorker === undefined) {
        delete process.env.HARNESS_MEM_SEARCH_WORKER;
      } else {
        process.env.HARNESS_MEM_SEARCH_WORKER = oldWorker;
      }
      if (oldQueueMax === undefined) {
        delete process.env.HARNESS_MEM_SEARCH_CHILD_QUEUE_MAX;
      } else {
        process.env.HARNESS_MEM_SEARCH_CHILD_QUEUE_MAX = oldQueueMax;
      }
      if (oldDelay === undefined) {
        delete process.env.HARNESS_MEM_TEST_SEARCH_CHILD_DELAY_MS;
      } else {
        process.env.HARNESS_MEM_TEST_SEARCH_CHILD_DELAY_MS = oldDelay;
      }
    }
  });

  test("persistent vector search timeout returns safe lexical fallback instead of 503", async () => {
    const oldNodeEnv = process.env.NODE_ENV;
    const oldOffload = process.env.HARNESS_MEM_SEARCH_OFFLOAD;
    const oldWorker = process.env.HARNESS_MEM_SEARCH_WORKER;
    const oldWorkerTimeout = process.env.HARNESS_MEM_SEARCH_WORKER_TIMEOUT_MS;
    const oldStartupTimeout = process.env.HARNESS_MEM_SEARCH_WORKER_STARTUP_TIMEOUT_MS;
    const oldWorkerDelay = process.env.HARNESS_MEM_TEST_SEARCH_WORKER_DELAY_MS;
    process.env.NODE_ENV = "test";
    process.env.HARNESS_MEM_SEARCH_OFFLOAD = "1";
    process.env.HARNESS_MEM_SEARCH_WORKER = "1";
    process.env.HARNESS_MEM_SEARCH_WORKER_STARTUP_TIMEOUT_MS = "1000";
    process.env.HARNESS_MEM_SEARCH_WORKER_TIMEOUT_MS = "50";
    process.env.HARNESS_MEM_TEST_SEARCH_WORKER_DELAY_MS = "300";

    const runtime = createRuntime("s128-search-worker-timeout-fallback");
    try {
      runtime.core.recordEvent({
        platform: "claude",
        project: "s128-search-worker-timeout-fallback",
        session_id: "session-search-worker-timeout",
        event_type: "user_prompt",
        ts: "2026-02-14T00:00:00.000Z",
        payload: { content: "persistent timeout safe lexical fallback sentinel" },
      });

      const warmup = await fetch(`${runtime.baseUrl}/v1/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "warmup safe lexical",
          project: "s128-search-worker-timeout-fallback",
          limit: 1,
          safe_mode: true,
          vector_search: false,
        }),
      });
      expect(warmup.status).toBe(200);

      const response = await fetch(`${runtime.baseUrl}/v1/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "persistent timeout safe lexical fallback sentinel",
          project: "s128-search-worker-timeout-fallback",
          limit: 3,
          vector_search: true,
        }),
      });
      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        ok: boolean;
        items: Array<{ content?: string }>;
        meta: { search_offload?: Record<string, unknown>; warnings?: string[] };
      };
      expect(payload.ok).toBe(true);
      expect(payload.items.some((item) => String(item.content || "").includes("safe lexical fallback sentinel"))).toBe(true);
      expect(payload.meta.search_offload?.mode).toBe("persistent_worker");
      expect(payload.meta.search_offload?.fallback).toBe("safe_lexical");
      expect(payload.meta.warnings?.some((warning) => warning.includes("returned safe lexical fallback"))).toBe(true);
    } finally {
      runtime.stop();
      if (oldNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = oldNodeEnv;
      }
      if (oldOffload === undefined) {
        delete process.env.HARNESS_MEM_SEARCH_OFFLOAD;
      } else {
        process.env.HARNESS_MEM_SEARCH_OFFLOAD = oldOffload;
      }
      if (oldWorker === undefined) {
        delete process.env.HARNESS_MEM_SEARCH_WORKER;
      } else {
        process.env.HARNESS_MEM_SEARCH_WORKER = oldWorker;
      }
      if (oldWorkerTimeout === undefined) {
        delete process.env.HARNESS_MEM_SEARCH_WORKER_TIMEOUT_MS;
      } else {
        process.env.HARNESS_MEM_SEARCH_WORKER_TIMEOUT_MS = oldWorkerTimeout;
      }
      if (oldStartupTimeout === undefined) {
        delete process.env.HARNESS_MEM_SEARCH_WORKER_STARTUP_TIMEOUT_MS;
      } else {
        process.env.HARNESS_MEM_SEARCH_WORKER_STARTUP_TIMEOUT_MS = oldStartupTimeout;
      }
      if (oldWorkerDelay === undefined) {
        delete process.env.HARNESS_MEM_TEST_SEARCH_WORKER_DELAY_MS;
      } else {
        process.env.HARNESS_MEM_TEST_SEARCH_WORKER_DELAY_MS = oldWorkerDelay;
      }
    }
  });

  test("worker and child offload both failing returns in-process degraded results instead of empty_error", async () => {
    const oldNodeEnv = process.env.NODE_ENV;
    const oldOffload = process.env.HARNESS_MEM_SEARCH_OFFLOAD;
    const oldWorker = process.env.HARNESS_MEM_SEARCH_WORKER;
    const oldWorkerTimeout = process.env.HARNESS_MEM_SEARCH_WORKER_TIMEOUT_MS;
    const oldChildTimeout = process.env.HARNESS_MEM_SEARCH_CHILD_TIMEOUT_MS;
    const oldStartupTimeout = process.env.HARNESS_MEM_SEARCH_WORKER_STARTUP_TIMEOUT_MS;
    const oldWorkerDelay = process.env.HARNESS_MEM_TEST_SEARCH_WORKER_DELAY_MS;
    const oldChildDelay = process.env.HARNESS_MEM_TEST_SEARCH_CHILD_DELAY_MS;
    process.env.NODE_ENV = "test";
    process.env.HARNESS_MEM_SEARCH_OFFLOAD = "1";
    process.env.HARNESS_MEM_SEARCH_WORKER = "1";
    process.env.HARNESS_MEM_SEARCH_WORKER_STARTUP_TIMEOUT_MS = "1000";
    process.env.HARNESS_MEM_SEARCH_WORKER_TIMEOUT_MS = "50";
    process.env.HARNESS_MEM_SEARCH_CHILD_TIMEOUT_MS = "50";
    process.env.HARNESS_MEM_TEST_SEARCH_WORKER_DELAY_MS = "300";
    process.env.HARNESS_MEM_TEST_SEARCH_CHILD_DELAY_MS = "300";

    const runtime = createRuntime("s145-in-process-degraded-fallback");
    try {
      runtime.core.recordEvent({
        platform: "claude",
        project: "s145-in-process-degraded-fallback",
        session_id: "session-in-process-degraded",
        event_type: "user_prompt",
        ts: "2026-06-02T00:00:00.000Z",
        payload: { content: "in-process degraded fallback sentinel alpha" },
      });

      const warmup = await fetch(`${runtime.baseUrl}/v1/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "warmup in-process degraded",
          project: "s145-in-process-degraded-fallback",
          limit: 1,
          safe_mode: true,
          vector_search: false,
        }),
      });
      expect(warmup.status).toBe(200);

      const response = await fetch(`${runtime.baseUrl}/v1/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "in-process degraded fallback sentinel alpha",
          project: "s145-in-process-degraded-fallback",
          limit: 3,
          vector_search: true,
        }),
      });
      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        ok: boolean;
        items: Array<{ content?: string }>;
        meta: {
          search_offload?: Record<string, unknown>;
          degradation?: string[];
          warnings?: string[];
        };
      };
      expect(payload.ok).toBe(true);
      expect(payload.items.length).toBeGreaterThan(0);
      expect(payload.items.some((item) => String(item.content || "").includes("in-process degraded fallback sentinel"))).toBe(true);
      expect(payload.meta.search_offload?.fallback).toBe("in_process_degraded");
      expect(payload.meta.search_offload?.fallback_mode).toBe("in_process");
      expect(payload.meta.degradation).toEqual(
        expect.arrayContaining(["safe_lexical_fallback", "in_process_degraded"]),
      );
      expect(payload.meta.warnings?.some((warning) => warning.includes("in-process degraded fallback"))).toBe(true);
    } finally {
      runtime.stop();
      if (oldNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = oldNodeEnv;
      }
      if (oldOffload === undefined) {
        delete process.env.HARNESS_MEM_SEARCH_OFFLOAD;
      } else {
        process.env.HARNESS_MEM_SEARCH_OFFLOAD = oldOffload;
      }
      if (oldWorker === undefined) {
        delete process.env.HARNESS_MEM_SEARCH_WORKER;
      } else {
        process.env.HARNESS_MEM_SEARCH_WORKER = oldWorker;
      }
      if (oldWorkerTimeout === undefined) {
        delete process.env.HARNESS_MEM_SEARCH_WORKER_TIMEOUT_MS;
      } else {
        process.env.HARNESS_MEM_SEARCH_WORKER_TIMEOUT_MS = oldWorkerTimeout;
      }
      if (oldChildTimeout === undefined) {
        delete process.env.HARNESS_MEM_SEARCH_CHILD_TIMEOUT_MS;
      } else {
        process.env.HARNESS_MEM_SEARCH_CHILD_TIMEOUT_MS = oldChildTimeout;
      }
      if (oldStartupTimeout === undefined) {
        delete process.env.HARNESS_MEM_SEARCH_WORKER_STARTUP_TIMEOUT_MS;
      } else {
        process.env.HARNESS_MEM_SEARCH_WORKER_STARTUP_TIMEOUT_MS = oldStartupTimeout;
      }
      if (oldWorkerDelay === undefined) {
        delete process.env.HARNESS_MEM_TEST_SEARCH_WORKER_DELAY_MS;
      } else {
        process.env.HARNESS_MEM_TEST_SEARCH_WORKER_DELAY_MS = oldWorkerDelay;
      }
      if (oldChildDelay === undefined) {
        delete process.env.HARNESS_MEM_TEST_SEARCH_CHILD_DELAY_MS;
      } else {
        process.env.HARNESS_MEM_TEST_SEARCH_CHILD_DELAY_MS = oldChildDelay;
      }
    }
  });

  test("strict project vector search does not fall back to global KNN when lexical candidates lack vectors", async () => {
    const runtime = createRuntime("s129-vector-prefilter-no-global-fallback");
    try {
      const response = runtime.core.recordEvent({
        event_id: "s129-no-vector-lexical",
        platform: "codex",
        project: "s129-vector-prefilter",
        session_id: "s129-vector-prefilter-session",
        event_type: "user_prompt",
        ts: "2026-05-25T00:00:00.000Z",
        payload: { content: "s129 lexical only vector prefilter sentinel" },
        tags: [],
        privacy_tags: [],
      });
      expect(response.ok).toBe(true);
      const observationId = (response.items[0] as { id?: string } | undefined)?.id;
      expect(observationId).toBe("obs_s129-no-vector-lexical");
      runtime.core.db
        .query("DELETE FROM mem_vectors WHERE observation_id = ?")
        .run(observationId);

      const search = runtime.core.search({
        query: "s129 lexical only vector prefilter sentinel",
        project: "s129-vector-prefilter",
        limit: 3,
        include_private: false,
        strict_project: true,
        vector_search: true,
      });
      expect(search.ok).toBe(true);
      expect(search.items.some((item) => String(item.content || "").includes("s129 lexical only vector prefilter sentinel"))).toBe(true);
      expect(search.meta.vector_candidates).toBe(0);
      expect((search.meta.vector_prefilter as Record<string, unknown> | undefined)?.mode).toBe("lexical_candidate_rerank");
      expect((search.meta.vector_prefilter as Record<string, unknown> | undefined)?.matched_rows).toBe(0);
      expect((search.meta.warnings as string[] | undefined)?.some((warning) =>
        warning.includes("skipped global vector fallback")
      )).toBe(true);
    } finally {
      runtime.stop();
    }
  });

  test("checkpoint offload queue full is bounded at the parent daemon", async () => {
    const oldNodeEnv = process.env.NODE_ENV;
    const oldDelay = process.env.HARNESS_MEM_TEST_WRITE_QUEUE_DELAY_MS;
    const oldOffload = process.env.HARNESS_MEM_CHECKPOINT_OFFLOAD;
    const oldQueueMax = process.env.HARNESS_MEM_CHECKPOINT_CHILD_QUEUE_MAX;
    const oldTimeout = process.env.HARNESS_MEM_CHECKPOINT_CHILD_TIMEOUT_MS;
    process.env.NODE_ENV = "test";
    process.env.HARNESS_MEM_TEST_WRITE_QUEUE_DELAY_MS = "500";
    process.env.HARNESS_MEM_CHECKPOINT_OFFLOAD = "1";
    process.env.HARNESS_MEM_CHECKPOINT_CHILD_QUEUE_MAX = "1";
    process.env.HARNESS_MEM_CHECKPOINT_CHILD_TIMEOUT_MS = "5000";

    const runtime = createRuntime("s127-checkpoint-child-queue");

    try {
      const first = fetch(`${runtime.baseUrl}/v1/checkpoints/record`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          platform: "codex",
          project: "s127-checkpoint-child-queue",
          session_id: "s127-checkpoint-child-queue-session",
          title: "First bounded checkpoint",
          content: "The first checkpoint holds the single parent-side child slot.",
        }),
      });

      await Bun.sleep(30);
      const second = await fetch(`${runtime.baseUrl}/v1/checkpoints/record`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          platform: "codex",
          project: "s127-checkpoint-child-queue",
          session_id: "s127-checkpoint-child-queue-session",
          title: "Second bounded checkpoint",
          content: "The second checkpoint should be rejected before spawning another child.",
        }),
      });
      expect(second.status).toBe(503);
      const rejected = (await second.json()) as Record<string, unknown>;
      expect(rejected.ok).toBe(false);
      expect(rejected.error).toBe("write queue full, retry later");

      const firstResponse = await first;
      expect(firstResponse.ok).toBe(true);
    } finally {
      runtime.stop();
      if (oldNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = oldNodeEnv;
      }
      if (oldDelay === undefined) {
        delete process.env.HARNESS_MEM_TEST_WRITE_QUEUE_DELAY_MS;
      } else {
        process.env.HARNESS_MEM_TEST_WRITE_QUEUE_DELAY_MS = oldDelay;
      }
      if (oldOffload === undefined) {
        delete process.env.HARNESS_MEM_CHECKPOINT_OFFLOAD;
      } else {
        process.env.HARNESS_MEM_CHECKPOINT_OFFLOAD = oldOffload;
      }
      if (oldQueueMax === undefined) {
        delete process.env.HARNESS_MEM_CHECKPOINT_CHILD_QUEUE_MAX;
      } else {
        process.env.HARNESS_MEM_CHECKPOINT_CHILD_QUEUE_MAX = oldQueueMax;
      }
      if (oldTimeout === undefined) {
        delete process.env.HARNESS_MEM_CHECKPOINT_CHILD_TIMEOUT_MS;
      } else {
        process.env.HARNESS_MEM_CHECKPOINT_CHILD_TIMEOUT_MS = oldTimeout;
      }
    }
  });

  test("event offload queue full is bounded at the parent daemon", async () => {
    const oldNodeEnv = process.env.NODE_ENV;
    const oldDelay = process.env.HARNESS_MEM_TEST_EVENT_CHILD_DELAY_MS;
    const oldOffload = process.env.HARNESS_MEM_EVENT_OFFLOAD;
    const oldQueueMax = process.env.HARNESS_MEM_EVENT_CHILD_QUEUE_MAX;
    const oldTimeout = process.env.HARNESS_MEM_EVENT_CHILD_TIMEOUT_MS;
    process.env.NODE_ENV = "test";
    process.env.HARNESS_MEM_TEST_EVENT_CHILD_DELAY_MS = "500";
    process.env.HARNESS_MEM_EVENT_OFFLOAD = "1";
    process.env.HARNESS_MEM_EVENT_CHILD_QUEUE_MAX = "1";
    process.env.HARNESS_MEM_EVENT_CHILD_TIMEOUT_MS = "5000";

    const runtime = createRuntime("s127-event-child-queue");

    try {
      const first = fetch(`${runtime.baseUrl}/v1/events/record`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          event: {
            platform: "codex",
            project: "s127-event-child-queue",
            session_id: "s127-event-child-queue-session",
            event_type: "user_prompt",
            payload: { content: "The first event holds the single parent-side child slot." },
          },
        }),
      });

      await Bun.sleep(30);
      const second = await fetch(`${runtime.baseUrl}/v1/events/record`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          event: {
            platform: "codex",
            project: "s127-event-child-queue",
            session_id: "s127-event-child-queue-session",
            event_type: "user_prompt",
            payload: { content: "The second event should be rejected before spawning another child." },
          },
        }),
      });
      expect(second.status).toBe(503);
      const rejected = (await second.json()) as Record<string, unknown>;
      expect(rejected.ok).toBe(false);
      expect(rejected.error).toBe("write queue full, retry later");

      const firstResponse = await first;
      expect(firstResponse.ok).toBe(true);
    } finally {
      runtime.stop();
      if (oldNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = oldNodeEnv;
      }
      if (oldDelay === undefined) {
        delete process.env.HARNESS_MEM_TEST_EVENT_CHILD_DELAY_MS;
      } else {
        process.env.HARNESS_MEM_TEST_EVENT_CHILD_DELAY_MS = oldDelay;
      }
      if (oldOffload === undefined) {
        delete process.env.HARNESS_MEM_EVENT_OFFLOAD;
      } else {
        process.env.HARNESS_MEM_EVENT_OFFLOAD = oldOffload;
      }
      if (oldQueueMax === undefined) {
        delete process.env.HARNESS_MEM_EVENT_CHILD_QUEUE_MAX;
      } else {
        process.env.HARNESS_MEM_EVENT_CHILD_QUEUE_MAX = oldQueueMax;
      }
      if (oldTimeout === undefined) {
        delete process.env.HARNESS_MEM_EVENT_CHILD_TIMEOUT_MS;
      } else {
        process.env.HARNESS_MEM_EVENT_CHILD_TIMEOUT_MS = oldTimeout;
      }
    }
  });
});
