import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

describe("hardening artifacts", () => {
  test("ships 100k benchmark, chaos test, and final architecture docs", () => {
    const perfTestPath = join(ROOT, "tests", "benchmarks", "performance-100k.test.ts");
    const chaosScriptPath = join(ROOT, "tests", "test-memory-daemon-chaos.sh");
    const finalDocPath = join(ROOT, "docs", "world1-architecture-and-ops.md");

    expect(existsSync(perfTestPath)).toBe(true);
    expect(existsSync(chaosScriptPath)).toBe(true);
    expect(existsSync(finalDocPath)).toBe(true);

    const perfSource = readFileSync(perfTestPath, "utf8");
    const chaosSource = readFileSync(chaosScriptPath, "utf8");
    const docSource = readFileSync(finalDocPath, "utf8");

    expect(perfSource).toContain("100000");
    expect(chaosSource).toContain("kill");
    expect(docSource).toContain("Architecture");
    expect(docSource).toContain("Migration");
    expect(docSource).toContain("Operations");
  });
});
