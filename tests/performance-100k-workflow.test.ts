import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("performance 100k workflow", () => {
  test("provides dispatch/schedule triggers and artifact upload", () => {
    const workflowPath = join(process.cwd(), ".github", "workflows", "performance-100k.yml");
    expect(existsSync(workflowPath)).toBe(true);

    const source = readFileSync(workflowPath, "utf8");
    expect(source).toContain("workflow_dispatch");
    expect(source).toContain("schedule");
    expect(source).toContain("HARNESS_MEM_RUN_100K_BENCH=1 bun test tests/benchmarks/performance-100k.test.ts");
    expect(source).toContain("actions/upload-artifact@v4");
  });
});
