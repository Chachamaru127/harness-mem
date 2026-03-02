/**
 * StorageAdapter - backend-agnostic database abstraction.
 *
 * Mirrors the bun:sqlite Database usage pattern so that HarnessMemCore
 * can switch between SQLite and PostgreSQL without changing call sites.
 */

/** Result of a prepared query's .all / .get / .run methods. */
export interface PreparedLike<T = unknown> {
  all(...params: unknown[]): T[];
  get(...params: unknown[]): T | null;
  run(...params: unknown[]): void;
}

/**
 * Minimal contract that HarnessMemCore depends on.
 *
 * - `query(sql)` returns a PreparedLike object (cached / reusable).
 * - `exec(sql)` runs DDL or multi-statement SQL without return values.
 * - `transaction(fn)` wraps `fn` in a database transaction and returns
 *   a function that, when called, executes `fn` within the transaction.
 */
export interface StorageAdapter {
  /** Returns a re-usable query handle. */
  query<T = unknown>(sql: string): PreparedLike<T>;

  /** Executes raw DDL / PRAGMA (no results). */
  exec(sql: string): void;

  /** Wraps `fn` in a transaction; returns a callable. */
  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T;

  /**
   * Underlying backend kind.  Useful for feature-gating SQL dialect
   * differences (FTS5 vs tsvector, sqlite-vec vs pgvector, etc.).
   */
  readonly backend: "sqlite" | "postgres";

  /** Close / release the underlying connection. */
  close(): void;
}

/**
 * Async storage operations for backends that require asynchronous I/O (e.g. PostgreSQL).
 * Adapters implementing this interface can be used by the Repository layer (Phase 2+).
 */
export interface AsyncStorageAdapter {
  queryAllAsync<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOneAsync<T = unknown>(sql: string, params?: unknown[]): Promise<T | null>;
  runAsync(sql: string, params?: unknown[]): Promise<number>;
  execAsync(sql: string): Promise<void>;
  transactionAsync<T>(fn: () => Promise<T>): Promise<T>;
}

/** Factory signature consumed by HarnessMemCore. */
export type StorageAdapterFactory = (config: StorageAdapterConfig) => StorageAdapter;

export interface StorageAdapterConfig {
  backendMode: "local" | "managed" | "hybrid";
  /** SQLite database file path (used when backend includes local). */
  dbPath?: string;
  /** PostgreSQL connection string (used when backend includes managed). */
  managedEndpoint?: string;
  managedApiKey?: string;
}
