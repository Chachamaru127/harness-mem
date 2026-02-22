import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { HarnessMemCore, type Config } from "../../memory-server/src/core/harness-mem-core";
import { evaluateLocomoQa, type LocomoMetricSummary } from "./locomo-evaluator";
import { HarnessMemLocomoAdapter, type HarnessLocomoAnswerTrace } from "./locomo-harness-adapter";
import { loadLocomoDataset } from "./locomo-loader";

export type BenchmarkSystem = "harness-mem" | "mem0" | "claude-mem";

export interface LocomoBenchmarkRecord {
  sample_id: string;
  question_id: string;
  category: string;
  question: string;
  answer: string;
  prediction: string;
  question_kind: string;
  answer_strategy: string;
  selected_evidence_ids: string[];
  answer_trace: HarnessLocomoAnswerTrace;
  search_latency_ms: number;
  token_estimate_input_tokens: number;
  token_estimate_output_tokens: number;
  token_estimate_total_tokens: number;
  em: number;
  f1: number;
}

export interface NumericStatSummary {
  count: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
}

export interface TokenEstimateSummary {
  count: number;
  input_total: number;
  output_total: number;
  total_total: number;
  input_avg: number;
  output_avg: number;
  total_avg: number;
}

export interface LocomoBenchmarkResult {
  schema_version: "locomo-benchmark-v2";
  generated_at: string;
  system: BenchmarkSystem;
  dataset: {
    path: string;
    sample_count: number;
    qa_count: number;
  };
  metrics: ReturnType<typeof evaluateLocomoQa>;
  comparison: {
    cat_1_to_4: LocomoMetricSummary;
    cat_5: LocomoMetricSummary;
  };
  performance: {
    search_latency_ms: NumericStatSummary;
  };
  cost: {
    search_token_estimate: TokenEstimateSummary;
  };
  records: LocomoBenchmarkRecord[];
}

export interface RunLocomoBenchmarkOptions {
  system: BenchmarkSystem;
  datasetPath: string;
  outputPath?: string;
  project?: string;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function tokenF1(prediction: string, answer: string): number {
  const predTokens = normalize(prediction).split(" ").filter(Boolean);
  const goldTokens = normalize(answer).split(" ").filter(Boolean);
  if (predTokens.length === 0 || goldTokens.length === 0) return 0;

  const bag = new Map<string, number>();
  for (const token of goldTokens) bag.set(token, (bag.get(token) || 0) + 1);
  let overlap = 0;
  for (const token of predTokens) {
    const count = bag.get(token) || 0;
    if (count > 0) {
      overlap += 1;
      bag.set(token, count - 1);
    }
  }
  if (overlap === 0) return 0;
  const precision = overlap / predTokens.length;
  const recall = overlap / goldTokens.length;
  return (2 * precision * recall) / (precision + recall);
}

function computeRecordScore(record: Omit<LocomoBenchmarkRecord, "em" | "f1">): Pick<LocomoBenchmarkRecord, "em" | "f1"> {
  const em = normalize(record.prediction) === normalize(record.answer) ? 1 : 0;
  const f1 = tokenF1(record.prediction, record.answer);
  return { em, f1 };
}

function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((lhs, rhs) => lhs - rhs);
  const rank = Math.max(0, Math.min(sorted.length - 1, Math.ceil((q / 100) * sorted.length) - 1));
  return sorted[rank] || 0;
}

function summarizeNumbers(values: number[]): NumericStatSummary {
  if (values.length === 0) {
    return { count: 0, min: 0, max: 0, avg: 0, p50: 0, p95: 0 };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    count: values.length,
    min,
    max,
    avg,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
  };
}

function summarizeTokenEstimate(records: LocomoBenchmarkRecord[]): TokenEstimateSummary {
  const count = records.length;
  const inputTotal = records.reduce((sum, record) => sum + record.token_estimate_input_tokens, 0);
  const outputTotal = records.reduce((sum, record) => sum + record.token_estimate_output_tokens, 0);
  const totalTotal = records.reduce((sum, record) => sum + record.token_estimate_total_tokens, 0);
  return {
    count,
    input_total: inputTotal,
    output_total: outputTotal,
    total_total: totalTotal,
    input_avg: count > 0 ? inputTotal / count : 0,
    output_avg: count > 0 ? outputTotal / count : 0,
    total_avg: count > 0 ? totalTotal / count : 0,
  };
}

function summarizeCategories(records: LocomoBenchmarkRecord[], categories: Set<string>): LocomoMetricSummary {
  return evaluateLocomoQa(
    records
      .filter((record) => categories.has(record.category))
      .map((record) => ({
        prediction: record.prediction,
        answer: record.answer,
        category: record.category,
      }))
  ).overall;
}

function createCore(tempDir: string): HarnessMemCore {
  const config: Config = {
    dbPath: join(tempDir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 37888,
    vectorDimension: 64,
    captureEnabled: true,
    retrievalEnabled: true,
    injectionEnabled: true,
    codexHistoryEnabled: false,
    codexProjectRoot: process.cwd(),
    codexSessionsRoot: process.cwd(),
    codexIngestIntervalMs: 5000,
    codexBackfillHours: 24,
    opencodeIngestEnabled: false,
    cursorIngestEnabled: false,
    antigravityIngestEnabled: false,
  };
  return new HarnessMemCore(config);
}

async function runHarnessMemBenchmark(options: RunLocomoBenchmarkOptions): Promise<LocomoBenchmarkResult> {
  const datasetPath = resolve(options.datasetPath);
  const samples = loadLocomoDataset(datasetPath);
  const missingAnswers = samples.flatMap((sample) =>
    sample.qa.filter((qa) => !qa.answer.trim()).map((qa) => `${sample.sample_id}:${qa.question_id}`)
  );
  if (missingAnswers.length > 0) {
    const preview = missingAnswers.slice(0, 5).join(", ");
    throw new Error(
      `dataset contains ${missingAnswers.length} QA rows with empty answer (examples: ${preview})`
    );
  }
  const project = options.project || "locomo-benchmark";
  const tempDir = mkdtempSync(join(tmpdir(), "locomo-harness-"));
  const core = createCore(tempDir);
  const records: LocomoBenchmarkRecord[] = [];

  try {
    for (const sample of samples) {
      const adapter = new HarnessMemLocomoAdapter(core, {
        project,
        session_id: `locomo-benchmark-${sample.sample_id}`,
      });
      adapter.ingestSample(sample);
      for (const qa of sample.qa) {
        const replay = adapter.answerQuestion(qa.question, { category: qa.category });
        const baseRecord = {
          sample_id: sample.sample_id,
          question_id: qa.question_id,
          category: qa.category,
          question: qa.question,
          answer: qa.answer,
          prediction: replay.prediction,
          question_kind: replay.question_kind,
          answer_strategy: replay.answer_strategy,
          selected_evidence_ids: replay.selected_evidence_ids,
          answer_trace: replay.answer_trace,
          search_latency_ms: replay.search_latency_ms,
          token_estimate_input_tokens: replay.token_estimate_input_tokens,
          token_estimate_output_tokens: replay.token_estimate_output_tokens,
          token_estimate_total_tokens: replay.token_estimate_total_tokens,
        };
        records.push({ ...baseRecord, ...computeRecordScore(baseRecord) });
      }
    }

    const metrics = evaluateLocomoQa(
      records.map((record) => ({
        prediction: record.prediction,
        answer: record.answer,
        category: record.category,
      }))
    );
    const comparison = {
      cat_1_to_4: summarizeCategories(records, new Set(["cat-1", "cat-2", "cat-3", "cat-4"])),
      cat_5: summarizeCategories(records, new Set(["cat-5"])),
    };
    const performance = {
      search_latency_ms: summarizeNumbers(records.map((record) => record.search_latency_ms)),
    };
    const cost = {
      search_token_estimate: summarizeTokenEstimate(records),
    };

    const result: LocomoBenchmarkResult = {
      schema_version: "locomo-benchmark-v2",
      generated_at: new Date().toISOString(),
      system: "harness-mem",
      dataset: {
        path: datasetPath,
        sample_count: samples.length,
        qa_count: records.length,
      },
      metrics,
      comparison,
      performance,
      cost,
      records,
    };
    return result;
  } finally {
    core.shutdown("benchmark");
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function runLocomoBenchmark(options: RunLocomoBenchmarkOptions): Promise<LocomoBenchmarkResult> {
  if (options.system !== "harness-mem") {
    throw new Error(`system ${options.system} is not supported yet`);
  }

  const result = await runHarnessMemBenchmark(options);
  if (options.outputPath) {
    const outputPath = resolve(options.outputPath);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  return result;
}

function parseArgs(argv: string[]): RunLocomoBenchmarkOptions {
  const parsed: Partial<RunLocomoBenchmarkOptions> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--system" && i + 1 < argv.length) {
      parsed.system = argv[i + 1] as BenchmarkSystem;
      i += 1;
      continue;
    }
    if (token === "--dataset" && i + 1 < argv.length) {
      parsed.datasetPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--output" && i + 1 < argv.length) {
      parsed.outputPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--project" && i + 1 < argv.length) {
      parsed.project = argv[i + 1];
      i += 1;
    }
  }

  if (!parsed.system) {
    throw new Error("--system is required");
  }
  if (!parsed.datasetPath) {
    throw new Error("--dataset is required");
  }

  return parsed as RunLocomoBenchmarkOptions;
}

if (import.meta.main) {
  const options = parseArgs(process.argv.slice(2));
  runLocomoBenchmark(options)
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
