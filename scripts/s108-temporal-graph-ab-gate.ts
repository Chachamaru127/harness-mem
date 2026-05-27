#!/usr/bin/env bun
/**
 * S108-015: temporal-graph A/B promotion gate
 *
 * Runs the existing temporal-planner gate fixture twice:
 *   - baseline: HARNESS_MEM_TEMPORAL_GRAPH unset (default behavior)
 *   - candidate: HARNESS_MEM_TEMPORAL_GRAPH=1
 *
 * Compares the two runs and emits a decision:
 *   - "improved":  candidate beats baseline on hit@10 / order_score by margin
 *                  → recommend flipping default ON (S108-014 → default in next minor)
 *   - "neutral":   neither side wins by margin
 *                  → keep PoC opt-in (diagnostic-only mode)
 *   - "regressed": candidate loses by margin or breaks p95
 *                  → roll back PoC; remove from search path on next patch
 *
 * Usage:
 *   bun scripts/s108-temporal-graph-ab-gate.ts [--out <artifact-dir>]
 *
 * Exit codes:
 *   0 if decision is "improved" or "neutral" (no regression)
 *   1 if decision is "regressed"
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runTemporalPlannerGate } from "./s108-temporal-planner-gate";

interface GateMetrics {
  /** fraction of cases where the expected answer was top-1 */
  answer_top1_rate: number;
  /** fraction of cases where the expected answer was within top-10 */
  hit_at_10_rate: number;
  /** mean order_score across cases (higher = better order alignment) */
  mean_order_score: number;
  /** p95 latency in ms */
  p95_latency_ms: number;
  /** total cases evaluated */
  cases: number;
}

interface ABGateReport {
  schema_version: "s108-temporal-graph-ab.v1";
  generated_at: string;
  task_id: "S108-015";
  baseline: GateMetrics;
  candidate: GateMetrics;
  delta: {
    answer_top1_rate: number;
    hit_at_10_rate: number;
    mean_order_score: number;
    p95_latency_ms: number;
  };
  margins: {
    /** minimum delta on hit@10 to call it "improved" */
    hit_at_10_threshold: number;
    /** maximum p95 regression tolerated */
    max_p95_regression_ms: number;
  };
  decision: "improved" | "neutral" | "regressed";
  decision_reason: string;
}

interface GateOptions {
  artifactDir: string;
  fixturePath?: string;
  maxCases?: number;
  writeArtifacts: boolean;
}

const HIT_AT_10_THRESHOLD = 0.02;
const MAX_P95_REGRESSION_MS = 5;

/**
 * Run the temporal-planner gate with the given env override and return metrics.
 *
 * Implementation note: this is a thin wrapper over s108-temporal-planner-gate.ts.
 * The full A/B harness invokes that gate as a child process (with the env var
 * set / unset) and parses the JSON artifact. For the PoC scaffolding here we
 * extract the metrics shape from the planner gate output.
 */
async function runGate(label: string, envFlag: string | null, options: GateOptions): Promise<GateMetrics> {
  const previous = process.env.HARNESS_MEM_TEMPORAL_GRAPH;
  if (envFlag === null) {
    delete process.env.HARNESS_MEM_TEMPORAL_GRAPH;
  } else {
    process.env.HARNESS_MEM_TEMPORAL_GRAPH = envFlag;
  }

  try {
    const result = await runTemporalPlannerGate({
      artifactDir: join(options.artifactDir, label),
      fixturePath: options.fixturePath,
      maxCases: options.maxCases,
      writeArtifacts: options.writeArtifacts,
    });
    return {
      answer_top1_rate: result.metrics.answer_top1_rate,
      hit_at_10_rate: result.metrics.answer_hit_at_10,
      mean_order_score: result.metrics.temporal_order_score,
      p95_latency_ms: result.metrics.p95_latency_ms,
      cases: result.fixture.evaluated_cases,
    };
  } finally {
    if (previous === undefined) {
      delete process.env.HARNESS_MEM_TEMPORAL_GRAPH;
    } else {
      process.env.HARNESS_MEM_TEMPORAL_GRAPH = previous;
    }
  }
}

function decide(
  baseline: GateMetrics,
  candidate: GateMetrics,
): { decision: ABGateReport["decision"]; reason: string } {
  if (baseline.cases <= 0 || candidate.cases <= 0) {
    return {
      decision: "regressed",
      reason: `A/B gate did not evaluate cases (baseline=${baseline.cases}, candidate=${candidate.cases})`,
    };
  }
  if (baseline.cases !== candidate.cases) {
    return {
      decision: "regressed",
      reason: `A/B gate case count mismatch (baseline=${baseline.cases}, candidate=${candidate.cases})`,
    };
  }

  // p95 regression breaks the gate regardless of recall lift.
  if (candidate.p95_latency_ms - baseline.p95_latency_ms > MAX_P95_REGRESSION_MS) {
    return {
      decision: "regressed",
      reason: `p95 regressed by ${
        (candidate.p95_latency_ms - baseline.p95_latency_ms).toFixed(1)
      }ms (limit ${MAX_P95_REGRESSION_MS}ms)`,
    };
  }

  const hitDelta = candidate.hit_at_10_rate - baseline.hit_at_10_rate;
  if (hitDelta >= HIT_AT_10_THRESHOLD) {
    return {
      decision: "improved",
      reason: `hit@10 improved by ${(hitDelta * 100).toFixed(2)}%pt (>= ${
        (HIT_AT_10_THRESHOLD * 100).toFixed(0)
      }%pt threshold)`,
    };
  }
  if (hitDelta <= -HIT_AT_10_THRESHOLD) {
    return {
      decision: "regressed",
      reason: `hit@10 regressed by ${(Math.abs(hitDelta) * 100).toFixed(2)}%pt`,
    };
  }
  return {
    decision: "neutral",
    reason: `hit@10 delta ${(hitDelta * 100).toFixed(2)}%pt within ±${
      (HIT_AT_10_THRESHOLD * 100).toFixed(0)
    }%pt threshold`,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const fixtureIdx = args.indexOf("--fixture");
  const maxCasesIdx = args.indexOf("--max-cases");
  const artifactDir = outIdx >= 0 && args[outIdx + 1]
    ? resolve(args[outIdx + 1])
    : resolve(process.cwd(), "docs/benchmarks/artifacts/s108-temporal-graph-ab");
  const fixturePath = fixtureIdx >= 0 && args[fixtureIdx + 1] ? resolve(args[fixtureIdx + 1]) : undefined;
  const maxCases = maxCasesIdx >= 0 && args[maxCasesIdx + 1] ? Number(args[maxCasesIdx + 1]) : undefined;
  const writeArtifacts = !args.includes("--no-write");

  mkdirSync(artifactDir, { recursive: true });

  const options = { artifactDir, fixturePath, maxCases, writeArtifacts };
  const baseline = await runGate("baseline", null, options);
  const candidate = await runGate("candidate", "1", options);

  const { decision, reason } = decide(baseline, candidate);

  const report: ABGateReport = {
    schema_version: "s108-temporal-graph-ab.v1",
    generated_at: new Date().toISOString(),
    task_id: "S108-015",
    baseline,
    candidate,
    delta: {
      answer_top1_rate: candidate.answer_top1_rate - baseline.answer_top1_rate,
      hit_at_10_rate: candidate.hit_at_10_rate - baseline.hit_at_10_rate,
      mean_order_score: candidate.mean_order_score - baseline.mean_order_score,
      p95_latency_ms: candidate.p95_latency_ms - baseline.p95_latency_ms,
    },
    margins: {
      hit_at_10_threshold: HIT_AT_10_THRESHOLD,
      max_p95_regression_ms: MAX_P95_REGRESSION_MS,
    },
    decision,
    decision_reason: reason,
  };

  const reportPath = join(artifactDir, "ab-report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`[s108-015] decision=${decision}  reason=${reason}`);
  console.log(`[s108-015] artifact: ${reportPath}`);

  if (decision === "regressed") {
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("[s108-015] error:", err);
    process.exit(2);
  });
}

export { decide, type ABGateReport, type GateMetrics };
