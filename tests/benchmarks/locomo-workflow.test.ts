import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("LOCOMO workflow", () => {
  test("supports manual/scheduled execution and uploads artifacts", () => {
    const workflowPath = join(process.cwd(), ".github", "workflows", "locomo-benchmark.yml");
    expect(existsSync(workflowPath)).toBe(true);

    const source = readFileSync(workflowPath, "utf8");
    expect(source).toContain("workflow_dispatch");
    expect(source).toContain("schedule");
    expect(source).toContain("run-locomo-benchmark.ts");
    expect(source).toContain("actions/upload-artifact@v4");
  });
});
