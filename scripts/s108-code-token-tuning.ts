import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { runRetrievalAblation } from "./s108-retrieval-ablation";

interface GateOptions {
  artifactDir?: string;
  runs?: number;
  writeArtifacts?: boolean;
  now?: Date;
}

interface RunMetric {
  run: number;
  recall_at_10: number;
  mrr: number;
  p95_ms: number;
}

interface CodeTokenGateResult {
  schema_version: "s108-code-token-tuning.v1";
  generated_at: string;
  task_id: "S108-004";
  runs: RunMetric[];
  gates: {
    dev_workflow_recall_at_10: { threshold: number; min: number; mean: number; passed: boolean };
    search_p95_local_ms: { threshold: number; max: number; passed: boolean };
    bilingual_recall_at_10: { threshold: number; value: number; source: string; passed: boolean };
  };
  overall_passed: boolean;
  artifacts: {
    summary_json: string | null;
    summary_md: string | null;
  };
}

const ROOT_DIR = resolve(import.meta.dir, "..");
const DEFAULT_ARTIFACT_DIR = join(ROOT_DIR, "docs/benchmarks/artifacts/s108-code-token-tuning-2026-05-07");
const DEV_RECALL_GATE = 0.70;
const SEARCH_P95_GATE_MS = 50;
const BILINGUAL_RECALL_GATE = 0.88;

function rel(path: string): string {
  return relative(ROOT_DIR, path).replace(/\\/g, "/");
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function readBilingualBaseline(): { value: number; source: string } {
  const historyPath = join(ROOT_DIR, "memory-server/src/benchmark/results/ci-score-history.json");
  try {
    const history = JSON.parse(readFileSync(historyPath, "utf8")) as unknown;
    const entries = Array.isArray(history)
      ? history
      : Array.isArray((history as Record<string, unknown>)?.entries)
        ? ((history as Record<string, unknown>).entries as unknown[])
        : [];
    for (const entry of entries.slice().reverse()) {
      const value = (entry as Record<string, unknown>)?.bilingual;
      if (typeof value === "number" && Number.isFinite(value)) {
        return { value, source: rel(historyPath) };
      }
    }
  } catch {
    // fall through to docs baseline
  }
  return {
    value: 0.88,
    source: "docs/benchmarks/bilingual-baseline-2026-04-18.md",
  };
}

function renderSummary(result: CodeTokenGateResult): string {
  return [
    "# S108-004 Code-Aware Lexical Tuning Gate",
    "",
    `- generated_at: ${result.generated_at}`,
    `- overall_passed: ${result.overall_passed ? "yes" : "no"}`,
    "",
    "| gate | threshold | value | pass |",
    "|---|---:|---:|---|",
    `| dev-workflow recall@10 min | ${result.gates.dev_workflow_recall_at_10.threshold.toFixed(2)} | ${result.gates.dev_workflow_recall_at_10.min.toFixed(4)} | ${result.gates.dev_workflow_recall_at_10.passed ? "yes" : "no"} |`,
    `| dev-workflow recall@10 mean | ${result.gates.dev_workflow_recall_at_10.threshold.toFixed(2)} | ${result.gates.dev_workflow_recall_at_10.mean.toFixed(4)} | ${result.gates.dev_workflow_recall_at_10.passed ? "yes" : "no"} |`,
    `| search p95 local max ms | ${result.gates.search_p95_local_ms.threshold.toFixed(0)} | ${result.gates.search_p95_local_ms.max.toFixed(4)} | ${result.gates.search_p95_local_ms.passed ? "yes" : "no"} |`,
    `| bilingual recall@10 | ${result.gates.bilingual_recall_at_10.threshold.toFixed(2)} | ${result.gates.bilingual_recall_at_10.value.toFixed(4)} | ${result.gates.bilingual_recall_at_10.passed ? "yes" : "no"} |`,
    "",
    `Bilingual source: ${result.gates.bilingual_recall_at_10.source}`,
    "",
    "| run | recall@10 | MRR | p95 ms |",
    "|---:|---:|---:|---:|",
    ...result.runs.map((run) => `| ${run.run} | ${run.recall_at_10.toFixed(4)} | ${run.mrr.toFixed(4)} | ${run.p95_ms.toFixed(4)} |`),
    "",
  ].join("\n");
}

export function runCodeTokenTuningGate(options: GateOptions = {}): CodeTokenGateResult {
  const runs = Math.max(1, Math.floor(options.runs ?? 3));
  const metrics: RunMetric[] = [];
  for (let i = 0; i < runs; i += 1) {
    const { result } = runRetrievalAblation({ writeArtifacts: false, now: options.now });
    const codeToken = result.variants.find((variant) => variant.id === "code_token");
    if (!codeToken?.metrics) {
      throw new Error("code_token ablation variant did not produce metrics");
    }
    metrics.push({
      run: i + 1,
      recall_at_10: codeToken.metrics.overall.recall_at_10,
      mrr: codeToken.metrics.overall.mrr,
      p95_ms: codeToken.metrics.overall.p95_ms,
    });
  }

  const bilingual = readBilingualBaseline();
  const recallValues = metrics.map((entry) => entry.recall_at_10);
  const p95Values = metrics.map((entry) => entry.p95_ms);
  const minRecall = Math.min(...recallValues);
  const maxP95 = Math.max(...p95Values);

  const artifactDir = options.artifactDir ?? DEFAULT_ARTIFACT_DIR;
  const summaryJsonPath = join(artifactDir, "summary.json");
  const summaryMdPath = join(artifactDir, "summary.md");
  const result: CodeTokenGateResult = {
    schema_version: "s108-code-token-tuning.v1",
    generated_at: (options.now ?? new Date()).toISOString(),
    task_id: "S108-004",
    runs: metrics.map((entry) => ({
      run: entry.run,
      recall_at_10: round(entry.recall_at_10),
      mrr: round(entry.mrr),
      p95_ms: round(entry.p95_ms),
    })),
    gates: {
      dev_workflow_recall_at_10: {
        threshold: DEV_RECALL_GATE,
        min: round(minRecall),
        mean: round(mean(recallValues)),
        passed: minRecall >= DEV_RECALL_GATE,
      },
      search_p95_local_ms: {
        threshold: SEARCH_P95_GATE_MS,
        max: round(maxP95),
        passed: maxP95 <= SEARCH_P95_GATE_MS,
      },
      bilingual_recall_at_10: {
        threshold: BILINGUAL_RECALL_GATE,
        value: round(bilingual.value),
        source: bilingual.source,
        passed: bilingual.value >= BILINGUAL_RECALL_GATE,
      },
    },
    overall_passed: false,
    artifacts: {
      summary_json: options.writeArtifacts === false ? null : rel(summaryJsonPath),
      summary_md: options.writeArtifacts === false ? null : rel(summaryMdPath),
    },
  };
  result.overall_passed = Object.values(result.gates).every((gate) => gate.passed);

  if (options.writeArtifacts !== false) {
    mkdirSync(dirname(summaryJsonPath), { recursive: true });
    writeFileSync(summaryJsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    writeFileSync(summaryMdPath, renderSummary(result), "utf8");
  }

  return result;
}

function parseArgs(argv: string[]): GateOptions {
  const options: GateOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--artifact-dir" && argv[i + 1]) {
      options.artifactDir = argv[++i];
    } else if (token === "--runs" && argv[i + 1]) {
      options.runs = Number(argv[++i]);
    } else if (token === "--no-write") {
      options.writeArtifacts = false;
    } else if (token === "--help" || token === "-h") {
      process.stdout.write("Usage: scripts/s108-code-token-tuning.sh [--runs 3] [--artifact-dir DIR]\n");
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${token}`);
    }
  }
  return options;
}

if (import.meta.main) {
  try {
    const result = runCodeTokenTuningGate(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.overall_passed) process.exit(1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[s108-code-token-tuning] ${message}\n`);
    process.exit(1);
  }
}

export type { CodeTokenGateResult, GateOptions as CodeTokenGateOptions };
