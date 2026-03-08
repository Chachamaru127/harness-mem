import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("japanese release pack docs", () => {
  test("documents contract, slices, execution, and anti-goals", () => {
    const contractPath = join(process.cwd(), "docs", "benchmarks", "japanese-release-contract.md");
    const runbookPath = join(process.cwd(), "docs", "benchmarks", "japanese-release-pack.md");
    const copyTierPath = join(process.cwd(), "docs", "benchmarks", "japanese-copy-tiering.md");
    const companionGatePath = join(process.cwd(), "docs", "benchmarks", "japanese-gate-companion.md");
    const competitiveAuditPath = join(process.cwd(), "docs", "benchmarks", "competitive-audit-2026-03-07.md");

    expect(existsSync(contractPath)).toBe(true);
    expect(existsSync(runbookPath)).toBe(true);
    expect(existsSync(copyTierPath)).toBe(true);
    expect(existsSync(companionGatePath)).toBe(true);
    expect(existsSync(competitiveAuditPath)).toBe(true);

    const contract = readFileSync(contractPath, "utf8");
    const runbook = readFileSync(runbookPath, "utf8");
    const copyTier = readFileSync(copyTierPath, "utf8");
    const companionGate = readFileSync(companionGatePath, "utf8");
    const competitiveAudit = readFileSync(competitiveAuditPath, "utf8");

    expect(contract).toContain("Main gate");
    expect(contract).toContain("Japanese companion gate");
    expect(contract).toContain("Tier 1");
    expect(contract).toContain("Tier 2");
    expect(contract).toContain("Tier 3");
    expect(contract).toContain("japanese-release-pack-96.json");
    expect(contract).toContain("shadow-ja-pack-24.json");

    expect(runbook).toContain("v2");
    expect(runbook).toContain("shadow-ja-pack-24.json");
    expect(runbook).toContain("3-run freeze");
    expect(runbook).toContain("実行方法");
    expect(runbook).toContain("4成果物");
    expect(runbook).toContain("Anti-Goals");

    expect(copyTier).toContain("Tier 1");
    expect(copyTier).toContain("Tier 2");
    expect(copyTier).toContain("Tier 3");

    expect(companionGate).toContain("Companion checks");
    expect(companionGate).toContain("Rejection signals");

    expect(competitiveAudit).toContain("blocked");
    expect(competitiveAudit).toContain("only option");
  });

  test("v2 release pack and shadow-ja pack satisfy fixture contract", () => {
    const releaseV2Path = join(process.cwd(), "tests", "benchmarks", "fixtures", "japanese-release-pack-96.json");
    const shadowJaPath = join(process.cwd(), "tests", "benchmarks", "fixtures", "shadow-ja-pack-24.json");

    expect(existsSync(releaseV2Path)).toBe(true);
    expect(existsSync(shadowJaPath)).toBe(true);

    const releaseV2 = JSON.parse(readFileSync(releaseV2Path, "utf8")) as Array<{
      sample_id: string;
      qa: Array<{ slice?: string }>;
    }>;
    const shadowJa = JSON.parse(readFileSync(shadowJaPath, "utf8")) as Array<{
      sample_id: string;
      qa: Array<{ question_id: string }>;
    }>;

    const qaCount = releaseV2.reduce((sum, sample) => sum + sample.qa.length, 0);
    expect(releaseV2.length).toBe(16);
    expect(qaCount).toBe(96);

    const slices = new Set(releaseV2.flatMap((sample) => sample.qa.map((qa) => qa.slice || "")));
    for (const required of [
      "current",
      "current_vs_previous",
      "exact",
      "why",
      "list",
      "temporal",
      "relative_temporal",
      "yes_no",
      "noisy",
      "long_turn",
      "entity",
      "location",
    ]) {
      expect(slices.has(required)).toBe(true);
    }

    expect(shadowJa.length).toBe(12);
    expect(shadowJa.reduce((sum, sample) => sum + sample.qa.length, 0)).toBe(24);
  });
});
