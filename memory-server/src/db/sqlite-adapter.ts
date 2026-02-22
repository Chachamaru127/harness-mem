/**
 * SqliteStorageAdapter - wraps bun:sqlite Database into the StorageAdapter contract.
 *
 * This is a thin pass-through: the bun:sqlite Database already exposes
 * .query(), .exec(), and .transaction() with the exact same signatures
 * the adapter interface requires.
 */
import { Database } from "bun:sqlite";
import type { StorageAdapter, PreparedLike } from "./storage-adapter";

export class SqliteStorageAdapter implements StorageAdapter {
  readonly backend = "sqlite" as const;
  private readonly db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { create: true, strict: false });
  }

  query<T = unknown>(sql: string): PreparedLike<T> {
    return this.db.query(sql) as unknown as PreparedLike<T>;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T {
    return this.db.transaction(fn as () => T) as (...args: unknown[]) => T;
  }

  close(): void {
    this.db.close();
  }

  /**
   * Expose the raw bun:sqlite Database for SQLite-specific operations
   * (FTS5, sqlite-vec, PRAGMA) that have no cross-backend equivalent.
   */
  get raw(): Database {
    return this.db;
  }
}
