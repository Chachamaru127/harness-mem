import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  arbitrateContentDedupeClaim,
  contentDedupeProtectionMask,
} from "../../src/core/content-dedupe-claims";
import { createTestDb } from "./test-helpers";
import { configureDatabase, initSchema, migrateSchema } from "../../src/db/schema";

describe("content dedupe claim projection", () => {
  test("single-statement arbitration reports claim, duplicate, replacement, protection, and project mismatch", () => {
    const db = createTestDb();
    try {
      const first = arbitrateContentDedupeClaim(db, {
        hash: "outcome-hash", observationId: "old", project: "p",
        expiresAt: "2020-01-01T00:00:00.000Z", protectionMask: 0,
        now: "2019-01-01T00:00:00.000Z",
      });
      expect(first.outcome).toBe("claimed");
      expect(arbitrateContentDedupeClaim(db, {
        hash: "outcome-hash", observationId: "duplicate", project: "p",
        expiresAt: null, protectionMask: 0, now: "2019-01-02T00:00:00.000Z",
      }).outcome).toBe("duplicate");
      const replacement = arbitrateContentDedupeClaim(db, {
        hash: "outcome-hash", observationId: "new", project: "p",
        expiresAt: null, protectionMask: 0, now: "2026-01-01T00:00:00.000Z",
      });
      expect(replacement).toMatchObject({
        outcome: "replacement", canonical_observation_id: "new",
        displaced_observation_id: "old", generation: 2,
      });
      expect(arbitrateContentDedupeClaim(db, {
        hash: "outcome-hash", observationId: "foreign", project: "other",
        expiresAt: null, protectionMask: 0, now: "2027-01-01T00:00:00.000Z",
      }).outcome).toBe("project_mismatch");

      arbitrateContentDedupeClaim(db, {
        hash: "protected-hash", observationId: "protected", project: "p",
        expiresAt: "2020-01-01T00:00:00.000Z",
        protectionMask: contentDedupeProtectionMask(["secret"], []),
        now: "2019-01-01T00:00:00.000Z",
      });
      expect(arbitrateContentDedupeClaim(db, {
        hash: "protected-hash", observationId: "blocked", project: "p",
        expiresAt: null, protectionMask: 0, now: "2026-01-01T00:00:00.000Z",
      }).outcome).toBe("protected_expired");
    } finally {
      db.close();
    }
  });

  test("direct observation archive, restore, metadata update, and delete keep claims synchronized", () => {
    const db = createTestDb();
    try {
      const now = "2026-08-19T00:00:00.000Z";
      db.query(`INSERT INTO mem_sessions(session_id, platform, project, started_at, created_at, updated_at)
        VALUES ('direct-session', 'test', 'p', ?, ?, ?)`)
        .run(now, now, now);
      db.query(`INSERT INTO mem_observations(
        id, platform, project, session_id, content, content_redacted,
        content_dedupe_hash, tags_json, privacy_tags_json, created_at, updated_at
      ) VALUES ('direct', 'test', 'p', 'direct-session', 'c', 'c', 'direct-hash', '[]', '[]', ?, ?)`)
        .run(now, now);
      expect(db.query<{ canonical_observation_id: string }, []>(
        "SELECT canonical_observation_id FROM mem_content_dedupe_claims WHERE content_dedupe_hash = 'direct-hash'",
      ).get()?.canonical_observation_id).toBe("direct");

      db.exec("UPDATE mem_observations SET privacy_tags_json = '[\"private\"]' WHERE id = 'direct'");
      expect(db.query<{ protection_mask: number }, []>(
        "SELECT protection_mask FROM mem_content_dedupe_claims WHERE content_dedupe_hash = 'direct-hash'",
      ).get()?.protection_mask).toBe(1);
      db.exec("UPDATE mem_observations SET archived_at = '2026-08-20T00:00:00.000Z' WHERE id = 'direct'");
      expect(db.query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM mem_content_dedupe_claims WHERE content_dedupe_hash = 'direct-hash'",
      ).get()?.count).toBe(0);
      db.exec("UPDATE mem_observations SET archived_at = NULL WHERE id = 'direct'");
      expect(db.query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM mem_content_dedupe_claims WHERE content_dedupe_hash = 'direct-hash'",
      ).get()?.count).toBe(1);
      db.exec("DELETE FROM mem_observations WHERE id = 'direct'");
      expect(db.query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM mem_content_dedupe_claims WHERE content_dedupe_hash = 'direct-hash'",
      ).get()?.count).toBe(0);
    } finally {
      db.close();
    }
  });

  test("trigger validation rejects non-string elements and SQL mask matches trimmed union semantics", () => {
    const db = createTestDb();
    try {
      const now = "2026-08-19T00:00:00.000Z";
      db.query(`INSERT INTO mem_sessions(session_id, platform, project, started_at, created_at, updated_at)
        VALUES ('mask-session', 'test', 'p', ?, ?, ?)`)
        .run(now, now, now);
      const insert = db.query(`INSERT INTO mem_observations(
        id, platform, project, session_id, content, content_redacted,
        content_dedupe_hash, tags_json, privacy_tags_json, created_at, updated_at
      ) VALUES (?, 'test', 'p', 'mask-session', ?, ?, ?, ?, ?, ?, ?)`);

      for (const [id, privacy, tags, expected] of [
        ["mask-private-tags", "[]", "[\"  private  \"]", 1],
        ["mask-secret-privacy", "[\" SECRET \"]", "[]", 2],
        ["mask-sensitive-tags", "[]", "[\" sensitive \"]", 4],
        ["mask-hold-privacy", "[\" legal_hold \"]", "[]", 8],
        ["mask-union", "[\" private \",\"sensitive\"]", "[\"secret\",\" legal_hold \"]", 15],
        ["mask-js-whitespace", JSON.stringify(["\tprivate\n", "\u00a0secret\u00a0"]), JSON.stringify(["\rsensitive\r", "\u3000legal_hold\u3000"]), 15],
      ] as const) {
        insert.run(id, id, id, `${id}-hash`, tags, privacy, now, now);
        expect(db.query<{ protection_mask: number }, [string]>(
          "SELECT protection_mask FROM mem_content_dedupe_claims WHERE content_dedupe_hash = ?",
        ).get(`${id}-hash`)?.protection_mask).toBe(expected);
      }

      for (const [privacy, tags] of [["[1]", "[]"], ["[]", "[null]"], ["[]", "[{}]"]] as const) {
        expect(() => insert.run(
          `invalid-${privacy}-${tags}`, "bad", "bad", `invalid-${privacy}-${tags}-hash`,
          tags, privacy, now, now,
        )).toThrow();
      }
      expect(() => db.exec(
        "UPDATE mem_observations SET privacy_tags_json = '[null]' WHERE id = 'mask-private-tags'",
      )).toThrow();
      expect(db.query<{ privacy_tags_json: string }, []>(
        "SELECT privacy_tags_json FROM mem_observations WHERE id = 'mask-private-tags'",
      ).get()?.privacy_tags_json).toBe("[]");
    } finally {
      db.close();
    }
  });

  test("a fault rolls claim arbitration back with the surrounding immediate transaction", () => {
    const db = createTestDb();
    try {
      const transaction = db.transaction(() => {
        arbitrateContentDedupeClaim(db, {
          hash: "rollback-hash", observationId: "rollback", project: "p",
          expiresAt: null, protectionMask: 0, now: "2026-08-19T00:00:00.000Z",
        });
        throw new Error("fault after claim");
      });
      expect(() => transaction.immediate()).toThrow("fault after claim");
      expect(db.query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM mem_content_dedupe_claims WHERE content_dedupe_hash = 'rollback-hash'",
      ).get()?.count).toBe(0);
    } finally {
      db.close();
    }
  });

  test("two processes serialize on BEGIN IMMEDIATE and return the held canonical claim", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hmem-claim-race-"));
    const dbPath = join(dir, "memory.db");
    const db = new Database(dbPath);
    configureDatabase(db);
    initSchema(db);
    migrateSchema(db);
    let transactionOpen = false;
    try {
      db.exec("BEGIN IMMEDIATE");
      transactionOpen = true;
      arbitrateContentDedupeClaim(db, {
        hash: "process-race-hash", observationId: "held-canonical", project: "p",
        expiresAt: null, protectionMask: 0, now: "2026-08-19T00:00:00.000Z",
      });
      const moduleUrl = new URL("../../src/core/content-dedupe-claims.ts", import.meta.url).href;
      const child = Bun.spawn([
        process.execPath,
        "-e",
        `import { Database } from "bun:sqlite";
         import { arbitrateContentDedupeClaim } from ${JSON.stringify(moduleUrl)};
         const db = new Database(process.argv[1]);
         db.exec("PRAGMA busy_timeout=5000");
         const started = Date.now();
         const result = arbitrateContentDedupeClaim(db, {
           hash: "process-race-hash", observationId: "racing-candidate", project: "p",
           expiresAt: null, protectionMask: 0, now: "2026-08-19T00:00:01.000Z"
         });
         console.log(JSON.stringify({ result, waited_ms: Date.now() - started }));
         db.close();`,
        dbPath,
      ], { stdout: "pipe", stderr: "pipe" });
      await Bun.sleep(100);
      expect(child.exitCode).toBeNull();
      db.exec("COMMIT");
      transactionOpen = false;
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      const payload = JSON.parse(stdout) as {
        result: { outcome: string; canonical_observation_id: string };
        waited_ms: number;
      };
      expect(payload.result).toMatchObject({
        outcome: "duplicate",
        canonical_observation_id: "held-canonical",
      });
      expect(payload.waited_ms).toBeGreaterThanOrEqual(75);
    } finally {
      if (transactionOpen) db.exec("ROLLBACK");
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("claim lookup uses the WITHOUT ROWID primary key", () => {
    const db = createTestDb();
    try {
      const plan = db.query<{ detail: string }, [string]>(
        "EXPLAIN QUERY PLAN SELECT canonical_observation_id FROM mem_content_dedupe_claims WHERE content_dedupe_hash = ?",
      ).all("plan-hash").map((row) => row.detail).join(" ");
      expect(plan).toContain("SEARCH mem_content_dedupe_claims USING PRIMARY KEY");
    } finally {
      db.close();
    }
  });
});
