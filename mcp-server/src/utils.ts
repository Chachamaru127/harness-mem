/**
 * Shared Utilities for Harness MCP Server
 *
 * Common functions used across multiple tool modules.
 */

import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";

// Promisified exec for async operations
export const execAsync = promisify(exec);

// ===== Configuration Constants =====

/** Session is considered stale after this many seconds (1 hour) */
export const STALE_THRESHOLD_SECONDS = 3600;

/** Maximum number of broadcast messages to retain */
export const MAX_BROADCAST_MESSAGES = 100;

/** Directory for session state files */
export const SESSIONS_DIR = ".claude/sessions";

/** Active sessions file path */
export const ACTIVE_SESSIONS_FILE = `${SESSIONS_DIR}/active.json`;

/** Broadcast messages file path (Markdown format for CLI compatibility) */
export const BROADCAST_FILE = `${SESSIONS_DIR}/broadcast.md`;

// ===== File System Utilities =====

/**
 * Find the project root by looking for common markers.
 * Traverses up the directory tree until a marker is found.
 * Compatible with both Unix and Windows file systems.
 *
 * @returns The project root path, or current working directory if not found
 */
export function getProjectRoot(): string {
  const markers = [".git", "package.json", "Plans.md", ".claude"];
  let current = process.cwd();

  // Use path.parse for cross-platform root detection
  // On Unix: root = "/"
  // On Windows: root = "C:\\" etc.
  const { root } = path.parse(current);

  while (current !== root) {
    for (const marker of markers) {
      if (fs.existsSync(path.join(current, marker))) {
        return current;
      }
    }
    current = path.dirname(current);
  }

  return process.cwd();
}

/**
 * Find the project root starting from an explicit caller path.
 * Unlike getProjectRoot(), this never falls back to the MCP server cwd unless
 * the caller explicitly passed that cwd.
 */
export function getProjectRootFrom(startPath: string): string {
  const markers = [".git", "package.json", "Plans.md", ".claude"];
  let current = path.resolve(startPath);

  if (fs.existsSync(current) && fs.statSync(current).isFile()) {
    current = path.dirname(current);
  }

  const { root } = path.parse(current);

  while (current !== root) {
    for (const marker of markers) {
      if (fs.existsSync(path.join(current, marker))) {
        return current;
      }
    }
    current = path.dirname(current);
  }

  return path.resolve(startPath);
}

export interface PlansScopeArgs {
  cwd?: string;
  project?: string;
  plans_path?: string;
}

export interface PlansTarget {
  projectRoot: string;
  plansPath: string;
  source: "cwd" | "project" | "plans_path";
}

export type PlansTargetResolution =
  | { ok: true; target: PlansTarget }
  | { ok: false; message: string };

function normalizeScopeValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isSubpathOrEqual(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function realpathExistingDir(dirPath: string): string | null {
  if (!fs.existsSync(dirPath)) {
    return null;
  }
  const stat = fs.statSync(dirPath);
  if (!stat.isDirectory()) {
    return null;
  }
  return fs.realpathSync(dirPath);
}

function resolveSafePlansPath(plansPath: string, realRoot: string): PlansTargetResolution {
  const parent = realpathExistingDir(path.dirname(plansPath));
  if (!parent) {
    return { ok: false, message: "invalid_scope: Plans.md parent must be an existing directory" };
  }
  const normalizedPlansPath = path.join(parent, "Plans.md");
  if (fs.existsSync(normalizedPlansPath)) {
    const stat = fs.lstatSync(normalizedPlansPath);
    if (stat.isDirectory()) {
      return { ok: false, message: "invalid_scope: Plans.md path must not be a directory" };
    }
    const realFile = fs.realpathSync(normalizedPlansPath);
    if (!isSubpathOrEqual(realFile, realRoot)) {
      return { ok: false, message: "invalid_scope: Plans.md realpath must stay within the resolved project root" };
    }
  } else if (!isSubpathOrEqual(normalizedPlansPath, realRoot)) {
    return { ok: false, message: "invalid_scope: plans_path must stay within the resolved project root" };
  }
  return { ok: true, target: { projectRoot: realRoot, plansPath: normalizedPlansPath, source: "plans_path" } };
}

/**
 * Resolve a filesystem-backed Plans.md target from explicit caller scope.
 * This is intentionally separate from memory project-key normalization:
 * short project keys are logical memory scopes, not safe filesystem locations.
 */
export function resolvePlansTarget(args: PlansScopeArgs | undefined): PlansTargetResolution {
  const cwd = normalizeScopeValue(args?.cwd);
  const project = normalizeScopeValue(args?.project);
  const plansPathArg = normalizeScopeValue(args?.plans_path);

  let scopedRoot: string | null = null;
  let source: PlansTarget["source"] | null = null;

  if (cwd) {
    if (!path.isAbsolute(cwd)) {
      return { ok: false, message: "invalid_scope: cwd must be an absolute path" };
    }
    const realCwd = realpathExistingDir(cwd);
    if (!realCwd) {
      return { ok: false, message: "invalid_scope: cwd must be an existing directory" };
    }
    scopedRoot = getProjectRootFrom(realCwd);
    source = "cwd";
  } else if (project) {
    if (!path.isAbsolute(project)) {
      return {
        ok: false,
        message:
          "invalid_scope: project must be an absolute filesystem path for Plans.md operations; pass cwd for short project keys",
      };
    }
    const realProject = realpathExistingDir(project);
    if (!realProject) {
      return { ok: false, message: "invalid_scope: project must be an existing directory" };
    }
    scopedRoot = getProjectRootFrom(realProject);
    source = "project";
  }

  if (plansPathArg) {
    if (!path.isAbsolute(plansPathArg)) {
      return { ok: false, message: "invalid_scope: plans_path must be an absolute path" };
    }
    if (path.basename(plansPathArg) !== "Plans.md") {
      return { ok: false, message: "invalid_scope: plans_path must point to a Plans.md file" };
    }
    const parent = realpathExistingDir(path.dirname(plansPathArg));
    if (!parent) {
      return { ok: false, message: "invalid_scope: plans_path parent must be an existing directory" };
    }
    const projectRoot = scopedRoot ?? getProjectRootFrom(parent);
    const realRoot = realpathExistingDir(projectRoot);
    if (!realRoot) {
      return { ok: false, message: "invalid_scope: resolved project root must be an existing directory" };
    }
    const safePlansPath = resolveSafePlansPath(path.join(parent, "Plans.md"), realRoot);
    if (!safePlansPath.ok) {
      return safePlansPath;
    }
    return { ok: true, target: { ...safePlansPath.target, source: "plans_path" } };
  }

  if (!scopedRoot || !source) {
    return {
      ok: false,
      message:
        "scope_required: pass cwd, an absolute filesystem project path, or plans_path so Plans.md file operations do not use the MCP server cwd",
    };
  }

  const realRoot = realpathExistingDir(scopedRoot);
  if (!realRoot) {
    return { ok: false, message: "invalid_scope: resolved project root must be an existing directory" };
  }
  const safePlansPath = resolveSafePlansPath(path.join(realRoot, "Plans.md"), realRoot);
  if (!safePlansPath.ok) {
    return safePlansPath;
  }
  return {
    ok: true,
    target: {
      ...safePlansPath.target,
      source,
    },
  };
}

/**
 * Ensure a directory exists, creating it if necessary.
 *
 * @param dirPath - The directory path to ensure exists
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Safely parse JSON from a file with error logging.
 *
 * @param filePath - Path to the JSON file
 * @param defaultValue - Default value if file doesn't exist or parse fails
 * @returns Parsed JSON or default value
 */
export function safeReadJSON<T>(filePath: string, defaultValue: T): T {
  if (!fs.existsSync(filePath)) {
    return defaultValue;
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[harness-mcp] Failed to parse JSON from ${filePath}: ${message}`);
    return defaultValue;
  }
}

/**
 * Safely write JSON to a file with error logging.
 *
 * @param filePath - Path to write the JSON file
 * @param data - Data to serialize and write
 * @returns true if successful, false otherwise
 */
export function safeWriteJSON<T>(filePath: string, data: T): boolean {
  try {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[harness-mcp] Failed to write JSON to ${filePath}: ${message}`);
    return false;
  }
}

// ===== Git Utilities =====

/**
 * Validate that a path is safe for use in shell commands.
 * Prevents command injection by rejecting paths with dangerous characters.
 *
 * @param inputPath - The path to validate
 * @returns true if the path is safe, false otherwise
 */
export function isValidPath(inputPath: string): boolean {
  // Reject empty paths
  if (!inputPath || inputPath.trim() === "") {
    return false;
  }

  // Reject paths with command injection characters
  const dangerousChars = /[;&|`$(){}[\]<>'"\\!#*?~\n\r]/;
  if (dangerousChars.test(inputPath)) {
    return false;
  }

  // Reject paths with null bytes
  if (inputPath.includes("\0")) {
    return false;
  }

  // Normalize and check for path traversal beyond root
  const normalized = path.normalize(inputPath);
  if (normalized.startsWith("..")) {
    return false;
  }

  return true;
}

/**
 * Get list of recently changed files using git diff (async).
 * Validates the base path to prevent command injection.
 *
 * @param basePath - The repository path (validated for safety)
 * @returns Array of changed file paths
 */
export async function getRecentChangesAsync(basePath?: string): Promise<string[]> {
  // Validate basePath if provided to prevent command injection
  if (basePath !== undefined && !isValidPath(basePath)) {
    console.error(`[harness-mcp] Invalid path rejected: ${basePath}`);
    return [];
  }

  const cwd = basePath || getProjectRoot();

  // Additional check: ensure the directory exists and is accessible
  if (!fs.existsSync(cwd)) {
    return [];
  }

  try {
    const { stdout } = await execAsync("git diff --name-only HEAD~1", {
      cwd,
      encoding: "utf-8",
    });
    return stdout.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

// ===== Time Utilities =====

/**
 * Format a duration in seconds to a human-readable string.
 *
 * @param seconds - Duration in seconds
 * @returns Human-readable duration (e.g., "5m ago", "2h ago")
 */
export function formatTimeAgo(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  return `${Math.floor(seconds / 3600)}h ago`;
}
