/**
 * S154-201: dreaming consolidation job wiring.
 *
 * Proves the DoD: after finalizeSession a `dreaming` job is enqueued, is visible
 * as a distinct job type via admin consolidation status (jobs_by_reason), and on
 * run produces a `consolidation.dreaming` audit row. Dreaming is local by default
 * (provider=ollama); pointing it at an external provider requires an explicit env
 * opt-in and is warned + audited. Existing consolidation behavior is non-regressed.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessMemCore, type Config, type EventEnvelope } from "../../src/core/harness-mem-core";

const ENV_KEYS = ["HARNESS_MEM_DREAMING_LLM_PROVIDER", "HARNESS_MEM_FACT_EXTRACTOR_MODE"];
const cleanupPaths: string[] = [];
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function createConfig(name: string): Config {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-dreaming-${name}-`));
  cleanupPaths.push(dir);
  return {
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
    consolidationEnabled: true,
  };
}

function seedAndFinalize(core: HarnessMemCore, project: string, session: string): void {
  const event: EventEnvelope = {
    platform: "claude",
    project,
    session_id: session,
    event_type: "checkpoint",
    ts: "2026-06-08T10:00:00.000Z",
    payload: { prompt: "本番DBを PostgreSQL に決定した。" },
    tags: [],
    privacy_tags: [],
  };
  core.recordEvent(event);
  const res = core.finalizeSession({ session_id: session, project, platform: "claude" });
  expect(res.ok).toBe(true);
}

function statusItem(core: HarnessMemCore): Record<string, unknown> {
  const res = core.getConsolidationStatus();
  expect(res.ok).toBe(true);
  return res.items[0] as Record<string, unknown>;
}

function auditRows(core: HarnessMemCore, action: string): Array<{ details: Record<string, unknown> }> {
  const res = core.getAuditLog({ limit: 50, action });
  expect(res.ok).toBe(true);
  return res.items as Array<{ details: Record<string, unknown> }>;
}

describe("S154-201 dreaming consolidation job", () => {
  test("finalize enqueues a dreaming job visible by reason in admin status", async () => {
    const core = new HarnessMemCore(createConfig("status"));
    try {
      seedAndFinalize(core, "dream-status", "s1");
      const item = statusItem(core);
      const byReason = item.jobs_by_reason as Record<string, number>;
      expect(byReason).toBeDefined();
      expect(byReason.dreaming).toBeGreaterThanOrEqual(1);
      expect(byReason.finalize).toBeGreaterThanOrEqual(1);
    } finally {
      core.shutdown("test");
    }
  });

  test("running the queue produces a consolidation.dreaming audit (local default provider)", async () => {
    const core = new HarnessMemCore(createConfig("run"));
    try {
      seedAndFinalize(core, "dream-run", "s1");
      await core.runConsolidation({}); // process the queued finalize + dreaming jobs
      const dreaming = auditRows(core, "consolidation.dreaming");
      expect(dreaming.length).toBeGreaterThanOrEqual(1);
      expect(dreaming[0].details.provider).toBe("ollama"); // local default, no egress
      // the generic consolidation.run row carries reason=dreaming for the dreaming job
      const runs = auditRows(core, "consolidation.run");
      expect(runs.some((r) => r.details.reason === "dreaming")).toBe(true);
      // local default → no external-provider audit
      expect(auditRows(core, "consolidation.dreaming.external_provider")).toHaveLength(0);
    } finally {
      core.shutdown("test");
    }
  });

  test("external dreaming provider requires explicit opt-in and is audited", async () => {
    process.env.HARNESS_MEM_DREAMING_LLM_PROVIDER = "openai";
    const core = new HarnessMemCore(createConfig("external"));
    try {
      seedAndFinalize(core, "dream-ext", "s1");
      await core.runConsolidation({});
      const ext = auditRows(core, "consolidation.dreaming.external_provider");
      expect(ext.length).toBeGreaterThanOrEqual(1);
      expect(ext[0].details.provider).toBe("openai");
      const dreaming = auditRows(core, "consolidation.dreaming");
      expect(dreaming[0].details.provider).toBe("openai");
    } finally {
      core.shutdown("test");
    }
  });
});
