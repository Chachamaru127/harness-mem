import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

interface MetricSummary {
  count: number;
  em_avg: number;
  f1_avg: number;
  zero_f1_count: number;
}

interface SliceReport {
  summary: {
    overall: MetricSummary;
    by_slice: Record<string, MetricSummary>;
    cross_lingual: MetricSummary;
    missing_metadata: string[];
  };
}

interface DatasetSample {
  sample_id: string;
  qa?: Array<{ question_id: string; slice?: string }>;
}

interface ResultRecord {
  sample_id: string;
  question_id: string;
  prediction: string;
}

interface ResultFile {
  records: ResultRecord[];
}

interface CompanionGateReport {
  schema_version: "japanese-companion-gate-v1";
  generated_at: string;
  dataset_path: string;
  result_path: string;
  slice_report_path: string;
  critical_thresholds: Record<string, number>;
  watch_slices: string[];
  checks: {
    missing_metadata: number;
    zero_f1_count: number;
    overlong_answer_count: number;
    overlong_answer_rate: number;
    filler_count: number;
    /** Record keys ("sample_id::question_id") where filler prefix was detected. */
    per_record_filler_ids: string[];
  };
  slices: Record<string, MetricSummary>;
  verdict: "pass" | "fail";
  failures: string[];
  warnings: string[];
}

interface CliOptions {
  datasetPath: string;
  resultPath: string;
  sliceReportPath: string;
  outputPath?: string;
}

const CRITICAL_THRESHOLDS: Record<string, number> = {
  current: 0.9,
  exact: 0.85,
  why: 0.92,
  list: 0.9,
  temporal: 0.75,
};

const WATCH_SLICES = [
  "yes_no",
  "current_vs_previous",
  "relative_temporal",
  "noisy",
  "long_turn",
  "entity",
  "location",
];

const FILLER_PATTERN = /^(?:ちなみに|なお|ただ|実際には|現時点では|That said|Actually|Currently|Right now)/i;

/**
 * S43-011: product-side hallucination filler rejection.
 *
 * Strips known filler prefixes (Japanese / English) from a prediction string.
 * These prefixes signal that the answer has been padded with context that is
 * not directly grounded in the retrieved evidence.
 *
 * Example:
 *   "ちなみに GitHub Actions です。" → "GitHub Actions です。"
 *   "That said, Tokyo is the answer." → "Tokyo is the answer."
 */
export function stripHallucinationFiller(text: string): string {
  if (!text) return text;
  // Match filler prefix followed by optional punctuation/whitespace
  const stripped = text.replace(
    /^(?:ちなみに|なお|ただし?|実際には|現時点では|That said|Actually|Currently|Right now)[、,，\s]*/i,
    ""
  );
  return stripped;
}

function parseArgs(argv: string[]): CliOptions {
  let datasetPath = "";
  let resultPath = "";
  let sliceReportPath = "";
  let outputPath: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--dataset" && i + 1 < argv.length) {
      datasetPath = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (token === "--result" && i + 1 < argv.length) {
      resultPath = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (token === "--slice-report" && i + 1 < argv.length) {
      sliceReportPath = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (token === "--output" && i + 1 < argv.length) {
      outputPath = argv[i + 1];
      i += 1;
    }
  }

  if (!datasetPath) throw new Error("--dataset is required");
  if (!resultPath) throw new Error("--result is required");
  if (!sliceReportPath) throw new Error("--slice-report is required");
  return { datasetPath, resultPath, sliceReportPath, outputPath };
}

function loadSliceMap(datasetPath: string): Map<string, string> {
  const dataset = JSON.parse(readFileSync(datasetPath, "utf8")) as DatasetSample[];
  const map = new Map<string, string>();
  for (const sample of dataset) {
    for (const qa of sample.qa || []) {
      map.set(`${sample.sample_id}::${qa.question_id}`, String(qa.slice || "unlabeled"));
    }
  }
  return map;
}

function sentenceCount(text: string): number {
  return text
    .split(/\n+|(?<=[。.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean).length;
}

function isOverlongAnswer(text: string, slice: string): boolean {
  if (!text.trim()) return false;
  const shortSlices = new Set(["current", "current_vs_previous", "exact", "yes_no", "entity", "location", "relative_temporal"]);
  const charLimit = shortSlices.has(slice) ? 40 : 120;
  if (text.trim().length > charLimit) return true;
  if (shortSlices.has(slice) && sentenceCount(text) > 1) return true;
  return false;
}

export function buildJapaneseCompanionGateReport(
  datasetPath: string,
  resultPath: string,
  sliceReportPath: string
): CompanionGateReport {
  const resolvedDataset = resolve(datasetPath);
  const resolvedResult = resolve(resultPath);
  const resolvedSliceReport = resolve(sliceReportPath);
  const sliceMap = loadSliceMap(resolvedDataset);
  const result = JSON.parse(readFileSync(resolvedResult, "utf8")) as ResultFile;
  const sliceReport = JSON.parse(readFileSync(resolvedSliceReport, "utf8")) as SliceReport;

  let overlongAnswerCount = 0;
  let fillerCount = 0;
  const perRecordFillerIds: string[] = [];
  for (const record of result.records || []) {
    const slice = sliceMap.get(`${record.sample_id}::${record.question_id}`) || "unlabeled";
    if (isOverlongAnswer(record.prediction || "", slice)) overlongAnswerCount += 1;
    if (FILLER_PATTERN.test((record.prediction || "").trim())) {
      fillerCount += 1;
      perRecordFillerIds.push(`${record.sample_id}::${record.question_id}`);
    }
  }

  const failures: string[] = [];
  const warnings: string[] = [];
  if ((sliceReport.summary.missing_metadata || []).length > 0) {
    failures.push("missing_metadata");
  }
  for (const [slice, floor] of Object.entries(CRITICAL_THRESHOLDS)) {
    const actual = sliceReport.summary.by_slice[slice]?.f1_avg ?? 0;
    if (actual < floor) {
      failures.push(`slice:${slice}<${floor}`);
    }
  }
  if ((sliceReport.summary.overall.zero_f1_count || 0) > 1) {
    failures.push("zero_f1_count>1");
  }
  const overlongAnswerRate = (result.records || []).length > 0 ? overlongAnswerCount / result.records.length : 0;
  if (overlongAnswerRate > 0.1) {
    failures.push("overlong_answer_rate>0.10");
  }
  if (fillerCount > 0) {
    failures.push("unsupported_filler_detected");
  }

  for (const slice of WATCH_SLICES) {
    const metric = sliceReport.summary.by_slice[slice];
    if (!metric) {
      warnings.push(`watch_slice_missing:${slice}`);
      continue;
    }
    if (metric.f1_avg < 0.7) {
      warnings.push(`watch_slice_low:${slice}`);
    }
  }

  return {
    schema_version: "japanese-companion-gate-v1",
    generated_at: new Date().toISOString(),
    dataset_path: resolvedDataset,
    result_path: resolvedResult,
    slice_report_path: resolvedSliceReport,
    critical_thresholds: CRITICAL_THRESHOLDS,
    watch_slices: WATCH_SLICES,
    checks: {
      missing_metadata: (sliceReport.summary.missing_metadata || []).length,
      zero_f1_count: sliceReport.summary.overall.zero_f1_count || 0,
      overlong_answer_count: overlongAnswerCount,
      overlong_answer_rate: Number(overlongAnswerRate.toFixed(4)),
      filler_count: fillerCount,
      per_record_filler_ids: perRecordFillerIds,
    },
    slices: sliceReport.summary.by_slice,
    verdict: failures.length === 0 ? "pass" : "fail",
    failures,
    warnings,
  };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const report = buildJapaneseCompanionGateReport(options.datasetPath, options.resultPath, options.sliceReportPath);
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
