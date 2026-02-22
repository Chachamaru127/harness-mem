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

describe("security hardening", () => {
  test("query/project injection patterns do not bypass filters", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-security-filter-"));
    const core = new HarnessMemCore(makeConfig(dir));

    try {
      core.recordEvent({
        event_id: "security-public",
        platform: "codex",
        project: "security-a",
        session_id: "session-a",
        event_type: "user_prompt",
        payload: { content: "public security note" },
        tags: [],
        privacy_tags: [],
      });
      core.recordEvent({
        event_id: "security-private",
        platform: "codex",
        project: "security-b",
        session_id: "session-b",
        event_type: "user_prompt",
        payload: { content: "private security note" },
        tags: [],
        privacy_tags: ["private"],
      });

      const response = core.search({
        query: '" OR 1=1 -- private security note',
        project: "security-a' OR 1=1 --",
        include_private: false,
        limit: 20,
        strict_project: true,
      });
      expect(response.ok).toBe(true);
      for (const item of response.items as Array<Record<string, unknown>>) {
        const privacyTags = (item.privacy_tags || []) as string[];
        expect(privacyTags.includes("private")).toBe(false);
      }
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("read audit logs capture search access traces", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-security-audit-"));
    const core = new HarnessMemCore(makeConfig(dir));

    try {
      core.recordEvent({
        event_id: "security-audit",
        platform: "codex",
        project: "security-audit",
        session_id: "security-audit-session",
        event_type: "user_prompt",
        payload: { content: "audit test" },
        tags: [],
        privacy_tags: [],
      });
      core.search({ query: "audit test", project: "security-audit", limit: 5, include_private: true });

      const audit = core.getAuditLog({ action: "read.search", limit: 10 });
      expect(audit.ok).toBe(true);
      expect(audit.items.length).toBeGreaterThan(0);
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
