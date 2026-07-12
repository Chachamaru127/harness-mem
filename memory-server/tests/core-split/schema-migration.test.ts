import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureDatabase, initSchema, migrateSchema } from "../../src/db/schema";

const tempDirs: string[] = [];

function createTempDb(): Database {
  const dir = mkdtempSync(join(tmpdir(), "hmem-schema-migration-"));
  tempDirs.push(dir);
  const db = new Database(join(dir, "harness-mem.db"));
  configureDatabase(db);
  return db;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function sqliteObjectExists(db: Database, type: string, name: string): boolean {
  const row = db
    .query(`SELECT name FROM sqlite_master WHERE type = ? AND name = ?`)
    .get(type, name) as { name: string } | null;
  return row?.name === name;
}

function columnNames(db: Database, tableName: string): string[] {
  return (db.query(`SELECT name FROM pragma_table_info(?)`).all(tableName) as Array<{ name: string }>).map(
    (row) => row.name,
  );
}

function expectWorkGraphSchema(db: Database): void {
  expect(sqliteObjectExists(db, "table", "mem_work_items")).toBe(true);
  expect(sqliteObjectExists(db, "table", "mem_work_dependencies")).toBe(true);
  expect(sqliteObjectExists(db, "table", "mem_work_events")).toBe(true);
  expect(sqliteObjectExists(db, "table", "mem_work_links")).toBe(true);

  expect(columnNames(db, "mem_work_items").sort()).toEqual(
    [
      "assignee",
      "branch",
      "close_reason",
      "closed_at",
      "created_at",
      "created_by",
      "description",
      "metadata_json",
      "parent_work_id",
      "priority",
      "project",
      "session_id",
      "source_ref",
      "source_type",
      "status",
      "title",
      "updated_at",
      "work_id",
      "work_type",
    ].sort(),
  );
  expect(columnNames(db, "mem_work_dependencies").sort()).toEqual(
    ["created_at", "from_work_id", "metadata_json", "relation", "to_work_id"].sort(),
  );
  expect(columnNames(db, "mem_work_events").sort()).toEqual(
    ["actor", "created_at", "event_id", "event_type", "payload_json", "session_id", "work_id"].sort(),
  );
  expect(columnNames(db, "mem_work_links").sort()).toEqual(
    ["created_at", "relation", "target_id", "target_type", "work_id"].sort(),
  );

  expect(sqliteObjectExists(db, "index", "idx_mem_work_items_project_status_updated")).toBe(true);
  expect(sqliteObjectExists(db, "index", "idx_mem_work_items_source")).toBe(true);
  expect(sqliteObjectExists(db, "index", "idx_mem_work_dependencies_to")).toBe(true);
  expect(sqliteObjectExists(db, "index", "idx_mem_work_events_work_created")).toBe(true);
  expect(sqliteObjectExists(db, "index", "idx_mem_work_links_target")).toBe(true);
}

function expectRecallProjectionSchema(db: Database): void {
  expect(sqliteObjectExists(db, "table", "mem_recall_projection_runs")).toBe(true);
  expect(sqliteObjectExists(db, "table", "mem_recall_items")).toBe(true);
  expect(sqliteObjectExists(db, "table", "mem_recall_chunks")).toBe(true);
  expect(sqliteObjectExists(db, "table", "mem_recall_profiles")).toBe(true);

  expect(columnNames(db, "mem_recall_projection_runs").sort()).toEqual(
    [
      "completed_at",
      "diagnostics_json",
      "generation",
      "item_count",
      "project",
      "scope_key",
      "skipped_count",
      "source_watermark",
      "started_at",
      "status",
    ].sort(),
  );
  expect(columnNames(db, "mem_recall_items").sort()).toEqual(
    [
      "content_redacted",
      "metadata_json",
      "privacy_tags_json",
      "project",
      "projected_at",
      "projection_generation",
      "recall_id",
      "recall_type",
      "session_id",
      "source_created_at",
      "source_id",
      "source_ref",
      "source_type",
      "tenant",
      "title",
      "valid_from",
      "valid_to",
      "workspace",
    ].sort(),
  );

  expect(sqliteObjectExists(db, "index", "idx_mem_recall_runs_project_completed")).toBe(true);
  expect(sqliteObjectExists(db, "index", "idx_mem_recall_items_scope_type_created")).toBe(true);
  expect(sqliteObjectExists(db, "index", "idx_mem_recall_items_source")).toBe(true);
  expect(sqliteObjectExists(db, "index", "idx_mem_recall_chunks_recall_index")).toBe(true);
  expect(sqliteObjectExists(db, "index", "idx_mem_recall_profiles_project_type")).toBe(true);
}

function expectArchiveSchema(db: Database): void {
  expect(sqliteObjectExists(db, "table", "mem_archive_stubs")).toBe(true);
  expect(sqliteObjectExists(db, "table", "mem_archive_full")).toBe(true);
  expect(columnNames(db, "mem_archive_stubs").sort()).toEqual(
    [
      "archive_full_ref",
      "archive_id",
      "archive_state",
      "archive_stub",
      "content_sha256",
      "created_at",
      "legal_hold_snapshot",
      "manifest_sha256",
      "metadata_json",
      "observation_id",
      "project",
      "purged_at",
      "reason",
      "restored_at",
      "session_id",
      "team_id",
      "user_id",
    ].sort(),
  );
  expect(columnNames(db, "mem_archive_full").sort()).toEqual(
    ["archive_full_ref", "archive_id", "created_at", "payload_json", "payload_sha256", "purged_at"].sort(),
  );
  expect(sqliteObjectExists(db, "index", "idx_mem_archive_stubs_observation")).toBe(true);
  expect(sqliteObjectExists(db, "index", "idx_mem_archive_stubs_state_created")).toBe(true);
}

describe("schema migration", () => {
  test("fresh initSchema and migrateSchema create WorkGraph tables and indexes", () => {
    const db = createTempDb();
    try {
      expect(() => initSchema(db)).not.toThrow();
      expect(() => migrateSchema(db)).not.toThrow();

      expectWorkGraphSchema(db);
      expectRecallProjectionSchema(db);
      expectArchiveSchema(db);
    } finally {
      db.close();
    }
  });

  test("legacy mem tables migrate additively to include WorkGraph tables", () => {
    const db = createTempDb();
    try {
      db.exec(`
        CREATE TABLE mem_sessions (
          session_id TEXT PRIMARY KEY,
          platform TEXT NOT NULL,
          project TEXT NOT NULL,
          started_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE mem_events (
          event_id TEXT PRIMARY KEY,
          platform TEXT NOT NULL,
          project TEXT NOT NULL,
          session_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          ts TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          tags_json TEXT NOT NULL,
          privacy_tags_json TEXT NOT NULL,
          dedupe_hash TEXT NOT NULL UNIQUE,
          observation_id TEXT,
          created_at TEXT NOT NULL
        );
        CREATE TABLE mem_observations (
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
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO mem_sessions(session_id, platform, project, started_at, created_at, updated_at)
          VALUES ('legacy-session', 'codex', 'legacy-project', '2026-05-17T00:00:00.000Z', '2026-05-17T00:00:00.000Z', '2026-05-17T00:00:00.000Z');
      `);

      expect(() => initSchema(db)).not.toThrow();
      expect(() => migrateSchema(db)).not.toThrow();

      expectWorkGraphSchema(db);
      expectRecallProjectionSchema(db);
      expectArchiveSchema(db);
      const legacySession = db
        .query(`SELECT project FROM mem_sessions WHERE session_id = 'legacy-session'`)
        .get() as { project: string } | null;
      expect(legacySession?.project).toBe("legacy-project");
    } finally {
      db.close();
    }
  });

  test("legacy observation table without content_dedupe_hash migrates before index creation", () => {
    const db = createTempDb();
    try {
      db.exec(`
        CREATE TABLE mem_observations (
          id TEXT PRIMARY KEY,
          event_id TEXT,
          platform TEXT NOT NULL,
          project TEXT NOT NULL,
          session_id TEXT NOT NULL,
          title TEXT,
          content TEXT NOT NULL,
          content_redacted TEXT NOT NULL,
          raw_text TEXT,
          observation_type TEXT NOT NULL DEFAULT 'context',
          memory_type TEXT NOT NULL DEFAULT 'semantic',
          tags_json TEXT NOT NULL,
          privacy_tags_json TEXT NOT NULL,
          user_id TEXT NOT NULL DEFAULT 'default',
          team_id TEXT DEFAULT NULL,
          archived_at TEXT DEFAULT NULL,
          expires_at TEXT DEFAULT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      expect(() => initSchema(db)).not.toThrow();
      expect(() => migrateSchema(db)).not.toThrow();

      const column = db
        .query(`SELECT name FROM pragma_table_info('mem_observations') WHERE name = 'content_dedupe_hash'`)
        .get() as { name: string } | null;
      const index = db
        .query(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_mem_obs_content_dedupe_hash'`)
        .get() as { name: string } | null;

      expect(column?.name).toBe("content_dedupe_hash");
      expect(index?.name).toBe("idx_mem_obs_content_dedupe_hash");
    } finally {
      db.close();
    }
  });

  test("H156-004: fresh schema includes mem_events.metadata_json with default {}", () => {
    const db = createTempDb();
    try {
      initSchema(db);
      migrateSchema(db);

      const columns = columnNames(db, "mem_events");
      expect(columns).toContain("metadata_json");

      db.query(
        `INSERT INTO mem_sessions(session_id, platform, project, started_at, created_at, updated_at)
         VALUES ('sess-h156', 'codex', 'proj-h156', '2026-07-12T00:00:00.000Z', '2026-07-12T00:00:00.000Z', '2026-07-12T00:00:00.000Z')`,
      ).run();
      db.query(
        `INSERT INTO mem_events(
          event_id, platform, project, session_id, event_type, ts,
          payload_json, tags_json, privacy_tags_json, dedupe_hash, created_at
        ) VALUES ('evt-h156-default', 'codex', 'proj-h156', 'sess-h156', 'user_prompt',
          '2026-07-12T00:00:00.000Z', '{}', '[]', '[]', 'dedupe-h156-default', '2026-07-12T00:00:00.000Z')`,
      ).run();

      const row = db
        .query<{ metadata_json: string }, []>(`SELECT metadata_json FROM mem_events WHERE event_id = 'evt-h156-default'`)
        .get();
      expect(row?.metadata_json).toBe("{}");
    } finally {
      db.close();
    }
  });

  test("H156-004: legacy mem_events without metadata_json migrates additively", () => {
    const db = createTempDb();
    try {
      db.exec(`
        CREATE TABLE mem_sessions (
          session_id TEXT PRIMARY KEY,
          platform TEXT NOT NULL,
          project TEXT NOT NULL,
          started_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE mem_events (
          event_id TEXT PRIMARY KEY,
          platform TEXT NOT NULL,
          project TEXT NOT NULL,
          session_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          ts TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          tags_json TEXT NOT NULL,
          privacy_tags_json TEXT NOT NULL,
          dedupe_hash TEXT NOT NULL UNIQUE,
          observation_id TEXT,
          created_at TEXT NOT NULL
        );
        INSERT INTO mem_sessions(session_id, platform, project, started_at, created_at, updated_at)
          VALUES ('legacy-h156', 'codex', 'legacy-h156', '2026-07-12T00:00:00.000Z', '2026-07-12T00:00:00.000Z', '2026-07-12T00:00:00.000Z');
        INSERT INTO mem_events(
          event_id, platform, project, session_id, event_type, ts,
          payload_json, tags_json, privacy_tags_json, dedupe_hash, created_at
        ) VALUES (
          'legacy-h156-event', 'codex', 'legacy-h156', 'legacy-h156', 'user_prompt',
          '2026-07-12T00:00:00.000Z', '{}', '[]', '[]', 'legacy-h156-dedupe', '2026-07-12T00:00:00.000Z'
        );
      `);

      initSchema(db);
      migrateSchema(db);
      migrateSchema(db);

      expect(columnNames(db, "mem_events")).toContain("metadata_json");
      const row = db
        .query<{ metadata_json: string }, []>(`SELECT metadata_json FROM mem_events WHERE event_id = 'legacy-h156-event'`)
        .get();
      expect(row?.metadata_json).toBe("{}");
    } finally {
      db.close();
    }
  });

  test("S108-007 temporal anchor columns and observed_at backfill are idempotent", () => {
    const db = createTempDb();
    try {
      db.exec(`
        CREATE TABLE mem_sessions (
          session_id TEXT PRIMARY KEY,
          platform TEXT NOT NULL,
          project TEXT NOT NULL,
          started_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE mem_events (
          event_id TEXT PRIMARY KEY,
          platform TEXT NOT NULL,
          project TEXT NOT NULL,
          session_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          ts TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          tags_json TEXT NOT NULL,
          privacy_tags_json TEXT NOT NULL,
          dedupe_hash TEXT NOT NULL UNIQUE,
          observation_id TEXT,
          created_at TEXT NOT NULL
        );
        CREATE TABLE mem_observations (
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
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE mem_links (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          from_observation_id TEXT NOT NULL,
          to_observation_id TEXT NOT NULL,
          relation TEXT NOT NULL,
          weight REAL NOT NULL DEFAULT 1.0,
          created_at TEXT NOT NULL
        );
        CREATE TABLE mem_facts (
          fact_id TEXT PRIMARY KEY,
          observation_id TEXT,
          project TEXT NOT NULL,
          session_id TEXT NOT NULL,
          fact_type TEXT NOT NULL,
          fact_key TEXT NOT NULL,
          fact_value TEXT NOT NULL,
          confidence REAL NOT NULL DEFAULT 0.5,
          merged_into_fact_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      expect(() => initSchema(db)).not.toThrow();
      expect(() => migrateSchema(db)).not.toThrow();
      expect(() => migrateSchema(db)).not.toThrow();

      const required = {
        mem_observations: ["event_time", "observed_at", "valid_from", "valid_to", "supersedes", "invalidated_at"],
        mem_facts: ["event_time", "observed_at", "valid_from", "valid_to", "supersedes", "invalidated_at"],
        mem_links: ["event_time", "observed_at", "valid_from", "valid_to", "supersedes", "invalidated_at"],
        mem_relations: ["event_time", "observed_at", "valid_from", "valid_to", "supersedes", "invalidated_at"],
      };

      for (const [table, columns] of Object.entries(required)) {
        const existing = new Set(
          (db.query(`SELECT name FROM pragma_table_info(?)`).all(table) as Array<{ name: string }>).map((row) => row.name),
        );
        for (const columnName of columns) {
          expect(existing.has(columnName)).toBe(true);
        }
      }
      const reverseLinkIndex = db
        .query(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_mem_links_to_relation'`)
        .get() as { name: string } | null;
      expect(reverseLinkIndex?.name).toBe("idx_mem_links_to_relation");
      const activeFactIndex = db
        .query(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_mem_facts_observation_active'`)
        .get() as { name: string } | null;
      expect(activeFactIndex?.name).toBe("idx_mem_facts_observation_active");

      const now = "2026-05-07T00:00:00.000Z";
      db.query(
        `INSERT INTO mem_observations(
          id, event_id, platform, project, session_id, title, content, content_redacted,
          observation_type, memory_type, tags_json, privacy_tags_json, created_at, updated_at
        ) VALUES ('obs-s108', NULL, 'codex', 'proj', 'sess', 'title', 'content', 'content',
          'context', 'semantic', '[]', '[]', ?, ?)`
      ).run(now, now);
      db.query(
        `INSERT INTO mem_facts(
          fact_id, observation_id, project, session_id, fact_type, fact_key, fact_value,
          confidence, valid_from, created_at, updated_at
        ) VALUES ('fact-s108', 'obs-s108', 'proj', 'sess', 'decision', 'decision:key', 'value',
          0.9, ?, ?, ?)`
      ).run(now, now, now);
      db.query(
        `INSERT INTO mem_links(from_observation_id, to_observation_id, relation, weight, created_at)
         VALUES ('obs-s108', 'obs-s108-2', 'extends', 1.0, ?)`
      ).run(now);
      db.query(
        `INSERT INTO mem_relations(src, dst, kind, strength, observation_id, created_at)
         VALUES ('a', 'b', 'co-occurs', 1.0, 'obs-s108', ?)`
      ).run(now);

      const observed = {
        observation: (db.query(`SELECT event_time, observed_at FROM mem_observations WHERE id = 'obs-s108'`).get() as { event_time: string | null; observed_at: string | null }),
        fact: (db.query(`SELECT event_time, observed_at FROM mem_facts WHERE fact_id = 'fact-s108'`).get() as { event_time: string | null; observed_at: string | null }),
        link: (db.query(`SELECT event_time, observed_at FROM mem_links WHERE from_observation_id = 'obs-s108'`).get() as { event_time: string | null; observed_at: string | null }),
        relation: (db.query(`SELECT event_time, observed_at FROM mem_relations WHERE observation_id = 'obs-s108'`).get() as { event_time: string | null; observed_at: string | null }),
      };

      expect(observed.observation.event_time).toBeNull();
      expect(observed.observation.observed_at).toBe(now);
      expect(observed.fact.event_time).toBeNull();
      expect(observed.fact.observed_at).toBe(now);
      expect(observed.link.event_time).toBeNull();
      expect(observed.link.observed_at).toBe(now);
      expect(observed.relation.event_time).toBeNull();
      expect(observed.relation.observed_at).toBe(now);
    } finally {
      db.close();
    }
  });
});
