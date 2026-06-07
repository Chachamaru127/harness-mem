#!/usr/bin/env bun
/**
 * S154-100: generic A/B gate for the CodingMemory bench (Bilingual Coding-Memory).
 *
 * Generalizes the S108-017 temporal-graph A/B pattern (scripts/s108-temporal-graph-ab-gate.ts)
 * into a REUSABLE runner that every §154 A/B task (101b lexical boost, 102 dual-query,
 * 401 shadow embedding, 701/702 opt-in LLM, ...) can drive without re-implementing the
 * baseline/candidate plumbing.
 *
 * It runs the internal-memory CodingMemory dataset twice against harness-mem:
 *   - baseline:  the candidate env overrides are UNSET (default behavior)
 *   - candidate: the candidate env overrides are SET
 * then extracts mixed_recall_at_10 / ja_recall_at_10 and emits the fixed artifact
 * schema { metric, baseline, candidate, delta } per metric.
 *
 * Usage:
 *   bun run scripts/s154-coding-memory-ab-gate.ts \
 *     --candidate-env HARNESS_MEM_LEXICAL_BOOST=1 \
 *     --metric mixed_recall_at_10 --min-delta 0.02 --require-improved \
 *     [--limit 80] [--out <artifact-dir>] [--task-id S154-101b]
 *
 * Exit codes:
 *   default (no-regression mode): 0 unless decision == "regressed"
 *   --require-improved:           0 only if decision == "improved", else 1
 *   2 on runner error
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runInternalMemoryBenchmark } from "../benchmarks/internal-memory/scripts/run-internal-memory-benchmark";
import { meanRecallForProfile } from "../benchmarks/internal-memory/scorers/multilingual";
import type { ScoredCaseResult } from "../benchmarks/internal-memory/lib/types";

export const AB_METRIC_NAMES = ["mixed_recall_at_10", "ja_recall_at_10"] as const;
export type AbMetricName = (typeof AB_METRIC_NAMES)[number];
export type AbDecision = "improved" | "neutral" | "regressed";

/** Fixed per-metric artifact row. DoD pins this schema: { metric, baseline, candidate, delta }. */
export interface AbMetricDelta {
  metric: AbMetricName;
  baseline: number;
  candidate: number;
  delta: number;
}

export interface AbReport {
  schema_version: "s154-coding-memory-ab.v1";
  generated_at: string;
  task_id: string;
  candidate_env: Record<string, string>;
  metrics: AbMetricDelta[];
  min_delta: number;
  regression_delta: number;
  require_improved: boolean;
  decision: AbDecision;
  decision_reason: string;
}

export type RecallByMetric = Record<AbMetricName, number>;

/**
 * Pure decision core — unit-tested without running the benchmark.
 *
 * - "regressed": any targeted metric drops by >= regressionDelta
 * - "improved":  every targeted metric rises by >= minDelta
 * - "neutral":   anything in between
 */
export function decideAb(
  baseline: RecallByMetric,
  candidate: RecallByMetric,
  metrics: AbMetricName[],
  minDelta: number,
  regressionDelta: number,
): { metrics: AbMetricDelta[]; decision: AbDecision; reason: string } {
  // Float-point epsilon so a delta numerically equal to the threshold counts as
  // inclusive (e.g. 0.12 - 0.10 = 0.01999…9 must still clear a +0.02 margin).
  const EPS = 1e-9;
  const rows: AbMetricDelta[] = metrics.map((metric) => ({
    metric,
    baseline: baseline[metric],
    candidate: candidate[metric],
    delta: candidate[metric] - baseline[metric],
  }));

  const regressed = rows.filter((r) => r.delta <= -regressionDelta + EPS);
  if (regressed.length > 0) {
    const worst = regressed.reduce((a, b) => (a.delta < b.delta ? a : b));
    return {
      metrics: rows,
      decision: "regressed",
      reason: `${worst.metric} regressed by ${(Math.abs(worst.delta) * 100).toFixed(2)}%pt (>= ${(regressionDelta * 100).toFixed(0)}%pt regression band)`,
    };
  }

  const improvedAll = rows.every((r) => r.delta >= minDelta - EPS);
  if (improvedAll) {
    const min = rows.reduce((a, b) => (a.delta < b.delta ? a : b));
    return {
      metrics: rows,
      decision: "improved",
      reason: `all metrics improved by >= ${(minDelta * 100).toFixed(0)}%pt (weakest ${min.metric} +${(min.delta * 100).toFixed(2)}%pt)`,
    };
  }

  return {
    metrics: rows,
    decision: "neutral",
    reason: `no regression but improvement below +${(minDelta * 100).toFixed(0)}%pt on at least one metric`,
  };
}

/**
 * Extract harness-mem mixed/JA recall@10 from a benchmark run's scored rows.
 *
 * Only the `required` metrics must be present; a non-required metric with no
 * scored cases is returned as NaN (and never read by `decideAb`). The default
 * CodingMemory dataset (coding-memory-real-ja-mixed-v3) is en+mixed with no
 * pure-`ja` rows, so ja_recall_at_10 is only meaningful against a ja-bearing
 * dataset and must be explicitly targeted via `--metric ja_recall_at_10`.
 */
export function recallsFromResults(
  results: ScoredCaseResult[],
  required: AbMetricName[] = [...AB_METRIC_NAMES],
  competitorId = "harness-mem",
): RecallByMetric {
  const rows = results.filter((row) => row.competitor_id === competitorId);
  const read = (metric: AbMetricName): number => {
    const profile = metric === "ja_recall_at_10" ? "ja" : "mixed";
    const value = meanRecallForProfile(rows, profile);
    if (value === undefined) {
      if (required.includes(metric)) {
        throw new Error(
          `no '${profile}' cases scored for ${competitorId}; cannot compute ${metric} (check dataset / limit / --metric)`,
        );
      }
      return Number.NaN;
    }
    return value;
  };
  return {
    mixed_recall_at_10: read("mixed_recall_at_10"),
    ja_recall_at_10: read("ja_recall_at_10"),
  };
}

interface AbOptions {
  candidateEnv: Record<string, string>;
  metrics: AbMetricName[];
  minDelta: number;
  regressionDelta: number;
  requireImproved: boolean;
  taskId: string;
  artifactDir: string;
  limit?: number;
  writeArtifacts: boolean;
}

async function runBenchOnce(
  label: "baseline" | "candidate",
  options: AbOptions,
): Promise<RecallByMetric> {
  const keys = Object.keys(options.candidateEnv);
  const previous = new Map<string, string | undefined>();
  for (const key of keys) {
    previous.set(key, process.env[key]);
    if (label === "candidate") {
      process.env[key] = options.candidateEnv[key];
    } else {
      delete process.env[key];
    }
  }

  try {
    const { results } = await runInternalMemoryBenchmark({
      competitors: ["harness-mem"],
      dataset: "codingmemory",
      limit: options.limit,
      reportsDir: join(options.artifactDir, label),
    });
    return recallsFromResults(results, options.metrics);
  } finally {
    for (const key of keys) {
      const prev = previous.get(key);
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
  }
}

function parseAbArgs(argv: string[]): AbOptions {
  const candidateEnv: Record<string, string> = {};
  const metrics: AbMetricName[] = [];
  let minDelta = 0.02;
  let regressionDelta: number | undefined;
  let requireImproved = false;
  let taskId = "S154-100";
  let limit: number | undefined;
  let artifactDir = resolve(process.cwd(), "docs/benchmarks/artifacts/s154-coding-memory-ab");
  let writeArtifacts = true;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === "--candidate-env" && next) {
      const eq = next.indexOf("=");
      if (eq <= 0) throw new Error(`--candidate-env expects KEY=VALUE, got '${next}'`);
      candidateEnv[next.slice(0, eq)] = next.slice(eq + 1);
      i += 1;
    } else if (token === "--metric" && next) {
      if (!AB_METRIC_NAMES.includes(next as AbMetricName)) {
        throw new Error(`--metric must be one of ${AB_METRIC_NAMES.join(", ")}, got '${next}'`);
      }
      metrics.push(next as AbMetricName);
      i += 1;
    } else if (token === "--min-delta" && next) {
      minDelta = Number(next);
      i += 1;
    } else if (token === "--regression-delta" && next) {
      regressionDelta = Number(next);
      i += 1;
    } else if (token === "--require-improved") {
      requireImproved = true;
    } else if (token === "--task-id" && next) {
      taskId = next;
      i += 1;
    } else if (token === "--limit" && next) {
      limit = Number(next);
      i += 1;
    } else if (token === "--out" && next) {
      artifactDir = resolve(next);
      i += 1;
    } else if (token === "--no-write") {
      writeArtifacts = false;
    }
  }

  return {
    candidateEnv,
    // Default to mixed only: the CodingMemory dataset is en+mixed (no pure-ja
    // rows). Callers wanting ja_recall_at_10 must target it explicitly against a
    // ja-bearing dataset.
    metrics: metrics.length > 0 ? metrics : ["mixed_recall_at_10"],
    minDelta,
    regressionDelta: regressionDelta ?? minDelta,
    requireImproved,
    taskId,
    artifactDir,
    limit,
    writeArtifacts,
  };
}

async function main(): Promise<void> {
  const options = parseAbArgs(process.argv.slice(2));
  if (Object.keys(options.candidateEnv).length === 0) {
    console.error(
      "[s154-100] no --candidate-env given; baseline==candidate. Pass at least one --candidate-env KEY=VALUE.",
    );
  }
  mkdirSync(options.artifactDir, { recursive: true });

  const baseline = await runBenchOnce("baseline", options);
  const candidate = await runBenchOnce("candidate", options);

  const { metrics, decision, reason } = decideAb(
    baseline,
    candidate,
    options.metrics,
    options.minDelta,
    options.regressionDelta,
  );

  const report: AbReport = {
    schema_version: "s154-coding-memory-ab.v1",
    generated_at: new Date().toISOString(),
    task_id: options.taskId,
    candidate_env: options.candidateEnv,
    metrics,
    min_delta: options.minDelta,
    regression_delta: options.regressionDelta,
    require_improved: options.requireImproved,
    decision,
    decision_reason: reason,
  };

  if (options.writeArtifacts) {
    const reportPath = join(options.artifactDir, "ab-report.json");
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[s154-100] artifact: ${reportPath}`);
  }
  for (const m of metrics) {
    console.log(
      `[s154-100] ${m.metric}: baseline=${m.baseline.toFixed(4)} candidate=${m.candidate.toFixed(4)} delta=${(m.delta >= 0 ? "+" : "") + (m.delta * 100).toFixed(2)}%pt`,
    );
  }
  console.log(`[s154-100] decision=${decision}  reason=${reason}`);

  const pass = options.requireImproved ? decision === "improved" : decision !== "regressed";
  if (!pass) process.exit(1);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("[s154-100] error:", err);
    process.exit(2);
  });
}
