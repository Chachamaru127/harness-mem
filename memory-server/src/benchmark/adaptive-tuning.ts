import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  runBilingualBenchmark,
  runDevWorkflowBenchmark,
  resolveBenchEmbeddingProfile,
  type BenchEmbeddingProfile,
} from "./run-ci";
import {
  getAdaptiveThresholdConfigPath,
  loadAdaptiveThresholdDefaults,
} from "../embedding/adaptive-config";

const BILINGUAL_50_PATH = resolve(import.meta.dir, "../../../tests/benchmarks/fixtures/bilingual-50.json");
const DEV_WORKFLOW_20_PATH = resolve(import.meta.dir, "../../../tests/benchmarks/fixtures/dev-workflow-20.json");

interface AdaptiveTuneOptions {
  step: number;
  jaMin: number;
  jaMax: number;
  codeMin: number;
  codeMax: number;
  save: boolean;
  outputPath: string;
}

export interface AdaptiveTuneCandidate {
  jaThreshold: number;
  codeThreshold: number;
  bilingualRecall: number;
  devWorkflowRecall: number;
  combinedScore: number;
}

export interface AdaptiveTuneReport {
  generatedAt: string;
  fixturePaths: {
    bilingual50: string;
    devWorkflow20: string;
  };
  best: AdaptiveTuneCandidate;
  candidates: AdaptiveTuneCandidate[];
}

function clampRatio(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, value));
}

function roundStep(value: number): number {
  return Math.round(value * 100) / 100;
}

export function buildThresholdGrid(options: AdaptiveTuneOptions): Array<{ jaThreshold: number; codeThreshold: number }> {
  const candidates: Array<{ jaThreshold: number; codeThreshold: number }> = [];
  for (let ja = options.jaMin; ja <= options.jaMax + 0.0001; ja += options.step) {
    for (let code = options.codeMin; code <= options.codeMax + 0.0001; code += options.step) {
      candidates.push({
        jaThreshold: roundStep(ja),
        codeThreshold: roundStep(code),
      });
    }
  }
  return candidates;
}

function parseArgs(argv: string[]): AdaptiveTuneOptions {
  const defaults = loadAdaptiveThresholdDefaults();
  const parsed: Partial<AdaptiveTuneOptions> = {
    step: 0.05,
    jaMin: Math.max(0.55, defaults.jaThreshold - 0.15),
    jaMax: Math.min(0.95, defaults.jaThreshold + 0.1),
    codeMin: Math.max(0.2, defaults.codeThreshold - 0.15),
    codeMax: Math.min(0.8, defaults.codeThreshold + 0.15),
    save: false,
    outputPath: getAdaptiveThresholdConfigPath(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--step" && next) {
      parsed.step = Number(next);
      index += 1;
      continue;
    }
    if (token === "--ja-min" && next) {
      parsed.jaMin = Number(next);
      index += 1;
      continue;
    }
    if (token === "--ja-max" && next) {
      parsed.jaMax = Number(next);
      index += 1;
      continue;
    }
    if (token === "--code-min" && next) {
      parsed.codeMin = Number(next);
      index += 1;
      continue;
    }
    if (token === "--code-max" && next) {
      parsed.codeMax = Number(next);
      index += 1;
      continue;
    }
    if (token === "--output" && next) {
      parsed.outputPath = resolve(next);
      index += 1;
      continue;
    }
    if (token === "--save") {
      parsed.save = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      console.log(
        "Usage: bun run memory-server/src/benchmark/adaptive-tuning.ts [--step 0.05] [--ja-min 0.7] [--ja-max 0.95] [--code-min 0.35] [--code-max 0.65] [--save] [--output data/adaptive-thresholds.json]"
      );
      process.exit(0);
    }
  }

  return {
    step: clampRatio(parsed.step ?? 0.05, 0.05) || 0.05,
    jaMin: clampRatio(parsed.jaMin ?? defaults.jaThreshold, defaults.jaThreshold),
    jaMax: clampRatio(parsed.jaMax ?? defaults.jaThreshold, defaults.jaThreshold),
    codeMin: clampRatio(parsed.codeMin ?? defaults.codeThreshold, defaults.codeThreshold),
    codeMax: clampRatio(parsed.codeMax ?? defaults.codeThreshold, defaults.codeThreshold),
    save: parsed.save === true,
    outputPath: parsed.outputPath || getAdaptiveThresholdConfigPath(),
  };
}

function buildAdaptiveProfile(jaThreshold: number, codeThreshold: number): BenchEmbeddingProfile {
  const base = resolveBenchEmbeddingProfile({
    ...process.env,
    HARNESS_BENCH_EMBEDDING_MODE: "adaptive",
    HARNESS_MEM_ADAPTIVE_JA_THRESHOLD: String(jaThreshold),
    HARNESS_MEM_ADAPTIVE_CODE_THRESHOLD: String(codeThreshold),
  });
  return {
    ...base,
    mode: "adaptive",
    provider: "adaptive",
    adaptive: { jaThreshold, codeThreshold },
  };
}

async function withBenchmarkEnvironment<T>(
  profile: BenchEmbeddingProfile,
  run: () => Promise<T>,
): Promise<T> {
  const previous = {
    decayDisabled: process.env.HARNESS_MEM_DECAY_DISABLED,
    rerankerEnabled: process.env.HARNESS_MEM_RERANKER_ENABLED,
    benchMode: process.env.HARNESS_BENCH_EMBEDDING_MODE,
    provider: process.env.HARNESS_MEM_EMBEDDING_PROVIDER,
    model: process.env.HARNESS_MEM_EMBEDDING_MODEL,
    jaThreshold: process.env.HARNESS_MEM_ADAPTIVE_JA_THRESHOLD,
    codeThreshold: process.env.HARNESS_MEM_ADAPTIVE_CODE_THRESHOLD,
  };

  process.env.HARNESS_MEM_DECAY_DISABLED = "1";
  process.env.HARNESS_MEM_RERANKER_ENABLED = "1";
  process.env.HARNESS_BENCH_EMBEDDING_MODE = profile.mode;
  process.env.HARNESS_MEM_EMBEDDING_PROVIDER = profile.provider;
  process.env.HARNESS_MEM_EMBEDDING_MODEL = profile.model;
  if (profile.adaptive) {
    process.env.HARNESS_MEM_ADAPTIVE_JA_THRESHOLD = String(profile.adaptive.jaThreshold);
    process.env.HARNESS_MEM_ADAPTIVE_CODE_THRESHOLD = String(profile.adaptive.codeThreshold);
  } else {
    delete process.env.HARNESS_MEM_ADAPTIVE_JA_THRESHOLD;
    delete process.env.HARNESS_MEM_ADAPTIVE_CODE_THRESHOLD;
  }

  try {
    return await run();
  } finally {
    if (previous.decayDisabled == null) delete process.env.HARNESS_MEM_DECAY_DISABLED;
    else process.env.HARNESS_MEM_DECAY_DISABLED = previous.decayDisabled;
    if (previous.rerankerEnabled == null) delete process.env.HARNESS_MEM_RERANKER_ENABLED;
    else process.env.HARNESS_MEM_RERANKER_ENABLED = previous.rerankerEnabled;
    if (previous.benchMode == null) delete process.env.HARNESS_BENCH_EMBEDDING_MODE;
    else process.env.HARNESS_BENCH_EMBEDDING_MODE = previous.benchMode;
    if (previous.provider == null) delete process.env.HARNESS_MEM_EMBEDDING_PROVIDER;
    else process.env.HARNESS_MEM_EMBEDDING_PROVIDER = previous.provider;
    if (previous.model == null) delete process.env.HARNESS_MEM_EMBEDDING_MODEL;
    else process.env.HARNESS_MEM_EMBEDDING_MODEL = previous.model;
    if (previous.jaThreshold == null) delete process.env.HARNESS_MEM_ADAPTIVE_JA_THRESHOLD;
    else process.env.HARNESS_MEM_ADAPTIVE_JA_THRESHOLD = previous.jaThreshold;
    if (previous.codeThreshold == null) delete process.env.HARNESS_MEM_ADAPTIVE_CODE_THRESHOLD;
    else process.env.HARNESS_MEM_ADAPTIVE_CODE_THRESHOLD = previous.codeThreshold;
  }
}

export async function runAdaptiveThresholdTuning(options: AdaptiveTuneOptions): Promise<AdaptiveTuneReport> {
  const grid = buildThresholdGrid(options);
  if (grid.length === 0) {
    throw new Error("adaptive tuning grid is empty");
  }

  const candidates: AdaptiveTuneCandidate[] = [];
  for (const candidate of grid) {
    const profile = buildAdaptiveProfile(candidate.jaThreshold, candidate.codeThreshold);
    const { bilingual, devWorkflow } = await withBenchmarkEnvironment(profile, async () => ({
      bilingual: await runBilingualBenchmark(BILINGUAL_50_PATH, profile),
      devWorkflow: await runDevWorkflowBenchmark(DEV_WORKFLOW_20_PATH, profile),
    }));
    const combinedScore = bilingual.recall * 0.7 + devWorkflow.recall * 0.3;
    candidates.push({
      jaThreshold: candidate.jaThreshold,
      codeThreshold: candidate.codeThreshold,
      bilingualRecall: bilingual.recall,
      devWorkflowRecall: devWorkflow.recall,
      combinedScore,
    });
  }

  candidates.sort((lhs, rhs) => {
    if (rhs.combinedScore !== lhs.combinedScore) {
      return rhs.combinedScore - lhs.combinedScore;
    }
    if (rhs.bilingualRecall !== lhs.bilingualRecall) {
      return rhs.bilingualRecall - lhs.bilingualRecall;
    }
    return rhs.devWorkflowRecall - lhs.devWorkflowRecall;
  });

  const report: AdaptiveTuneReport = {
    generatedAt: new Date().toISOString(),
    fixturePaths: {
      bilingual50: BILINGUAL_50_PATH,
      devWorkflow20: DEV_WORKFLOW_20_PATH,
    },
    best: candidates[0]!,
    candidates,
  };

  if (options.save) {
    writeFileSync(
      options.outputPath,
      `${JSON.stringify(
        {
          jaThreshold: report.best.jaThreshold,
          codeThreshold: report.best.codeThreshold,
          source: "adaptive-tuning",
          updatedAt: report.generatedAt,
          notes: "Generated by memory-server/src/benchmark/adaptive-tuning.ts",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  return report;
}

if (import.meta.main) {
  const options = parseArgs(process.argv.slice(2));
  runAdaptiveThresholdTuning(options)
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
