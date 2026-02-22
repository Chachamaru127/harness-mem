import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

interface ScoreReportInput {
  dataset?: {
    path?: string;
  };
  strict?: {
    all_categories?: { em?: number; f1?: number };
    cat_1_to_4?: { em?: number; f1?: number };
    cat_5?: { em?: number; f1?: number };
  };
  llm_judge?: {
    source_judge_path?: string;
    overall_accuracy?: number;
    by_category?: Record<string, { accuracy?: number; count?: number }>;
  };
  performance?: {
    search_latency_ms?: {
      p95?: number;
    };
  };
  cost?: {
    search_token_estimate?: {
      total_avg?: number;
    };
  };
}

interface NumericSummary {
  count: number;
  mean: number;
  stddev: number;
  min: number;
  max: number;
}

interface LocomoReproReport {
  schema_version: "locomo-repro-report-v1";
  generated_at: string;
  runs: number;
  sources: string[];
  strict: {
    all_categories_f1: NumericSummary;
    all_categories_em: NumericSummary;
    cat_1_to_4_f1: NumericSummary;
    cat_1_to_4_em: NumericSummary;
    cat_5_f1: NumericSummary;
    cat_5_em: NumericSummary;
  };
  llm_judge?: {
    overall_accuracy: NumericSummary;
  };
  performance?: {
    search_latency_p95_ms: NumericSummary;
  };
  cost?: {
    search_token_total_avg: NumericSummary;
  };
  comparison_lock: {
    dataset_paths: string[];
    judge_paths: string[];
    judge_signatures: string[];
    category_sets: string[];
    same_dataset: boolean;
    same_judge: boolean;
    same_category_scope: boolean;
  };
  review_evidence_spec: {
    required_artifacts: string[];
    rejection_conditions: string[];
    comparison_requirements: string[];
  };
  rejection_flags: string[];
}

interface CliOptions {
  reports: string[];
  outputPath?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const reports: string[] = [];
  let outputPath: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--report" && i + 1 < argv.length) {
      reports.push(argv[i + 1] || "");
      i += 1;
      continue;
    }
    if (token === "--reports" && i + 1 < argv.length) {
      const split = String(argv[i + 1] || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      reports.push(...split);
      i += 1;
      continue;
    }
    if (token === "--output" && i + 1 < argv.length) {
      outputPath = argv[i + 1];
      i += 1;
    }
  }

  const uniqueReports = [...new Set(reports.filter(Boolean).map((path) => resolve(path)))];
  if (uniqueReports.length === 0) {
    throw new Error("--report or --reports is required");
  }
  return {
    reports: uniqueReports,
    outputPath,
  };
}

function summarize(values: number[]): NumericSummary {
  if (values.length === 0) {
    return { count: 0, mean: 0, stddev: 0, min: 0, max: 0 };
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return {
    count: values.length,
    mean,
    stddev: Math.sqrt(variance),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function hasAny(values: number[]): boolean {
  return values.length > 0;
}

function allEqual(values: string[]): boolean {
  if (values.length <= 1) return true;
  return values.every((value) => value === values[0]);
}

function normalizeJudgeSignature(path: string): string {
  return path
    .replace(/run\d+/gi, "runX")
    .replace(/\d{4}-\d{2}-\d{2}/g, "DATE")
    .replace(/v\d+/gi, "vX");
}

export function buildLocomoReproReportFromPaths(paths: string[]): LocomoReproReport {
  const resolved = paths.map((path) => resolve(path));
  const reports = resolved.map((path) => JSON.parse(readFileSync(path, "utf8")) as ScoreReportInput);

  const strictAllF1 = reports.map((report) => Number(report.strict?.all_categories?.f1 || 0));
  const strictAllEm = reports.map((report) => Number(report.strict?.all_categories?.em || 0));
  const strictCat14F1 = reports.map((report) => Number(report.strict?.cat_1_to_4?.f1 || 0));
  const strictCat14Em = reports.map((report) => Number(report.strict?.cat_1_to_4?.em || 0));
  const strictCat5F1 = reports.map((report) => Number(report.strict?.cat_5?.f1 || 0));
  const strictCat5Em = reports.map((report) => Number(report.strict?.cat_5?.em || 0));

  const judgeAcc = reports
    .map((report) => report.llm_judge?.overall_accuracy)
    .filter((value): value is number => typeof value === "number");
  const latencyP95 = reports
    .map((report) => report.performance?.search_latency_ms?.p95)
    .filter((value): value is number => typeof value === "number");
  const tokenAvg = reports
    .map((report) => report.cost?.search_token_estimate?.total_avg)
    .filter((value): value is number => typeof value === "number");
  const datasetPaths = reports
    .map((report) => String(report.dataset?.path || "").trim())
    .filter((value) => value.length > 0);
  const judgePaths = reports
    .map((report) => String(report.llm_judge?.source_judge_path || "").trim())
    .filter((value) => value.length > 0);
  const judgeSignatures = judgePaths.map((path) => normalizeJudgeSignature(path));
  const categorySets = reports
    .map((report) => Object.keys(report.llm_judge?.by_category || {}).sort().join(","))
    .filter((value) => value.length > 0);

  const sameDataset = datasetPaths.length > 0 && allEqual(datasetPaths);
  const sameJudge = judgeSignatures.length > 0 && allEqual(judgeSignatures);
  const sameCategoryScope = categorySets.length > 0 && allEqual(categorySets);

  const rejectionFlags: string[] = [];
  if (!sameDataset) rejectionFlags.push("comparison_lock.dataset_mismatch");
  if (!sameJudge) rejectionFlags.push("comparison_lock.judge_mismatch");
  if (!sameCategoryScope) rejectionFlags.push("comparison_lock.category_scope_mismatch");
  if (reports.length < 3) rejectionFlags.push("repro.runs_below_3");

  const judgeSummary = hasAny(judgeAcc) ? summarize(judgeAcc) : null;
  const latencySummary = hasAny(latencyP95) ? summarize(latencyP95) : null;
  const tokenSummary = hasAny(tokenAvg) ? summarize(tokenAvg) : null;

  if (judgeSummary) {
    if (judgeSummary.mean < 0.52) rejectionFlags.push("gate_c.judge_mean_below_minimum");
    if (judgeSummary.stddev > 0.025) rejectionFlags.push("gate_c.judge_stddev_above_2_5pt");
  }
  if (latencySummary && latencySummary.mean > 25) {
    rejectionFlags.push("gate_c.search_p95_above_25ms");
  }
  if (tokenSummary && tokenSummary.mean > 450) {
    rejectionFlags.push("gate_c.token_avg_above_450");
  }

  const reviewEvidenceSpec = {
    required_artifacts: [
      "locomo10.run1.score-report.full.json",
      "locomo10.run2.score-report.full.json",
      "locomo10.run3.score-report.full.json",
      "locomo10.repro-report.json",
      "locomo10.failure-backlog.judged.json",
      "locomo10.failure-backlog.judged.md",
      "locomo10.run1.risk-notes.md",
      "locomo10.run2.risk-notes.md",
      "locomo10.run3.risk-notes.md",
    ],
    rejection_conditions: [
      "comparison lock mismatch (dataset / judge / category scope)",
      "missing required artifacts",
      "3-run stats are incomplete",
      "Gate C thresholds are not satisfied",
    ],
    comparison_requirements: [
      "same dataset path",
      "same judge model/temperature/prompt",
      "same category scope (cat-1..cat-4)",
    ],
  };

  const repro: LocomoReproReport = {
    schema_version: "locomo-repro-report-v1",
    generated_at: new Date().toISOString(),
    runs: reports.length,
    sources: resolved,
    strict: {
      all_categories_f1: summarize(strictAllF1),
      all_categories_em: summarize(strictAllEm),
      cat_1_to_4_f1: summarize(strictCat14F1),
      cat_1_to_4_em: summarize(strictCat14Em),
      cat_5_f1: summarize(strictCat5F1),
      cat_5_em: summarize(strictCat5Em),
    },
    ...(judgeSummary
      ? {
          llm_judge: {
            overall_accuracy: judgeSummary,
          },
        }
      : {}),
    ...(latencySummary
      ? {
          performance: {
            search_latency_p95_ms: latencySummary,
          },
        }
      : {}),
    ...(tokenSummary
      ? {
          cost: {
            search_token_total_avg: tokenSummary,
          },
        }
      : {}),
    comparison_lock: {
      dataset_paths: [...new Set(datasetPaths)],
      judge_paths: [...new Set(judgePaths)],
      judge_signatures: [...new Set(judgeSignatures)],
      category_sets: [...new Set(categorySets)],
      same_dataset: sameDataset,
      same_judge: sameJudge,
      same_category_scope: sameCategoryScope,
    },
    review_evidence_spec: reviewEvidenceSpec,
    rejection_flags: rejectionFlags,
  };

  return repro;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const report = buildLocomoReproReportFromPaths(options.reports);
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
