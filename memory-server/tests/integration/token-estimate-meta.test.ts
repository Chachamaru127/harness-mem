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

describe("token estimate metadata", () => {
  test("search/timeline/get_observations include token_estimate metadata", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-token-meta-"));
    const core = new HarnessMemCore(makeConfig(dir));
    try {
      for (let i = 0; i < 30; i += 1) {
        core.recordEvent({
          event_id: `token-meta-${i}`,
          platform: "codex",
          project: "token-meta",
          session_id: "token-meta-session",
          event_type: "user_prompt",
          payload: { content: `token estimate content ${i}` },
          tags: ["token"],
          privacy_tags: [],
        });
      }

      const search = core.search({
        query: "token estimate content",
        project: "token-meta",
        limit: 10,
        include_private: true,
      });
      expect((search.meta as Record<string, unknown>).token_estimate).toBeDefined();

      const firstId = String((search.items[0] as Record<string, unknown>).id || "");
      const timeline = core.timeline({ id: firstId, before: 2, after: 2, include_private: true });
      expect((timeline.meta as Record<string, unknown>).token_estimate).toBeDefined();

      const ids = (search.items as Array<Record<string, unknown>>).map((item) => String(item.id));
      const details = core.getObservations({ ids, include_private: true, compact: false });
      expect((details.meta as Record<string, unknown>).token_estimate).toBeDefined();
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("get_observations warns on large id batch", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-token-warn-"));
    const core = new HarnessMemCore(makeConfig(dir));
    try {
      for (let i = 0; i < 35; i += 1) {
        core.recordEvent({
          event_id: `token-warn-${i}`,
          platform: "codex",
          project: "token-warn",
          session_id: "token-warn-session",
          event_type: "user_prompt",
          payload: { content: `large get observation ${i}` },
          tags: ["token"],
          privacy_tags: [],
        });
      }

      const search = core.search({
        query: "large get observation",
        project: "token-warn",
        limit: 35,
        include_private: true,
      });
      const ids = (search.items as Array<Record<string, unknown>>).map((item) => String(item.id));
      const details = core.getObservations({ ids, include_private: true, compact: false });
      const warnings = ((details.meta as Record<string, unknown>).warnings || []) as unknown[];

      expect(warnings.length).toBeGreaterThan(0);
      expect(String(warnings[0] || "")).toContain("search -> timeline -> get_observations");
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
