import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("LOCOMO memos feasibility gate", () => {
  test("documents API/data-model fit decision for memos", () => {
    const docPath = join(process.cwd(), "docs", "benchmarks", "locomo-comparison-scope.md");
    expect(existsSync(docPath)).toBe(true);
    const source = readFileSync(docPath, "utf8");
    expect(source).toContain("memos");
    expect(source).toContain("判定");
    expect(source).toContain("API");
    expect(source).toContain("データモデル");
    expect(source).toContain("比較可否");
  });
});
