import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

interface DatasetQaMeta {
  question_id: string;
  slice?: string;
  cross_lingual?: boolean;
}

interface DatasetSample {
  sample_id: string;
  qa?: DatasetQaMeta[];
}

interface ResultRecord {
  sample_id: string;
  question_id: string;
  category: string;
  em: number;
  f1: number;
}

interface ResultFile {
  records: ResultRecord[];
}

interface MetricSummary {
  count: number;
  em_avg: number;
  f1_avg: number;
  zero_f1_count: number;
}

interface JapaneseReleaseReport {
  schema_version: "japanese-release-report-v1";
  generated_at: string;
  dataset_path: string;
  result_path: string;
  summary: {
    overall: MetricSummary;
    by_slice: Record<string, MetricSummary>;
    cross_lingual: MetricSummary;
    non_cross_lingual: MetricSummary;
    missing_metadata: string[];
  };
}

interface CliOptions {
  datasetPath: string;
  resultPath: string;
  outputPath?: string;
}

function parseArgs(argv: string[]): CliOptions {
  let datasetPath = "";
  let resultPath = "";
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
    if (token === "--output" && i + 1 < argv.length) {
      outputPath = argv[i + 1];
      i += 1;
    }
  }

  if (!datasetPath) throw new Error("--dataset is required");
  if (!resultPath) throw new Error("--result is required");
  return { datasetPath, resultPath, outputPath };
}

function summarize(records: ResultRecord[]): MetricSummary {
  if (records.length === 0) {
    return { count: 0, em_avg: 0, f1_avg: 0, zero_f1_count: 0 };
  }
  const emTotal = records.reduce((sum, record) => sum + Number(record.em || 0), 0);
  const f1Total = records.reduce((sum, record) => sum + Number(record.f1 || 0), 0);
  const zeroF1Count = records.filter((record) => Number(record.f1 || 0) === 0).length;
  return {
    count: records.length,
    em_avg: emTotal / records.length,
    f1_avg: f1Total / records.length,
    zero_f1_count: zeroF1Count,
  };
}

function buildMetadataMap(datasetPath: string): Map<string, { slice: string; cross_lingual: boolean }> {
  const raw = JSON.parse(readFileSync(datasetPath, "utf8")) as DatasetSample[];
  const map = new Map<string, { slice: string; cross_lingual: boolean }>();

  for (const sample of raw) {
    for (const qa of sample.qa || []) {
      const key = `${sample.sample_id}::${qa.question_id}`;
      map.set(key, {
        slice: String(qa.slice || "unlabeled").trim() || "unlabeled",
        cross_lingual: qa.cross_lingual === true,
      });
    }
  }

  return map;
}

export function buildJapaneseReleaseReport(datasetPath: string, resultPath: string): JapaneseReleaseReport {
  const resolvedDataset = resolve(datasetPath);
  const resolvedResult = resolve(resultPath);
  const metadata = buildMetadataMap(resolvedDataset);
  const result = JSON.parse(readFileSync(resolvedResult, "utf8")) as ResultFile;

  const bySlice = new Map<string, ResultRecord[]>();
  const crossLingual: ResultRecord[] = [];
  const nonCrossLingual: ResultRecord[] = [];
  const missingMetadata: string[] = [];

  for (const record of result.records || []) {
    const key = `${record.sample_id}::${record.question_id}`;
    const meta = metadata.get(key);
    if (!meta) {
      missingMetadata.push(key);
      continue;
    }
    const bucket = bySlice.get(meta.slice) || [];
    bucket.push(record);
    bySlice.set(meta.slice, bucket);
    if (meta.cross_lingual) {
      crossLingual.push(record);
    } else {
      nonCrossLingual.push(record);
    }
  }

  const bySliceSummary = Object.fromEntries(
    [...bySlice.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([slice, records]) => [slice, summarize(records)])
  );

  return {
    schema_version: "japanese-release-report-v1",
    generated_at: new Date().toISOString(),
    dataset_path: resolvedDataset,
    result_path: resolvedResult,
    summary: {
      overall: summarize(result.records || []),
      by_slice: bySliceSummary,
      cross_lingual: summarize(crossLingual),
      non_cross_lingual: summarize(nonCrossLingual),
      missing_metadata: missingMetadata.sort(),
    },
  };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const report = buildJapaneseReleaseReport(options.datasetPath, options.resultPath);
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
