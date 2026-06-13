/**
 * granite-backfill.ts
 *
 * S154-511: re-embed every active observation into the Granite MRL-384 vector
 * space (`granite-embedding-311m-r2@384`) as a standalone, resumable batch job.
 *
 * Design notes (kept here because they constrain every caller):
 *   - Non-destructive: Granite rows are written under a distinct `model` value
 *     (GRANITE_BACKFILL_MODEL), so the incumbent `local:multilingual-e5` rows
 *     that the live search path filters on are never read, updated, or deleted.
 *     The flag flip that activates Granite is a separate task (154-512); until
 *     then search keeps running on the e5 rows with zero downtime.
 *   - Resumable: a cursor row in `mem_meta` records the last observation id that
 *     was backfilled (observations are processed in a stable id order). A fresh
 *     call skips everything already covered, so an interrupted run resumes
 *     instead of restarting.
 *   - Live-faithful: the embedded text is `raw_text ?? content_redacted` with no
 *     char cap — byte-for-byte what the live materialization path feeds the model
 *     (see embeddingSource) and at the same "passage" mode. If the backfill embedded
 *     a different string (e.g. a 2000-char slice), a post-flip live re-ingest of the
 *     same observation would produce a divergent vector and the index would drift.
 *   - Verified: completion is gated on row-count parity (active observations ==
 *     Granite rows) plus a random-sample cosine check (re-embed the sample, take
 *     the worst cosine against the stored vector). The returned verification
 *     object is the artifact 154-512 consumes before flipping the flag.
 *
 * The embedding call is injected (`BackfillEmbedBatch`) so the core is testable
 * with a deterministic fake — the bun test runner crashes if onnxruntime is
 * loaded in-process. The CLI script wires the real local ONNX provider.
 */

import type { Database } from "bun:sqlite";
import { expiredFilterSql, nowIso } from "./core-utils";
import {
  upsertSqliteVecRow as defaultUpsertSqliteVecRow,
  getSqliteVecMapTableName,
  getSqliteVecTableName,
} from "../vector/providers";

/** Active-model string the registry composes for Granite (`${name}:${model}`). */
export const GRANITE_BACKFILL_MODEL = "local:granite-embedding-311m-r2";
/** MRL truncation dimension the 154-512 rollout targets. */
export const GRANITE_BACKFILL_DIMENSION = 384;
/** mem_meta key holding the resume cursor (last backfilled observation id). */
export const GRANITE_BACKFILL_CURSOR_KEY = "granite_backfill_cursor";

export type BackfillEmbedBatch = (texts: string[]) => Promise<number[][]>;

/**
 * sqlite-vec sidecar upsert, matching the signature of `upsertSqliteVecRow`.
 * Injected so tests can observe sidecar writes without loading the native
 * extension; the default returns false (graceful no-op) when sqlite-vec is
 * unavailable, exactly like the live write path in event-recorder/config-manager.
 */
export type BackfillSqliteVecUpsert = (
  db: Database,
  observationId: string,
  vectorJson: string,
  updatedAt: string,
  options?: { model?: string; vectorDimension?: number },
) => boolean;

export interface BackfillProgress {
  processed: number;
  total: number;
  /** Estimated seconds remaining from the measured throughput, or null pre-timing. */
  eta_seconds: number | null;
  throughput_per_s: number | null;
}

export interface GraniteBackfillVerification {
  row_count_match: boolean;
  target_observations: number;
  granite_rows: number;
  /**
   * Active observations lacking a fresh granite-384 row, recomputed against the
   * live tables *at verification time* (not the run-start snapshot). This is the
   * gate: a live ingest landing after the start snapshot — or after the final
   * embed batch — leaves an active row uncovered, and `row_count_match` is now
   * defined as `missing_rows === 0` so that row can never be missed. Counting the
   * absolute gap directly also avoids the inverse trap where a row inserted after
   * the snapshot inflates `granite_rows` past the stale `target` and trips a false
   * fail.
   */
  missing_rows: number;
  sample_size: number;
  min_cosine: number | null;
  cosine_threshold: number;
  /** Active granite-384 rows whose observation was updated after the vector (stale embedding). */
  stale_rows: number;
  /** Whether the vec0 extension is loaded on this handle (sidecar parity is only enforced when true). */
  sqlite_vec_available: boolean;
  /** Sidecar map-table rows joined to the active granite-384 set; null when the extension is unavailable. */
  sidecar_rows: number | null;
  passed: boolean;
}

export interface GraniteBackfillResult {
  target_model: string;
  dimension: number;
  target_observations: number;
  granite_rows: number;
  embedded_this_run: number;
  completed: boolean;
  dry_run: boolean;
  elapsed_seconds: number;
  throughput_per_s: number | null;
  verification: GraniteBackfillVerification;
  generated_at: string;
}

export interface GraniteBackfillOptions {
  db: Database;
  embedBatch: BackfillEmbedBatch;
  batchSize?: number;
  /** Stop after N batches (resume coverage test / bounded run); undefined = run to completion. */
  maxBatches?: number;
  dryRun?: boolean;
  /** Random-sample cosine verification size. */
  verifySampleSize?: number;
  cosineThreshold?: number;
  now?: string;
  onProgress?: (progress: BackfillProgress) => void;
  /** Deterministic RNG seed for the verification sample (defaults to a fixed seed). */
  sampleSeed?: number;
  /** sqlite-vec sidecar upsert; defaults to the real `upsertSqliteVecRow`. */
  upsertSqliteVec?: BackfillSqliteVecUpsert;
  /**
   * Whether the vec0 extension is loaded/usable on this `db` handle. The CLI sets
   * this from the actual loadExtension result. When true, verification enforces
   * sidecar (mem_vectors_vec_map_*) row-count parity with the granite-384 rows; a
   * shortfall fails the gate. When false (CI / no extension), the sidecar write is
   * a graceful no-op and parity is not enforced. Defaults to false.
   */
  sqliteVecAvailable?: boolean;
}

interface ObservationRow {
  id: string;
  content_redacted: string;
  raw_text: string | null;
  created_at: string;
  updated_at: string;
}

const DEFAULT_BATCH_SIZE = 64;
const DEFAULT_VERIFY_SAMPLE = 16;
const DEFAULT_COSINE_THRESHOLD = 0.999;

/**
 * The exact text the live materialization path embeds
 * (event-recorder.materializeObservationDerivedData): `raw_text ?? content_redacted`,
 * with NO character cap. Length is bounded by the provider tokenizer's maxSeqLength,
 * identically to live (which passes the full string into `embedContent`). A standalone
 * char slice here would embed a *different* string than live, so a post-flip live
 * re-ingest of the same observation would produce a vector that diverges from the
 * backfilled one. Keeping a single source-of-truth function for both the embed and the
 * cosine-verify path guarantees they never drift apart.
 */
function embeddingSource(row: { raw_text: string | null; content_redacted: string }): string {
  return row.raw_text || row.content_redacted || "";
}

function activeFilterSql(now: string): string {
  // archived rows and rows past expiry are out of scope (mirrors the read path).
  // expiredFilterSql validates the ISO timestamp and emits the leading " AND ".
  return `o.archived_at IS NULL${expiredFilterSql("o", now)}`;
}

/**
 * Count granite rows that belong to the *active* observation set at the target
 * dimension. Counting raw `mem_vectors WHERE model=?` would (a) include stale
 * rows at a different dimension (e.g. an old native-768 experiment) and (b)
 * include rows whose observation later went archived/expired — either inflates
 * the count past the active target so row-count parity can never hold. This must
 * use the same active filter + dimension condition as the target selection.
 */
function countActiveGraniteRows(db: Database, activeFilter: string): number {
  return (
    db
      .query(
        `SELECT COUNT(*) AS n
         FROM mem_observations o
         JOIN mem_vectors v
           ON v.observation_id = o.id AND v.model = ? AND v.dimension = ?
         WHERE ${activeFilter}`,
      )
      .get(GRANITE_BACKFILL_MODEL, GRANITE_BACKFILL_DIMENSION) as { n: number }
  ).n;
}

/**
 * Count active granite-384 rows whose source observation was updated *after* the
 * stored vector (`o.updated_at > v.updated_at`). These are stale: a live edit
 * landed after the row was embedded, so the embedding no longer reflects the
 * content. They are re-selected for re-embed and must be zero before completion.
 */
function countStaleGraniteRows(db: Database, activeFilter: string): number {
  return (
    db
      .query(
        `SELECT COUNT(*) AS n
         FROM mem_observations o
         JOIN mem_vectors v
           ON v.observation_id = o.id AND v.model = ? AND v.dimension = ?
         WHERE ${activeFilter} AND o.updated_at > v.updated_at`,
      )
      .get(GRANITE_BACKFILL_MODEL, GRANITE_BACKFILL_DIMENSION) as { n: number }
  ).n;
}

/**
 * Count active observations that lack a *fresh* granite-384 row — the same
 * missing-or-stale predicate the backfill selection uses, evaluated against the
 * live tables. This is the verification-time gap: any active row inserted (or
 * edited) after the run-start snapshot, or after the final embed batch, shows up
 * here. Gating `row_count_match` on `missing === 0` (rather than a start-snapshot
 * count equality) closes both the "row added after final fetch passes anyway" and
 * the "row added during the run inflates granite_rows past target" holes.
 */
function countMissingActiveGraniteRows(db: Database, activeFilter: string): number {
  return (
    db
      .query(
        `SELECT COUNT(*) AS n
         FROM mem_observations o
         WHERE ${activeFilter}
           AND NOT EXISTS (
             SELECT 1 FROM mem_vectors v
             WHERE v.observation_id = o.id AND v.model = ? AND v.dimension = ?
               AND v.updated_at >= o.updated_at
           )`,
      )
      .get(GRANITE_BACKFILL_MODEL, GRANITE_BACKFILL_DIMENSION) as { n: number }
  ).n;
}

/**
 * Count sidecar rows that join to the *active granite-384 set*, through the same
 * path the search uses: vec0 virtual table × map (rowid) × mem_observations (active)
 * × mem_vectors (granite, 384). Returns null when the map table does not exist
 * (extension never loaded).
 *
 * Two failure modes this guards against:
 *  - Lingering map rows: a raw `COUNT(*)` over the map table counts observations that
 *    went archived/expired after a past partial run (the backfill never deletes map
 *    rows), so a fully-covered active set could falsely fail parity. The active filter
 *    + mem_vectors join drops those.
 *  - Stale/orphan map rows: a map row whose backing vec0 row is missing (rowid has no
 *    match in the vec virtual table) is dead weight — search joins `m.rowid = v.rowid`,
 *    so that observation is invisible to vector search. Counting the map row alone
 *    would let parity PASS over a partial index. Joining the vec table on rowid counts
 *    only observations actually reachable by search.
 *
 * The vec0 join is added only when the vec virtual table is present (queryable). In
 * the unit-test fake sidecar (no vec0 extension) only the map table exists; we fall
 * back to the map-only join there — matching the existing sqlite_master existence
 * style rather than a blanket try/catch swallow.
 */
function countSidecarRows(db: Database, activeFilter: string): number | null {
  const mapTable = getSqliteVecMapTableName(GRANITE_BACKFILL_MODEL);
  const vecTable = getSqliteVecTableName(GRANITE_BACKFILL_MODEL);
  try {
    const mapExists = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(mapTable) as { name?: string } | null;
    if (!mapExists?.name) return null;

    // vec0 virtual tables register in sqlite_master with type 'table'; a plain table
    // by the same name (test fake) registers identically, so either is joinable.
    const vecExists = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(vecTable) as { name?: string } | null;

    const vecJoin = vecExists?.name ? `JOIN ${vecTable} vec ON vec.rowid = m.rowid` : "";

    return (
      db
        .query(
          `SELECT COUNT(*) AS n
           FROM ${mapTable} m
           ${vecJoin}
           JOIN mem_observations o ON o.id = m.observation_id
           JOIN mem_vectors v
             ON v.observation_id = o.id AND v.model = ? AND v.dimension = ?
           WHERE ${activeFilter}`,
        )
        .get(GRANITE_BACKFILL_MODEL, GRANITE_BACKFILL_DIMENSION) as { n: number }
    ).n;
  } catch {
    return null;
  }
}

function writeCursor(db: Database, observationId: string): void {
  db.query(
    `INSERT INTO mem_meta(key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(GRANITE_BACKFILL_CURSOR_KEY, observationId, nowIso());
}

function clearCursor(db: Database): void {
  db.query("DELETE FROM mem_meta WHERE key = ?").run(GRANITE_BACKFILL_CURSOR_KEY);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

/** Deterministic PRNG (mulberry32) so the verification sample is reproducible. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleIds(ids: string[], size: number, seed: number): string[] {
  if (ids.length <= size) return [...ids];
  const rng = mulberry32(seed);
  const pool = [...ids];
  // Fisher–Yates partial shuffle.
  for (let i = 0; i < size; i += 1) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, size);
}

export async function runGraniteBackfill(
  options: GraniteBackfillOptions,
): Promise<GraniteBackfillResult> {
  const {
    db,
    embedBatch,
    batchSize = DEFAULT_BATCH_SIZE,
    maxBatches,
    dryRun = false,
    verifySampleSize = DEFAULT_VERIFY_SAMPLE,
    cosineThreshold = DEFAULT_COSINE_THRESHOLD,
    now = nowIso(),
    onProgress,
    sampleSeed = 154_511,
    upsertSqliteVec = defaultUpsertSqliteVecRow,
    sqliteVecAvailable = false,
  } = options;

  const startedAt = performance.now();
  const activeFilter = activeFilterSql(now);

  const target = (
    db
      .query(`SELECT COUNT(*) AS n FROM mem_observations o WHERE ${activeFilter}`)
      .get() as { n: number }
  ).n;

  if (dryRun) {
    const graniteRows = countActiveGraniteRows(db, activeFilter);
    // "completed" must use the same missing-or-stale gap the real run and the
    // verification gate use — not `graniteRows >= target`. A stale row (live edit
    // after embed) or a row added after the start snapshot satisfies `>= target`
    // while still leaving the active set uncovered; the dry-run would then report
    // completion over a gap that the real run correctly refuses to close.
    const missingRows = countMissingActiveGraniteRows(db, activeFilter);
    return {
      target_model: GRANITE_BACKFILL_MODEL,
      dimension: GRANITE_BACKFILL_DIMENSION,
      target_observations: target,
      granite_rows: graniteRows,
      embedded_this_run: 0,
      completed: missingRows === 0,
      dry_run: true,
      elapsed_seconds: (performance.now() - startedAt) / 1000,
      throughput_per_s: null,
      verification: {
        row_count_match: missingRows === 0,
        target_observations: target,
        granite_rows: graniteRows,
        missing_rows: missingRows,
        sample_size: 0,
        min_cosine: null,
        cosine_threshold: cosineThreshold,
        stale_rows: countStaleGraniteRows(db, activeFilter),
        sqlite_vec_available: sqliteVecAvailable,
        sidecar_rows: sqliteVecAvailable ? countSidecarRows(db, activeFilter) : null,
        passed: false,
      },
      generated_at: now,
    };
  }

  let embedded = 0;
  let batches = 0;
  let embedElapsedS = 0;
  let bounded = false;

  // The target set is "active observations whose Granite-384 vector is missing OR
  // stale", processed in stable id order. Missing covers a fresh/interrupted run;
  // stale (`o.updated_at > v.updated_at`) covers a live edit that landed after the
  // row was embedded during a long run — without it, resume would skip the row and
  // leave an embedding that no longer matches the content. The selection is the
  // resume mechanism itself: a re-run picks up exactly the rows still needing work,
  // and the INSERT ... ON CONFLICT below re-embeds stale rows in place. The mem_meta
  // cursor is persisted as the human-facing progress marker (last id covered).
  const fetchBatch = (): ObservationRow[] =>
    db
      .query(
        `SELECT o.id, o.content_redacted, o.raw_text, o.created_at, o.updated_at
         FROM mem_observations o
         WHERE ${activeFilter}
           AND NOT EXISTS (
             SELECT 1 FROM mem_vectors v
             WHERE v.observation_id = o.id AND v.model = ? AND v.dimension = ?
               AND v.updated_at >= o.updated_at
           )
         ORDER BY o.id ASC
         LIMIT ?`,
      )
      .all(GRANITE_BACKFILL_MODEL, GRANITE_BACKFILL_DIMENSION, batchSize) as ObservationRow[];

  const insert = db.query(
    `INSERT INTO mem_vectors(observation_id, model, dimension, vector_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(observation_id, model) DO UPDATE SET
       dimension = excluded.dimension,
       vector_json = excluded.vector_json,
       updated_at = excluded.updated_at`,
  );

  // Fail-fast guard against a non-terminating selection. The fetch set must shrink
  // every iteration: each row's vector is stamped with the *fetched* `o.updated_at`,
  // so the re-embedded `v.updated_at >= o.updated_at` predicate is satisfied and the
  // row leaves the missing-or-stale set. The key is `id+updated_at`, not id alone: a
  // legitimate mid-flight edit re-selects the same id at a *newer* updated_at (correct
  // re-embed, must not throw), whereas a genuine no-op — the same id at the same
  // updated_at re-fetched after a write — means the write did not land. If two
  // consecutive batches return the exact same id+updated_at set, the loop is making
  // no progress: a vector write failed to clear an unchanged observation. Throw
  // rather than spin: an aborted run is recoverable, an infinite loop is not.
  let prevBatchKey: string | null = null;
  for (;;) {
    if (maxBatches !== undefined && batches >= maxBatches) {
      bounded = true;
      break;
    }
    const rows = fetchBatch();
    if (rows.length === 0) break;
    const batchKey = rows.map((row) => `${row.id}@${row.updated_at}`).join(" ");
    if (batchKey === prevBatchKey) {
      throw new Error(
        `[s154-511] no-progress loop detected: ${rows.length} row(s) re-selected unchanged ` +
          `after a write (first id ${rows[0].id}, updated_at ${rows[0].updated_at}). A vector ` +
          `write did not clear the missing-or-stale predicate for an unchanged observation.`,
      );
    }
    prevBatchKey = batchKey;
    batches += 1;

    const batchStart = performance.now();
    const vectors = await embedBatch(rows.map((row) => embeddingSource(row)));
    embedElapsedS += (performance.now() - batchStart) / 1000;

    if (vectors.length !== rows.length) {
      throw new Error(
        `[s154-511] embed batch returned ${vectors.length} vectors for ${rows.length} inputs`,
      );
    }

    const writeFallback = nowIso();
    db.exec("BEGIN IMMEDIATE");
    try {
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        const vector = vectors[i];
        if (vector.length !== GRANITE_BACKFILL_DIMENSION) {
          throw new Error(
            `[s154-511] vector for ${row.id} has dimension ${vector.length}, expected ${GRANITE_BACKFILL_DIMENSION}`,
          );
        }
        // Stamp the vector with the *fetched* observation `updated_at`, not the wall
        // clock. fetchBatch read `content_redacted` and `updated_at` together, so this
        // ties the stored vector to the exact content generation it was embedded from.
        // If a live ingest updates the observation between the fetch and this insert
        // (TOCTOU), the stored `v.updated_at` is the *old* generation, strictly less
        // than the new `o.updated_at`: the row stays in the missing-or-stale set and is
        // re-embedded on the next pass instead of being silently accepted as covered.
        // Stamping `nowIso()` would mark a stale embedding as fresh and let verification
        // PASS it unless the cosine sample happened to hit it.
        const vectorUpdatedAt = row.updated_at || writeFallback;
        const vectorJson = JSON.stringify(vector);
        insert.run(
          row.id,
          GRANITE_BACKFILL_MODEL,
          GRANITE_BACKFILL_DIMENSION,
          vectorJson,
          row.created_at || vectorUpdatedAt,
          vectorUpdatedAt,
        );
        // Keep the model-specific sqlite-vec sidecar (mem_vectors_vec_*) in lockstep
        // with mem_vectors — same `updated_at` so the sidecar map row reflects the same
        // content generation. Without this, post-flip global vector search hits the
        // missing-row path and silently falls back to bounded JS scan, ignoring most
        // of the backfilled index.
        const sidecarOk = upsertSqliteVec(db, row.id, vectorJson, vectorUpdatedAt, {
          model: GRANITE_BACKFILL_MODEL,
          vectorDimension: GRANITE_BACKFILL_DIMENSION,
        });
        // When vec0 is loaded, a false return is a real write failure (e.g. an
        // existing sidecar row that did not update), not graceful degradation —
        // leaving a stale/absent map row while mem_vectors row-count parity passes.
        // Fail the batch fast (same posture as the no-progress valve) so the gate
        // can never green-light a flip over a silently-broken sidecar. When vec0 is
        // unavailable, false is the expected no-op and is ignored.
        if (sqliteVecAvailable && !sidecarOk) {
          throw new Error(
            `[s154-511] sqlite-vec sidecar upsert failed for ${row.id} ` +
              `(model ${GRANITE_BACKFILL_MODEL}, dim ${GRANITE_BACKFILL_DIMENSION}) ` +
              `while the extension is loaded; aborting to avoid a partial sidecar index.`,
          );
        }
        embedded += 1;
      }
      writeCursor(db, rows[rows.length - 1].id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    const throughput = embedElapsedS > 0 ? embedded / embedElapsedS : null;
    const graniteSoFar = countActiveGraniteRows(db, activeFilter);
    const remaining = Math.max(0, target - graniteSoFar);
    onProgress?.({
      processed: graniteSoFar,
      total: target,
      eta_seconds: throughput && throughput > 0 ? remaining / throughput : null,
      throughput_per_s: throughput,
    });
  }

  const graniteRows = countActiveGraniteRows(db, activeFilter);
  // "completed" is decided against the live missing-or-stale gap, not the run-start
  // `target` snapshot: a row inserted after the snapshot must keep the run from
  // reporting completion (and from clearing the resume cursor) even though it never
  // entered `target`. This is the same gap the verification gate uses.
  const completed = !bounded && countMissingActiveGraniteRows(db, activeFilter) === 0;
  if (completed) {
    // the cursor is only meaningful for an in-flight job; clear it once covered.
    clearCursor(db);
  }

  const throughput = embedElapsedS > 0 ? embedded / embedElapsedS : null;

  const verification = await verifyBackfill({
    db,
    embedBatch,
    target,
    graniteRows,
    completed,
    verifySampleSize,
    cosineThreshold,
    activeFilter,
    sampleSeed,
    sqliteVecAvailable,
  });

  return {
    target_model: GRANITE_BACKFILL_MODEL,
    dimension: GRANITE_BACKFILL_DIMENSION,
    target_observations: target,
    granite_rows: graniteRows,
    embedded_this_run: embedded,
    completed,
    dry_run: false,
    elapsed_seconds: (performance.now() - startedAt) / 1000,
    throughput_per_s: throughput,
    verification,
    generated_at: now,
  };
}

async function verifyBackfill(args: {
  db: Database;
  embedBatch: BackfillEmbedBatch;
  target: number;
  graniteRows: number;
  completed: boolean;
  verifySampleSize: number;
  cosineThreshold: number;
  activeFilter: string;
  sampleSeed: number;
  sqliteVecAvailable: boolean;
}): Promise<GraniteBackfillVerification> {
  const {
    db,
    embedBatch,
    target,
    graniteRows,
    completed,
    verifySampleSize,
    cosineThreshold,
    activeFilter,
    sampleSeed,
    sqliteVecAvailable,
  } = args;

  // Recompute the gap against the *live* tables here, not the run-start `target`
  // snapshot. A live ingest that lands after the snapshot (or after the final
  // embed batch) would otherwise slip through: it neither shows up in `target` nor
  // necessarily breaks a `granite_rows === target` equality. Gating on
  // `missing === 0` directly is the correct invariant for "every active row is
  // covered" regardless of concurrent inserts.
  const missingRows = countMissingActiveGraniteRows(db, activeFilter);
  const rowCountMatch = missingRows === 0;
  const staleRows = countStaleGraniteRows(db, activeFilter);
  const sidecarRows = sqliteVecAvailable ? countSidecarRows(db, activeFilter) : null;
  // sidecar parity is only meaningful — and only enforced — when vec0 is loaded.
  // Available + joined-count != active granite-384 count => the index is partial,
  // so post-flip global vector search would silently fall back to a bounded JS scan.
  const sidecarOk = !sqliteVecAvailable || sidecarRows === graniteRows;

  const backfilledIds = (
    db
      .query(
        `SELECT o.id AS id
         FROM mem_observations o
         JOIN mem_vectors v ON v.observation_id = o.id AND v.model = ? AND v.dimension = ?
         WHERE ${activeFilter}
         ORDER BY o.id ASC`,
      )
      .all(GRANITE_BACKFILL_MODEL, GRANITE_BACKFILL_DIMENSION) as Array<{ id: string }>
  ).map((row) => row.id);

  const sample = sampleIds(backfilledIds, Math.max(0, verifySampleSize), sampleSeed);
  let minCosine: number | null = null;

  if (sample.length > 0) {
    const rows = db
      .query(
        `SELECT o.id AS id, o.content_redacted AS content_redacted, o.raw_text AS raw_text,
                v.vector_json AS vector_json
         FROM mem_observations o
         JOIN mem_vectors v ON v.observation_id = o.id AND v.model = ? AND v.dimension = ?
         WHERE o.id IN (${sample.map(() => "?").join(",")})`,
      )
      .all(GRANITE_BACKFILL_MODEL, GRANITE_BACKFILL_DIMENSION, ...sample) as Array<{
      id: string;
      content_redacted: string;
      raw_text: string | null;
      vector_json: string;
    }>;

    // Re-embed from the *same* source the run embedded from, or the cosine check
    // compares vectors built from different text and falsely fails on raw_text rows.
    const reembedded = await embedBatch(rows.map((row) => embeddingSource(row)));
    minCosine = 1;
    for (let i = 0; i < rows.length; i += 1) {
      const stored = JSON.parse(rows[i].vector_json) as number[];
      const c = cosine(stored, reembedded[i]);
      if (c < (minCosine ?? 1)) minCosine = c;
    }
  }

  const cosineOk = sample.length === 0 ? false : (minCosine ?? 0) >= cosineThreshold;
  const passed = completed && rowCountMatch && cosineOk && staleRows === 0 && sidecarOk;

  return {
    row_count_match: rowCountMatch,
    target_observations: target,
    granite_rows: graniteRows,
    missing_rows: missingRows,
    sample_size: sample.length,
    min_cosine: minCosine,
    cosine_threshold: cosineThreshold,
    stale_rows: staleRows,
    sqlite_vec_available: sqliteVecAvailable,
    sidecar_rows: sidecarRows,
    passed,
  };
}
