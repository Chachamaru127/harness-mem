/**
 * S154-511: granite mrl-384 re-embed backfill core.
 *
 * Tests use a deterministic fake embedding provider (the bun test runner
 * crashes if onnxruntime is loaded in-process). The fake returns a unit vector
 * derived from a hash of the content so cosine verification is meaningful and
 * resume/idempotency are observable. Real-model smoke is the script's job.
 */

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  runGraniteBackfill,
  GRANITE_BACKFILL_MODEL,
  GRANITE_BACKFILL_DIMENSION,
  type BackfillEmbedBatch,
} from "../../src/core/granite-backfill";

const E5_MODEL = "local:multilingual-e5";

function makeDb(): Database {
  const db = new Database(":memory:");
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
  return db;
}

function seedObservation(
  db: Database,
  id: string,
  content: string,
  createdAt: string,
  updatedAt?: string,
  rawText?: string,
): void {
  db.query(
    "INSERT INTO mem_observations(id, content_redacted, raw_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, content, rawText ?? null, createdAt, updatedAt ?? createdAt);
}

/** Existing e5 vector (a different model space) — backfill must never touch it. */
function seedE5Vector(db: Database, id: string): void {
  const vec = JSON.stringify(Array.from({ length: 384 }, () => 0.123));
  db.query(
    `INSERT INTO mem_vectors(observation_id, model, dimension, vector_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, E5_MODEL, 384, vec, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
}

/** Deterministic fake: hash content into a unit vector of GRANITE dimension. */
function makeFakeEmbed(): { embed: BackfillEmbedBatch; calls: string[][] } {
  const calls: string[][] = [];
  const embed: BackfillEmbedBatch = async (texts) => {
    calls.push([...texts]);
    return texts.map((text) => {
      const vec = new Array<number>(GRANITE_BACKFILL_DIMENSION).fill(0);
      for (let i = 0; i < text.length; i += 1) {
        vec[i % GRANITE_BACKFILL_DIMENSION] += text.charCodeAt(i);
      }
      const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0)) || 1;
      return vec.map((v) => v / norm);
    });
  };
  return { embed, calls };
}

function countVectors(db: Database, model: string): number {
  return (
    db.query("SELECT COUNT(*) AS n FROM mem_vectors WHERE model = ?").get(model) as { n: number }
  ).n;
}

/** Seed a granite-model row at a non-target dimension (e.g. an old native-768 experiment). */
function seedGraniteRowAtDimension(db: Database, id: string, dimension: number): void {
  const vec = JSON.stringify(Array.from({ length: dimension }, () => 0.5));
  db.query(
    `INSERT INTO mem_vectors(observation_id, model, dimension, vector_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(observation_id, model) DO UPDATE SET
       dimension = excluded.dimension, vector_json = excluded.vector_json`,
  ).run(id, GRANITE_BACKFILL_MODEL, dimension, vec, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
}

/** Fake sqlite-vec sidecar upsert that records the (observation_id, model, dimension) it received. */
function makeFakeSqliteVecUpsert(): {
  upsert: NonNullable<Parameters<typeof runGraniteBackfill>[0]["upsertSqliteVec"]>;
  rows: Array<{ id: string; model?: string; dimension?: number }>;
} {
  const rows: Array<{ id: string; model?: string; dimension?: number }> = [];
  const upsert = (
    _db: Database,
    observationId: string,
    _vectorJson: string,
    _updatedAt: string,
    options?: { model?: string; vectorDimension?: number },
  ): boolean => {
    rows.push({ id: observationId, model: options?.model, dimension: options?.vectorDimension });
    return true;
  };
  return { upsert, rows };
}

describe("S154-511 granite backfill core", () => {
  test("re-embeds every active observation into the granite model space", async () => {
    const db = makeDb();
    for (let i = 0; i < 5; i += 1) {
      seedObservation(db, `o${i}`, `content number ${i} 日本語`, `2026-06-10T00:00:0${i}.000Z`);
    }
    const { embed } = makeFakeEmbed();

    const result = await runGraniteBackfill({ db, embedBatch: embed, batchSize: 2 });

    expect(result.target_model).toBe(GRANITE_BACKFILL_MODEL);
    expect(result.dimension).toBe(GRANITE_BACKFILL_DIMENSION);
    expect(result.target_observations).toBe(5);
    expect(result.granite_rows).toBe(5);
    expect(countVectors(db, GRANITE_BACKFILL_MODEL)).toBe(5);
    // each granite row is stored at the truncated dimension
    const dims = db
      .query("SELECT DISTINCT dimension AS d FROM mem_vectors WHERE model = ?")
      .all(GRANITE_BACKFILL_MODEL) as Array<{ d: number }>;
    expect(dims).toEqual([{ d: GRANITE_BACKFILL_DIMENSION }]);
  });

  test("embeds raw_text when present, falling back to content_redacted (live parity)", async () => {
    const db = makeDb();
    // o0 has raw_text → it must be embedded, NOT content_redacted.
    seedObservation(db, "o0", "REDACTED placeholder", "2026-06-10T00:00:00.000Z", undefined, "verbatim raw passage 日本語");
    // o1 has no raw_text → falls back to content_redacted, exactly like live.
    seedObservation(db, "o1", "redacted only content", "2026-06-10T00:00:01.000Z");
    const { embed, calls } = makeFakeEmbed();

    const result = await runGraniteBackfill({ db, embedBatch: embed, batchSize: 8 });

    // Verification re-embeds the sample too; the run-phase embed is calls[0].
    const embeddedTexts = calls[0];
    expect(embeddedTexts).toContain("verbatim raw passage 日本語");
    expect(embeddedTexts).toContain("redacted only content");
    expect(embeddedTexts).not.toContain("REDACTED placeholder");
    expect(result.verification.passed).toBe(true);
  });

  test("does not modify or delete existing e5 vectors (non-destructive)", async () => {
    const db = makeDb();
    for (let i = 0; i < 4; i += 1) {
      seedObservation(db, `o${i}`, `passage ${i}`, "2026-06-12T00:00:00.000Z");
      seedE5Vector(db, `o${i}`);
    }
    const e5Before = db
      .query("SELECT observation_id, vector_json, dimension, updated_at FROM mem_vectors WHERE model = ? ORDER BY observation_id")
      .all(E5_MODEL);
    const { embed } = makeFakeEmbed();

    await runGraniteBackfill({ db, embedBatch: embed, batchSize: 2 });

    const e5After = db
      .query("SELECT observation_id, vector_json, dimension, updated_at FROM mem_vectors WHERE model = ? ORDER BY observation_id")
      .all(E5_MODEL);
    expect(e5After).toEqual(e5Before);
    expect(countVectors(db, E5_MODEL)).toBe(4);
    expect(countVectors(db, GRANITE_BACKFILL_MODEL)).toBe(4);
  });

  test("resumes from a persisted cursor after interruption", async () => {
    const db = makeDb();
    for (let i = 0; i < 6; i += 1) {
      seedObservation(db, `o${i}`, `row ${i}`, `2026-06-12T00:00:0${i}.000Z`);
    }
    const { embed } = makeFakeEmbed();

    // first pass: stop after the first batch via maxBatches
    const partial = await runGraniteBackfill({ db, embedBatch: embed, batchSize: 2, maxBatches: 1 });
    expect(partial.granite_rows).toBe(2);
    expect(partial.completed).toBe(false);
    expect(countVectors(db, GRANITE_BACKFILL_MODEL)).toBe(2);

    // resume: a fresh call must not re-embed the first 2 and must finish the rest.
    // verifySampleSize 0 isolates the assertion to the backfill embed calls
    // (verification would otherwise re-embed a sample for the cosine check).
    const { embed: embed2, calls } = makeFakeEmbed();
    const resumed = await runGraniteBackfill({ db, embedBatch: embed2, batchSize: 2, verifySampleSize: 0 });
    expect(resumed.completed).toBe(true);
    expect(countVectors(db, GRANITE_BACKFILL_MODEL)).toBe(6);
    // resume only embedded the remaining 4 (no rework of already-backfilled rows)
    expect(calls.flat().length).toBe(4);
  });

  test("verification passes: row count match + sample cosine above threshold", async () => {
    const db = makeDb();
    for (let i = 0; i < 8; i += 1) {
      seedObservation(db, `o${i}`, `verifiable content ${i}`, "2026-06-12T00:00:00.000Z");
    }
    const { embed } = makeFakeEmbed();

    const result = await runGraniteBackfill({
      db,
      embedBatch: embed,
      batchSize: 3,
      verifySampleSize: 4,
      cosineThreshold: 0.999,
    });

    expect(result.completed).toBe(true);
    expect(result.verification.row_count_match).toBe(true);
    expect(result.verification.sample_size).toBe(4);
    expect(result.verification.min_cosine).toBeGreaterThanOrEqual(0.999);
    expect(result.verification.passed).toBe(true);
  });

  test("verification fails when stored vectors diverge from a re-embed", async () => {
    const db = makeDb();
    for (let i = 0; i < 4; i += 1) {
      seedObservation(db, `o${i}`, `drift ${i}`, "2026-06-12T00:00:00.000Z");
    }
    // a provider whose output differs between the backfill phase and verification
    let phase = 0;
    const embed: BackfillEmbedBatch = async (texts) => {
      phase += 1;
      const axis = phase; // a different basis vector each phase => cosine 0 across phases
      return texts.map(() => {
        const vec = new Array<number>(GRANITE_BACKFILL_DIMENSION).fill(0);
        vec[axis % GRANITE_BACKFILL_DIMENSION] = 1;
        return vec;
      });
    };

    const result = await runGraniteBackfill({
      db,
      embedBatch: embed,
      batchSize: 4,
      verifySampleSize: 2,
      cosineThreshold: 0.99,
    });
    // rows are present, but cosine drift trips the verification gate
    expect(result.granite_rows).toBe(4);
    expect(result.verification.passed).toBe(false);
  });

  test("excludes archived and expired observations from the target set", async () => {
    const db = makeDb();
    seedObservation(db, "live", "live row", "2026-06-12T00:00:00.000Z");
    db.query(
      "INSERT INTO mem_observations(id, content_redacted, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("archived", "archived row", "2026-06-01T00:00:00.000Z", "2026-06-12T00:00:00.000Z", "2026-06-12T00:00:00.000Z");
    db.query(
      "INSERT INTO mem_observations(id, content_redacted, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("expired", "expired row", "2020-01-01T00:00:00.000Z", "2026-06-12T00:00:00.000Z", "2026-06-12T00:00:00.000Z");
    const { embed } = makeFakeEmbed();

    const result = await runGraniteBackfill({
      db,
      embedBatch: embed,
      batchSize: 5,
      now: "2026-06-12T12:00:00.000Z",
    });

    expect(result.target_observations).toBe(1);
    expect(result.granite_rows).toBe(1);
    const ids = db
      .query("SELECT observation_id FROM mem_vectors WHERE model = ?")
      .all(GRANITE_BACKFILL_MODEL) as Array<{ observation_id: string }>;
    expect(ids).toEqual([{ observation_id: "live" }]);
  });

  test("dry-run reports the target count without writing vectors", async () => {
    const db = makeDb();
    for (let i = 0; i < 3; i += 1) {
      seedObservation(db, `o${i}`, `dry ${i}`, "2026-06-12T00:00:00.000Z");
    }
    const { embed, calls } = makeFakeEmbed();

    const result = await runGraniteBackfill({ db, embedBatch: embed, dryRun: true });

    expect(result.dry_run).toBe(true);
    expect(result.target_observations).toBe(3);
    expect(result.granite_rows).toBe(0);
    expect(countVectors(db, GRANITE_BACKFILL_MODEL)).toBe(0);
    expect(calls.length).toBe(0);
  });

  test("reports throughput-based ETA progress while running", async () => {
    const db = makeDb();
    for (let i = 0; i < 6; i += 1) {
      seedObservation(db, `o${i}`, `prog ${i}`, "2026-06-12T00:00:00.000Z");
    }
    const { embed } = makeFakeEmbed();
    const progress: Array<{ processed: number; total: number; eta_seconds: number | null }> = [];

    await runGraniteBackfill({
      db,
      embedBatch: embed,
      batchSize: 2,
      onProgress: (p) => progress.push({ processed: p.processed, total: p.total, eta_seconds: p.eta_seconds }),
    });

    expect(progress.length).toBeGreaterThan(0);
    const last = progress[progress.length - 1];
    expect(last.processed).toBe(6);
    expect(last.total).toBe(6);
    // ETA is a finite number once at least one batch has been timed
    expect(progress.some((p) => typeof p.eta_seconds === "number")).toBe(true);
  });

  test("P2-1: writes the 384 row even when a non-target-dimension granite row exists, and counts only 384", async () => {
    const db = makeDb();
    for (let i = 0; i < 3; i += 1) {
      seedObservation(db, `o${i}`, `dim guard ${i}`, "2026-06-12T00:00:00.000Z");
    }
    // a stale native-768 granite row from a past experiment — must NOT mask the 384 backfill.
    seedGraniteRowAtDimension(db, "o0", 768);
    const { embed } = makeFakeEmbed();

    const result = await runGraniteBackfill({ db, embedBatch: embed, batchSize: 5, verifySampleSize: 0 });

    // every active observation has a 384 granite row (o0 gets one written despite the 768 row)
    const dim384 = (
      db
        .query("SELECT COUNT(*) AS n FROM mem_vectors WHERE model = ? AND dimension = ?")
        .get(GRANITE_BACKFILL_MODEL, GRANITE_BACKFILL_DIMENSION) as { n: number }
    ).n;
    expect(dim384).toBe(3);
    // completion count and verification reflect the 384 active set only, not the stray 768 row
    expect(result.target_observations).toBe(3);
    expect(result.granite_rows).toBe(3);
    expect(result.verification.row_count_match).toBe(true);
    expect(result.completed).toBe(true);

    // dry-run after completion also counts only 384 rows
    const dry = await runGraniteBackfill({ db, embedBatch: embed, dryRun: true });
    expect(dry.granite_rows).toBe(3);
    expect(dry.completed).toBe(true);
  });

  test("P2-2: updates the sqlite-vec sidecar for each backfilled row at the target model+dimension", async () => {
    const db = makeDb();
    for (let i = 0; i < 4; i += 1) {
      seedObservation(db, `o${i}`, `sidecar ${i}`, "2026-06-12T00:00:00.000Z");
    }
    const { embed } = makeFakeEmbed();
    const { upsert, rows } = makeFakeSqliteVecUpsert();

    await runGraniteBackfill({ db, embedBatch: embed, batchSize: 2, verifySampleSize: 0, upsertSqliteVec: upsert });

    expect(rows.length).toBe(4);
    expect(rows.every((r) => r.model === GRANITE_BACKFILL_MODEL)).toBe(true);
    expect(rows.every((r) => r.dimension === GRANITE_BACKFILL_DIMENSION)).toBe(true);
    expect(new Set(rows.map((r) => r.id))).toEqual(new Set(["o0", "o1", "o2", "o3"]));
  });

  test("P2-3: row-count parity holds even when granite rows exist outside the active set", async () => {
    const db = makeDb();
    // one live observation in the active set
    seedObservation(db, "live", "live row", "2026-06-12T00:00:00.000Z");
    // a granite row whose observation went archived after a past partial run (active-set excluded)
    db.query(
      "INSERT INTO mem_observations(id, content_redacted, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("archived", "archived row", "2026-06-01T00:00:00.000Z", "2026-06-12T00:00:00.000Z", "2026-06-12T00:00:00.000Z");
    seedGraniteRowAtDimension(db, "archived", GRANITE_BACKFILL_DIMENSION);
    const { embed } = makeFakeEmbed();

    const result = await runGraniteBackfill({
      db,
      embedBatch: embed,
      batchSize: 5,
      now: "2026-06-12T12:00:00.000Z",
      verifySampleSize: 0,
    });

    // target is the single active row; the out-of-set archived granite row must not break parity
    expect(result.target_observations).toBe(1);
    expect(result.granite_rows).toBe(1);
    expect(result.verification.row_count_match).toBe(true);
    expect(result.completed).toBe(true);
  });

  test("P1: sidecar row count mismatch fails verification when sqlite-vec is available", async () => {
    const db = makeDb();
    for (let i = 0; i < 4; i += 1) {
      seedObservation(db, `o${i}`, `sidecar gate ${i}`, "2026-06-12T00:00:00.000Z");
    }
    const { embed } = makeFakeEmbed();
    // a sidecar upsert that "succeeds" for the caller but only persists 2 of the 4
    // sidecar map rows — simulating a partial/broken vec0 write under a loaded extension.
    let written = 0;
    const partialUpsert = (
      sidecarDb: Database,
      observationId: string,
      _vectorJson: string,
      updatedAt: string,
    ): boolean => {
      written += 1;
      if (written > 2) return true; // claim success but skip the actual sidecar map row
      sidecarDb
        .query(
          "INSERT OR REPLACE INTO mem_vectors_vec_map_local_granite_embedding_311m_r2(observation_id, updated_at) VALUES (?, ?)",
        )
        .run(observationId, updatedAt);
      return true;
    };
    // the sidecar map table the verification counts against (model-derived name)
    db.exec(
      "CREATE TABLE mem_vectors_vec_map_local_granite_embedding_311m_r2 (observation_id TEXT PRIMARY KEY, updated_at TEXT NOT NULL);",
    );

    const result = await runGraniteBackfill({
      db,
      embedBatch: embed,
      batchSize: 4,
      // a real sample so cosine + row-count both pass; the sidecar gate is isolated.
      verifySampleSize: 4,
      cosineThreshold: 0.999,
      upsertSqliteVec: partialUpsert,
      sqliteVecAvailable: true,
    });

    expect(result.verification.sqlite_vec_available).toBe(true);
    expect(result.verification.sidecar_rows).toBe(2);
    // mem_vectors + cosine pass, but the sidecar shortfall must trip the gate
    expect(result.verification.row_count_match).toBe(true);
    expect(result.verification.min_cosine).toBeGreaterThanOrEqual(0.999);
    expect(result.verification.passed).toBe(false);
  });

  test("P1: sidecar check is a graceful no-op when sqlite-vec is unavailable", async () => {
    const db = makeDb();
    for (let i = 0; i < 3; i += 1) {
      seedObservation(db, `o${i}`, `no ext ${i}`, "2026-06-12T00:00:00.000Z");
    }
    const { embed } = makeFakeEmbed();

    // default upsert returns false (extension unavailable); availability not asserted
    const result = await runGraniteBackfill({
      db,
      embedBatch: embed,
      batchSize: 3,
      verifySampleSize: 2,
      // sqliteVecAvailable defaults to false
    });

    expect(result.verification.sqlite_vec_available).toBe(false);
    expect(result.verification.sidecar_rows).toBeNull();
    // sidecar is not gated when the extension cannot be used (CI / no-darwin)
    expect(result.verification.passed).toBe(true);
  });

  test("P2: resume re-embeds a stale granite row whose observation was updated mid-run", async () => {
    const db = makeDb();
    // first pass over fresh rows
    for (let i = 0; i < 3; i += 1) {
      seedObservation(db, `o${i}`, `original ${i}`, "2026-06-10T00:00:00.000Z", "2026-06-10T00:00:00.000Z");
    }
    const { embed: embed1 } = makeFakeEmbed();
    const first = await runGraniteBackfill({ db, embedBatch: embed1, batchSize: 3, verifySampleSize: 0 });
    expect(first.completed).toBe(true);
    const o1VecBefore = (
      db
        .query("SELECT vector_json FROM mem_vectors WHERE observation_id = ? AND model = ?")
        .get("o1", GRANITE_BACKFILL_MODEL) as { vector_json: string }
    ).vector_json;

    // simulate the first pass having run earlier: backdate its granite vectors so a
    // subsequent edit can be a realistic *past* wall-clock time that is still newer
    // than the vector (the production invariant: v.updated_at < o.updated_at < now).
    db.query("UPDATE mem_vectors SET updated_at = ? WHERE model = ?").run(
      "2026-06-11T00:00:00.000Z",
      GRANITE_BACKFILL_MODEL,
    );
    // live ingest updates o1 after its (now-old) granite row was written -> stale.
    db.query(
      "UPDATE mem_observations SET content_redacted = ?, updated_at = ? WHERE id = ?",
    ).run("EDITED content for o1 entirely different", "2026-06-11T12:00:00.000Z", "o1");

    // resume: the stale row must be re-selected and re-embedded; stale_rows must clear to 0
    const { embed: embed2, calls } = makeFakeEmbed();
    const resumed = await runGraniteBackfill({ db, embedBatch: embed2, batchSize: 3, verifySampleSize: 0 });

    // only the stale row was re-embedded (fresh rows skipped)
    expect(calls.flat()).toEqual(["EDITED content for o1 entirely different"]);
    const o1VecAfter = (
      db
        .query("SELECT vector_json FROM mem_vectors WHERE observation_id = ? AND model = ?")
        .get("o1", GRANITE_BACKFILL_MODEL) as { vector_json: string }
    ).vector_json;
    expect(o1VecAfter).not.toBe(o1VecBefore);
    expect(resumed.verification.stale_rows).toBe(0);
    expect(resumed.completed).toBe(true);
    expect(countVectors(db, GRANITE_BACKFILL_MODEL)).toBe(3);
  });

  test("P2: stale rows present at verification time fail the gate", async () => {
    const db = makeDb();
    seedObservation(db, "o0", "content", "2026-06-10T00:00:00.000Z", "2026-06-10T00:00:00.000Z");
    const { embed } = makeFakeEmbed();
    await runGraniteBackfill({ db, embedBatch: embed, batchSize: 1, verifySampleSize: 0 });

    // force a stale granite row directly (observation newer than its vector) and
    // re-run verification via a maxBatches:0 bounded pass that does no embedding.
    db.query("UPDATE mem_observations SET updated_at = ? WHERE id = ?").run(
      "2030-01-01T00:00:00.000Z",
      "o0",
    );
    const { embed: embed2 } = makeFakeEmbed();
    const bounded = await runGraniteBackfill({
      db,
      embedBatch: embed2,
      batchSize: 1,
      maxBatches: 0,
      verifySampleSize: 0,
    });

    expect(bounded.verification.stale_rows).toBe(1);
    expect(bounded.verification.passed).toBe(false);
  });

  test("P2-a: a live observation inserted after the final batch fails the gate (missing_rows>0)", async () => {
    const db = makeDb();
    for (let i = 0; i < 3; i += 1) {
      seedObservation(db, `o${i}`, `base ${i}`, "2026-06-10T00:00:00.000Z", "2026-06-10T00:00:00.000Z");
    }
    const { embed } = makeFakeEmbed();

    // Insert a brand-new active observation from inside the last batch's onProgress,
    // then immediately backdate it so its updated_at is in the past (a realistic live
    // ingest) — but at verification time it has no granite-384 row. The loop's own
    // fetch would normally re-pick it; to isolate the verification-time gate we bound
    // the run to exactly the batches needed for the seeded rows via maxBatches, so the
    // late row never gets embedded and must surface as missing at verification.
    let inserted = false;
    const onProgress = () => {
      if (inserted) return;
      inserted = true;
      seedObservation(db, "late", "late live ingest", "2026-06-11T00:00:00.000Z", "2026-06-11T00:00:00.000Z");
    };
    // 3 rows / batchSize 3 = exactly 1 batch; maxBatches:1 stops before the late row.
    const result = await runGraniteBackfill({
      db,
      embedBatch: embed,
      batchSize: 3,
      maxBatches: 1,
      verifySampleSize: 0,
      onProgress,
    });

    expect(result.verification.missing_rows).toBe(1);
    expect(result.verification.row_count_match).toBe(false);
    expect(result.completed).toBe(false);
    expect(result.verification.passed).toBe(false);
  });

  test("P2-a: full coverage still passes when live ingest adds an already-covered row count (no false fail)", async () => {
    const db = makeDb();
    for (let i = 0; i < 3; i += 1) {
      seedObservation(db, `o${i}`, `covered ${i}`, "2026-06-10T00:00:00.000Z", "2026-06-10T00:00:00.000Z");
    }
    const { embed } = makeFakeEmbed();

    // A run that embeds every active row to completion. The verification recompute
    // reads live tables; because every active row has a fresh granite-384 row,
    // missing_rows is 0 and the gate passes — the snapshot-vs-live distinction does
    // not produce a false fail when coverage is genuinely complete.
    const result = await runGraniteBackfill({
      db,
      embedBatch: embed,
      batchSize: 2,
      verifySampleSize: 2,
      cosineThreshold: 0.999,
    });

    expect(result.verification.missing_rows).toBe(0);
    expect(result.verification.row_count_match).toBe(true);
    expect(result.completed).toBe(true);
    expect(result.verification.passed).toBe(true);
  });

  test("P2-b: a false sidecar upsert under a loaded extension throws (fail-fast)", async () => {
    const db = makeDb();
    for (let i = 0; i < 2; i += 1) {
      seedObservation(db, `o${i}`, `vec0 fail ${i}`, "2026-06-12T00:00:00.000Z");
    }
    const { embed } = makeFakeEmbed();
    // vec0 is loaded, but the sidecar upsert always reports failure (e.g. an existing
    // map row that did not update). With parity passing on mem_vectors alone this
    // would otherwise green-light a flip over a broken sidecar.
    const alwaysFalse: NonNullable<Parameters<typeof runGraniteBackfill>[0]["upsertSqliteVec"]> = () => false;

    expect(
      runGraniteBackfill({
        db,
        embedBatch: embed,
        batchSize: 2,
        verifySampleSize: 0,
        upsertSqliteVec: alwaysFalse,
        sqliteVecAvailable: true,
      }),
    ).rejects.toThrow(/sqlite-vec sidecar upsert failed/);
  });

  test("P2-b: a false sidecar upsert when the extension is unavailable is a graceful no-op", async () => {
    const db = makeDb();
    seedObservation(db, "o0", "no ext", "2026-06-12T00:00:00.000Z");
    const { embed } = makeFakeEmbed();
    const alwaysFalse: NonNullable<Parameters<typeof runGraniteBackfill>[0]["upsertSqliteVec"]> = () => false;

    // sqliteVecAvailable defaults to false: false return is the expected no-op.
    const result = await runGraniteBackfill({
      db,
      embedBatch: embed,
      batchSize: 1,
      verifySampleSize: 0,
      upsertSqliteVec: alwaysFalse,
    });
    expect(result.completed).toBe(true);
    expect(countVectors(db, GRANITE_BACKFILL_MODEL)).toBe(1);
  });

  test("P2-c: sidecar parity ignores map rows for observations archived after a past run", async () => {
    const db = makeDb();
    // an active observation that gets a granite-384 row + sidecar row
    seedObservation(db, "live", "live row", "2026-06-12T00:00:00.000Z");
    // an observation backfilled in a past run, then archived — its map row lingers
    // (the backfill never deletes sidecar rows) but it is out of the active set.
    db.query(
      "INSERT INTO mem_observations(id, content_redacted, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("archived", "archived row", "2026-06-01T00:00:00.000Z", "2026-06-12T00:00:00.000Z", "2026-06-12T00:00:00.000Z");
    seedGraniteRowAtDimension(db, "archived", GRANITE_BACKFILL_DIMENSION);

    // the model-derived sidecar map table, pre-populated with the lingering archived row
    db.exec(
      "CREATE TABLE mem_vectors_vec_map_local_granite_embedding_311m_r2 (observation_id TEXT PRIMARY KEY, updated_at TEXT NOT NULL);",
    );
    db.query(
      "INSERT INTO mem_vectors_vec_map_local_granite_embedding_311m_r2(observation_id, updated_at) VALUES (?, ?)",
    ).run("archived", "2026-06-01T00:00:00.000Z");

    const { embed } = makeFakeEmbed();
    // a sidecar upsert that writes the real map row for the active observation
    const upsert: NonNullable<Parameters<typeof runGraniteBackfill>[0]["upsertSqliteVec"]> = (
      sidecarDb,
      observationId,
      _vectorJson,
      updatedAt,
    ) => {
      sidecarDb
        .query(
          "INSERT OR REPLACE INTO mem_vectors_vec_map_local_granite_embedding_311m_r2(observation_id, updated_at) VALUES (?, ?)",
        )
        .run(observationId, updatedAt);
      return true;
    };

    const result = await runGraniteBackfill({
      db,
      embedBatch: embed,
      batchSize: 5,
      now: "2026-06-12T12:00:00.000Z",
      verifySampleSize: 1,
      cosineThreshold: 0.999,
      upsertSqliteVec: upsert,
      sqliteVecAvailable: true,
    });

    // raw map COUNT(*) would be 2 (live + lingering archived) vs 1 active granite row
    // -> false fail. The join counts only the active granite-384 set: exactly 1.
    expect(result.verification.sidecar_rows).toBe(1);
    expect(result.verification.granite_rows).toBe(1);
    expect(result.verification.passed).toBe(true);
  });

  test("P2: a map row with no backing vec0 row is not counted (rowid join) and fails the gate", async () => {
    const db = makeDb();
    for (let i = 0; i < 2; i += 1) {
      seedObservation(db, `o${i}`, `vec join ${i}`, "2026-06-12T00:00:00.000Z");
    }

    // Model-derived map + vec tables. vec0 is unavailable here, so we model the vec
    // virtual table as a plain table keyed by rowid (search joins m.rowid = vec.rowid).
    db.exec(
      "CREATE TABLE mem_vectors_vec_map_local_granite_embedding_311m_r2 (rowid INTEGER PRIMARY KEY, observation_id TEXT UNIQUE NOT NULL, updated_at TEXT NOT NULL);",
    );
    db.exec(
      "CREATE TABLE mem_vectors_vec_local_granite_embedding_311m_r2 (rowid INTEGER PRIMARY KEY, embedding TEXT NOT NULL);",
    );

    // A sidecar upsert that writes the map row for every observation, but only inserts
    // the backing vec row for o0 — o1's map row is orphaned (rowid 2 has no vec match),
    // exactly the stale/corrupt state P2 guards against.
    const upsert: NonNullable<Parameters<typeof runGraniteBackfill>[0]["upsertSqliteVec"]> = (
      sidecarDb,
      observationId,
      _vectorJson,
      updatedAt,
    ) => {
      const rowid = observationId === "o0" ? 1 : 2;
      sidecarDb
        .query(
          "INSERT OR REPLACE INTO mem_vectors_vec_map_local_granite_embedding_311m_r2(rowid, observation_id, updated_at) VALUES (?, ?, ?)",
        )
        .run(rowid, observationId, updatedAt);
      if (observationId === "o0") {
        sidecarDb
          .query("INSERT OR REPLACE INTO mem_vectors_vec_local_granite_embedding_311m_r2(rowid, embedding) VALUES (?, ?)")
          .run(rowid, "[]");
      }
      return true;
    };

    const result = await runGraniteBackfill({
      db,
      embedBatch: makeFakeEmbed().embed,
      batchSize: 2,
      verifySampleSize: 2,
      cosineThreshold: 0.999,
      upsertSqliteVec: upsert,
      sqliteVecAvailable: true,
    });

    // both observations have a granite-384 row + a map row, but only o0 has a vec0 row.
    // counting map rows alone would report 2 and falsely PASS; the rowid join to the
    // vec table counts only o0 -> 1, short of granite_rows (2), so the gate fails.
    expect(result.verification.granite_rows).toBe(2);
    expect(result.verification.row_count_match).toBe(true);
    expect(result.verification.min_cosine).toBeGreaterThanOrEqual(0.999);
    expect(result.verification.sidecar_rows).toBe(1);
    expect(result.verification.passed).toBe(false);
  });

  test("P1: a future-dated observation self-resolves (vector stamped at its own updated_at)", async () => {
    const db = makeDb();
    // Stamping the vector with the *fetched* updated_at (not the wall clock) makes a
    // future-dated observation terminate in one pass: v.updated_at == o.updated_at
    // satisfies the >= predicate, so the row leaves the missing-or-stale set. The old
    // nowIso() stamp would have left v.updated_at < o.updated_at forever and spun.
    seedObservation(db, "future", "content", "2099-01-01T00:00:00.000Z", "2099-01-01T00:00:00.000Z");
    const { embed } = makeFakeEmbed();

    const result = await runGraniteBackfill({ db, embedBatch: embed, batchSize: 1, verifySampleSize: 0 });

    expect(result.completed).toBe(true);
    expect(result.granite_rows).toBe(1);
    const vec = db
      .query("SELECT updated_at FROM mem_vectors WHERE observation_id = ? AND model = ?")
      .get("future", GRANITE_BACKFILL_MODEL) as { updated_at: string };
    // the vector carries the observation's generation, not the run wall clock
    expect(vec.updated_at).toBe("2099-01-01T00:00:00.000Z");
    expect(result.verification.stale_rows).toBe(0);
    expect(result.verification.missing_rows).toBe(0);
  });

  test("P1: TOCTOU — an observation edited between fetch and insert is re-embedded next pass, not accepted stale", async () => {
    const db = makeDb();
    seedObservation(db, "o0", "original text", "2026-06-10T00:00:00.000Z", "2026-06-10T00:00:00.000Z");

    // An embed fake that, on its first call only, simulates a live ingest landing
    // between fetchBatch (which already read content+updated_at) and the insert: it
    // bumps o0's updated_at forward and rewrites its content. The vector this pass
    // writes is for the OLD content/generation and must be stamped with the OLD
    // updated_at — so it is strictly older than the now-current observation and is
    // re-selected (not silently treated as covered).
    let call = 0;
    const oldVec = (text: string): number[] => {
      const vec = new Array<number>(GRANITE_BACKFILL_DIMENSION).fill(0);
      for (let i = 0; i < text.length; i += 1) vec[i % GRANITE_BACKFILL_DIMENSION] += text.charCodeAt(i);
      const norm = Math.sqrt(vec.reduce((a, v) => a + v * v, 0)) || 1;
      return vec.map((v) => v / norm);
    };
    const seenTexts: string[] = [];
    const embed: BackfillEmbedBatch = async (texts) => {
      call += 1;
      seenTexts.push(...texts);
      if (call === 1) {
        // mid-flight live edit (a past wall-clock time, newer than the fetched gen)
        db.query(
          "UPDATE mem_observations SET content_redacted = ?, updated_at = ? WHERE id = ?",
        ).run("EDITED brand new content entirely", "2026-06-10T06:00:00.000Z", "o0");
      }
      return texts.map((t) => oldVec(t));
    };

    const result = await runGraniteBackfill({ db, embedBatch: embed, batchSize: 1, verifySampleSize: 0 });

    // first embed saw the OLD text; the row was re-selected and the second embed saw
    // the EDITED text — the stale (old-generation) vector was never accepted as covered.
    expect(seenTexts).toEqual(["original text", "EDITED brand new content entirely"]);
    expect(result.completed).toBe(true);
    expect(result.verification.stale_rows).toBe(0);
    expect(result.verification.missing_rows).toBe(0);
    // the stored vector now reflects the edited generation
    const vec = db
      .query("SELECT updated_at FROM mem_vectors WHERE observation_id = ? AND model = ?")
      .get("o0", GRANITE_BACKFILL_MODEL) as { updated_at: string };
    expect(vec.updated_at).toBe("2026-06-10T06:00:00.000Z");
  });

  test("P1: no-progress valve does not misfire on legitimate mid-flight re-selection across batches", async () => {
    const db = makeDb();
    seedObservation(db, "o0", "row zero", "2026-06-10T00:00:00.000Z", "2026-06-10T00:00:00.000Z");
    seedObservation(db, "o1", "row one", "2026-06-10T00:00:00.000Z", "2026-06-10T00:00:00.000Z");

    // After o0 is embedded in batch 1, a live ingest bumps o0's updated_at forward so
    // it is re-selected in a later batch at a NEWER updated_at. The valve keys on
    // id+updated_at, so the re-selection (o0 at a new generation) is not a no-op and
    // must not throw. The mutation fires once, so the run still converges.
    let bumped = false;
    const { embed } = makeFakeEmbed();
    const wrapped: BackfillEmbedBatch = async (texts) => {
      const out = await embed(texts);
      if (!bumped) {
        bumped = true;
        db.query("UPDATE mem_observations SET updated_at = ? WHERE id = ?").run(
          "2026-06-10T03:00:00.000Z",
          "o0",
        );
      }
      return out;
    };

    const result = await runGraniteBackfill({ db, embedBatch: wrapped, batchSize: 1, verifySampleSize: 0 });

    expect(result.completed).toBe(true);
    expect(result.verification.stale_rows).toBe(0);
    expect(result.verification.missing_rows).toBe(0);
    const o0 = db
      .query("SELECT updated_at FROM mem_vectors WHERE observation_id = ? AND model = ?")
      .get("o0", GRANITE_BACKFILL_MODEL) as { updated_at: string };
    // final o0 vector matches the bumped generation
    expect(o0.updated_at).toBe("2026-06-10T03:00:00.000Z");
  });
});
