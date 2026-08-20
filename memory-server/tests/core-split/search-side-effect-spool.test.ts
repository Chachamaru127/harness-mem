import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { configureDatabase, initSchema, migrateSchema } from "../../src/db/schema";
import {
  flushSearchSideEffectSpool,
  SearchAuditBackpressureError,
  SearchSideEffectSpool,
  searchSideEffectSpoolPath,
  type SearchSideEffectIntent,
} from "../../src/core/search-side-effect-spool";
import { insertTestObservation } from "./test-helpers";
import { createTestConfig } from "./test-helpers";
import { HarnessMemCore } from "../../src/core/harness-mem-core";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeDb(): { db: Database; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "harness-mem-search-side-effects-"));
  dirs.push(dir);
  const dbPath = join(dir, "memory.db");
  const db = new Database(dbPath);
  configureDatabase(db);
  initSchema(db);
  migrateSchema(db);
  return { db, dbPath };
}

function intent(marker: string, observationId?: string): SearchSideEffectIntent {
  return {
    audits: [{
      action: "read.search",
      target_type: "project",
      target_id: `/private/project/${marker}`,
      details: {
        query: `private-query-${marker}`,
        limit: 1,
        include_private: false,
        count: observationId ? 1 : 0,
        privacy_excluded_count: 0,
        boundary_excluded_count: 0,
      },
    }],
    access_count_ids: observationId ? [observationId] : [],
    created_at: "2026-08-20T00:00:00.000Z",
  };
}

describe("search side-effect spool", () => {
  test("persists FIFO intents in a mode-0600 synchronous sidecar", () => {
    const { db, dbPath } = makeDb();
    const spool = new SearchSideEffectSpool(dbPath);
    try {
      spool.append(intent("first"));
      spool.append(intent("second"));
      expect(statSync(searchSideEffectSpoolPath(dbPath)).mode & 0o777).toBe(0o600);
      const spoolFiles = readdirSync(dirname(dbPath)).filter((name) => name.includes("search-side-effects.sqlite"));
      expect(spoolFiles.length).toBeGreaterThan(0);
      for (const file of spoolFiles) {
        expect(statSync(join(dirname(dbPath), file)).mode & 0o077).toBe(0);
      }
      expect(spool.loadBatch(10).map((row) => row.audits[0]?.details.query)).toEqual([
        "private-query-first",
        "private-query-second",
      ]);
    } finally {
      spool.close();
      db.close();
    }
  });

  test("rejects non-allowlisted or nested audit details before durable append", () => {
    const { db, dbPath } = makeDb();
    const spool = new SearchSideEffectSpool(dbPath);
    try {
      const extraKey = intent("extra-key");
      extraKey.audits[0]!.details.unexpected = "value";
      expect(() => spool.append(extraKey)).toThrow(SearchAuditBackpressureError);

      const nestedValue = intent("nested-value");
      nestedValue.audits[0]!.details.query = { raw: "nested" };
      expect(() => spool.append(nestedValue)).toThrow(SearchAuditBackpressureError);

      const wrongActionShape = intent("wrong-action");
      wrongActionShape.audits[0] = {
        action: "search_hit",
        target_type: "observation",
        target_id: "observation-id",
        details: { query: "query", project: "project", count: 1 },
      };
      expect(() => spool.append(wrongActionShape)).toThrow(SearchAuditBackpressureError);
      expect(spool.count()).toBe(0);
    } finally {
      spool.close();
      db.close();
    }
  });

  test("rejects non-allowlisted audit details when reading a persisted spool row", () => {
    const { db, dbPath } = makeDb();
    const spool = new SearchSideEffectSpool(dbPath);
    spool.close();
    const rawSpool = new Database(searchSideEffectSpoolPath(dbPath));
    rawSpool.query(`
      INSERT INTO search_side_effect_intents(intent_id, payload_json, created_at)
      VALUES (?, ?, ?)
    `).run("tampered-intent", JSON.stringify({
      ...intent("tampered"),
      audits: [{
        action: "read.search",
        target_type: "project",
        target_id: "project",
        details: { query: "query", nested: { private: true } },
      }],
    }), "2026-08-20T00:00:00.000Z");
    rawSpool.close();

    const reader = new SearchSideEffectSpool(dbPath);
    try {
      expect(() => reader.loadBatch(10)).toThrow(SearchAuditBackpressureError);
    } finally {
      reader.close();
      db.close();
    }
  });

  test("bounded spool fails closed with a fixed privacy-safe error", () => {
    const { db, dbPath } = makeDb();
    const spool = new SearchSideEffectSpool(dbPath, 1);
    try {
      spool.append(intent("first-secret"));
      let failure: unknown;
      try { spool.append(intent("second-secret")); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(SearchAuditBackpressureError);
      expect((failure as SearchAuditBackpressureError).code).toBe("audit_backpressure");
      expect(String(failure)).not.toContain("secret");
      expect(String(failure)).not.toContain(dbPath);
    } finally {
      spool.close();
      db.close();
    }
  });

  test("claim makes commit-before-spool-delete crash replay idempotent", () => {
    const { db, dbPath } = makeDb();
    insertTestObservation(db, {
      id: "search-hit-observation",
      project: "search-side-effect-project",
      content: "durable search hit",
    });
    const spool = new SearchSideEffectSpool(dbPath);
    spool.append(intent("crash-replay", "search-hit-observation"));
    spool.close();

    expect(() => flushSearchSideEffectSpool(db, dbPath, 10, {
      afterApply: () => { throw new Error("simulated crash after main commit"); },
    })).toThrow("simulated crash");
    expect((db.query("SELECT access_count FROM mem_observations WHERE id = ?").get("search-hit-observation") as { access_count: number }).access_count).toBe(1);

    const replay = flushSearchSideEffectSpool(db, dbPath);
    expect(replay).toEqual({ intents_applied: 0, intents_replayed: 1, intents_remaining: 0 });
    expect((db.query("SELECT access_count FROM mem_observations WHERE id = ?").get("search-hit-observation") as { access_count: number }).access_count).toBe(1);
    expect((db.query("SELECT COUNT(*) AS count FROM mem_audit_log WHERE action = 'read.search'").get() as { count: number }).count).toBe(1);
    db.close();
  });

  test("a flush applies a true batch in one main transaction before sidecar deletion", () => {
    const { db, dbPath } = makeDb();
    const spool = new SearchSideEffectSpool(dbPath);
    for (let index = 0; index < 5; index += 1) spool.append(intent(`batch-${index}`));
    spool.close();

    let hooks = 0;
    expect(() => flushSearchSideEffectSpool(db, dbPath, 5, {
      afterApply: () => {
        hooks += 1;
        if (hooks === 1) throw new Error("simulated crash after batch commit");
      },
    })).toThrow("simulated crash after batch commit");
    expect((db.query("SELECT COUNT(*) AS count FROM mem_audit_log WHERE action = 'read.search'").get() as { count: number }).count).toBe(5);

    const replay = flushSearchSideEffectSpool(db, dbPath, 5);
    expect(replay).toEqual({ intents_applied: 0, intents_replayed: 5, intents_remaining: 0 });
    expect((db.query("SELECT COUNT(*) AS count FROM mem_search_side_effect_claims").get() as { count: number }).count).toBe(0);
    db.close();
  });

  test("all flush entry points cap one transaction batch at 100 intents", () => {
    const { db, dbPath } = makeDb();
    const spool = new SearchSideEffectSpool(dbPath);
    for (let index = 0; index < 101; index += 1) spool.append(intent(`bounded-${index}`));
    spool.close();

    expect(flushSearchSideEffectSpool(db, dbPath, 500)).toEqual({
      intents_applied: 100,
      intents_replayed: 0,
      intents_remaining: 1,
    });
    expect(flushSearchSideEffectSpool(db, dbPath, 500)).toEqual({
      intents_applied: 1,
      intents_replayed: 0,
      intents_remaining: 0,
    });
    db.close();
  });

  test("graceful core shutdown drains durable intents before closing the main DB", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-search-side-effect-shutdown-"));
    dirs.push(dir);
    const dbPath = join(dir, "memory.db");
    const core = new HarnessMemCore(createTestConfig({
      dbPath,
      backgroundWorkersEnabled: false,
    }));
    const spool = new SearchSideEffectSpool(dbPath);
    spool.append(intent("shutdown-drain"));
    spool.close();

    await core.shutdown("test-shutdown-drain");

    const verify = new Database(dbPath, { readonly: true });
    expect((verify.query("SELECT COUNT(*) AS count FROM mem_audit_log WHERE action = 'read.search'").get() as { count: number }).count).toBe(1);
    const remaining = new SearchSideEffectSpool(dbPath);
    expect(remaining.count()).toBe(0);
    remaining.close();
    verify.close();
  });
});
