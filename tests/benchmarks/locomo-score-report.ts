import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { evaluateLocomoQa, type LocomoMetricSummary } from "./locomo-evaluator";
import type { LocomoBenchmarkRecord, LocomoBenchmarkResult } from "./run-locomo-benchmark";

interface ScoreReport {
  schema_version: "locomo-score-report-v1";
  generated_at: string;
  source_result_path: string;
  dataset: LocomoBenchmarkResult["dataset"];
  strict: {
    all_categories: LocomoMetricSummary;
    cat_1_to_4: LocomoMetricSummary;
    cat_5: LocomoMetricSummary;
  };
  performance?: LocomoBenchmarkResult["performance"];
  cost?: LocomoBenchmarkResult["cost"];
  llm_judge?: {
    source_judge_path: string;
    overall_accuracy: number;
    overall_count: number;
    by_category: Record<string, { accuracy: number; count: number }>;
  };
}

interface LocomoJudgeFile {
  metrics?: {
    overall?: { accuracy?: number; count?: number };
    by_category?: Record<string, { accuracy?: number; count?: number }>;
  };
}

interface CliOptions {
  resultPath: string;
  judgePath?: string;
  outputPath?: string;
}

function parseArgs(argv: string[]): CliOptions {
  let resultPath = "";
  let judgePath: string | undefined;
  let outputPath: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--result" && i + 1 < argv.length) {
      resultPath = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (token === "--judge-result" && i + 1 < argv.length) {
      judgePath = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--output" && i + 1 < argv.length) {
      outputPath = argv[i + 1];
      i += 1;
    }
  }

  if (!resultPath) {
    throw new Error("--result is required");
  }
  return { resultPath, judgePath, outputPath };
}

function summarizeFromRecords(records: LocomoBenchmarkRecord[]): LocomoMetricSummary {
  return evaluateLocomoQa(
    records.map((record) => ({
      prediction: record.prediction,
      answer: record.answer,
      category: record.category,
    }))
  ).overall;
}

function buildStrictSummary(result: LocomoBenchmarkResult): ScoreReport["strict"] {
  const cat14 = result.records.filter((record) =>
    ["cat-1", "cat-2", "cat-3", "cat-4"].includes(record.category)
  );
  const cat5 = result.records.filter((record) => record.category === "cat-5");
  return {
    all_categories: result.metrics.overall,
    cat_1_to_4: result.comparison?.cat_1_to_4 || summarizeFromRecords(cat14),
    cat_5: result.comparison?.cat_5 || summarizeFromRecords(cat5),
  };
}

function normalizeJudgeSummary(judgePath: string, source: LocomoJudgeFile): ScoreReport["llm_judge"] {
  const byCategory: Record<string, { accuracy: number; count: number }> = {};
  for (const [category, metric] of Object.entries(source.metrics?.by_category || {})) {
    byCategory[category] = {
      accuracy: Number(metric?.accuracy || 0),
      count: Number(metric?.count || 0),
    };
  }
  return {
    source_judge_path: resolve(judgePath),
    overall_accuracy: Number(source.metrics?.overall?.accuracy || 0),
    overall_count: Number(source.metrics?.overall?.count || 0),
    by_category: byCategory,
  };
}

function buildReport(options: CliOptions): ScoreReport {
  const resultPath = resolve(options.resultPath);
  const result = JSON.parse(readFileSync(resultPath, "utf8")) as LocomoBenchmarkResult;

  const report: ScoreReport = {
    schema_version: "locomo-score-report-v1",
    generated_at: new Date().toISOString(),
    source_result_path: resultPath,
    dataset: result.dataset,
    strict: buildStrictSummary(result),
    performance: result.performance,
    cost: result.cost,
  };

  if (options.judgePath) {
    const judgeSource = JSON.parse(readFileSync(resolve(options.judgePath), "utf8")) as LocomoJudgeFile;
    report.llm_judge = normalizeJudgeSummary(options.judgePath, judgeSource);
  }

  return report;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const report = buildReport(options);
  if (options.outputPath) {
    const outputPath = resolve(options.outputPath);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
