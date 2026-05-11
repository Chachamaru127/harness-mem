import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";

export const DEFAULT_HOMEBREW_SQLITE_LIB_PATH = "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib";
export const DARWIN_SQLITE_VEC_PACKAGE = "sqlite-vec-darwin-arm64";
export const SQLITE_VEC_EXTENSION_FILENAME = "vec0.dylib";

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
  cwd?: string;
  moduleDir?: string;
  home?: string;
  readDir?: (path: string) => string[];
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

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function defaultRepoRoots(options: CustomSqlitePreflightOptions): string[] {
  const moduleDir = options.moduleDir ?? import.meta.dir;
  const cwd = options.cwd ?? process.cwd();
  return dedupe([
    cwd,
    resolve(moduleDir, "../../.."),
  ]);
}

function defaultBunCacheCandidates(
  options: CustomSqlitePreflightOptions,
  exists: (path: string) => boolean,
): string[] {
  const home = options.home ?? process.env.HOME ?? "";
  if (!home) {
    return [];
  }

  const cacheDir = join(home, ".bun", "install", "cache");
  if (!exists(cacheDir)) {
    return [];
  }

  const readDir = options.readDir ?? readdirSync;
  try {
    return readDir(cacheDir)
      .filter((entry) => entry.startsWith(`${DARWIN_SQLITE_VEC_PACKAGE}@`))
      .sort()
      .reverse()
      .map((entry) => join(cacheDir, entry, SQLITE_VEC_EXTENSION_FILENAME));
  } catch {
    return [];
  }
}

export function getDefaultSqliteVecExtensionCandidates(
  options: CustomSqlitePreflightOptions = {},
): string[] {
  const exists = options.exists ?? existsSync;
  const repoCandidates = defaultRepoRoots(options).map((root) =>
    join(root, "node_modules", DARWIN_SQLITE_VEC_PACKAGE, SQLITE_VEC_EXTENSION_FILENAME),
  );

  return dedupe([
    ...repoCandidates,
    ...defaultBunCacheCandidates(options, exists),
  ]);
}

export function resolveSqliteVecExtensionPath(
  options: CustomSqlitePreflightOptions = {},
): string | null {
  const env = options.env ?? process.env;
  const explicit = (env.HARNESS_MEM_SQLITE_VEC_PATH ?? "").trim();
  if (explicit) {
    return explicit;
  }

  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") {
    return null;
  }

  const exists = options.exists ?? existsSync;
  for (const candidate of getDefaultSqliteVecExtensionCandidates(options)) {
    if (exists(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Bun on macOS uses Apple's SQLite by default, which can reject dynamic
 * extension loading.  When sqlite-vec is enabled explicitly or discovered from
 * the macOS package default, switch Bun to a custom SQLite library before any
 * Database instance is created.
 */
export function configureBunCustomSqliteForSqliteVec(
  options: CustomSqlitePreflightOptions = {},
): CustomSqlitePreflightState {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? existsSync;
  const vectorExtensionPath = resolveSqliteVecExtensionPath({
    ...options,
    env,
    platform,
    exists,
  });
  if (!vectorExtensionPath) {
    return state({
      attempted: false,
      configured: configuredPath !== null,
      path: configuredPath,
      reason: platform === "darwin" ? "sqlite-vec-extension-not-found" : "not-required",
    });
  }

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
