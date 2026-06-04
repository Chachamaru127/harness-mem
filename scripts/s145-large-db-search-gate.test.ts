import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessMemCore, type Config } from "../memory-server/src/core/harness-mem-core";
import { runLargeDbSearchGate } from "./s145-large-db-search-gate";

function config(dbPath: string): Config {
  return {
    dbPath,
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
}

describe("s145-large-db-search-gate", () => {
  test("passes on small fixture with zero empty_error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "s145-gate-"));
    const dbPath = join(dir, "harness-mem.db");
    const core = new HarnessMemCore(config(dbPath));
    try {
      core.recordEvent({
        platform: "claude",
        project: "s145-gate",
        session_id: "s145-gate-session",
        event_type: "user_prompt",
        ts: "2026-06-02T00:00:00.000Z",
        payload: { content: "search fallback worker timeout sentinel" },
      });
    } finally {
      core.shutdown("test");
    }

    const manifest = await runLargeDbSearchGate({
      sourcePath: dbPath,
      thresholds: { p95_ms: 30_000, empty_error_count: 0 },
    });

    expect(manifest.harness.empty_error_count).toBe(0);
    expect(manifest.summary.status).toBe("pass");
    rmSync(dir, { recursive: true, force: true });
  });
});
