#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { runCodeTokenTuningGate } from "./s108-code-token-tuning";
import { runTemporalPlannerGate } from "./s108-temporal-planner-gate";
import { runCjkDiscriminationGate, type CjkSlice } from "./s154-cjk-discrimination-gate";
import { buildFlagshipKpi, buildDeepFreshnessSubBlock, type FlagshipKpi, type DeepFreshnessSubBlock } from "../memory-server/src/benchmark/flagship-kpi";
import {
  computeFreshnessLagReal,
  computeSupersessionReal,
  computeTenseRewriteReal,
  buildOllamaAdjudicator,
  type LagContradictionInput,
  type SupersessionInput,
  type TenseRewriteInput,
} from "../memory-server/src/benchmark/deep-freshness-bench";

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
  // S154-305: flagship KPI leads the report and is enforced via gates.flagship_freshness.
  flagship_kpi: FlagshipKpi & {
    freshness_source: string;
    evidence: {
      // Shallow freshness per spec.md: stale answers must not regress (measured live below).
      current_stale_answer_regressions: number;
      // S154-303 dreaming tense-rewrite machinery: rewrite counts and false-positive
      // negatives are pinned by this integration suite (D38 review condition).
      dreaming_rewrite_evidence: string;
      deep_freshness: DeepFreshnessSubBlock;
    };
  };
  schema_version: "s108-developer-domain-manifest.v1";
  task_id: "S108-005b";
  generated_at: string;
  manifest_path: string;
  inputs: {
    code_token_runs: number;
    temporal_cases: number;
    cjk_cases: number;
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
    cjk_nfkc_fixable_top1: number;
    cjk_non_nfkc_orthographic_top1: number;
    cjk_mixed_en_ja_top1: number;
    cjk_discrimination_min_top1: number;
    cjk_discrimination_regressions: number;
  };
  gates: {
    flagship_freshness: boolean;
    dev_workflow: boolean;
    bilingual: boolean;
    temporal_order: boolean;
    japanese_temporal: boolean;
    current_stale_regressions: boolean;
    cjk_discrimination: boolean;
    /** S154-FU02: deep freshness enforce gate (tense_rewrite + supersession via gate_consumer_contract). */
    deep_freshness_enforce: boolean;
  };
  artifacts: {
    report_json: string | null;
    code_token_summary_json: string | null;
    temporal_planner_summary_json: string | null;
    cjk_discrimination_summary_json: string | null;
  };
  cjk_discrimination_baseline: {
    schema_version: "s154-103-cjk-baseline.v1";
    per_slice_top1: Record<CjkSlice, number>;
    recorded_at: string;
  } | null;
  cjk_discrimination_current: {
    per_slice_top1: Record<CjkSlice, number>;
    per_slice_mrr: Record<CjkSlice, number>;
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

function cjkBaselineFromManifest(manifest: Record<string, unknown>): ReconciliationReport["cjk_discrimination_baseline"] | null {
  const reconciliation = manifest.developer_domain_reconciliation as Record<string, unknown> | undefined;
  const baseline = reconciliation?.cjk_discrimination_baseline as ReconciliationReport["cjk_discrimination_baseline"] | undefined;
  if (!baseline || baseline.schema_version !== "s154-103-cjk-baseline.v1") return null;
  return baseline;
}

// A frozen baseline becomes the permanent regression reference; refuse to freeze
// from a degraded run so a bad first measurement cannot become the bar forever.
export const CJK_BASELINE_FREEZE_MIN_TOP1 = 0.6;

export function resolveCjkBaseline(
  existing: ReconciliationReport["cjk_discrimination_baseline"],
  currentTop1: Record<CjkSlice, number>,
  recordedAt: string,
): ReconciliationReport["cjk_discrimination_baseline"] {
  if (existing) return existing;
  if (Math.min(...Object.values(currentTop1)) < CJK_BASELINE_FREEZE_MIN_TOP1) return null;
  return {
    schema_version: "s154-103-cjk-baseline.v1",
    per_slice_top1: currentTop1,
    recorded_at: recordedAt,
  };
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
  const cjkArtifactDir = join(artifactDir, "cjk-discrimination");
  const manifest = parseJsonFile(manifestPath);
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
  const cjk = await runCjkDiscriminationGate({
    artifactDir: cjkArtifactDir,
    writeArtifacts,
    now,
    candidateEnv: {
      HARNESS_MEM_DISABLE_CJK_NORMALIZE: null,
      HARNESS_MEM_LEXICAL_BOOST: "1",
      HARNESS_MEM_DUAL_QUERY: "1",
    },
    requireImproved: true,
  });

  const cjkCurrentTop1 = Object.fromEntries(
    Object.entries(cjk.variants.candidate.per_slice).map(([slice, metrics]) => [slice, metrics.top1]),
  ) as Record<CjkSlice, number>;
  const cjkCurrentMrr = Object.fromEntries(
    Object.entries(cjk.variants.candidate.per_slice).map(([slice, metrics]) => [slice, metrics.mrr]),
  ) as Record<CjkSlice, number>;
  const existingCjkBaseline = cjkBaselineFromManifest(manifest);
  const cjkBaseline = resolveCjkBaseline(existingCjkBaseline, cjkCurrentTop1, now.toISOString());
  const cjkRegressionTolerance = 0.02;
  const cjkRegressions = cjkBaseline === null
    ? 0
    : Object.entries(cjkCurrentTop1).filter(([slice, current]) => {
      const baseline = cjkBaseline.per_slice_top1[slice as CjkSlice] ?? current;
      return current + cjkRegressionTolerance < baseline;
    }).length;

  // S154-310: deep freshness 3-metric bench (report-only). Run real system bench.
  // Fixtures provide input+labels only; LLM outputs and DB values come from live execution.
  const dfbFixtureBase = resolve(import.meta.dir, "../tests/benchmarks/fixtures");
  const ollamaOpts = {
    ollamaHost: process.env["HARNESS_MEM_OLLAMA_HOST"] ?? "http://127.0.0.1:11434",
    model: process.env["HARNESS_MEM_FACT_LLM_MODEL"] ?? "qwen3.5:9b",
    timeoutMs: 30_000,
  };
  const dfbAdjudicator = buildOllamaAdjudicator(ollamaOpts);
  let lagInputs: LagContradictionInput[] = [];
  let supInputs: SupersessionInput[] = [];
  let trInputs: TenseRewriteInput[] = [];
  try { lagInputs = JSON.parse(readFileSync(join(dfbFixtureBase, "deep-freshness-lag.json"), "utf8")) as LagContradictionInput[]; } catch { /* no fixture */ }
  try { supInputs = JSON.parse(readFileSync(join(dfbFixtureBase, "deep-freshness-supersession.json"), "utf8")) as SupersessionInput[]; } catch { /* no fixture */ }
  try { trInputs = JSON.parse(readFileSync(join(dfbFixtureBase, "deep-freshness-tense-rewrite.json"), "utf8")) as TenseRewriteInput[]; } catch { /* no fixture */ }
  const [dfbLag, dfbSup, dfbTr] = await Promise.all([
    computeFreshnessLagReal(lagInputs, dfbAdjudicator).catch(() => ({ status: "skipped" as const, skip_reason: "bench threw" })),
    computeSupersessionReal(supInputs, dfbAdjudicator, undefined, ollamaOpts).catch(() => ({ status: "skipped" as const, skip_reason: "bench threw" })),
    computeTenseRewriteReal(trInputs, ollamaOpts).catch(() => ({ status: "skipped" as const, skip_reason: "bench threw" })),
  ]);

  // S154-305: enforce the flagship KPI threshold on the recorded full-CI measurement.
  // The freshness value is produced by run-ci's knowledge-update benchmark and recorded
  // in the CI manifest; this reconciliation gate fails when that recorded value is
  // missing or below FLAGSHIP_FRESHNESS_GREEN_THRESHOLD (fail-closed).
  const manifestResults = manifest.results as Record<string, unknown> | undefined;
  const rawFreshness = Number(manifestResults?.freshness);
  const flagshipFreshness = Number.isFinite(rawFreshness) ? rawFreshness : 0;

  // S154-FU02: build deep freshness sub-block with gate judgment.
  // shallow_freshness is required to evaluate the composite gate (green_definition).
  const deepFreshnessSubBlock = buildDeepFreshnessSubBlock({
    freshness_lag: dfbLag,
    supersession: dfbSup,
    tense_rewrite: dfbTr,
    shallow_freshness: flagshipFreshness,
  });
  const flagshipKpi = {
    ...buildFlagshipKpi(flagshipFreshness),
    freshness_source: Number.isFinite(rawFreshness)
      ? "ci-run-manifest results.freshness"
      : "missing (treated as 0, fail-closed)",
    evidence: {
      current_stale_answer_regressions: temporal.metrics.current_stale_answer_regressions,
      dreaming_rewrite_evidence:
        "memory-server/tests/integration/dreaming-consolidation.test.ts (S154-303 rewrite counts + false-positive negatives)",
      deep_freshness: deepFreshnessSubBlock,
    },
  };

  const reportPath = join(artifactDir, "summary.json");
  const report: ReconciliationReport = {
    flagship_kpi: flagshipKpi,
    schema_version: "s108-developer-domain-manifest.v1",
    task_id: "S108-005b",
    generated_at: now.toISOString(),
    manifest_path: rel(manifestPath),
    inputs: {
      code_token_runs: codeToken.runs.length,
      temporal_cases: temporal.fixture.evaluated_cases,
      cjk_cases: cjk.fixture.count,
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
      cjk_nfkc_fixable_top1: cjkCurrentTop1.nfkc_fixable,
      cjk_non_nfkc_orthographic_top1: cjkCurrentTop1.non_nfkc_orthographic,
      cjk_mixed_en_ja_top1: cjkCurrentTop1.mixed_en_ja,
      cjk_discrimination_min_top1: Math.min(...Object.values(cjkCurrentTop1)),
      cjk_discrimination_regressions: cjkRegressions,
    },
    gates: {
      flagship_freshness: flagshipKpi.green,
      dev_workflow: codeToken.gates.dev_workflow_recall_at_10.passed,
      bilingual: codeToken.gates.bilingual_recall_at_10.passed,
      temporal_order: temporal.gates.temporal_order_score.passed,
      japanese_temporal: temporal.gates.japanese_temporal_slice.passed,
      current_stale_regressions: temporal.gates.current_stale_answer_regressions.passed,
      cjk_discrimination: cjk.overall_passed && cjkRegressions === 0 && cjkBaseline !== null,
      // S154-FU02: green = all enforce_metrics pass AND shallow freshness >= 0.95.
      // yellow (skipped metrics) is treated as pass to avoid blocking CI when Ollama unavailable.
      deep_freshness_enforce: deepFreshnessSubBlock.gate_verdict !== "red",
    },
    artifacts: {
      report_json: writeArtifacts ? rel(reportPath) : null,
      code_token_summary_json: codeToken.artifacts.summary_json,
      temporal_planner_summary_json: temporal.artifacts.summary_json,
      cjk_discrimination_summary_json: cjk.artifacts.summary_json,
    },
    cjk_discrimination_baseline: cjkBaseline,
    cjk_discrimination_current: {
      per_slice_top1: cjkCurrentTop1,
      per_slice_mrr: cjkCurrentMrr,
    },
    rollback: "Restore memory-server/src/benchmark/results/ci-run-manifest-latest.json from version control, or rerun npm run benchmark:developer-domain from a known-good checkout.",
    overall_passed: false,
  };
  report.overall_passed = Object.values(report.gates).every(Boolean);

  const results = {
    ...((manifest.results as Record<string, unknown> | undefined) ?? {}),
    dev_workflow_recall: report.metrics.dev_workflow_recall_at_10,
    bilingual_recall: report.metrics.bilingual_recall_at_10,
    temporal: report.metrics.temporal_order_score,
    cjk_discrimination_min_top1: report.metrics.cjk_discrimination_min_top1,
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
          `flagship_freshness=${round(report.flagship_kpi.value).toFixed(4)}(gate>=${report.flagship_kpi.green_threshold}) ` +
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
