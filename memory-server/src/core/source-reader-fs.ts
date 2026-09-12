import * as fs from "node:fs";
import { dirname, resolve } from "node:path";
import { fileUriToPath } from "./core-utils";

type ReadHooks = {
  enter(path: string, operation: string): void;
  leave(): void;
  beginFile(path: string): void;
};
let hooks: ReadHooks | null = null;
const descriptors = new Map<number, string>();

export function installSourceReadHooks(value: ReadHooks): void { hooks = value; }
export function beginSourceFile(path: string): void { hooks?.beginFile(path); }
export class SourceReaderDeferredError extends Error {
  constructor() { super("source_reference_pending"); this.name = "SourceReaderDeferredError"; }
}
export function sourceRead<T>(path: string, operation: string, run: () => T): T {
  hooks?.enter(path, operation);
  try { return run(); } finally { hooks?.leave(); }
}

export const existsSync: typeof fs.existsSync = (path) => sourceRead(String(path), "exists", () => fs.existsSync(path));
export const statSync: typeof fs.statSync = ((path: fs.PathLike, options?: unknown) =>
  sourceRead(String(path), "stat", () => fs.statSync(path, options as never))) as typeof fs.statSync;
export const readdirSync: typeof fs.readdirSync = ((path: fs.PathLike, options?: unknown) => {
  if (!hooks) return fs.readdirSync(path, options as never);
  // Enumerate one directory entry per OS call, so a blocked directory has its
  // own deadline and never hides behind a whole-source timeout.
  const dir = sourceRead(String(path), "readdir", () => fs.opendirSync(path));
  const entries: fs.Dirent[] = [];
  try {
    for (;;) {
      const entry = sourceRead(String(path), "readdir", () => dir.readSync());
      if (!entry) break;
      entries.push(entry);
    }
  } finally { sourceRead(String(path), "readdir", () => dir.closeSync()); }
  return typeof options === "object" && options && "withFileTypes" in options && options.withFileTypes
    ? entries : entries.map((entry) => entry.name);
}) as typeof fs.readdirSync;
export const readFileSync: typeof fs.readFileSync = ((path: fs.PathOrFileDescriptor, options?: unknown) =>
  sourceRead(typeof path === "number" ? descriptors.get(path) ?? "" : String(path), "read_file", () => fs.readFileSync(path, options as never))) as typeof fs.readFileSync;
export const openSync: typeof fs.openSync = ((path: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
  const fd = sourceRead(String(path), "open", () => fs.openSync(path, flags, mode));
  descriptors.set(fd, String(path));
  return fd;
}) as typeof fs.openSync;
export const readSync: typeof fs.readSync = ((fd: number, ...args: unknown[]) =>
  sourceRead(descriptors.get(fd) ?? "", "read", () => (fs.readSync as Function)(fd, ...args))) as typeof fs.readSync;
export const closeSync: typeof fs.closeSync = (fd) => {
  sourceRead(descriptors.get(fd) ?? "", "close", () => fs.closeSync(fd));
  descriptors.delete(fd);
};

// The workspace descriptor helper must use the same guarded source I/O as primary logs.
export function readSourceWorkspaceFile(workspacePath: string): string {
  try {
    const parsed = JSON.parse(readFileSync(workspacePath, "utf8"));
    for (const folder of Array.isArray(parsed.folders) ? parsed.folders : []) {
      if (typeof folder?.path === "string" && folder.path.trim()) return resolve(dirname(workspacePath), folder.path.trim());
    }
  } catch (error) {
    if (error instanceof SourceReaderDeferredError) throw error;
  }
  return dirname(workspacePath);
}

export function readSourceWorkspaceJson(workspaceJsonPath: string): string {
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(readFileSync(workspaceJsonPath, "utf8")); }
  catch (error) { if (error instanceof SourceReaderDeferredError) throw error; return ""; }
  const raw = typeof parsed?.folder === "string" ? parsed.folder : typeof parsed?.workspace === "string" ? parsed.workspace : "";
  if (!raw) return "";
  const path = fileUriToPath(raw);
  if (!path) return "";
  return path.endsWith(".code-workspace") ? readSourceWorkspaceFile(path) : resolve(path);
}
