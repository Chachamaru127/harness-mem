import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { initFtsIndex } from "../../src/db/schema";

test("metadata updates do not rewrite FTS; text changes remain searchable", () => {
  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE mem_observations (
      id TEXT PRIMARY KEY, title TEXT, content_redacted TEXT,
      title_fts TEXT, content_fts TEXT, access_count INTEGER,
      last_accessed_at TEXT, archived_at TEXT
    )`);
    expect(initFtsIndex(db)).toBe(true);
    db.query("INSERT INTO mem_observations(id,title,content_redacted) VALUES ('one','alpha','before')").run();
    const changes = () => (db.query("SELECT total_changes() AS n").get() as { n: number }).n;
    for (const sql of [
      "UPDATE mem_observations SET access_count=1,last_accessed_at='2026-10-26' WHERE id='one'",
      "UPDATE mem_observations SET archived_at='2026-10-26' WHERE id='one'",
      "UPDATE mem_observations SET content_redacted=content_redacted WHERE id='one'",
    ]) {
      const before = changes();
      db.exec(sql);
      expect(changes() - before).toBe(1);
    }
    const matches = (term: string) => (db.query(
      "SELECT COUNT(*) AS n FROM mem_observations_fts WHERE mem_observations_fts MATCH ?",
    ).get(term) as { n: number }).n;
    expect(matches("before")).toBe(1);
    db.exec("UPDATE mem_observations SET content_redacted='after' WHERE id='one'");
    expect(matches("before")).toBe(0);
    expect(matches("after")).toBe(1);
    db.exec("UPDATE mem_observations SET title_fts='indexed',content_fts='segmented' WHERE id='one'");
    expect(matches("alpha")).toBe(0);
    expect(matches("after")).toBe(0);
    expect(matches("indexed")).toBe(1);
    expect(matches("segmented")).toBe(1);
    db.exec("DELETE FROM mem_observations WHERE id='one'");
    expect(matches("segmented")).toBe(0);
  } finally {
    db.close();
  }
});

test("current populated FTS startup succeeds while another connection owns the write lock", () => {
  const directory = mkdtempSync(join(tmpdir(), "hmem-fts-startup-"));
  const path = join(directory, "fixture.db");
  const db = new Database(path);
  const writer = new Database(path);
  try {
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=20;
      CREATE TABLE mem_observations(id TEXT PRIMARY KEY, title TEXT, content_redacted TEXT, title_fts TEXT, content_fts TEXT)`);
    expect(initFtsIndex(db)).toBe(true);
    db.exec("INSERT INTO mem_observations(id,title,content_redacted) VALUES ('one','title','searchable')");
    const version = db.query("PRAGMA schema_version").get();
    writer.exec("BEGIN IMMEDIATE");
    expect(initFtsIndex(db)).toBe(true);
    expect(db.query("PRAGMA schema_version").get()).toEqual(version);
    expect(db.query("SELECT observation_id FROM mem_observations_fts WHERE mem_observations_fts MATCH 'searchable'").get())
      .toEqual({ observation_id: "one" });
  } finally {
    if (writer.inTransaction) writer.exec("ROLLBACK");
    writer.close(); db.close(); rmSync(directory, { recursive: true, force: true });
  }
});

test("FTS startup repairs outdated and missing triggers, then leaves the schema unchanged", () => {
  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE mem_observations(id TEXT PRIMARY KEY, title TEXT, content_redacted TEXT, title_fts TEXT, content_fts TEXT)`);
    expect(initFtsIndex(db)).toBe(true);
    db.exec(`INSERT INTO mem_observations(id,title,content_redacted) VALUES ('one','title','before');
      DROP TRIGGER mem_observations_ad; DROP TRIGGER mem_observations_au;
      CREATE TRIGGER mem_observations_au AFTER UPDATE ON mem_observations BEGIN SELECT 1; END`);
    expect(initFtsIndex(db)).toBe(true);
    const version = db.query("PRAGMA schema_version").get();
    expect(initFtsIndex(db)).toBe(true);
    expect(db.query("PRAGMA schema_version").get()).toEqual(version);
    db.exec("UPDATE mem_observations SET content_redacted='after' WHERE id='one'");
    expect(db.query("SELECT observation_id FROM mem_observations_fts WHERE mem_observations_fts MATCH 'after'").get())
      .toEqual({ observation_id: "one" });
    db.exec("DELETE FROM mem_observations WHERE id='one'");
    expect(db.query("SELECT rowid FROM mem_observations_fts LIMIT 1").get()).toBeNull();
  } finally { db.close(); }
});
