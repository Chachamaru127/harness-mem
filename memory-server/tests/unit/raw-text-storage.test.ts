/**
 * S78-B01: Verbatim raw storage mode — unit + integration tests
 *
 * Verifies:
 *   1. raw_text is stored when HARNESS_MEM_RAW_MODE=1, omitted otherwise
 *   2. stripPrivateBlocks is applied to raw_text (privacy contract)
 *   3. Schema migration adds raw_text column to an empty DB
 *   4. loadObservations returns raw_text in the response shape
 *   5. Integration round-trip: ingest RAW=1 → retrieve → raw_text present
 *      ingest RAW=0 → retrieve → raw_text absent (null)
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { HarnessMemCore, type Config, type EventEnvelope } from "../../src/core/harness-mem-core";
import { initSchema, migrateSchema } from "../../src/db/schema";
import { removeDirWithRetry } from "../fs-cleanup";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (!dir) continue;
    removeDirWithRetry(dir);
  }
  // Always restore env after each test
  delete process.env["HARNESS_MEM_RAW_MODE"];
});

function makeTmpDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `hm-s78b01-${label}-`));
  cleanupPaths.push(dir);
  return dir;
}

function createConfig(label: string): Config {
  const dir = makeTmpDir(label);
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
  };
}

function baseEvent(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    platform: "claude",
    project: "s78b01-test",
    session_id: "sess-s78b01",
    event_type: "user_prompt",
    ts: new Date().toISOString(),
    payload: { content: "The verbatim raw conversation text for S78-B01." },
    tags: [],
    privacy_tags: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Schema tests
// ---------------------------------------------------------------------------

describe("S78-B01: schema migration", () => {
  test("initSchema creates mem_observations with raw_text column", () => {
    const dir = makeTmpDir("schema");
    const db = new Database(join(dir, "test.db"));
    initSchema(db);

    const cols = db
      .query<{ name: string }, []>(`PRAGMA table_info(mem_observations)`)
      .all()
      .map((r) => r.name);

    expect(cols).toContain("raw_text");
    db.close();
  });

  test("migrateSchema adds raw_text to existing DB that lacks it", () => {
    const dir = makeTmpDir("migrate");
    const db = new Database(join(dir, "legacy.db"));

    // Create table WITHOUT raw_text (simulating pre-S78-B01 schema)
    db.exec(`
      CREATE TABLE IF NOT EXISTS mem_observations (
        id TEXT PRIMARY KEY,
        event_id TEXT,
        platform TEXT NOT NULL,
        project TEXT NOT NULL,
        session_id TEXT NOT NULL,
        title TEXT,
        content TEXT NOT NULL,
        content_redacted TEXT NOT NULL,
        observation_type TEXT NOT NULL DEFAULT 'context',
        memory_type TEXT NOT NULL DEFAULT 'semantic',
        tags_json TEXT NOT NULL,
        privacy_tags_json TEXT NOT NULL,
        user_id TEXT NOT NULL DEFAULT 'default',
        team_id TEXT DEFAULT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    // Confirm raw_text not yet present
    const colsBefore = db
      .query<{ name: string }, []>(`PRAGMA table_info(mem_observations)`)
      .all()
      .map((r) => r.name);
    expect(colsBefore).not.toContain("raw_text");

    // Run migration (migrateSchema expects many tables — init first then migrate)
    initSchema(db);
    migrateSchema(db);

    const colsAfter = db
      .query<{ name: string }, []>(`PRAGMA table_info(mem_observations)`)
      .all()
      .map((r) => r.name);
    expect(colsAfter).toContain("raw_text");

    db.close();
  });
});

// ---------------------------------------------------------------------------
// Integration: EventRecorder + raw_text storage
// ---------------------------------------------------------------------------

describe("S78-B01: raw_text storage via HarnessMemCore", () => {
  test("RAW mode OFF: raw_text is NULL for ingested observation", () => {
    delete process.env["HARNESS_MEM_RAW_MODE"];

    const core = new HarnessMemCore(createConfig("raw-off"));
    try {
      const result = core.recordEvent(baseEvent());
      expect(result.ok).toBe(true);
      const obsId = (result.items[0] as { id?: string } | undefined)?.id;
      expect(obsId).toBeTruthy();

      const row = (core as unknown as { db: Database }).db
        .query<{ raw_text: string | null }, [string]>(
          `SELECT raw_text FROM mem_observations WHERE id = ?`
        )
        .get(obsId!);

      expect(row).not.toBeNull();
      expect(row!.raw_text).toBeNull();
    } finally {
      core.shutdown("test");
    }
  });

  test("RAW mode ON: raw_text is stored with verbatim content", () => {
    process.env["HARNESS_MEM_RAW_MODE"] = "1";

    const rawContent = "The verbatim raw conversation text for S78-B01.";
    const core = new HarnessMemCore(createConfig("raw-on"));
    try {
      const result = core.recordEvent(baseEvent({ payload: { content: rawContent } }));
      expect(result.ok).toBe(true);
      const obsId = (result.items[0] as { id?: string } | undefined)?.id;
      expect(obsId).toBeTruthy();

      const row = (core as unknown as { db: Database }).db
        .query<{ raw_text: string | null }, [string]>(
          `SELECT raw_text FROM mem_observations WHERE id = ?`
        )
        .get(obsId!);

      expect(row).not.toBeNull();
      expect(row!.raw_text).toBe(rawContent);
    } finally {
      core.shutdown("test");
    }
  });

  test("RAW mode ON: <private> blocks are stripped from raw_text", () => {
    process.env["HARNESS_MEM_RAW_MODE"] = "1";

    const rawWithPrivate =
      "Useful context. <private>SECRET_TOKEN=abc123</private> More context.";
    const core = new HarnessMemCore(createConfig("raw-private"));
    try {
      const result = core.recordEvent(
        baseEvent({ payload: { content: rawWithPrivate } })
      );
      expect(result.ok).toBe(true);
      const obsId = (result.items[0] as { id?: string } | undefined)?.id;
      expect(obsId).toBeTruthy();

      const row = (core as unknown as { db: Database }).db
        .query<{ raw_text: string | null }, [string]>(
          `SELECT raw_text FROM mem_observations WHERE id = ?`
        )
        .get(obsId!);

      expect(row).not.toBeNull();
      expect(row!.raw_text).not.toContain("SECRET_TOKEN");
      expect(row!.raw_text).not.toContain("<private>");
      expect(row!.raw_text).toContain("Useful context.");
    } finally {
      core.shutdown("test");
    }
  });

  test("RAW mode ON: content column still populated (raw is ADDITIONAL)", () => {
    process.env["HARNESS_MEM_RAW_MODE"] = "1";

    const core = new HarnessMemCore(createConfig("raw-additive"));
    try {
      const result = core.recordEvent(baseEvent());
      expect(result.ok).toBe(true);
      const obsId = (result.items[0] as { id?: string } | undefined)?.id;
      expect(obsId).toBeTruthy();

      const row = (core as unknown as { db: Database }).db
        .query<{ content: string; raw_text: string | null }, [string]>(
          `SELECT content, raw_text FROM mem_observations WHERE id = ?`
        )
        .get(obsId!);

      expect(row).not.toBeNull();
      // content (structured) must still be populated
      expect(row!.content).toBeTruthy();
      // raw_text also populated in RAW mode
      expect(row!.raw_text).toBeTruthy();
    } finally {
      core.shutdown("test");
    }
  });
});

// ---------------------------------------------------------------------------
// Integration: retrieval returns raw_text in response shape
// ---------------------------------------------------------------------------

describe("S78-B01: retrieval response includes raw_text", () => {
  test("getObservations returns raw_text field (non-null when RAW=1)", () => {
    process.env["HARNESS_MEM_RAW_MODE"] = "1";

    const rawContent = "Raw retrieval test content for S78-B01.";
    const core = new HarnessMemCore(createConfig("retrieval-raw"));
    try {
      const ingestResult = core.recordEvent(
        baseEvent({ payload: { content: rawContent } })
      );
      const obsId = (ingestResult.items[0] as { id?: string } | undefined)?.id;
      expect(obsId).toBeTruthy();

      const getResult = core.getObservations({ ids: [obsId!] });
      expect(getResult.ok).toBe(true);
      expect(getResult.items.length).toBe(1);

      const obs = getResult.items[0] as Record<string, unknown>;
      // raw_text should be present in the response
      expect("raw_text" in obs).toBe(true);
      expect(obs.raw_text).toBe(rawContent);
    } finally {
      core.shutdown("test");
    }
  });

  test("getObservations returns raw_text as null when RAW=0", () => {
    delete process.env["HARNESS_MEM_RAW_MODE"];

    const core = new HarnessMemCore(createConfig("retrieval-no-raw"));
    try {
      const ingestResult = core.recordEvent(baseEvent());
      const obsId = (ingestResult.items[0] as { id?: string } | undefined)?.id;
      expect(obsId).toBeTruthy();

      const getResult = core.getObservations({ ids: [obsId!] });
      expect(getResult.ok).toBe(true);
      const obs = getResult.items[0] as Record<string, unknown>;

      // raw_text column exists in SELECT but should be null
      expect("raw_text" in obs || obs.raw_text === undefined || obs.raw_text === null).toBe(true);
      expect(obs.raw_text ?? null).toBeNull();
    } finally {
      core.shutdown("test");
    }
  });
});
