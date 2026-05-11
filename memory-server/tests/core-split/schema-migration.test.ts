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

describe("schema migration", () => {
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
