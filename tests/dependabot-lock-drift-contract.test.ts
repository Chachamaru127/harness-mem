import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type PackageLock = {
  packages: Record<string, { version?: string }>;
};

const ROOT = process.cwd();

const ROOT_LOCK_PACKAGES = [
  "protobufjs",
  "@protobufjs/codegen",
  "@protobufjs/eventemitter",
  "@protobufjs/fetch",
  "@protobufjs/inquire",
  "@protobufjs/utf8",
] as const;

const MCP_LOCK_PACKAGES = [
  "@hono/node-server",
  "express-rate-limit",
  "fast-uri",
  "hono",
  "ip-address",
  "path-to-regexp",
  "qs",
] as const;

function readPackageLock(path: string): PackageLock {
  return JSON.parse(readFileSync(path, "utf8")) as PackageLock;
}

function packageLockVersion(lock: PackageLock, name: string): string {
  const version = lock.packages[`node_modules/${name}`]?.version;
  expect(version, `${name} missing from package-lock.json`).toBeString();
  return version as string;
}

function bunLockVersion(lockText: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = lockText.match(new RegExp(`^\\s+"${escaped}": \\["${escaped}@([^"]+)"`, "m"));
  expect(match?.[1], `${name} missing from bun.lock`).toBeString();
  return match?.[1] as string;
}

function expectLocksAligned(rootDir: string, packages: readonly string[]) {
  const packageLock = readPackageLock(join(rootDir, "package-lock.json"));
  const bunLock = readFileSync(join(rootDir, "bun.lock"), "utf8");

  for (const name of packages) {
    expect(bunLockVersion(bunLock, name)).toBe(packageLockVersion(packageLock, name));
  }
}

describe("Dependabot lock drift contract", () => {
  test("root Bun lock stays aligned with npm lock for protobufjs transitive updates", () => {
    expectLocksAligned(ROOT, ROOT_LOCK_PACKAGES);
  });

  test("MCP Bun lock stays aligned with npm lock for MCP runtime transitive updates", () => {
    expectLocksAligned(join(ROOT, "mcp-server"), MCP_LOCK_PACKAGES);
  });
});
