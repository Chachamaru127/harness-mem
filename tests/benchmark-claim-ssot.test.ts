import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readText(...parts: string[]): string {
  return readFileSync(join(root, ...parts), "utf8");
}

function readJson<T>(...parts: string[]): T {
  return JSON.parse(readText(...parts)) as T;
}

function format4(value: number): string {
  return value.toFixed(4);
}

function format2(value: number): string {
  return value.toFixed(2);
}

describe("benchmark / claim SSOT", () => {
  const manifest = readJson<{
    generated_at: string;
    git_sha: string;
    results: {
      all_passed: boolean;
      locomo_f1: number;
      bilingual_recall: number;
      freshness: number;
      temporal: number;
    };
    performance: {
      locomo_search_p95_ms: number;
      locomo_token_avg: number;
    };
  }>("memory-server", "src", "benchmark", "results", "ci-run-manifest-latest.json");

  const currentSummary = readJson<{
    metrics: {
      overall_f1_mean: number;
      cross_lingual_f1_mean: number;
      overall_f1_span: number;
    };
    dataset: { qa_count: number };
    current_claim_run: {
      checks: { zero_f1_count: number };
      slices: Record<string, { f1_avg: number }>;
    };
  }>("docs", "benchmarks", "artifacts", "s43-ja-release-v2-latest", "summary.json");

  const baselineSummary = readJson<{
    metrics: {
      overall_f1_mean: number;
      cross_lingual_f1_mean: number;
      overall_f1_span: number;
    };
    dataset: { qa_count: number };
    current_claim_run: {
      checks: { zero_f1_count: number };
    };
  }>("docs", "benchmarks", "artifacts", "s40-ja-baseline-latest", "summary.json");

  const readme = readText("README.md");
  const readmeJa = readText("README_ja.md");
  const proofBar = readText("docs", "benchmarks", "japanese-release-proof-bar.md");
  const ssotMatrix = readText("docs", "benchmarks", "benchmark-claim-ssot-matrix-2026-03-13.md");
  const plans = readText("Plans.md");
  const archivePlans = readText("docs", "archive", "Plans-2026-02-26.md");
  const currentFailureBacklog = readText(
    "docs",
    "benchmarks",
    "artifacts",
    "s43-ja-release-v2-latest",
    "run3",
    "failure-backlog.json"
  );
  const deprecatedAliasSummary = readText(
    "docs",
    "benchmarks",
    "artifacts",
    "s40-ja-release-latest",
    "summary.json"
  );
  const deprecatedAliasScore = readText(
    "docs",
    "benchmarks",
    "artifacts",
    "s40-ja-release-latest",
    "run1",
    "score-report.json"
  );
  const deprecatedAliasSlice = readText(
    "docs",
    "benchmarks",
    "artifacts",
    "s40-ja-release-latest",
    "run1",
    "slice-report.json"
  );
  const deprecatedAliasRuns = readText(
    "docs",
    "benchmarks",
    "artifacts",
    "s40-ja-release-latest",
    "runs.tsv"
  );
  const baselineFailureBacklog = readText(
    "docs",
    "benchmarks",
    "artifacts",
    "s40-ja-baseline-latest",
    "run3",
    "failure-backlog.json"
  );
  const shadowFailureBacklog = readText(
    "docs",
    "benchmarks",
    "artifacts",
    "s39-shadow-query-pack-latest",
    "failure-backlog.json"
  );

  test("required summary artifacts exist", () => {
    expect(existsSync(join(root, "docs", "benchmarks", "artifacts", "s43-ja-release-v2-latest", "summary.json"))).toBe(true);
    expect(existsSync(join(root, "docs", "benchmarks", "artifacts", "s40-ja-baseline-latest", "summary.json"))).toBe(true);
  });

  test("README and proof bar cite current and historical aliases correctly", () => {
    expect(readme).toContain("s43-ja-release-v2-latest/summary.json");
    expect(readme).toContain("s40-ja-baseline-latest/summary.json");
    expect(readmeJa).toContain("s43-ja-release-v2-latest/summary.json");
    expect(readmeJa).toContain("s40-ja-baseline-latest/summary.json");
    expect(proofBar).toContain("s43-ja-release-v2-latest/summary.json");
    expect(proofBar).toContain("s40-ja-baseline-latest/summary.json");

    expect(readme).not.toContain("s40-ja-release-latest/summary.md");
    expect(readmeJa).not.toContain("s40-ja-release-latest/summary.md");
    expect(proofBar).not.toContain("s40-ja-release-latest/summary.md");
  });

  test("main gate metrics copy matches current manifest", () => {
    expect(readme).toContain(`| LoCoMo F1 | ${format4(manifest.results.locomo_f1)} |`);
    expect(readme).toContain(`| Bilingual recall@10 | ${format4(manifest.results.bilingual_recall)} |`);
    expect(readme).toContain(`| Freshness | ${format4(manifest.results.freshness)} |`);
    expect(readme).toContain(`| Temporal | ${format4(manifest.results.temporal)} |`);
    expect(readme).toContain(`| Search p95 | ${format2(manifest.performance.locomo_search_p95_ms)}ms |`);
    expect(readme).toContain(`| Token avg | ${format2(manifest.performance.locomo_token_avg)} |`);
    expect(readme).toContain(`Verdict: \`${manifest.results.all_passed ? "PASS" : "FAIL"}\``);

    expect(readmeJa).toContain(`| LoCoMo F1 | ${format4(manifest.results.locomo_f1)} |`);
    expect(readmeJa).toContain(`| bilingual recall@10 | ${format4(manifest.results.bilingual_recall)} |`);
    expect(readmeJa).toContain(`| freshness | ${format4(manifest.results.freshness)} |`);
    expect(readmeJa).toContain(`| temporal | ${format4(manifest.results.temporal)} |`);
    expect(readmeJa).toContain(`| search p95 | ${format2(manifest.performance.locomo_search_p95_ms)}ms |`);
    expect(readmeJa).toContain(`| token avg | ${format2(manifest.performance.locomo_token_avg)} |`);
    expect(readmeJa).toContain("判定: `FAIL`");

    expect(proofBar).toContain(`| LoCoMo F1 | ${format4(manifest.results.locomo_f1)} |`);
    expect(proofBar).toContain(`| Temporal | ${format4(manifest.results.temporal)} |`);
    expect(proofBar).toContain(`| Search p95 | ${format2(manifest.performance.locomo_search_p95_ms)}ms |`);
    expect(proofBar).toContain(`| Token avg | ${format2(manifest.performance.locomo_token_avg)} |`);
    expect(proofBar).toContain("Verdict: `FAIL`");
  });

  test("main gate metadata copy matches current manifest", () => {
    expect(readme).toContain(`generated_at: \`${manifest.generated_at}\``);
    expect(readme).toContain(`git_sha: \`${manifest.git_sha.slice(0, 7)}\``);
    expect(readmeJa).toContain(`generated_at: \`${manifest.generated_at}\``);
    expect(readmeJa).toContain(`git_sha: \`${manifest.git_sha.slice(0, 7)}\``);
    expect(proofBar).toContain(`generated_at=${manifest.generated_at}`);
    expect(proofBar).toContain(`git_sha=${manifest.git_sha.slice(0, 7)}`);
    expect(ssotMatrix).toContain(`generated_at=${manifest.generated_at}`);
    expect(ssotMatrix).toContain(`git_sha=${manifest.git_sha.slice(0, 7)}`);
    expect(plans).toContain(`generated_at=${manifest.generated_at}`);
    expect(plans).toContain(`git_sha=${manifest.git_sha.slice(0, 7)}`);
  });

  test("current companion and historical baseline copy match summary JSON", () => {
    const currentZero = `${currentSummary.current_claim_run.checks.zero_f1_count} / ${currentSummary.dataset.qa_count}`;
    const baselineZero = `${baselineSummary.current_claim_run.checks.zero_f1_count} / ${baselineSummary.dataset.qa_count}`;

    for (const doc of [readme, readmeJa, proofBar]) {
      expect(doc).toContain(`| Overall F1 mean | ${format4(currentSummary.metrics.overall_f1_mean)} |`);
      expect(doc).toContain(`| Cross-lingual F1 mean | ${format4(currentSummary.metrics.cross_lingual_f1_mean)} |`);
      expect(doc).toContain(`| Zero-F1 count | ${currentZero} |`);
      expect(doc).toContain(`| 3-run span | ${format4(currentSummary.metrics.overall_f1_span)} |`);
    }

    expect(readme).toContain(`| Exact slice F1 | ${format4(currentSummary.current_claim_run.slices.exact.f1_avg)} |`);
    expect(readme).toContain(`| Temporal slice F1 | ${format4(currentSummary.current_claim_run.slices.temporal.f1_avg)} |`);
    expect(readmeJa).toContain(`| exact slice F1 | ${format4(currentSummary.current_claim_run.slices.exact.f1_avg)} |`);
    expect(readmeJa).toContain(`| temporal slice F1 | ${format4(currentSummary.current_claim_run.slices.temporal.f1_avg)} |`);
    expect(proofBar).toContain(`| Exact slice F1 | ${format4(currentSummary.current_claim_run.slices.exact.f1_avg)} |`);
    expect(proofBar).toContain(`| Temporal slice F1 | ${format4(currentSummary.current_claim_run.slices.temporal.f1_avg)} |`);

    expect(readme).toContain(`| Overall F1 mean | ${format4(baselineSummary.metrics.overall_f1_mean)} |`);
    expect(readme).toContain(`| Cross-lingual F1 mean | ${format4(baselineSummary.metrics.cross_lingual_f1_mean)} |`);
    expect(readme).toContain(`| Zero-F1 count | ${baselineZero} |`);
    expect(readmeJa).toContain(`| Overall F1 mean | ${format4(baselineSummary.metrics.overall_f1_mean)} |`);
    expect(readmeJa).toContain(`| Cross-lingual F1 mean | ${format4(baselineSummary.metrics.cross_lingual_f1_mean)} |`);
    expect(readmeJa).toContain(`| Zero-F1 count | ${baselineZero} |`);
    expect(proofBar).toContain(`| Overall F1 mean | ${format4(baselineSummary.metrics.overall_f1_mean)} |`);
    expect(proofBar).toContain(`| Cross-lingual F1 mean | ${format4(baselineSummary.metrics.cross_lingual_f1_mean)} |`);
    expect(proofBar).toContain(`| Zero-F1 count | ${baselineZero} |`);

    expect(plans).toContain(`overall_f1_mean=${format4(currentSummary.metrics.overall_f1_mean)}`);
    expect(plans).toContain(`overall_f1_mean=${format4(baselineSummary.metrics.overall_f1_mean)}`);
  });

  test("license copy uses explicit BUSL metadata and avoids GitHub autodetect badge", () => {
    expect(readme).toContain("BUSL-1.1");
    expect(readmeJa).toContain("BUSL-1.1");
    expect(readme).not.toContain("img.shields.io/github/license");
    expect(readmeJa).not.toContain("img.shields.io/github/license");
    expect(readme).toContain("NOASSERTION");
    expect(readmeJa).toContain("NOASSERTION");
  });

  test("current, historical, and shadow failure backlog artifacts use generic review evidence names", () => {
    for (const artifact of [currentFailureBacklog, baselineFailureBacklog, shadowFailureBacklog]) {
      expect(artifact).toContain("benchmark.runX.score-report.full.json");
      expect(artifact).toContain("benchmark.repro-report.json");
      expect(artifact).toContain("benchmark.failure-backlog.judged.json");
      expect(artifact).toContain("benchmark.failure-backlog.judged.md");
      expect(artifact).toContain("benchmark.runX.risk-notes.md");
      expect(artifact).not.toContain("locomo10.runX.score-report.full.json");
      expect(artifact).not.toContain("locomo10.repro-report.json");
      expect(artifact).not.toContain("locomo10.failure-backlog.judged.json");
      expect(artifact).not.toContain("locomo10.failure-backlog.judged.md");
      expect(artifact).not.toContain("locomo10.runX.risk-notes.md");
    }
  });

  test("archived benchmark notes also use generic bundle names", () => {
    expect(archivePlans).toContain(".tmp/locomo/benchmark.repro-report.json");
    expect(archivePlans).toContain(".tmp/locomo/benchmark.failure-backlog.judged.json");
    expect(archivePlans).not.toContain(".tmp/locomo/locomo10.repro-report.json");
    expect(archivePlans).not.toContain(".tmp/locomo/locomo10.failure-backlog.judged.json");
  });

  test("deprecated alias is sealed at both root and deep artifact paths", () => {
    for (const artifact of [deprecatedAliasSummary, deprecatedAliasScore, deprecatedAliasSlice]) {
      expect(artifact).toContain("\"schema_version\": \"deprecated-artifact-alias-v1\"");
      expect(artifact).toContain("This deprecated alias is sealed.");
      expect(artifact).toContain("s40-ja-baseline-latest");
      expect(artifact).toContain("s43-ja-release-v2-latest");
      expect(artifact).not.toContain("\"schema_version\": \"locomo-score-report-v1\"");
      expect(artifact).not.toContain("\"schema_version\": \"japanese-release-report-v1\"");
    }

    expect(deprecatedAliasRuns).toContain("deprecated_at\tpath\tmessage\thistorical\tcurrent");
    expect(deprecatedAliasRuns).toContain("s40-ja-baseline-latest/runs.tsv");
    expect(deprecatedAliasRuns).toContain("s43-ja-release-v2-latest/runs.tsv");
  });
});
