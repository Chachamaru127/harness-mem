#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { runCodeTokenTuningGate } from "./s108-code-token-tuning";
import { runTemporalPlannerGate } from "./s108-temporal-planner-gate";

interface Options {
  manifestPath?: string;
  artifactDir?: string;
  codeTokenRuns?: number;
  temporalMaxCases?: number;
  writeManifest?: boolean;
  writeArtifacts?: boolean;
  now?: Date;
  json?: boolean;
}

interface ReconciliationReport {
  schema_version: "s108-developer-domain-manifest.v1";
  task_id: "S108-005b";
  generated_at: string;
  manifest_path: string;
  inputs: {
    code_token_runs: number;
    temporal_cases: number;
  };
  metrics: {
    dev_workflow_recall_at_10: number;
    dev_workflow_recall_mean: number;
    bilingual_recall_at_10: number;
    temporal_order_score: number;
    temporal_answer_hit_at_10: number;
    japanese_temporal_slice: number;
    current_stale_answer_regressions: number;
    temporal_p95_latency_ms: number;
  };
  gates: {
    dev_workflow: boolean;
    bilingual: boolean;
    temporal_order: boolean;
    japanese_temporal: boolean;
    current_stale_regressions: boolean;
  };
  artifacts: {
    report_json: string | null;
    code_token_summary_json: string | null;
    temporal_planner_summary_json: string | null;
  };
  rollback: string;
  overall_passed: boolean;
}

const ROOT_DIR = resolve(import.meta.dir, "..");
const DEFAULT_MANIFEST_PATH = join(ROOT_DIR, "memory-server/src/benchmark/results/ci-run-manifest-latest.json");
const DEFAULT_ARTIFACT_DIR = join(ROOT_DIR, "docs/benchmarks/artifacts/s108-developer-domain-manifest-2026-05-27");

function rel(path: string): string {
  return relative(ROOT_DIR, path).replace(/\\/g, "/");
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function parseJsonFile(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

export async function reconcileDeveloperDomainManifest(options: Options = {}): Promise<ReconciliationReport> {
  const manifestPath = resolve(options.manifestPath ?? DEFAULT_MANIFEST_PATH);
  const artifactDir = resolve(options.artifactDir ?? DEFAULT_ARTIFACT_DIR);
  const writeManifest = options.writeManifest !== false;
  const writeArtifacts = options.writeArtifacts !== false;
  const codeTokenRuns = Math.max(1, Math.floor(options.codeTokenRuns ?? 3));
  const now = options.now ?? new Date();

  const codeTokenArtifactDir = join(artifactDir, "code-token");
  const temporalArtifactDir = join(artifactDir, "temporal-planner");
  const codeToken = runCodeTokenTuningGate({
    runs: codeTokenRuns,
    artifactDir: codeTokenArtifactDir,
    writeArtifacts,
    now,
  });
  const temporal = await runTemporalPlannerGate({
    artifactDir: temporalArtifactDir,
    maxCases: options.temporalMaxCases,
    writeArtifacts,
    now,
  });

  const reportPath = join(artifactDir, "summary.json");
  const report: ReconciliationReport = {
    schema_version: "s108-developer-domain-manifest.v1",
    task_id: "S108-005b",
    generated_at: now.toISOString(),
    manifest_path: rel(manifestPath),
    inputs: {
      code_token_runs: codeToken.runs.length,
      temporal_cases: temporal.fixture.evaluated_cases,
    },
    metrics: {
      dev_workflow_recall_at_10: codeToken.gates.dev_workflow_recall_at_10.min,
      dev_workflow_recall_mean: codeToken.gates.dev_workflow_recall_at_10.mean,
      bilingual_recall_at_10: codeToken.gates.bilingual_recall_at_10.value,
      temporal_order_score: temporal.metrics.temporal_order_score,
      temporal_answer_hit_at_10: temporal.metrics.answer_hit_at_10,
      japanese_temporal_slice: temporal.metrics.japanese_temporal_slice,
      current_stale_answer_regressions: temporal.metrics.current_stale_answer_regressions,
      temporal_p95_latency_ms: temporal.metrics.p95_latency_ms,
    },
    gates: {
      dev_workflow: codeToken.gates.dev_workflow_recall_at_10.passed,
      bilingual: codeToken.gates.bilingual_recall_at_10.passed,
      temporal_order: temporal.gates.temporal_order_score.passed,
      japanese_temporal: temporal.gates.japanese_temporal_slice.passed,
      current_stale_regressions: temporal.gates.current_stale_answer_regressions.passed,
    },
    artifacts: {
      report_json: writeArtifacts ? rel(reportPath) : null,
      code_token_summary_json: codeToken.artifacts.summary_json,
      temporal_planner_summary_json: temporal.artifacts.summary_json,
    },
    rollback: "Restore memory-server/src/benchmark/results/ci-run-manifest-latest.json from version control, or rerun npm run benchmark:developer-domain from a known-good checkout.",
    overall_passed: false,
  };
  report.overall_passed = Object.values(report.gates).every(Boolean);

  const manifest = parseJsonFile(manifestPath);
  const results = {
    ...((manifest.results as Record<string, unknown> | undefined) ?? {}),
    dev_workflow_recall: report.metrics.dev_workflow_recall_at_10,
    bilingual_recall: report.metrics.bilingual_recall_at_10,
    temporal: report.metrics.temporal_order_score,
  };
  const reconciled = {
    ...manifest,
    results,
    developer_domain_reconciliation: report,
  };

  if (writeManifest) {
    writeFileSync(manifestPath, `${JSON.stringify(reconciled, null, 2)}\n`, "utf8");
  }
  if (writeArtifacts) {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  return report;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--manifest" && argv[i + 1]) {
      options.manifestPath = argv[++i];
    } else if (token === "--artifact-dir" && argv[i + 1]) {
      options.artifactDir = argv[++i];
    } else if (token === "--runs" && argv[i + 1]) {
      options.codeTokenRuns = Number(argv[++i]);
    } else if (token === "--max-cases" && argv[i + 1]) {
      options.temporalMaxCases = Number(argv[++i]);
    } else if (token === "--no-write-manifest") {
      options.writeManifest = false;
    } else if (token === "--no-write-artifacts") {
      options.writeArtifacts = false;
    } else if (token === "--json") {
      options.json = true;
    } else if (token === "--help" || token === "-h") {
      process.stdout.write("Usage: bun scripts/s108-developer-domain-manifest.ts [--manifest PATH] [--artifact-dir DIR] [--runs 3] [--max-cases N] [--no-write-manifest] [--no-write-artifacts] [--json]\n");
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${token}`);
    }
  }
  return options;
}

if (import.meta.main) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = await reconcileDeveloperDomainManifest(options);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write(
        `[s108-005b] status=${report.overall_passed ? "pass" : "fail"} ` +
          `dev=${round(report.metrics.dev_workflow_recall_at_10).toFixed(4)} ` +
          `temporal=${round(report.metrics.temporal_order_score).toFixed(4)} ` +
          `artifact=${report.artifacts.report_json ?? "none"}\n`,
      );
    }
    if (!report.overall_passed) process.exit(1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[s108-005b] ${message}\n`);
    process.exit(1);
  }
}

export type { Options as DeveloperDomainManifestOptions, ReconciliationReport };
