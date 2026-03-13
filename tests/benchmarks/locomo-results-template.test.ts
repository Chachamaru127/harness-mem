import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("LOCOMO results template", () => {
  test("contains fixed comparison table for harness-mem/mem0/claude-mem/memos", () => {
    const templatePath = join(process.cwd(), "docs", "benchmarks", "locomo-results-template.md");
    expect(existsSync(templatePath)).toBe(true);

    const source = readFileSync(templatePath, "utf8");
    expect(source).toContain("harness-mem");
    expect(source).toContain("mem0");
    expect(source).toContain("claude-mem");
    expect(source).toContain("memos");
    expect(source).toContain("| System |");
    expect(source).toContain("EM");
    expect(source).toContain("F1");
    expect(source).toContain("benchmark.run1.score-report.full.json");
    expect(source).toContain("benchmark.repro-report.json");
    expect(source).toContain("benchmark.failure-backlog.judged.json");
    expect(source).toContain("benchmark.run1.risk-notes.md");
    expect(source).not.toContain("locomo10.run1.score-report.full.json");
    expect(source).not.toContain("locomo10.repro-report.json");
    expect(source).not.toContain("locomo10.failure-backlog.judged.json");
    expect(source).not.toContain("locomo10.run1.risk-notes.md");
  });
});
