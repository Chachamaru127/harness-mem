/**
 * S154-512 fix regression: custom-sqlite preflight + busy_timeout wiring in
 * scripts/s154-granite-backfill.ts (commit 5530f7a).
 *
 * Uses :memory: / mktemp temp DBs and a fake embedder only — never touches the
 * live ~/.harness-mem/harness-mem.db or loads ONNX models.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  runGraniteBackfill,
  GRANITE_BACKFILL_MODEL,
  GRANITE_BACKFILL_DIMENSION,
  type BackfillEmbedBatch,
} from "../memory-server/src/core/granite-backfill";
import {
  configureBunCustomSqliteForSqliteVec,
  getCustomSqlitePreflightState,
  resetCustomSqlitePreflightForTests,
} from "../memory-server/src/db/custom-sqlite-preflight";
import {
  GRANITE_BACKFILL_BUSY_TIMEOUT_MS,
  loadSqliteVec,
  openGraniteBackfillDatabase,
  runCustomSqlitePreflightIfNeeded,
} from "./s154-granite-backfill";

const cleanupDirs: string[] = [];

beforeEach(() => {
  resetCustomSqlitePreflightForTests();
});

afterEach(() => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function readBusyTimeoutMs(db: Database): number {
  return (db.query("PRAGMA busy_timeout").get() as { timeout: number }).timeout;
}

function makeSchemaDb(db: Database): void {
  db.exec(`
    CREATE TABLE mem_observations (
      id TEXT PRIMARY KEY,
      content_redacted TEXT NOT NULL,
      raw_text TEXT DEFAULT NULL,
      archived_at TEXT DEFAULT NULL,
      expires_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE mem_vectors (
      observation_id TEXT NOT NULL,
      model TEXT NOT NULL,
      dimension INTEGER NOT NULL,
      vector_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(observation_id, model)
    );
    CREATE TABLE mem_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
}

function seedObservation(db: Database, id: string, content: string): void {
  db.query(
    "INSERT INTO mem_observations(id, content_redacted, created_at, updated_at) VALUES (?, ?, ?, ?)",
  ).run(id, content, "2026-06-12T00:00:00.000Z", "2026-06-12T00:00:00.000Z");
}

function makeFakeEmbed(): BackfillEmbedBatch {
  return async (texts) =>
    texts.map((text) => {
      const vec = new Array<number>(GRANITE_BACKFILL_DIMENSION).fill(0);
      for (let i = 0; i < text.length; i += 1) {
        vec[i % GRANITE_BACKFILL_DIMENSION] += text.charCodeAt(i);
      }
      const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0)) || 1;
      return vec.map((v) => v / norm);
    });
}

function countGraniteMemVectors(db: Database): number {
  return (
    db
      .query("SELECT COUNT(*) AS n FROM mem_vectors WHERE model = ? AND dimension = ?")
      .get(GRANITE_BACKFILL_MODEL, GRANITE_BACKFILL_DIMENSION) as { n: number }
  ).n;
}

function countGraniteSidecarMapRows(db: Database): number {
  return (
    db.query("SELECT COUNT(*) AS n FROM mem_vectors_vec_map_local_granite_embedding_311m_r2").get() as {
      n: number;
    }
  ).n;
}

function probeRealSqliteVecAvailable(): boolean {
  resetCustomSqlitePreflightForTests();
  configureBunCustomSqliteForSqliteVec();
  const db = new Database(":memory:");
  try {
    return loadSqliteVec(db);
  } finally {
    db.close();
  }
}

const sqliteVecAvailable = probeRealSqliteVecAvailable();

describe("S154-512 granite backfill CLI 512-fix regression", () => {
  test("openGraniteBackfillDatabase sets PRAGMA busy_timeout to 30000", () => {
    const db = openGraniteBackfillDatabase(":memory:", false);
    try {
      expect(readBusyTimeoutMs(db)).toBe(GRANITE_BACKFILL_BUSY_TIMEOUT_MS);
      expect(GRANITE_BACKFILL_BUSY_TIMEOUT_MS).toBe(30_000);
    } finally {
      db.close();
    }
  });

  test("dry-run skips custom-sqlite preflight", () => {
    expect(runCustomSqlitePreflightIfNeeded(true)).toBeNull();
    expect(getCustomSqlitePreflightState().attempted).toBe(false);
  });

  test("real-run path invokes configureBunCustomSqliteForSqliteVec", () => {
    resetCustomSqlitePreflightForTests();
    const expected = configureBunCustomSqliteForSqliteVec();
    resetCustomSqlitePreflightForTests();
    const fromHelper = runCustomSqlitePreflightIfNeeded(false);
    expect(fromHelper).toEqual(expected);
  });

  test.skipIf(!sqliteVecAvailable)(
    "vec0 sidecar map row count matches granite mem_vectors after backfill",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "granite-backfill-512fix-"));
      cleanupDirs.push(dir);
      const dbPath = join(dir, "harness-mem.db");
      // Homebrew custom sqlite + explicit readwrite flags require the file to exist first.
      writeFileSync(dbPath, "");

      resetCustomSqlitePreflightForTests();
      configureBunCustomSqliteForSqliteVec();
      const db = openGraniteBackfillDatabase(dbPath, false);
      try {
        expect(loadSqliteVec(db)).toBe(true);
        makeSchemaDb(db);
        for (let i = 0; i < 4; i += 1) {
          seedObservation(db, `o${i}`, `parity content ${i}`);
        }

        const result = await runGraniteBackfill({
          db,
          embedBatch: makeFakeEmbed(),
          sqliteVecAvailable: true,
          batchSize: 2,
          verifySampleSize: 2,
          cosineThreshold: 0.999,
        });

        expect(result.completed).toBe(true);
        expect(result.verification.passed).toBe(true);
        expect(result.verification.sqlite_vec_available).toBe(true);

        const memVectorRows = countGraniteMemVectors(db);
        const sidecarMapRows = countGraniteSidecarMapRows(db);
        expect(memVectorRows).toBe(4);
        expect(sidecarMapRows).toBe(memVectorRows);
      } finally {
        db.close();
      }
    },
    60_000,
  );
});
