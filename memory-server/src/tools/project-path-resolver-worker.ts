import { closeSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { ProjectPathResolution } from "../core/project-path-resolver";

function maybeStat(path: string) {
  try { return statSync(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function readMarker(path: string): string {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(16385);
    const length = readSync(fd, buffer, 0, buffer.length, 0);
    if (length > 16384) throw new Error("invalid_git");
    return buffer.subarray(0, length).toString("utf8").trim();
  } finally { closeSync(fd); }
}

function resolveProject(input: string): ProjectPathResolution {
  const unresolved = (reason: ProjectPathResolution["reason"]): ProjectPathResolution => ({ input, canonical: input, kind: "unresolved", reason });
  if (!input.startsWith("/") || input.includes("\0") || input.length > 8192) return unresolved("invalid_path");
  try {
    const original = realpathSync(input);
    if (!statSync(original).isDirectory()) return unresolved("invalid_path");
    let cursor = original;
    for (let depth = 0; depth < 64; depth++) {
      const marker = join(cursor, ".git");
      const info = maybeStat(marker);
      if (info?.isDirectory()) {
        if (maybeStat(join(marker, "HEAD"))?.isFile()) return { input, canonical: cursor, kind: "confirmed" };
      } else if (info?.isFile()) {
        const match = /^gitdir:\s*(.+)$/i.exec(readMarker(marker));
        if (!match) return unresolved("invalid_git");
        const gitDir = realpathSync(resolve(cursor, match[1]));
        if (!maybeStat(join(gitDir, "HEAD"))?.isFile()) return unresolved("invalid_git");
        const commonMarker = join(gitDir, "commondir");
        if (maybeStat(commonMarker)?.isFile()) {
          const common = realpathSync(resolve(gitDir, readMarker(commonMarker)));
          if (basename(common) === ".git" && maybeStat(join(common, "HEAD"))?.isFile()) {
            return { input, canonical: realpathSync(dirname(common)), kind: "confirmed" };
          }
          return unresolved("invalid_git");
        }
        const token = "/.git/worktrees/";
        const index = gitDir.indexOf(token);
        if (index > 0 && maybeStat(join(gitDir.slice(0, index), ".git", "HEAD"))?.isFile()) {
          return { input, canonical: realpathSync(gitDir.slice(0, index)), kind: "confirmed" };
        }
        return { input, canonical: cursor, kind: "confirmed" };
      } else if (info) {
        return unresolved("invalid_git");
      }
      const parent = dirname(cursor);
      if (parent === cursor) return { input, canonical: original, kind: "confirmed" };
      cursor = parent;
    }
    return unresolved("depth_limit");
  } catch {
    return unresolved("unreadable");
  }
}

// One request per process; no memory database or application Core is loaded.
try {
  const reader = Bun.stdin.stream().getReader();
  let request = "";
  let bytes = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 65536) throw new Error("protocol");
    request += decoder.decode(value, { stream: true });
  }
  request += decoder.decode();
  const input = JSON.parse(request).input;
  if (typeof input !== "string") throw new Error("protocol");
  const reply = JSON.stringify(resolveProject(input));
  if (Buffer.byteLength(reply) > 65536) throw new Error("protocol");
  await Bun.write(Bun.stdout, reply);
} catch {
  process.exitCode = 1;
}
