/**
 * S154-511: granite backfill CLI smoke (spawned subprocess).
 *
 * The real-model run loads onnxruntime, which crashes the bun test runner, so
 * the resumable batch core is unit-tested with a fake provider
 * (tests/unit/granite-backfill.test.ts). This integration test exercises the
 * script's wiring on the safe `--dry-run` path: it must open the DB, count the
 * target observations, and emit the verification-shaped JSON without loading the
 * model or writing any vectors.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(import.meta.dir, "../../..");
const cleanup: string[] = [];
afterEach(() => {
  while (cleanup.length > 0) {
    const dir = cleanup.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeFixtureDb(rows: number): string {
  const dir = mkdtempSync(join(tmpdir(), "granite-backfill-script-"));
  cleanup.push(dir);
  const dbPath = join(dir, "harness-mem.db");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE mem_observations (
      id TEXT PRIMARY KEY, content_redacted TEXT NOT NULL,
      archived_at TEXT, expires_at TEXT, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE mem_vectors (
      observation_id TEXT NOT NULL, model TEXT NOT NULL, dimension INTEGER NOT NULL,
      vector_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(observation_id, model)
    );
    CREATE TABLE mem_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
  for (let i = 0; i < rows; i += 1) {
    db.query(
      "INSERT INTO mem_observations(id, content_redacted, created_at, updated_at) VALUES (?, ?, ?, ?)",
    ).run(`o${i}`, `fixture content ${i}`, "2026-06-12T00:00:00.000Z", "2026-06-12T00:00:00.000Z");
  }
  db.close();
  return dbPath;
}

describe("S154-511 granite backfill CLI", () => {
  test("--dry-run reports the target set and writes no vectors", async () => {
    const dbPath = makeFixtureDb(3);
    const proc = Bun.spawn(
      [process.execPath, "run", join(ROOT, "scripts/s154-granite-backfill.ts"), "--db", dbPath, "--dry-run"],
      { cwd: ROOT, stdout: "pipe", stderr: "pipe" },
    );
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    expect(`stdout=${stdout}\nstderr=${stderr}`).toContain("local:granite-embedding-311m-r2");
    expect(exitCode).toBe(0);

    const report = JSON.parse(stdout) as {
      target_model: string;
      dimension: number;
      target_observations: number;
      granite_rows: number;
      dry_run: boolean;
    };
    expect(report.target_model).toBe("local:granite-embedding-311m-r2");
    expect(report.dimension).toBe(384);
    expect(report.target_observations).toBe(3);
    expect(report.granite_rows).toBe(0);
    expect(report.dry_run).toBe(true);

    // dry-run must not have written any granite vectors to the fixture DB
    const db = new Database(dbPath);
    const n = (
      db.query("SELECT COUNT(*) AS n FROM mem_vectors WHERE model = ?").get("local:granite-embedding-311m-r2") as {
        n: number;
      }
    ).n;
    db.close();
    expect(n).toBe(0);
  }, 60_000);
});
