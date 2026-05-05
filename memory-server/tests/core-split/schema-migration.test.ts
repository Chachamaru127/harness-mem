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
});
