/**
 * raw-text-storage.test.ts — §78-B01 re-authored (post-drift)
 *
 * Covers:
 * 1. Schema: raw_text column exists after initSchema + migrateSchema
 * 2. RAW=0 (default): raw_text is null
 * 3. RAW=1: raw_text is populated with verbatim payload content
 * 4. Privacy interaction: RAW=1 + <private> block → stripped from raw_text
 * 5. Retrieval: getObservations includes raw_text field when present
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessMemCore, getConfig, type Config, type EventEnvelope } from "../../src/core/harness-mem-core";
import { removeDirWithRetry } from "../fs-cleanup";

const cleanupPaths: string[] = [];
afterEach(() => {
  // Restore RAW mode env to prevent cross-test leakage
  delete process.env["HARNESS_MEM_RAW_MODE"];
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (dir) removeDirWithRetry(dir);
  }
});

function createConfig(): Config {
  const dir = mkdtempSync(join(tmpdir(), "harness-mem-raw-test-"));
  cleanupPaths.push(dir);
  return {
    ...getConfig(),
    dbPath: join(dir, "harness-mem.db"),
    captureEnabled: true,
    vectorDimension: 64,
  };
}

function makeEvent(content: string, sessionId = "sess-raw-test"): EventEnvelope {
  return {
    platform: "claude",
    project: "raw-test-project",
    session_id: sessionId,
    event_type: "user_prompt",
    ts: new Date().toISOString(),
    payload: { content },
    tags: [],
    privacy_tags: [],
  };
}

// ---------------------------------------------------------------------------

describe("§78-B01 raw_text column (schema)", () => {
  test("raw_text column exists in mem_observations after schema init", () => {
    const core = new HarnessMemCore(createConfig());
    const db = core.getRawDb();

    type PragmaRow = { name: string; type: string };
    const columns = db
      .query<PragmaRow, []>("PRAGMA table_info(mem_observations)")
      .all();
    const colNames = columns.map((c) => c.name);

    expect(colNames).toContain("raw_text");

    core.close?.();
  });
});

describe("§78-B01 raw_text storage (RAW=0 default)", () => {
  test("raw_text is null when HARNESS_MEM_RAW_MODE is not set", () => {
    delete process.env["HARNESS_MEM_RAW_MODE"];
    const core = new HarnessMemCore(createConfig());

    const event = makeEvent("hello world content");
    const result = core.recordEvent(event);
    expect(result.ok).toBe(true);

    const db = core.getRawDb();
    type RawRow = { raw_text: string | null };
    const rows = db
      .query<RawRow, []>("SELECT raw_text FROM mem_observations LIMIT 1")
      .all();

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].raw_text).toBeNull();

    core.close?.();
  });
});

describe("§78-B01 raw_text storage (RAW=1)", () => {
  test("raw_text is populated with verbatim content when HARNESS_MEM_RAW_MODE=1", () => {
    process.env["HARNESS_MEM_RAW_MODE"] = "1";
    const core = new HarnessMemCore(createConfig());

    const content = "verbatim test content for §78-B01";
    const event = makeEvent(content);
    const result = core.recordEvent(event);
    expect(result.ok).toBe(true);

    const db = core.getRawDb();
    type RawRow = { raw_text: string | null };
    const rows = db
      .query<RawRow, []>("SELECT raw_text FROM mem_observations LIMIT 1")
      .all();

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].raw_text).toBe(content);

    core.close?.();
  });

  test("raw_text strips <private> blocks (§78-E01 interaction)", () => {
    process.env["HARNESS_MEM_RAW_MODE"] = "1";
    const core = new HarnessMemCore(createConfig());

    // Content with a private block — private part should be stripped from raw_text
    const event = makeEvent("public part <private>secret token</private> end");
    const result = core.recordEvent(event);
    expect(result.ok).toBe(true);

    const db = core.getRawDb();
    type RawRow = { raw_text: string | null };
    const rows = db
      .query<RawRow, []>("SELECT raw_text FROM mem_observations LIMIT 1")
      .all();

    expect(rows.length).toBeGreaterThan(0);
    const rawText = rows[0].raw_text;
    expect(rawText).not.toBeNull();
    // Private block must be stripped
    expect(rawText).not.toContain("secret token");
    // Public content is preserved
    expect(rawText).toContain("public part");

    core.close?.();
  });
});

describe("§78-B01 raw_text retrieval via getObservations", () => {
  test("getObservations includes raw_text field when RAW=1", () => {
    process.env["HARNESS_MEM_RAW_MODE"] = "1";
    const core = new HarnessMemCore(createConfig());

    const content = "retrieval check content";
    const event = makeEvent(content, "sess-retrieval");
    const result = core.recordEvent(event);
    expect(result.ok).toBe(true);

    // Derive the observation ID from the DB directly
    const db = core.getRawDb();
    type IdRow = { id: string };
    const rows = db
      .query<IdRow, []>("SELECT id FROM mem_observations LIMIT 1")
      .all();
    expect(rows.length).toBeGreaterThan(0);

    const obsId = rows[0].id;
    const getResult = core.getObservations({ ids: [obsId] });
    expect(getResult.ok).toBe(true);
    expect(Array.isArray(getResult.items)).toBe(true);

    const obs = (getResult.items as Array<Record<string, unknown>>)[0];
    expect(obs).toBeDefined();
    // raw_text field must be present
    expect("raw_text" in obs).toBe(true);
    expect(obs.raw_text).toBe(content);

    core.close?.();
  });
});
