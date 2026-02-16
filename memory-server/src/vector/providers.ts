import { type Database } from "bun:sqlite";

export type VectorEngine = "js-fallback" | "sqlite-vec" | "disabled";

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

  const extensionPath = process.env.HARNESS_MEM_SQLITE_VEC_PATH;
  if (!extensionPath) {
    return { engine: "js-fallback", vecTableReady: false };
  }

  try {
    const dbAny = db as unknown as { loadExtension?: (path: string) => void };
    dbAny.loadExtension?.(extensionPath);
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS mem_vectors_vec USING vec0(embedding float[${vectorDimension}]);`);
    return { engine: "sqlite-vec", vecTableReady: true };
  } catch {
    return { engine: "js-fallback", vecTableReady: false };
  }
}

export function upsertSqliteVecRow(
  db: Database,
  observationId: string,
  vectorJson: string,
  updatedAt: string
): boolean {
  try {
    const mapRow = db
      .query(`SELECT rowid FROM mem_vectors_vec_map WHERE observation_id = ?`)
      .get(observationId) as { rowid?: number } | null;

    if (typeof mapRow?.rowid === "number") {
      db.query(`INSERT OR REPLACE INTO mem_vectors_vec(rowid, embedding) VALUES (?, ?)`)
        .run(mapRow.rowid, vectorJson);
      db.query(`UPDATE mem_vectors_vec_map SET updated_at = ? WHERE rowid = ?`)
        .run(updatedAt, mapRow.rowid);
      return true;
    }

    db.query(`INSERT INTO mem_vectors_vec(embedding) VALUES (?)`).run(vectorJson);
    const lastRow = db.query(`SELECT last_insert_rowid() AS rowid`).get() as { rowid?: number } | null;
    if (typeof lastRow?.rowid !== "number") {
      return false;
    }

    db.query(`
      INSERT OR REPLACE INTO mem_vectors_vec_map(rowid, observation_id, updated_at)
      VALUES (?, ?, ?)
    `).run(lastRow.rowid, observationId, updatedAt);
    return true;
  } catch {
    return false;
  }
}
