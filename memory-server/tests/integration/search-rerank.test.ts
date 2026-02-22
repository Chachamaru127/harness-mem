import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessMemCore, type Config } from "../../src/core/harness-mem-core";

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

describe("search rerank integration", () => {
  test("search debug contains pre/post rank snapshots when reranker is enabled", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-rerank-"));
    const previous = process.env.HARNESS_MEM_RERANKER_ENABLED;
    process.env.HARNESS_MEM_RERANKER_ENABLED = "true";

    const core = new HarnessMemCore(makeConfig(dir));
    try {
      core.recordEvent({
        event_id: "rerank-1",
        platform: "codex",
        project: "rerank-project",
        session_id: "rerank-session",
        event_type: "user_prompt",
        ts: "2026-02-19T00:00:00.000Z",
        payload: { title: "build note", content: "parser rollout checklist" },
        tags: ["rerank"],
        privacy_tags: [],
      });
      core.recordEvent({
        event_id: "rerank-2",
        platform: "codex",
        project: "rerank-project",
        session_id: "rerank-session",
        event_type: "user_prompt",
        ts: "2026-02-20T00:00:00.000Z",
        payload: { title: "parser decision", content: "parser rollout checklist" },
        tags: ["rerank"],
        privacy_tags: [],
      });

      const response = core.search({
        query: "parser decision",
        project: "rerank-project",
        limit: 5,
        include_private: true,
        debug: true,
      });

      expect(response.ok).toBe(true);
      const debug = (response.meta.debug || {}) as Record<string, unknown>;
      const pre = (debug.rerank_pre || []) as Array<Record<string, unknown>>;
      const post = (debug.rerank_post || []) as Array<Record<string, unknown>>;

      expect(pre.length).toBeGreaterThan(0);
      expect(post.length).toBeGreaterThan(0);
      expect((debug.reranker || {}) as Record<string, unknown>).toHaveProperty("enabled", true);
      expect(String((response.items[0] as Record<string, unknown>).id)).toContain("rerank-2");
      const topScores = ((response.items[0] as Record<string, unknown>).scores || {}) as Record<string, unknown>;
      expect(topScores).toHaveProperty("rerank");
      expect(typeof topScores.rerank).toBe("number");
      expect(Number(topScores.rerank)).toBeGreaterThan(0);
    } finally {
      core.shutdown("test");
      if (previous === undefined) {
        delete process.env.HARNESS_MEM_RERANKER_ENABLED;
      } else {
        process.env.HARNESS_MEM_RERANKER_ENABLED = previous;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
