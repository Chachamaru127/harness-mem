import { existsSync } from "node:fs";
import { Database } from "bun:sqlite";

export const DEFAULT_HOMEBREW_SQLITE_LIB_PATH = "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib";

export type CustomSqlitePreflightReason =
  | "not-required"
  | "unsupported-platform"
  | "sqlite-vec-extension-not-found"
  | "sqlite-library-not-found"
  | "set-custom-sqlite-unavailable"
  | "already-configured"
  | "configured"
  | "failed";

export interface CustomSqlitePreflightState {
  attempted: boolean;
  configured: boolean;
  path: string | null;
  reason: CustomSqlitePreflightReason;
  error?: string;
}

interface BunSqliteDatabaseConstructor {
  setCustomSQLite?: (path: string) => void;
}

interface CustomSqlitePreflightOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform | string;
  exists?: (path: string) => boolean;
  database?: BunSqliteDatabaseConstructor;
}

let configuredPath: string | null = null;
let lastState: CustomSqlitePreflightState = {
  attempted: false,
  configured: false,
  path: null,
  reason: "not-required",
};

function state(next: CustomSqlitePreflightState): CustomSqlitePreflightState {
  lastState = next;
  return { ...lastState };
}

function compactError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function getCustomSqlitePreflightState(): CustomSqlitePreflightState {
  return { ...lastState };
}

export function resetCustomSqlitePreflightForTests(): void {
  configuredPath = null;
  lastState = {
    attempted: false,
    configured: false,
    path: null,
    reason: "not-required",
  };
}

/**
 * Bun on macOS uses Apple's SQLite by default, which can reject dynamic
 * extension loading.  When sqlite-vec is explicitly enabled, switch Bun to a
 * custom SQLite library before any Database instance is created.
 */
export function configureBunCustomSqliteForSqliteVec(
  options: CustomSqlitePreflightOptions = {},
): CustomSqlitePreflightState {
  const env = options.env ?? process.env;
  const vectorExtensionPath = (env.HARNESS_MEM_SQLITE_VEC_PATH ?? "").trim();
  if (!vectorExtensionPath) {
    return state({
      attempted: false,
      configured: configuredPath !== null,
      path: configuredPath,
      reason: "not-required",
    });
  }

  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? existsSync;
  if (platform !== "darwin") {
    return state({
      attempted: false,
      configured: configuredPath !== null,
      path: configuredPath,
      reason: "unsupported-platform",
    });
  }

  if (!exists(vectorExtensionPath)) {
    return state({
      attempted: false,
      configured: configuredPath !== null,
      path: configuredPath,
      reason: "sqlite-vec-extension-not-found",
    });
  }

  const sqliteLibraryPath = (env.HARNESS_MEM_SQLITE_LIB_PATH ?? "").trim() || DEFAULT_HOMEBREW_SQLITE_LIB_PATH;
  if (!exists(sqliteLibraryPath)) {
    return state({
      attempted: false,
      configured: configuredPath !== null,
      path: sqliteLibraryPath,
      reason: "sqlite-library-not-found",
    });
  }

  if (configuredPath === sqliteLibraryPath) {
    return state({
      attempted: false,
      configured: true,
      path: sqliteLibraryPath,
      reason: "already-configured",
    });
  }

  const database = options.database ?? Database;
  if (typeof database.setCustomSQLite !== "function") {
    return state({
      attempted: false,
      configured: configuredPath !== null,
      path: sqliteLibraryPath,
      reason: "set-custom-sqlite-unavailable",
    });
  }

  try {
    database.setCustomSQLite(sqliteLibraryPath);
    configuredPath = sqliteLibraryPath;
    return state({
      attempted: true,
      configured: true,
      path: sqliteLibraryPath,
      reason: "configured",
    });
  } catch (error) {
    return state({
      attempted: true,
      configured: configuredPath !== null,
      path: sqliteLibraryPath,
      reason: "failed",
      error: compactError(error),
    });
  }
}
