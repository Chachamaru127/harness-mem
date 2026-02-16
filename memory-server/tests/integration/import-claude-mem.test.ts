import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessMemCore, type Config } from "../../src/core/harness-mem-core";
import { startHarnessMemServer } from "../../src/server";

function createRuntime(name: string): {
  dir: string;
  sourceDbPath: string;
  baseUrl: string;
  stop: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-import-${name}-`));
  const sourceDbPath = join(dir, "claude-mem.db");
  const targetDbPath = join(dir, "harness-mem.db");
  const port = 39500 + Math.floor(Math.random() * 1000);

  const sourceDb = new Database(sourceDbPath, { create: true });
  sourceDb.exec(`
    CREATE TABLE observations (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      project_path TEXT,
      created_at TEXT,
      type TEXT,
      content TEXT,
      tags_json TEXT,
      privacy_tags_json TEXT
    );
    CREATE TABLE session_summaries (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      project_path TEXT,
      created_at TEXT,
      summary TEXT
    );
  `);
  sourceDb
    .query(`
      INSERT INTO observations(id, session_id, project_path, created_at, type, content, tags_json, privacy_tags_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      "obs-1",
      "claude-sess-1",
      "/tmp/project-alpha",
      "2026-02-10T00:00:00.000Z",
      "user",
      "public memory record",
      JSON.stringify(["alpha"]),
      JSON.stringify([])
    );
  sourceDb
    .query(`
      INSERT INTO observations(id, session_id, project_path, created_at, type, content, tags_json, privacy_tags_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      "obs-2",
      "claude-sess-1",
      "/tmp/project-alpha",
      "2026-02-10T00:01:00.000Z",
      "user",
      "private memory record",
      JSON.stringify(["alpha"]),
      JSON.stringify(["private"])
    );
  sourceDb
    .query(`
      INSERT INTO session_summaries(id, session_id, project_path, created_at, summary)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(
      "sum-1",
      "claude-sess-1",
      "/tmp/project-alpha",
      "2026-02-10T00:02:00.000Z",
      "session summary imported from claude-mem"
    );
  sourceDb.close(false);

  const config: Config = {
    dbPath: targetDbPath,
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
  };
  const core = new HarnessMemCore(config);
  const server = startHarnessMemServer(core, config);

  return {
    dir,
    sourceDbPath,
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () => {
      core.shutdown("test");
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("claude-mem import integration", () => {
  test("imports, verifies, and serves session/thread/facets APIs", async () => {
    const runtime = createRuntime("full");
    const { baseUrl, sourceDbPath } = runtime;

    try {
      const importRes = await fetch(`${baseUrl}/v1/admin/imports/claude-mem`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source_db_path: sourceDbPath,
        }),
      });
      expect(importRes.ok).toBe(true);
      const importPayload = (await importRes.json()) as {
        ok: boolean;
        items: Array<{ job_id: string }>;
      };
      expect(importPayload.ok).toBe(true);
      const jobId = importPayload.items[0]?.job_id;
      expect(typeof jobId).toBe("string");
      expect(jobId.length).toBeGreaterThan(0);

      const statusRes = await fetch(`${baseUrl}/v1/admin/imports/${encodeURIComponent(jobId)}`);
      expect(statusRes.ok).toBe(true);
      const statusPayload = (await statusRes.json()) as { ok: boolean; items: Array<{ status: string }> };
      expect(statusPayload.ok).toBe(true);
      expect(statusPayload.items[0]?.status).toBe("completed");

      const verifyRes = await fetch(`${baseUrl}/v1/admin/imports/${encodeURIComponent(jobId)}/verify`, {
        method: "POST",
      });
      expect(verifyRes.ok).toBe(true);
      const verifyPayload = (await verifyRes.json()) as { ok: boolean; items: Array<{ ok: boolean }> };
      expect(verifyPayload.ok).toBe(true);
      expect(verifyPayload.items[0]?.ok).toBe(true);

      const defaultSearchRes = await fetch(`${baseUrl}/v1/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "memory record",
          project: "project-alpha",
          include_private: false,
          limit: 10,
        }),
      });
      const defaultSearch = (await defaultSearchRes.json()) as { ok: boolean; items: Array<{ privacy_tags?: string[] }> };
      expect(defaultSearch.ok).toBe(true);
      for (const item of defaultSearch.items) {
        expect((item.privacy_tags || []).includes("private")).toBe(false);
      }

      const includePrivateRes = await fetch(`${baseUrl}/v1/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "memory record",
          project: "project-alpha",
          include_private: true,
          limit: 10,
        }),
      });
      const includePrivate = (await includePrivateRes.json()) as {
        ok: boolean;
        items: Array<{ privacy_tags?: string[] }>;
      };
      expect(includePrivate.ok).toBe(true);
      expect(includePrivate.items.some((item) => (item.privacy_tags || []).includes("private"))).toBe(true);

      const sessionsRes = await fetch(`${baseUrl}/v1/sessions/list?project=project-alpha`);
      expect(sessionsRes.ok).toBe(true);
      const sessions = (await sessionsRes.json()) as { ok: boolean; items: Array<{ session_id: string }> };
      expect(sessions.ok).toBe(true);
      expect(sessions.items.some((item) => item.session_id === "claude-sess-1")).toBe(true);

      const threadRes = await fetch(
        `${baseUrl}/v1/sessions/thread?session_id=claude-sess-1&project=project-alpha&include_private=true`
      );
      expect(threadRes.ok).toBe(true);
      const thread = (await threadRes.json()) as { ok: boolean; items: Array<{ event_type: string }> };
      expect(thread.ok).toBe(true);
      expect(thread.items.length).toBeGreaterThan(0);

      const facetsRes = await fetch(`${baseUrl}/v1/search/facets?project=project-alpha&query=memory`);
      expect(facetsRes.ok).toBe(true);
      const facets = (await facetsRes.json()) as {
        ok: boolean;
        items: Array<{ total_candidates: number; projects: Array<{ value: string }> }>;
      };
      expect(facets.ok).toBe(true);
      expect(Number(facets.items[0]?.total_candidates ?? 0)).toBeGreaterThan(0);
      expect((facets.items[0]?.projects || []).some((project) => project.value === "project-alpha")).toBe(true);
    } finally {
      runtime.stop();
    }
  });
});
