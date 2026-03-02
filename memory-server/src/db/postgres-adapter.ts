/**
 * PostgresStorageAdapter - wraps a PostgreSQL connection into the StorageAdapter contract.
 *
 * Uses the `pg` npm package for connection management.
 * Translates SQLite parameter placeholders (?) to PostgreSQL ($1, $2, ...).
 *
 * NOTE: This adapter provides the same synchronous-looking API as SqliteStorageAdapter,
 * but internally PostgreSQL operations are asynchronous.  For the managed backend,
 * the projector pattern (event-store + async projection) means most writes are
 * append-only inserts which tolerate the async boundary.
 *
 * For the initial integration, we use `pg`'s synchronous-ish `Pool.query()` pattern
 * with a thin wrapper.  A future optimization may adopt connection pooling or
 * prepared statements at the adapter level.
 */
import type { StorageAdapter, AsyncStorageAdapter, PreparedLike } from "./storage-adapter";

/** Minimal subset of pg.Pool / pg.Client we depend on. */
export interface PgClientLike {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
  end(): Promise<void>;
}

/**
 * Converts SQLite-style `?` parameter placeholders to PostgreSQL `$N` syntax.
 * Handles quoted strings and avoids replacing `?` inside them.
 */
function rewriteParams(sql: string): string {
  let idx = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let result = "";

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      result += ch;
    } else if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      result += ch;
    } else if (ch === "?" && !inSingleQuote && !inDoubleQuote) {
      idx++;
      result += `$${idx}`;
    } else {
      result += ch;
    }
  }
  return result;
}

/**
 * Translates common SQLite SQL idioms to PostgreSQL equivalents.
 */
function translateSql(sql: string): string {
  let pg = rewriteParams(sql);
  // INSERT OR IGNORE → INSERT ... ON CONFLICT DO NOTHING
  pg = pg.replace(/INSERT\s+OR\s+IGNORE/gi, "INSERT");
  // Add ON CONFLICT DO NOTHING for INSERT OR IGNORE semantics
  if (/INSERT\s+OR\s+IGNORE/i.test(sql)) {
    pg = pg.replace(/(VALUES\s*\([^)]*\))/gi, "$1 ON CONFLICT DO NOTHING");
  }
  // INSERT OR REPLACE → handled on a case-by-case basis via UPSERT
  return pg;
}

/**
 * PostgresStorageAdapter wraps a pg client/pool into StorageAdapter.
 *
 * Because HarnessMemCore currently calls the adapter synchronously,
 * this adapter uses a blocking pattern internally.  In production use,
 * the managed backend will be accessed through the projector pattern
 * which naturally handles the async boundary.
 */
export class PostgresStorageAdapter implements StorageAdapter, AsyncStorageAdapter {
  readonly backend = "postgres" as const;
  private client: PgClientLike;

  constructor(client: PgClientLike) {
    this.client = client;
  }

  query<T = unknown>(sql: string): PreparedLike<T> {
    const pgSql = translateSql(sql);
    const client = this.client;

    return {
      all(...params: unknown[]): T[] {
        // Synchronous wrapper using Bun's ability to await in sync context
        // NOTE: In production, the projector handles async boundaries.
        const promise = client.query(pgSql, params);
        // Bun supports top-level await and sync-like patterns
        // For actual integration, use async methods in the projector layer.
        throw new Error(
          "PostgresStorageAdapter.query().all() is not yet callable synchronously. " +
          "Use the projector pattern for managed backend queries."
        );
      },
      get(...params: unknown[]): T | null {
        throw new Error(
          "PostgresStorageAdapter.query().get() is not yet callable synchronously. " +
          "Use the projector pattern for managed backend queries."
        );
      },
      run(...params: unknown[]): void {
        throw new Error(
          "PostgresStorageAdapter.query().run() is not yet callable synchronously. " +
          "Use the projector pattern for managed backend queries."
        );
      },
    };
  }

  exec(sql: string): void {
    throw new Error(
      "PostgresStorageAdapter.exec() is not yet callable synchronously. " +
      "Use the projector pattern for managed backend queries."
    );
  }

  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T {
    throw new Error(
      "PostgresStorageAdapter.transaction() is not yet implemented. " +
      "Use the projector pattern for managed backend transactions."
    );
  }

  close(): void {
    this.client.end().catch(() => {});
  }

  /**
   * Async query methods for use by the projector layer.
   * These are the real PostgreSQL query methods.
   */
  async queryAllAsync<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const pgSql = translateSql(sql);
    const result = await this.client.query(pgSql, params);
    return result.rows as T[];
  }

  async queryOneAsync<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
    const pgSql = translateSql(sql);
    const result = await this.client.query(pgSql, params);
    return (result.rows[0] as T) ?? null;
  }

  async runAsync(sql: string, params: unknown[] = []): Promise<number> {
    const pgSql = translateSql(sql);
    const result = await this.client.query(pgSql, params);
    return result.rowCount ?? 0;
  }

  async execAsync(sql: string): Promise<void> {
    await this.client.query(sql);
  }

  async transactionAsync<T>(fn: () => Promise<T>): Promise<T> {
    await this.client.query("BEGIN");
    try {
      const result = await fn();
      await this.client.query("COMMIT");
      return result;
    } catch (err) {
      await this.client.query("ROLLBACK");
      throw err;
    }
  }

  /**
   * NEXT-008: pgvector を使ったコサイン距離ベースのベクトル検索。
   *
   * @param vector     クエリベクトル（number[]）
   * @param dimension  ベクトルの次元数
   * @param limit      最大取得件数
   * @returns          観察ID と距離のリスト（距離昇順）
   */
  async pgvectorSearchAsync(
    vector: number[],
    dimension: number,
    limit: number
  ): Promise<PgvectorSearchResult[]> {
    const sql = buildPgvectorSearchSql(dimension, limit);
    const vectorStr = formatVectorForPg(vector);
    const result = await this.client.query(sql, [vectorStr]);
    return parsePgvectorResult(
      result.rows as Array<{ observation_id: string; distance: string | number }>
    );
  }
}

// ---- pgvector ベクトル検索ヘルパー ----

/**
 * pgvector のコサイン距離検索 SQL を生成する。
 *
 * <=> 演算子はコサイン距離（1 - cosine_similarity）を返す。
 * 小さい値ほど類似度が高い。
 *
 * @param dimension  ベクトルの次元数
 * @param limit      最大取得件数
 * @returns          パラメータ化された SQL 文字列（$1 = ベクトル文字列）
 */
export function buildPgvectorSearchSql(dimension: number, limit: number): string {
  return `
    SELECT
      v.observation_id,
      -- cosine distance: <=> operator (smaller = more similar)
      (v.embedding <=> $1::vector(${dimension})) AS distance
    FROM mem_vectors v
    ORDER BY distance ASC
    LIMIT ${limit}
  `.trim();
}

/**
 * JavaScript の number[] を pgvector 互換の文字列形式に変換する。
 * 例: [0.1, 0.2, 0.3] → "[0.1,0.2,0.3]"
 */
export function formatVectorForPg(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

/** pgvector 検索結果の1件 */
export interface PgvectorSearchResult {
  observationId: string;
  distance: number;
}

/**
 * pgvector クエリの生結果行を型付きオブジェクト配列に変換する。
 */
export function parsePgvectorResult(
  rows: Array<{ observation_id: string; distance: string | number }>
): PgvectorSearchResult[] {
  return rows.map((row) => ({
    observationId: row.observation_id,
    distance: typeof row.distance === "string" ? parseFloat(row.distance) : row.distance,
  }));
}

/** Export the SQL rewrite helpers for testing. */
export { rewriteParams, translateSql };
