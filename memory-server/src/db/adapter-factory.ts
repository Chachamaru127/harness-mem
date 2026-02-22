/**
 * adapter-factory.ts - creates the appropriate StorageAdapter based on config.
 *
 * All modes use SQLite for synchronous reads (local cache).
 * ManagedBackend (separate layer) handles async PostgreSQL replication.
 *
 * managed mode: SQLite is local cache ONLY. Write SoT is PostgreSQL via ManagedBackend.
 *               HarnessMemCore MUST verify ManagedBackend is connected before treating
 *               writes as durable.
 */
import type { StorageAdapter, StorageAdapterConfig } from "./storage-adapter";
import { SqliteStorageAdapter } from "./sqlite-adapter";

export interface AdapterFactoryResult {
  adapter: StorageAdapter;
  /** True when managed backend MUST be connected for writes to be considered durable. */
  managedRequired: boolean;
}

export function createStorageAdapter(config: StorageAdapterConfig): AdapterFactoryResult {
  switch (config.backendMode) {
    case "local":
    case "hybrid":
      if (!config.dbPath) {
        throw new Error("dbPath is required for local/hybrid backend mode");
      }
      return {
        adapter: new SqliteStorageAdapter(config.dbPath),
        managedRequired: false,
      };

    case "managed":
      if (!config.dbPath) {
        throw new Error("dbPath is required (local cache) for managed backend mode");
      }
      if (!config.managedEndpoint) {
        throw new Error(
          "managedEndpoint is required for managed backend mode. " +
          "Set HARNESS_MEM_MANAGED_ENDPOINT or configure managed.endpoint in config.json"
        );
      }
      return {
        adapter: new SqliteStorageAdapter(config.dbPath),
        managedRequired: true,
      };

    default:
      throw new Error(`Unknown backend mode: ${config.backendMode}`);
  }
}
