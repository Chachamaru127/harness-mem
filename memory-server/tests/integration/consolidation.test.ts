import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
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

describe("consolidation worker integration", () => {
  test("creates mem_facts and mem_audit_log schema", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-consolidation-schema-"));
    const dbPath = join(dir, "harness-mem.db");
    const core = new HarnessMemCore(makeConfig(dir));
    core.shutdown("test");

    const db = new Database(dbPath, { readonly: true });
    try {
      const tableNames = db
        .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as Array<{ name: string }>;
      const names = tableNames.map((row) => row.name);

      expect(names.includes("mem_facts")).toBe(true);
      expect(names.includes("mem_audit_log")).toBe(true);
      expect(names.includes("mem_consolidation_queue")).toBe(true);
    } finally {
      db.close(false);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("extracts facts and dedupes similar facts on consolidation run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-consolidation-run-"));
    const core = new HarnessMemCore(makeConfig(dir));

    try {
      core.recordEvent({
        event_id: "fact-1",
        platform: "codex",
        project: "consolidation",
        session_id: "session-1",
        event_type: "user_prompt",
        payload: { content: "We decided to use sqlite for memory persistence." },
        tags: ["decision"],
        privacy_tags: [],
      });
      core.recordEvent({
        event_id: "fact-2",
        platform: "codex",
        project: "consolidation",
        session_id: "session-1",
        event_type: "user_prompt",
        payload: { content: "Decision: use sqlite for memory persistence." },
        tags: ["decision"],
        privacy_tags: [],
      });

      const run = await core.runConsolidation({ reason: "test" });
      expect(run.ok).toBe(true);

      const status = core.getConsolidationStatus();
      const statusItem = (status.items[0] || {}) as Record<string, unknown>;
      expect(Number(statusItem.pending_jobs || 0)).toBeGreaterThanOrEqual(0);
      expect(Number(statusItem.facts_total || 0)).toBeGreaterThan(0);
      expect(Number(statusItem.facts_merged || 0)).toBeGreaterThanOrEqual(1);

      const audit = core.getAuditLog({ limit: 20 });
      expect(audit.ok).toBe(true);
      expect(audit.items.length).toBeGreaterThan(0);
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
