import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessMemCore, type Config, type EventEnvelope } from "../../src/core/harness-mem-core";

const dirs: string[] = [];
const oldTtl = process.env.HARNESS_MEM_RECALL_CACHE_TTL_MS;

function makeCore(label: string): { core: HarnessMemCore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-repeat-cache-${label}-`));
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
  return { core: new HarnessMemCore(config), dir };
}

function event(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    event_id: `evt-${Math.random().toString(36).slice(2)}`,
    platform: "codex",
    project: "proj-cache",
    session_id: "session-cache",
    event_type: "user_prompt",
    ts: new Date().toISOString(),
    payload: { content: "Recall Runtime projection cache sentinel alpha" },
    tags: ["recall-runtime"],
    privacy_tags: [],
    ...overrides,
  };
}

afterEach(() => {
  if (oldTtl === undefined) {
    delete process.env.HARNESS_MEM_RECALL_CACHE_TTL_MS;
  } else {
    process.env.HARNESS_MEM_RECALL_CACHE_TTL_MS = oldTtl;
  }
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

describe("repeat recall query cache", () => {
  test("scoped repeat search hits cache and data watermark invalidates it", async () => {
    process.env.HARNESS_MEM_RECALL_CACHE_TTL_MS = "60000";
    const { core } = makeCore("hit");
    try {
      core.recordEvent(event({ event_id: "evt-a" }));

      const first = await core.searchPrepared({
        query: "projection cache sentinel alpha",
        project: "proj-cache",
        limit: 5,
        safe_mode: true,
      });
      expect(first.ok).toBe(true);
      expect(first.meta.recall_cache_hit).toBe(false);
      expect(JSON.stringify(first.meta.recall_cache)).not.toContain("projection cache sentinel alpha");

      const second = await core.searchPrepared({
        query: "projection cache sentinel alpha",
        project: "proj-cache",
        limit: 5,
        safe_mode: true,
      });
      expect(second.ok).toBe(true);
      expect(second.meta.recall_cache_hit).toBe(true);

      core.recordEvent(event({
        event_id: "evt-b",
        payload: { content: "Recall Runtime projection cache sentinel beta" },
      }));
      const third = await core.searchPrepared({
        query: "projection cache sentinel alpha",
        project: "proj-cache",
        limit: 5,
        safe_mode: true,
      });
      expect(third.ok).toBe(true);
      expect(third.meta.recall_cache_hit).toBe(false);
    } finally {
      core.shutdown("test");
    }
  });

  test("TTL 0 disables repeat recall cache", async () => {
    process.env.HARNESS_MEM_RECALL_CACHE_TTL_MS = "0";
    const { core } = makeCore("disabled");
    try {
      core.recordEvent(event({ event_id: "evt-disabled" }));
      const first = await core.searchPrepared({
        query: "projection cache sentinel alpha",
        project: "proj-cache",
        limit: 5,
        safe_mode: true,
      });
      const second = await core.searchPrepared({
        query: "projection cache sentinel alpha",
        project: "proj-cache",
        limit: 5,
        safe_mode: true,
      });
      expect(first.meta.recall_cache_hit).toBeUndefined();
      expect(second.meta.recall_cache_hit).toBeUndefined();
    } finally {
      core.shutdown("test");
    }
  });
});
