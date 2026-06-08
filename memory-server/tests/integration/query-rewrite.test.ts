import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessMemCore, type Config, type EventEnvelope } from "../../src/core/harness-mem-core";

const dirs: string[] = [];
const servers: Bun.Server[] = [];
const ENV_KEYS = [
  "HARNESS_MEM_QUERY_REWRITE",
  "HARNESS_MEM_QUERY_REWRITE_OLLAMA_HOST",
  "HARNESS_MEM_QUERY_REWRITE_MODEL",
] as const;
const oldEnv = new Map<string, string | undefined>();
for (const key of ENV_KEYS) oldEnv.set(key, process.env[key]);

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const old = oldEnv.get(key);
    if (old === undefined) delete process.env[key];
    else process.env[key] = old;
  }
}

function makeCore(label: string): HarnessMemCore {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-query-rewrite-${label}-`));
  dirs.push(dir);
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
    backgroundWorkersEnabled: false,
  };
  return new HarnessMemCore(config);
}

function event(content: string): EventEnvelope {
  return {
    event_id: `evt-${Math.random().toString(36).slice(2)}`,
    platform: "codex",
    project: "proj-query-rewrite",
    session_id: "session-query-rewrite",
    event_type: "checkpoint",
    ts: new Date().toISOString(),
    payload: { content },
    tags: ["s154-701"],
    privacy_tags: [],
  };
}

function startFakeOllama(rewrite: string): string {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      expect(new URL(request.url).pathname).toBe("/api/chat");
      const body = await request.json() as Record<string, unknown>;
      expect(body.model).toBe("qwen3.5:9b");
      return new Response(JSON.stringify({ message: { content: JSON.stringify({ query: rewrite }) } }), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}

afterEach(() => {
  restoreEnv();
  while (servers.length > 0) servers.pop()?.stop(true);
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("S154-701 searchPrepared query rewrite", () => {
  test("default OFF preserves searchPrepared path without local LLM metadata applying", async () => {
    delete process.env.HARNESS_MEM_QUERY_REWRITE;
    const core = makeCore("off");
    try {
      core.recordEvent(event("alpha701 unique retrieval marker"));
      const result = await core.searchPrepared({
        query: "alpha701",
        project: "proj-query-rewrite",
        limit: 10,
        vector_search: false,
      });

      expect(result.ok).toBe(true);
      expect((result.meta.query_rewrite as Record<string, unknown>).enabled).toBe(false);
      expect((result.meta.query_rewrite as Record<string, unknown>).applied).toBe(false);
      expect((result.items as Array<{ content?: string }>).some((item) => item.content?.includes("alpha701"))).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });

  test("opt-in local rewrite can add mixed retrieval terms before search", async () => {
    process.env.HARNESS_MEM_QUERY_REWRITE = "1";
    process.env.HARNESS_MEM_QUERY_REWRITE_MODEL = "qwen3.5:9b";
    process.env.HARNESS_MEM_QUERY_REWRITE_OLLAMA_HOST = startFakeOllama("alpha701 bilingual retrieval recall");
    const core = makeCore("on");
    try {
      core.recordEvent(event("alpha701 bilingual retrieval recall target document"));
      const result = await core.searchPrepared({
        query: "日英探索の再現率",
        project: "proj-query-rewrite",
        limit: 10,
        vector_search: false,
        debug: true,
      });
      const rewriteMeta = result.meta.query_rewrite as Record<string, unknown>;

      expect(result.ok).toBe(true);
      expect(rewriteMeta.enabled).toBe(true);
      expect(rewriteMeta.applied).toBe(true);
      expect(rewriteMeta.provider).toBe("ollama");
      expect(rewriteMeta.added_token_count).toBeGreaterThanOrEqual(3);
      expect(JSON.stringify(rewriteMeta)).not.toContain("日英探索");
      expect((result.items as Array<{ content?: string }>).some((item) => item.content?.includes("alpha701"))).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });
});
