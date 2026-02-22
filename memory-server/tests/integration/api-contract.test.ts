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
  const port = 40100 + Math.floor(Math.random() * 1000);
  const config: Config = {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: port,
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
    dir,
    baseUrl: `http://127.0.0.1:${port}`,
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
        counts: item.counts,
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
});
