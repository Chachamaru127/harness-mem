import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configureDatabase,
  initSchema,
  migrateSchema,
  recallGenerationsReady,
} from "../../src/db/schema";
import { readRecallDataWatermark } from "../../src/recall/projection";

const dbs: Database[] = [];

function createDb(): Database {
  const db = new Database(":memory:");
  dbs.push(db);
  configureDatabase(db);
  initSchema(db);
  migrateSchema(db);
  return db;
}

function seedObservation(
  db: Database,
  id: string,
  project = "watermark-project",
  sessionId = "watermark-session",
): void {
  const now = "2026-08-20T00:00:00.000Z";
  db.query(`INSERT OR IGNORE INTO mem_sessions(
    session_id, platform, project, started_at, created_at, updated_at
  ) VALUES (?, 'test', ?, ?, ?, ?)`).run(sessionId, project, now, now, now);
  db.query(`INSERT INTO mem_observations(
    id, platform, project, session_id, title, content, content_redacted,
    tags_json, privacy_tags_json, created_at, updated_at
  ) VALUES (?, 'test', ?, ?, ?, ?, ?, '[]', '[]', ?, ?)`)
    .run(id, project, sessionId, id, `content-${id}`, `content-${id}`, now, now);
}

function generation(
  db: Database,
  scopeType: "project" | "session" | "retrieval_aux",
  project = "",
  sessionId = "",
): number {
  return Number(db.query<{ generation: number }, [string, string, string]>(`
    SELECT generation FROM mem_recall_generations
    WHERE scope_type = ? AND project = ? AND session_id = ?
  `).get(scopeType, project, sessionId)?.generation ?? 0);
}

afterEach(() => {
  while (dbs.length > 0) dbs.pop()?.close();
});

describe("O(1) recall generation watermark", () => {
  test("first migration publishes a zero baseline without scanning existing observation scopes", () => {
    const db = new Database(":memory:");
    dbs.push(db);
    configureDatabase(db);
    initSchema(db);
    seedObservation(db, "obs-existing");

    migrateSchema(db);

    expect(recallGenerationsReady(db)).toBe(true);
    expect(generation(db, "project", "watermark-project")).toBe(0);
    expect(generation(db, "session", "", "watermark-session")).toBe(0);
    expect(generation(db, "retrieval_aux")).toBe(1);
    const baseline = readRecallDataWatermark(db, {
      project: "watermark-project",
      sessionId: "watermark-session",
    });
    db.exec("UPDATE mem_observations SET title = 'changed' WHERE id = 'obs-existing'");
    expect(readRecallDataWatermark(db, {
      project: "watermark-project",
      sessionId: "watermark-session",
    })).not.toBe(baseline);
  });

  test("migration publishes project, session, and global auxiliary generations atomically", () => {
    const db = createDb();
    expect(recallGenerationsReady(db)).toBe(true);
    expect(generation(db, "retrieval_aux")).toBeGreaterThan(0);

    const meta = db.query<{ key: string; value: string }, []>(`
      SELECT key, value FROM mem_meta WHERE key LIKE 'recall_generations.%' ORDER BY key
    `).all();
    expect(meta).toEqual([
      { key: "recall_generations.readiness", value: "ready" },
      { key: "recall_generations.version", value: "2" },
    ]);

    const plan = db.query<{
      detail: string;
    }, [string, string]>(`EXPLAIN QUERY PLAN
      SELECT scope_type, generation
      FROM mem_recall_generations
      WHERE (scope_type = 'retrieval_aux' AND project = '' AND session_id = '')
         OR (scope_type = 'project' AND project = ? AND session_id = '')
         OR (scope_type = 'session' AND project = '' AND session_id = ?)
    `).all("watermark-project", "watermark-session");
    expect(plan.map((row) => row.detail).join("\n")).toContain("SEARCH mem_recall_generations");
    expect(plan.map((row) => row.detail).join("\n")).not.toContain("mem_observations");
  });

  test("observation retrieval mutations bump project/session generations but access bookkeeping does not", () => {
    const db = createDb();
    seedObservation(db, "obs-watermark");
    const projectBefore = generation(db, "project", "watermark-project");
    const sessionBefore = generation(db, "session", "", "watermark-session");
    const auxBefore = generation(db, "retrieval_aux");
    const watermarkBefore = readRecallDataWatermark(db, {
      project: "watermark-project",
      sessionId: "watermark-session",
    });
    const sessionOnlyWatermarkBefore = readRecallDataWatermark(db, {
      sessionId: "watermark-session",
    });

    db.query(`UPDATE mem_observations
      SET access_count = access_count + 1, last_accessed_at = ?
      WHERE id = 'obs-watermark'`).run("2026-08-20T00:01:00.000Z");
    expect(generation(db, "project", "watermark-project")).toBe(projectBefore);
    expect(generation(db, "session", "", "watermark-session")).toBe(sessionBefore);
    expect(generation(db, "retrieval_aux")).toBe(auxBefore);
    expect(readRecallDataWatermark(db, {
      project: "watermark-project",
      sessionId: "watermark-session",
    })).toBe(watermarkBefore);

    db.exec(`UPDATE mem_observations SET content_redacted = 'changed retrieval content'
      WHERE id = 'obs-watermark'`);
    expect(generation(db, "project", "watermark-project")).toBe(projectBefore + 1);
    expect(generation(db, "session", "", "watermark-session")).toBe(sessionBefore + 1);
    expect(readRecallDataWatermark(db, {
      project: "watermark-project",
      sessionId: "watermark-session",
    })).not.toBe(watermarkBefore);
    expect(readRecallDataWatermark(db, {
      sessionId: "watermark-session",
    })).not.toBe(sessionOnlyWatermarkBefore);
  });

  test("moving and deleting observations invalidate the old and new scopes", () => {
    const db = createDb();
    seedObservation(db, "obs-move", "project-old", "session-old");
    const oldProject = generation(db, "project", "project-old");
    const oldSession = generation(db, "session", "", "session-old");
    db.exec(`INSERT INTO mem_sessions(
      session_id, platform, project, started_at, created_at, updated_at
    ) VALUES ('session-new', 'test', 'project-new',
      '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z')`);

    db.exec(`UPDATE mem_observations
      SET project = 'project-new', session_id = 'session-new'
      WHERE id = 'obs-move'`);
    expect(generation(db, "project", "project-old")).toBe(oldProject + 1);
    expect(generation(db, "session", "", "session-old")).toBe(oldSession + 1);
    expect(generation(db, "project", "project-new")).toBe(1);
    expect(generation(db, "session", "", "session-new")).toBe(1);

    db.exec(`DELETE FROM mem_observations WHERE id = 'obs-move'`);
    expect(generation(db, "project", "project-new")).toBe(2);
    expect(generation(db, "session", "", "session-new")).toBe(2);
  });

  test("auxiliary retrieval mutations invalidate every scoped watermark", () => {
    const db = createDb();
    seedObservation(db, "obs-aux-a", "project-a", "session-a");
    seedObservation(db, "obs-aux-b", "project-b", "session-b");
    const aBefore = readRecallDataWatermark(db, { project: "project-a", sessionId: "session-a" });
    const bBefore = readRecallDataWatermark(db, { project: "project-b", sessionId: "session-b" });

    db.query(`INSERT INTO mem_facts(
      fact_id, observation_id, project, session_id, fact_type, fact_key, fact_value, confidence,
      valid_from, created_at, updated_at
    ) VALUES ('fact-aux', 'obs-aux-a', 'project-a', 'session-a', 'context', 'key', 'value', 1, ?, ?, ?)`)
      .run("2026-08-20T00:00:00.000Z", "2026-08-20T00:00:00.000Z", "2026-08-20T00:00:00.000Z");

    expect(readRecallDataWatermark(db, { project: "project-a", sessionId: "session-a" })).not.toBe(aBefore);
    expect(readRecallDataWatermark(db, { project: "project-b", sessionId: "session-b" })).not.toBe(bBefore);
  });

  test("not-ready metadata falls back to the legacy observation scan", () => {
    const db = createDb();
    seedObservation(db, "obs-fallback");
    db.exec(`UPDATE mem_meta SET value = 'building' WHERE key = 'recall_generations.readiness'`);
    db.exec(`UPDATE mem_recall_generations SET generation = 999999`);

    expect(recallGenerationsReady(db)).toBe(false);
    expect(readRecallDataWatermark(db, { project: "watermark-project" }))
      .toBe("1:2026-08-20T00:00:00.000Z");
  });

  test("a missing trigger revokes readiness until one atomic migration repairs the projection", () => {
    const db = createDb();
    seedObservation(db, "obs-repair");
    const projectBefore = generation(db, "project", "watermark-project");
    const sessionBefore = generation(db, "session", "", "watermark-session");
    const auxBefore = generation(db, "retrieval_aux");
    db.exec("DROP TRIGGER mem_observations_recall_generation_ai");
    expect(recallGenerationsReady(db)).toBe(false);

    migrateSchema(db);
    expect(recallGenerationsReady(db)).toBe(true);
    expect(generation(db, "project", "watermark-project")).toBe(projectBefore);
    expect(generation(db, "session", "", "watermark-session")).toBe(sessionBefore);
    expect(generation(db, "retrieval_aux")).toBe(auxBefore + 1);
  });

  test("a waiting process rechecks readiness under the write lock without resetting a concurrent generation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hmem-recall-generation-race-"));
    const dbPath = join(dir, "memory.db");
    const markerPath = join(dir, "child-observed-not-ready");
    const db = new Database(dbPath);
    configureDatabase(db);
    initSchema(db);
    migrateSchema(db);
    seedObservation(db, "obs-race");
    let transactionOpen = false;
    try {
      db.exec("UPDATE mem_meta SET value = 'building' WHERE key = 'recall_generations.readiness'");
      expect(recallGenerationsReady(db)).toBe(false);

      db.exec("BEGIN IMMEDIATE");
      transactionOpen = true;
      db.exec("UPDATE mem_meta SET value = 'ready' WHERE key = 'recall_generations.readiness'");
      const schemaUrl = new URL("../../src/db/schema.ts", import.meta.url).href;
      const child = Bun.spawn([
        process.execPath,
        "-e",
        `import { Database } from "bun:sqlite";
         import { writeFileSync } from "node:fs";
         import { migrateRecallGenerations, recallGenerationsReady } from ${JSON.stringify(schemaUrl)};
         const db = new Database(process.argv[1]);
         db.exec("PRAGMA busy_timeout=5000");
         if (recallGenerationsReady(db)) throw new Error("expected not-ready snapshot");
         writeFileSync(process.argv[2], "ready");
         const started = Date.now();
         migrateRecallGenerations(db);
         console.log(JSON.stringify({ waited_ms: Date.now() - started }));
         db.close();`,
        dbPath,
        markerPath,
      ], { stdout: "pipe", stderr: "pipe" });

      const markerDeadline = Date.now() + 2_000;
      while (!existsSync(markerPath) && Date.now() < markerDeadline) await Bun.sleep(10);
      expect(existsSync(markerPath)).toBe(true);
      expect(child.exitCode).toBeNull();
      db.exec("UPDATE mem_observations SET title = 'published by authoritative migrator' WHERE id = 'obs-race'");
      const publishedWatermark = readRecallDataWatermark(db, {
        project: "watermark-project",
        sessionId: "watermark-session",
      });
      const publishedAux = generation(db, "retrieval_aux");
      db.exec("COMMIT");
      transactionOpen = false;

      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect((JSON.parse(stdout) as { waited_ms: number }).waited_ms).toBeGreaterThanOrEqual(0);
      expect(readRecallDataWatermark(db, {
        project: "watermark-project",
        sessionId: "watermark-session",
      })).toBe(publishedWatermark);
      expect(generation(db, "retrieval_aux")).toBe(publishedAux);
    } finally {
      if (transactionOpen) db.exec("ROLLBACK");
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
