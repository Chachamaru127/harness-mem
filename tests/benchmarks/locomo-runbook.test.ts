import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("LOCOMO runbook", () => {
  test("documents dataset placement, commands, reproducibility, and cost cautions", () => {
    const runbookPath = join(process.cwd(), "docs", "benchmarks", "locomo-runbook.md");
    expect(existsSync(runbookPath)).toBe(true);

    const source = readFileSync(runbookPath, "utf8");
    expect(source).toContain("データ配置");
    expect(source).toContain("実行手順");
    expect(source).toContain("再現条件");
    expect(source).toContain("APIキー");
    expect(source).toContain("コスト");
    expect(source).toContain("benchmark.runX.score-report.full.json");
    expect(source).toContain("benchmark.repro-report.json");
    expect(source).toContain("benchmark.failure-backlog.judged.json");
    expect(source).toContain("benchmark.runX.risk-notes.md");
    expect(source).not.toContain("locomo10.runX.score-report.full.json");
    expect(source).not.toContain("locomo10.repro-report.json");
    expect(source).not.toContain("locomo10.failure-backlog.judged.json");
    expect(source).not.toContain("locomo10.runX.risk-notes.md");
  });
});
