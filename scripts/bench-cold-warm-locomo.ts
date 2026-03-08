#!/usr/bin/env bun
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

interface LocomoQa {
  question_id: string;
  question: string;
  answer: string;
  category: string;
}

interface LocomoTurn {
  speaker: string;
  text: string;
}

interface LocomoSample {
  sample_id: string;
  conversation: LocomoTurn[];
  qa: LocomoQa[];
}

interface SelectedCase {
  sample_id: string;
  question_id: string;
  question: string;
  answer: string;
  category: string;
  dataset: LocomoSample[];
}

interface CaseMeasurement {
  em: number;
  f1: number;
  latency_ms: number;
  token_total: number;
  prediction: string;
  runtime_health_status: string;
  runtime_health_details: string;
  gate_passed: boolean;
  prime_embedding_enabled: boolean;
}

interface CaseSummary {
  sample_id: string;
  question_id: string;
  category: string;
  question: string;
  answer: string;
  cold: CaseMeasurement;
  warm: CaseMeasurement;
  delta: {
    f1: number;
    latency_ms: number;
    token_total: number;
  };
}

interface ObservationReport {
  generated_at: string;
  source_dataset: string;
  selected_case_count: number;
  method: {
    isolation: string;
    cold_ready: string;
    warm_ready: string;
    selection: string;
  };
  aggregate: {
    cold: AggregateSummary;
    warm: AggregateSummary;
    delta: AggregateDeltaSummary;
    quality_regression_count: number;
    latency_improved_count: number;
    run_success_count: number;
    runtime_health_snapshot_statuses: string[];
    runtime_health_snapshot_note: string;
    gate_all_passed: boolean;
  };
  cases: CaseSummary[];
}

interface AggregateSummary {
  mean_f1: number;
  mean_latency_ms: number;
  p95_latency_ms: number;
  mean_token_total: number;
}

interface AggregateDeltaSummary {
  mean_f1: number;
  mean_latency_ms: number;
  mean_token_total: number;
}

interface ScriptOptions {
  datasetPath: string;
  outputDir: string;
  limit: number;
}

const ROOT_DIR = resolve(import.meta.dir, "..");
const CATEGORY_ORDER = ["cat-1", "cat-2", "cat-3", "cat-4", "cat-5", "profile", "timeline", "hybrid"];

function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((lhs, rhs) => lhs - rhs);
  const rank = Math.max(0, Math.min(sorted.length - 1, Math.ceil((q / 100) * sorted.length) - 1));
  return sorted[rank] || 0;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function parseArgs(argv: string[]): ScriptOptions {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const parsed: ScriptOptions = {
    datasetPath: resolve(ROOT_DIR, "tests/benchmarks/fixtures/locomo-15x3.json"),
    outputDir: resolve(ROOT_DIR, ".tmp", `s39-cold-warm-${timestamp}`),
    limit: 12,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--dataset" && i + 1 < argv.length) {
      parsed.datasetPath = resolve(ROOT_DIR, argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--output-dir" && i + 1 < argv.length) {
      parsed.outputDir = resolve(ROOT_DIR, argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--limit" && i + 1 < argv.length) {
      parsed.limit = Math.max(1, Number.parseInt(argv[i + 1] || "12", 10) || 12);
      i += 1;
      continue;
    }
    if (token === "--help") {
      printHelp();
      process.exit(0);
    }
  }

  return parsed;
}

function printHelp(): void {
  console.log(`Usage: bun run scripts/bench-cold-warm-locomo.ts [options]\n\nOptions:\n  --dataset <path>      Source LoCoMo-compatible dataset (default: tests/benchmarks/fixtures/locomo-15x3.json)\n  --output-dir <path>   Directory for generated reports (default: .tmp/s39-cold-warm-<timestamp>)\n  --limit <n>           Number of single-QA cold/warm cases to sample (default: 12)\n  --help                Show this help\n`);
}

function loadDataset(datasetPath: string): LocomoSample[] {
  return JSON.parse(readFileSync(datasetPath, "utf8")) as LocomoSample[];
}

export function selectSingleQaCases(samples: LocomoSample[], limit: number): SelectedCase[] {
  const buckets = new Map<string, SelectedCase[]>();
  const pushCase = (category: string, value: SelectedCase) => {
    const next = buckets.get(category) || [];
    next.push(value);
    buckets.set(category, next);
  };

  for (const sample of samples) {
    for (const qa of sample.qa) {
      pushCase(qa.category, {
        sample_id: sample.sample_id,
        question_id: qa.question_id,
        question: qa.question,
        answer: qa.answer,
        category: qa.category,
        dataset: [
          {
            sample_id: sample.sample_id,
            conversation: sample.conversation,
            qa: [qa],
          },
        ],
      });
    }
  }

  const orderedCategories = [
    ...CATEGORY_ORDER.filter((category) => buckets.has(category)),
    ...[...buckets.keys()].filter((category) => !CATEGORY_ORDER.includes(category)).sort(),
  ];

  const selected: SelectedCase[] = [];
  while (selected.length < limit) {
    let progressed = false;
    for (const category of orderedCategories) {
      const queue = buckets.get(category) || [];
      if (queue.length === 0) continue;
      selected.push(queue.shift() as SelectedCase);
      progressed = true;
      if (selected.length >= limit) break;
    }
    if (!progressed) break;
  }

  return selected;
}

function readResult(outputPath: string): any {
  return JSON.parse(readFileSync(outputPath, "utf8"));
}

function extractMeasurement(result: any): CaseMeasurement {
  const record = result.records?.[0];
  if (!record) {
    throw new Error("benchmark result does not contain the single QA record");
  }
  return {
    em: Number(record.em || 0),
    f1: Number(record.f1 || 0),
    latency_ms: Number(record.search_latency_ms || 0),
    token_total: Number(record.token_estimate_total_tokens || 0),
    prediction: String(record.prediction || ""),
    runtime_health_status: String(result.pipeline?.embedding?.runtime_health_status || "unknown"),
    runtime_health_details: String(result.pipeline?.embedding?.runtime_health_details || ""),
    gate_passed: result.pipeline?.embedding?.gate?.passed !== false,
    prime_embedding_enabled: result.pipeline?.prime_embedding_enabled === true,
  };
}

function runSingleCase(caseInfo: SelectedCase, outputDir: string, mode: "cold" | "warm"): CaseMeasurement {
  const caseSlug = `${slug(caseInfo.sample_id)}-${slug(caseInfo.question_id)}`;
  const caseDir = join(outputDir, "cases", caseSlug);
  mkdirSync(caseDir, { recursive: true });

  const tempRoot = mkdtempSync(join(tmpdir(), "s39-cold-warm-"));
  const datasetPath = join(tempRoot, `${caseSlug}.dataset.json`);
  const outputPath = join(caseDir, `${mode}.result.json`);
  const logPath = join(caseDir, `${mode}.log`);
  writeFileSync(datasetPath, `${JSON.stringify(caseInfo.dataset, null, 2)}\n`, "utf8");

  const command = [
    process.execPath,
    "run",
    "tests/benchmarks/run-locomo-benchmark.ts",
    "--system",
    "harness-mem",
    "--dataset",
    datasetPath,
    "--output",
    outputPath,
    "--prime-embedding",
    mode === "warm" ? "true" : "false",
  ];

  const result = spawnSync(command[0], command.slice(1), {
    cwd: ROOT_DIR,
    env: { ...process.env },
    encoding: "utf8",
  });

  writeFileSync(
    logPath,
    [`$ ${command.join(" ")}`, result.stdout || "", result.stderr || ""].filter(Boolean).join("\n"),
    "utf8"
  );

  try {
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || `benchmark exited with status ${result.status}`);
    }
    return extractMeasurement(readResult(outputPath));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

export function summarizeCases(cases: CaseSummary[]): ObservationReport["aggregate"] {
  const coldLatencies = cases.map((item) => item.cold.latency_ms);
  const warmLatencies = cases.map((item) => item.warm.latency_ms);
  const coldF1 = cases.map((item) => item.cold.f1);
  const warmF1 = cases.map((item) => item.warm.f1);
  const coldTokens = cases.map((item) => item.cold.token_total);
  const warmTokens = cases.map((item) => item.warm.token_total);

  return {
    cold: {
      mean_f1: round(mean(coldF1)),
      mean_latency_ms: round(mean(coldLatencies)),
      p95_latency_ms: round(percentile(coldLatencies, 95)),
      mean_token_total: round(mean(coldTokens)),
    },
    warm: {
      mean_f1: round(mean(warmF1)),
      mean_latency_ms: round(mean(warmLatencies)),
      p95_latency_ms: round(percentile(warmLatencies, 95)),
      mean_token_total: round(mean(warmTokens)),
    },
    delta: {
      mean_f1: round(mean(cases.map((item) => item.delta.f1))),
      mean_latency_ms: round(mean(cases.map((item) => item.delta.latency_ms))),
      mean_token_total: round(mean(cases.map((item) => item.delta.token_total))),
    },
    quality_regression_count: cases.filter((item) => item.delta.f1 < 0).length,
    latency_improved_count: cases.filter((item) => item.delta.latency_ms < 0).length,
    run_success_count: cases.length,
    runtime_health_snapshot_statuses: Array.from(
      new Set(
        cases.flatMap((item) => [item.cold.runtime_health_status, item.warm.runtime_health_status]).filter(Boolean)
      )
    ).sort(),
    runtime_health_snapshot_note:
      "runtime_health_status is read from run-locomo-benchmark's startup snapshot. Successful run completion is the stronger readiness signal here.",
    gate_all_passed: cases.every((item) => item.cold.gate_passed && item.warm.gate_passed),
  };
}

export function renderMarkdown(report: ObservationReport): string {
  const lines: string[] = [];
  lines.push("# S39 Cold vs Warm Observation");
  lines.push("");
  lines.push(`- generated_at: ${report.generated_at}`);
  lines.push(`- source_dataset: ${report.source_dataset}`);
  lines.push(`- selected_case_count: ${report.selected_case_count}`);
  lines.push("");
  lines.push("## Method");
  lines.push("");
  lines.push(`- isolation: ${report.method.isolation}`);
  lines.push(`- cold_ready: ${report.method.cold_ready}`);
  lines.push(`- warm_ready: ${report.method.warm_ready}`);
  lines.push(`- selection: ${report.method.selection}`);
  lines.push("");
  lines.push("## Aggregate");
  lines.push("");
  lines.push("| metric | cold | warm | delta(warm-cold) |");
  lines.push("|---|---:|---:|---:|");
  lines.push(`| mean_f1 | ${report.aggregate.cold.mean_f1.toFixed(4)} | ${report.aggregate.warm.mean_f1.toFixed(4)} | ${report.aggregate.delta.mean_f1.toFixed(4)} |`);
  lines.push(`| mean_latency_ms | ${report.aggregate.cold.mean_latency_ms.toFixed(4)} | ${report.aggregate.warm.mean_latency_ms.toFixed(4)} | ${report.aggregate.delta.mean_latency_ms.toFixed(4)} |`);
  lines.push(`| p95_latency_ms | ${report.aggregate.cold.p95_latency_ms.toFixed(4)} | ${report.aggregate.warm.p95_latency_ms.toFixed(4)} | ${(report.aggregate.warm.p95_latency_ms - report.aggregate.cold.p95_latency_ms).toFixed(4)} |`);
  lines.push(`| mean_token_total | ${report.aggregate.cold.mean_token_total.toFixed(4)} | ${report.aggregate.warm.mean_token_total.toFixed(4)} | ${report.aggregate.delta.mean_token_total.toFixed(4)} |`);
  lines.push("");
  lines.push(`- quality_regression_count: ${report.aggregate.quality_regression_count}`);
  lines.push(`- latency_improved_count: ${report.aggregate.latency_improved_count}`);
  lines.push(`- run_success_count: ${report.aggregate.run_success_count}`);
  lines.push(`- runtime_health_snapshot_statuses: ${report.aggregate.runtime_health_snapshot_statuses.join(", ") || "n/a"}`);
  lines.push(`- runtime_health_snapshot_note: ${report.aggregate.runtime_health_snapshot_note}`);
  lines.push(`- gate_all_passed: ${report.aggregate.gate_all_passed}`);
  lines.push("");
  lines.push("## Cases");
  lines.push("");
  lines.push("| case | category | cold_f1 | warm_f1 | delta_f1 | cold_ms | warm_ms | delta_ms |");
  lines.push("|---|---|---:|---:|---:|---:|---:|---:|");
  for (const item of report.cases) {
    lines.push(
      `| ${item.sample_id}/${item.question_id} | ${item.category} | ${item.cold.f1.toFixed(4)} | ${item.warm.f1.toFixed(4)} | ${item.delta.f1.toFixed(4)} | ${item.cold.latency_ms.toFixed(2)} | ${item.warm.latency_ms.toFixed(2)} | ${item.delta.latency_ms.toFixed(2)} |`
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const samples = loadDataset(options.datasetPath);
  const selectedCases = selectSingleQaCases(samples, options.limit);
  mkdirSync(options.outputDir, { recursive: true });

  const summaries: CaseSummary[] = [];
  for (const item of selectedCases) {
    const cold = runSingleCase(item, options.outputDir, "cold");
    const warm = runSingleCase(item, options.outputDir, "warm");
    summaries.push({
      sample_id: item.sample_id,
      question_id: item.question_id,
      category: item.category,
      question: item.question,
      answer: item.answer,
      cold,
      warm,
      delta: {
        f1: round(warm.f1 - cold.f1),
        latency_ms: round(warm.latency_ms - cold.latency_ms),
        token_total: round(warm.token_total - cold.token_total),
      },
    });
  }

  const report: ObservationReport = {
    generated_at: new Date().toISOString(),
    source_dataset: options.datasetPath,
    selected_case_count: summaries.length,
    method: {
      isolation:
        "Each case runs in a fresh temp DB with exactly one QA, so first-query latency is measured without later-query cache dilution.",
      cold_ready:
        "Fresh core, readiness satisfied, prime_embedding_enabled=false. This captures first real query after startup readiness without question-specific priming.",
      warm_ready:
        "Fresh core, readiness satisfied, prime_embedding_enabled=true. This captures startup + question/corpus priming together on the same single-QA case.",
      selection: `Round-robin across categories from ${basename(options.datasetPath)} with limit=${options.limit}.`,
    },
    aggregate: summarizeCases(summaries),
    cases: summaries,
  };

  const jsonPath = join(options.outputDir, "cold-warm-summary.json");
  const markdownPath = join(options.outputDir, "cold-warm-summary.md");
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, renderMarkdown(report), "utf8");

  console.log(`[cold-warm] cases=${summaries.length}`);
  console.log(`[cold-warm] summary_json=${jsonPath}`);
  console.log(`[cold-warm] summary_md=${markdownPath}`);
  console.log(
    `[cold-warm] mean_f1 cold=${report.aggregate.cold.mean_f1.toFixed(4)} warm=${report.aggregate.warm.mean_f1.toFixed(4)} delta=${report.aggregate.delta.mean_f1.toFixed(4)}`
  );
  console.log(
    `[cold-warm] mean_latency_ms cold=${report.aggregate.cold.mean_latency_ms.toFixed(4)} warm=${report.aggregate.warm.mean_latency_ms.toFixed(4)} delta=${report.aggregate.delta.mean_latency_ms.toFixed(4)}`
  );
  console.log(
    `[cold-warm] runtime_snapshot_statuses=${report.aggregate.runtime_health_snapshot_statuses.join(",") || "n/a"}`
  );
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}
