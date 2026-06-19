import { type Database } from "bun:sqlite";
import { resolveSqliteVecExtensionPath } from "../db/custom-sqlite-preflight";

export type VectorEngine = "js-fallback" | "sqlite-vec" | "disabled";
const LEGACY_SQLITE_VEC_TABLE = "mem_vectors_vec";
const LEGACY_SQLITE_VEC_MAP_TABLE = "mem_vectors_vec_map";

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1)
    .slice(0, 4096);
}

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function embedText(text: string, dim: number): number[] {
  const vector = new Array<number>(dim).fill(0);
  const tokens = tokenize(text);

  if (tokens.length === 0) {
    return vector;
  }

  for (const token of tokens) {
    const hash = hashToken(token);
    const index = hash % dim;
    const sign = hash % 2 === 0 ? 1 : -1;
    vector[index] += sign;
  }

  let norm = 0;
  for (const value of vector) {
    norm += value * value;
  }
  norm = Math.sqrt(norm);
  if (norm === 0) {
    return vector;
  }

  for (let i = 0; i < vector.length; i += 1) {
    vector[i] = vector[i] / norm;
  }
  return vector;
}

export function cosineSimilarity(lhs: number[], rhs: number[]): number {
  const dim = Math.min(lhs.length, rhs.length);
  if (dim === 0) {
    return 0;
  }

  let dot = 0;
  let lhsNorm = 0;
  let rhsNorm = 0;
  for (let i = 0; i < dim; i += 1) {
    dot += lhs[i] * rhs[i];
    lhsNorm += lhs[i] * lhs[i];
    rhsNorm += rhs[i] * rhs[i];
  }

  if (lhsNorm === 0 || rhsNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(lhsNorm) * Math.sqrt(rhsNorm));
}

export function normalizeScoreMap(raw: Map<string, number>): Map<string, number> {
  if (raw.size === 0) {
    return new Map<string, number>();
  }

  let minValue = Number.POSITIVE_INFINITY;
  let maxValue = Number.NEGATIVE_INFINITY;
  for (const value of raw.values()) {
    minValue = Math.min(minValue, value);
    maxValue = Math.max(maxValue, value);
  }

  if (maxValue === minValue) {
    const normalized = new Map<string, number>();
    for (const key of raw.keys()) {
      normalized.set(key, 1);
    }
    return normalized;
  }

  const normalized = new Map<string, number>();
  for (const [key, value] of raw.entries()) {
    normalized.set(key, (value - minValue) / (maxValue - minValue));
  }

  return normalized;
}

export function resolveVectorEngine(
  db: Database,
  retrievalEnabled: boolean,
  vectorDimension: number
): { engine: VectorEngine; vecTableReady: boolean } {
  if (!retrievalEnabled) {
    return { engine: "disabled", vecTableReady: false };
  }

  const extensionPath = resolveSqliteVecExtensionPath();
  if (!extensionPath) {
    return { engine: "js-fallback", vecTableReady: false };
  }

  try {
    const dbAny = db as unknown as { loadExtension?: (path: string) => void };
    dbAny.loadExtension?.(extensionPath);
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${LEGACY_SQLITE_VEC_TABLE} USING vec0(embedding float[${vectorDimension}]);`);
    return { engine: "sqlite-vec", vecTableReady: true };
  } catch {
    return { engine: "js-fallback", vecTableReady: false };
  }
}

function normalizeSqliteIdentifierPart(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized.slice(0, 48) : "default";
}

export function getSqliteVecTableName(model: string): string {
  return `mem_vectors_vec_${normalizeSqliteIdentifierPart(model)}`;
}

export function getSqliteVecMapTableName(model: string): string {
  return `mem_vectors_vec_map_${normalizeSqliteIdentifierPart(model)}`;
}

// ---- s154-B: binary coarse prefilter (DENSE leg only, default-OFF) ----

/**
 * Sign-based quantization: dim_i > 0 → bit=1, otherwise bit=0.
 * Packs bits into bytes: 384-dim float → 48-byte Uint8Array (8 bits/byte, MSB first).
 * vec0(bit[384]) requires exactly ceil(N/8) bytes — NOT N bytes.
 */
export function quantizeToBits(vector: number[] | Float32Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(vector.length / 8));
  for (let i = 0; i < vector.length; i++) {
    if ((vector as number[])[i] > 0) out[i >> 3] |= (1 << (7 - (i & 7)));
  }
  return out;
}

export function getBitTableName(model: string): string {
  return `mem_vectors_bit_${normalizeSqliteIdentifierPart(model)}`;
}

export function getBitMapTableName(model: string): string {
  return `mem_vectors_bit_map_${normalizeSqliteIdentifierPart(model)}`;
}

export interface BitVecTableNames {
  tableName: string;
  mapTableName: string;
}

/**
 * Create (if not exists) a vec0(bit[N]) virtual table + companion map table.
 * Only valid when the sqlite-vec extension is already loaded.
 */
export function ensureBitVecTableForModel(
  db: Database,
  model: string,
  vectorDimension: number,
): BitVecTableNames {
  const safeDimension = Math.max(1, Math.trunc(vectorDimension));
  const tableName = getBitTableName(model);
  const mapTableName = getBitMapTableName(model);

  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${tableName} USING vec0(embedding bit[${safeDimension}]);`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${mapTableName} (
      rowid INTEGER PRIMARY KEY,
      observation_id TEXT NOT NULL UNIQUE,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(observation_id) REFERENCES mem_observations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_${mapTableName}_observation
      ON ${mapTableName}(observation_id);
  `);

  return { tableName, mapTableName };
}

export interface BitVecUpsertOptions {
  model?: string;
  vectorDimension?: number;
}

/**
 * Upsert a bit-quantized companion row.
 * Returns true on success, false on any failure (graceful degradation).
 */
export function upsertBitVecRow(
  db: Database,
  observationId: string,
  bits: Uint8Array,
  updatedAt: string,
  options: BitVecUpsertOptions = {},
): boolean {
  try {
    const hasModelSpecificTarget =
      typeof options.model === "string" &&
      options.model.length > 0 &&
      typeof options.vectorDimension === "number" &&
      Number.isFinite(options.vectorDimension);

    if (!hasModelSpecificTarget) {
      return false;
    }

    const tableName = getBitTableName(options.model!);
    const mapTableName = getBitMapTableName(options.model!);

    // Check tables exist (may not be created if extension failed to load)
    const tableCount = db
      .query<{ count: number }, [string, string]>(
        `SELECT COUNT(*) AS count FROM sqlite_master WHERE type IN ('table', 'shadow') AND name IN (?, ?)`
      )
      .get(tableName, mapTableName);
    if (Number(tableCount?.count ?? 0) < 2) {
      return false;
    }

    const mapRow = db
      .query<{ rowid: number }, [string]>(`SELECT rowid FROM ${mapTableName} WHERE observation_id = ?`)
      .get(observationId);

    if (typeof mapRow?.rowid === "number") {
      // vec0(bit[N]) virtual tables do not support UPDATE SET embedding — must delete+reinsert.
      // The rowid is preserved via the companion map table.
      db.query(`DELETE FROM ${tableName} WHERE rowid = ?`).run(mapRow.rowid);
      db.query(`INSERT INTO ${tableName}(rowid, embedding) VALUES (?, vec_bit(?))`).run(mapRow.rowid, bits);
      db.query(`UPDATE ${mapTableName} SET updated_at = ? WHERE rowid = ?`).run(updatedAt, mapRow.rowid);
      return true;
    }

    db.query(`INSERT INTO ${tableName}(embedding) VALUES (vec_bit(?))`).run(bits);
    const lastRow = db.query<{ rowid: number }, []>(`SELECT last_insert_rowid() AS rowid`).get();
    if (typeof lastRow?.rowid !== "number") {
      return false;
    }

    db.query(`
      INSERT OR REPLACE INTO ${mapTableName}(rowid, observation_id, updated_at)
      VALUES (?, ?, ?)
    `).run(lastRow.rowid, observationId, updatedAt);
    return true;
  } catch {
    return false;
  }
}

export type SqliteVecPayload = Float32Array | string;

function coerceFiniteVector(input: string | number[] | Float32Array): number[] | Float32Array | null {
  if (input instanceof Float32Array) {
    return input.length > 0 ? input : null;
  }

  const values = typeof input === "string" ? JSON.parse(input) : input;
  if (!Array.isArray(values)) {
    return null;
  }

  const vector: number[] = [];
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return null;
    }
    vector.push(value);
  }
  return vector.length > 0 ? vector : null;
}

export function serializeSqliteVecFloat32(input: string | number[] | Float32Array): SqliteVecPayload {
  try {
    const vector = coerceFiniteVector(input);
    if (!vector) {
      return typeof input === "string" ? input : JSON.stringify(Array.from(input));
    }
    return vector instanceof Float32Array ? vector : new Float32Array(vector);
  } catch {
    return typeof input === "string" ? input : JSON.stringify(Array.from(input));
  }
}

export function buildSqliteVecKnnCandidateSql(tableName: string, mapTableName: string): string {
  return `
    SELECT
      c.id AS id,
      c.distance AS distance,
      o.created_at AS created_at
    FROM (
      SELECT
        m.observation_id AS id,
        v.distance AS distance
      FROM ${tableName} v
      JOIN ${mapTableName} m ON m.rowid = v.rowid
      WHERE v.embedding MATCH vec_f32(?) AND k = ?
    ) c
    JOIN mem_observations o ON o.id = c.id
    WHERE 1 = 1
  `;
}

export function ensureSqliteVecTableForModel(
  db: Database,
  model: string,
  vectorDimension: number,
): { tableName: string; mapTableName: string } {
  const safeDimension = Math.max(1, Math.trunc(vectorDimension));
  const tableName = getSqliteVecTableName(model);
  const mapTableName = getSqliteVecMapTableName(model);

  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${tableName} USING vec0(embedding float[${safeDimension}]);`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${mapTableName} (
      rowid INTEGER PRIMARY KEY,
      observation_id TEXT NOT NULL UNIQUE,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(observation_id) REFERENCES mem_observations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_${mapTableName}_observation
      ON ${mapTableName}(observation_id);
    CREATE INDEX IF NOT EXISTS idx_${mapTableName}_updated_at_observation
      ON ${mapTableName}(updated_at, observation_id);
  `);

  return { tableName, mapTableName };
}

function deleteSqliteVecRowFromTables(
  db: Database,
  observationId: string,
  tableName: string,
  mapTableName: string,
): boolean {
  try {
    const mapRow = db
      .query(`SELECT rowid FROM ${mapTableName} WHERE observation_id = ?`)
      .get(observationId) as { rowid?: number } | null;

    if (typeof mapRow?.rowid !== "number") {
      return false;
    }

    db.query(`DELETE FROM ${tableName} WHERE rowid = ?`).run(mapRow.rowid);
    db.query(`DELETE FROM ${mapTableName} WHERE rowid = ?`).run(mapRow.rowid);
    return true;
  } catch {
    return false;
  }
}

export interface SqliteVecUpsertOptions {
  model?: string;
  vectorDimension?: number;
}

export function upsertSqliteVecRow(
  db: Database,
  observationId: string,
  vectorJson: string,
  updatedAt: string,
  options: SqliteVecUpsertOptions = {}
): boolean {
  try {
    const hasModelSpecificTarget =
      typeof options.model === "string" &&
      options.model.length > 0 &&
      typeof options.vectorDimension === "number" &&
      Number.isFinite(options.vectorDimension);

    const target = hasModelSpecificTarget
      ? ensureSqliteVecTableForModel(db, options.model!, options.vectorDimension!)
      : {
          tableName: LEGACY_SQLITE_VEC_TABLE,
          mapTableName: LEGACY_SQLITE_VEC_MAP_TABLE,
        };

    const mapRow = db
      .query(`SELECT rowid FROM ${target.mapTableName} WHERE observation_id = ?`)
      .get(observationId) as { rowid?: number } | null;

    if (typeof mapRow?.rowid === "number") {
      // vec_f32() wrapper required for reliable float binding (Lead verified)
      db.query(`UPDATE ${target.tableName} SET embedding = vec_f32(?) WHERE rowid = ?`)
        .run(serializeSqliteVecFloat32(vectorJson), mapRow.rowid);
      db.query(`UPDATE ${target.mapTableName} SET updated_at = ? WHERE rowid = ?`)
        .run(updatedAt, mapRow.rowid);
      return true;
    }

    db.query(`INSERT INTO ${target.tableName}(embedding) VALUES (vec_f32(?))`).run(serializeSqliteVecFloat32(vectorJson));
    const lastRow = db.query(`SELECT last_insert_rowid() AS rowid`).get() as { rowid?: number } | null;
    if (typeof lastRow?.rowid !== "number") {
      return false;
    }

    db.query(`
      INSERT OR REPLACE INTO ${target.mapTableName}(rowid, observation_id, updated_at)
      VALUES (?, ?, ?)
    `).run(lastRow.rowid, observationId, updatedAt);
    return true;
  } catch {
    return false;
  }
}

export function deleteSqliteVecRow(
  db: Database,
  observationId: string,
  model?: string,
): boolean {
  if (model) {
    const { tableName, mapTableName } = ensureSqliteVecTableForModel(db, model, 1);
    return deleteSqliteVecRowFromTables(db, observationId, tableName, mapTableName);
  }

  return deleteSqliteVecRowFromTables(
    db,
    observationId,
    LEGACY_SQLITE_VEC_TABLE,
    LEGACY_SQLITE_VEC_MAP_TABLE,
  );
}

// ---- NEXT-008: pgvector バックエンド統合ヘルパー ----

/**
 * number[] を pgvector が受け付ける文字列表現に変換する。
 * 例: [0.1, 0.2, 0.3] → "[0.1,0.2,0.3]"
 */
export function formatVectorForPg(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

/**
 * mem_vectors テーブルへのベクトル UPSERT SQL を返す。
 * パラメータ順: (observation_id, model, dimension, embedding::vector)
 */
export function buildPgVectorUpsertSql(): string {
  return `
    INSERT INTO mem_vectors(observation_id, model, dimension, embedding, created_at, updated_at)
    VALUES ($1, $2, $3, $4::vector, NOW(), NOW())
    ON CONFLICT(observation_id, model) DO UPDATE SET
      model = EXCLUDED.model,
      dimension = EXCLUDED.dimension,
      embedding = EXCLUDED.embedding,
      updated_at = NOW()
  `.trim();
}

/**
 * pgvector コサイン距離でベクトル検索する SQL を返す。
 * パラメータ順: (query_embedding::vector, [model])
 */
export function buildPgVectorSearchSql(dimension: number, limit = 50, model?: string): string {
  const safeLimit = Math.trunc(limit);
  const safeDimension = Math.max(1, Math.trunc(dimension));
  const filters = [`v.dimension = ${safeDimension}`];
  if (model) {
    filters.push("v.model = $2");
  }
  return `
    SELECT
      v.observation_id,
      1 - (v.embedding <=> $1::vector(${safeDimension})) AS cosine_similarity
    FROM mem_vectors v
    WHERE ${filters.join(" AND ")}
    ORDER BY v.embedding <=> $1::vector(${safeDimension})
    LIMIT ${safeLimit}
  `.trim();
}
