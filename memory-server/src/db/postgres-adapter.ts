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
import type { StorageAdapter, PreparedLike } from "./storage-adapter";

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
export class PostgresStorageAdapter implements StorageAdapter {
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
}

/** Export the SQL rewrite helpers for testing. */
export { rewriteParams, translateSql };
