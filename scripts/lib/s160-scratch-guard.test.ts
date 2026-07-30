import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assertScratchDbPath } from "./s160-scratch-guard";

describe("§160-001 review fix: assertScratchDbPath", () => {
  test("rejects a path under the production ~/.harness-mem/ data dir", () => {
    const productionDbPath = resolve(homedir(), ".harness-mem", "harness-mem.db");
    expect(() => assertScratchDbPath(productionDbPath, "--db")).toThrow(/harness-mem/);
  });

  test("rejects a path under the production dir even with a nested/unusual filename", () => {
    const productionDbPath = resolve(homedir(), ".harness-mem", "some-nested-dir", "whatever.db");
    expect(() => assertScratchDbPath(productionDbPath, "--out")).toThrow(/production data dir/);
  });

  test("rejects an arbitrary non-scratch absolute path (e.g. a project checkout)", () => {
    const notScratch = resolve(homedir(), "some-project", "data.db");
    expect(() => assertScratchDbPath(notScratch, "--db")).toThrow(/scratch/);
  });

  test("accepts a path under the OS temp dir (matches how :empty: and the scratch bench dirs resolve)", () => {
    const dir = mkdtempSync(join(tmpdir(), "s160-scratch-guard-test-"));
    try {
      const dbPath = join(dir, "synthetic.db");
      expect(() => assertScratchDbPath(dbPath, "--db")).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("accepts a not-yet-created file under a scratch dir (--out use case, file doesn't exist yet)", () => {
    const dir = mkdtempSync(join(tmpdir(), "s160-scratch-guard-test-"));
    try {
      const notYetCreated = join(dir, "nested", "does-not-exist-yet.db");
      expect(() => assertScratchDbPath(notYetCreated, "--out")).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("accepts a path under /tmp directly (POSIX scratch convention)", () => {
    const dbPath = "/tmp/s160-scratch-guard-test-direct-tmp.db";
    expect(() => assertScratchDbPath(dbPath, "--db")).not.toThrow();
  });
});
