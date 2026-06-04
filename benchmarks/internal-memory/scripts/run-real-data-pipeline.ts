#!/usr/bin/env bun
/**
 * Real-data benchmark pipeline (§140 pilot / §141 scale).
 * Export → mask → generate → filter → judge → review queue → gold jsonl
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exportMaskedCorpus } from "../lib/export-corpus";
import { loadBenchmarkEnvFiles } from "../lib/load-env";
import { getSharedOpenRouterBudget, resetSharedOpenRouterBudget } from "../lib/openrouter-budget";
import { scanJsonlForPii } from "../lib/pii-scan";
import { loadCheckpoint, saveCheckpoint } from "../lib/real-data/checkpoint";
import { filterCandidatesAsync } from "../lib/real-data/filters";
import { generateCandidatesFromCorpus } from "../lib/real-data/generate-candidates";
import {
  assertGeneratorJudgeSeparated,
  capByCompetency,
  generateLlmCandidatesFromCorpus,
} from "../lib/real-data/llm-generate";
import {
  assertModelsSeparated,
  computeGoldenAgreement,
  getGeneratorModel,
  getJudgeModel,
  judgeCandidate,
  passesJudgeGate,
} from "../lib/real-data/judge-gate";
import { applyHumanReview } from "../lib/real-data/human-review";
import { buildReviewQueue } from "../lib/real-data/review-queue";
import type { CandidateCase, PipelineManifest } from "../lib/real-data/types";
import { assertBenchmarkCase } from "../lib/schema";
import type { BenchmarkCase, Competency } from "../lib/types";

const ROOT = join(import.meta.dir, "..");
const DATASETS = join(ROOT, "datasets");
const REAL_DIR = join(DATASETS, "real-data-pilot");
const DEFAULT_CHECKPOINT = join(REAL_DIR, "pipeline-checkpoint.json");

export interface PipelineArgs {
  dbPath?: string;
  corpusLimit: number;
  perCompetency: number;
  targetPerCompetency: number;
  overgenFactor: number;
  useOpenRouter: boolean;
  useLlmGenerate: boolean;
  envFiles: string[];
  dryRun: boolean;
  checkpointPath: string;
  resume: boolean;
  datasetVersion: "v1" | "v2";
  judgeK: number;
}

export function parseArgs(argv: string[]): PipelineArgs {
  let dbPath: string | undefined;
  let corpusLimit = 800;
  let perCompetency = 15;
  let targetPerCompetency = 350;
  let overgenFactor = 2;
  let useOpenRouter = process.env.INTERNAL_BENCH_USE_OPENROUTER === "1";
  let useLlmGenerate = false;
  const envFiles: string[] = [];
  let dryRun = false;
  let checkpointPath = DEFAULT_CHECKPOINT;
  let resume = false;
  let datasetVersion: "v1" | "v2" = "v2";
  let judgeK = 5;

  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === "--db" && i + 1 < argv.length) {
      dbPath = argv[i + 1];
      i += 1;
    } else if (t === "--corpus-limit" && i + 1 < argv.length) {
      corpusLimit = Number(argv[i + 1]);
      i += 1;
    } else if (t === "--per-competency" && i + 1 < argv.length) {
      perCompetency = Number(argv[i + 1]);
      i += 1;
    } else if (t === "--target-per-competency" && i + 1 < argv.length) {
      targetPerCompetency = Number(argv[i + 1]);
      i += 1;
    } else if (t === "--overgen-factor" && i + 1 < argv.length) {
      overgenFactor = Number(argv[i + 1]);
      i += 1;
    } else if (t === "--checkpoint" && i + 1 < argv.length) {
      checkpointPath = argv[i + 1];
      i += 1;
    } else if (t === "--judge-k" && i + 1 < argv.length) {
      judgeK = Number(argv[i + 1]);
      i += 1;
    } else if (t === "--use-openrouter") {
      useOpenRouter = true;
    } else if (t === "--use-llm-generate") {
      useLlmGenerate = true;
    } else if (t === "--pilot") {
      datasetVersion = "v1";
      targetPerCompetency = 25;
      perCompetency = 25;
      useLlmGenerate = false;
    } else if (t === "--resume") {
      resume = true;
    } else if (t === "--env-file" && i + 1 < argv.length) {
      envFiles.push(argv[i + 1]);
      i += 1;
    } else if (t === "--dry-run") {
      dryRun = true;
    }
  }

  if (datasetVersion === "v2" && !argv.includes("--pilot")) {
    useLlmGenerate = argv.includes("--no-llm-generate") ? false : true;
    if (!argv.includes("--per-competency")) perCompetency = targetPerCompetency;
  }

  return {
    dbPath,
    corpusLimit,
    perCompetency,
    targetPerCompetency,
    overgenFactor,
    useOpenRouter,
    useLlmGenerate,
    envFiles,
    dryRun,
    checkpointPath,
    resume,
    datasetVersion,
    judgeK,
  };
}

function toBenchmarkCase(c: CandidateCase): BenchmarkCase {
  const {
    source_round_ids: _s,
    generation_model: _g,
    filter_passed: _f,
    filter_reason: _r,
    judge_scores: _j,
    ...rest
  } = c;
  return rest;
}

function competencyCounts(cases: CandidateCase[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of cases) {
    const k = c.competency ?? "AR";
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export async function runRealDataPipeline(args: PipelineArgs): Promise<void> {
  loadBenchmarkEnvFiles(args.envFiles, { override: true });
  if (!process.env.INTERNAL_BENCH_BUDGET_USD) {
    process.env.INTERNAL_BENCH_BUDGET_USD = args.datasetVersion === "v2" ? "30" : "20";
  }
  resetSharedOpenRouterBudget();
  const budget = args.useOpenRouter ? getSharedOpenRouterBudget() : undefined;

  if (args.useOpenRouter) {
    assertModelsSeparated();
    if (args.useLlmGenerate) assertGeneratorJudgeSeparated(true);
  }

  mkdirSync(REAL_DIR, { recursive: true });
  const ck = args.resume ? loadCheckpoint(args.checkpointPath) : null;

  let roundsCount = ck?.corpus_rounds ?? 0;
  let candidates: CandidateCase[] = ck?.candidates ?? [];
  let passed: CandidateCase[] = ck?.passed ?? [];
  let stats = ck?.filter_stats;
  let judged: CandidateCase[] = ck?.judged ?? [];

  if (!ck || ck.phase === "exported" || candidates.length === 0) {
    console.log("[real-data] exporting masked corpus (read-only)...");
    const rounds = exportMaskedCorpus({ dbPath: args.dbPath, limit: args.corpusLimit });
    roundsCount = rounds.length;
    console.log(`[real-data] corpus rounds: ${rounds.length}`);

    console.log("[real-data] generating candidates...");
    if (args.useLlmGenerate) {
      candidates = await generateLlmCandidatesFromCorpus(rounds, {
        targetPerCompetency: Math.ceil(args.targetPerCompetency * args.overgenFactor),
        overgenFactor: args.overgenFactor,
        budget: budget ?? undefined,
        requireLlm: Boolean(budget && args.useOpenRouter),
      });
    } else {
      candidates = generateCandidatesFromCorpus(rounds, {
        perCompetency: Math.ceil(args.targetPerCompetency * args.overgenFactor),
        generatorModel: getGeneratorModel(),
      });
    }
    console.log(`[real-data] candidates generated: ${candidates.length}`);
    saveCheckpoint(args.checkpointPath, {
      schema_version: "real-data-checkpoint-v1",
      saved_at: new Date().toISOString(),
      phase: "generated",
      corpus_rounds: roundsCount,
      candidates,
    });
  }

  if (!stats || passed.length === 0) {
    console.log("[real-data] filtering candidates...");
    const filtered = await filterCandidatesAsync(candidates, {
      budget: budget ?? undefined,
      leakageTrials: 3,
    });
    passed = filtered.passed;
    stats = filtered.stats;
    console.log("[real-data] filter stats:", stats);
    saveCheckpoint(args.checkpointPath, {
      schema_version: "real-data-checkpoint-v1",
      saved_at: new Date().toISOString(),
      phase: "filtered",
      corpus_rounds: roundsCount,
      candidates,
      filter_stats: stats,
      passed,
    });
  }

  if (judged.length === 0) {
    judged = [];
    console.log(`[real-data] judging (k=${args.judgeK})...`);
    for (const c of passed) {
      const scores = await judgeCandidate(c, budget, args.judgeK);
      c.judge_scores = scores;
      if (passesJudgeGate(scores)) judged.push(c);
    }
    console.log(`[real-data] judge passed: ${judged.length}`);
    saveCheckpoint(args.checkpointPath, {
      schema_version: "real-data-checkpoint-v1",
      saved_at: new Date().toISOString(),
      phase: "judged",
      corpus_rounds: roundsCount,
      candidates,
      filter_stats: stats,
      passed,
      judged,
    });
  }

  const golden = computeGoldenAgreement(judged.slice(0, Math.min(200, judged.length)));
  console.log(`[real-data] golden agreement rate: ${(golden.rate * 100).toFixed(1)}%`);

  const { accepted, log } = applyHumanReview(judged, { autoAcceptFiltered: true });
  writeFileSync(join(REAL_DIR, "review-log.json"), JSON.stringify(log, null, 2));

  const { entries: queueEntries, stats: queueStats } = buildReviewQueue(judged);
  writeFileSync(
    join(REAL_DIR, "review-queue.jsonl"),
    queueEntries.map((e) => JSON.stringify(e)).join("\n") + (queueEntries.length ? "\n" : ""),
  );

  const maxCases = args.datasetVersion === "v1" ? 100 : args.targetPerCompetency * 4;
  const capped =
    args.datasetVersion === "v2"
      ? capByCompetency(accepted, args.targetPerCompetency)
      : accepted.slice(0, maxCases);

  for (let i = 0; i < capped.length; i += 1) {
    assertBenchmarkCase(toBenchmarkCase(capped[i]), i + 1);
  }

  const outName =
    args.datasetVersion === "v2"
      ? "coding-memory-real-ja-mixed-v2.jsonl"
      : "coding-memory-real-ja-mixed-v1.jsonl";
  const outPath = join(DATASETS, outName);
  const jsonl = capped.map((c) => JSON.stringify(toBenchmarkCase(c))).join("\n") + "\n";
  const piiLeaks = scanJsonlForPii(jsonl);
  if (piiLeaks.length > 0) {
    throw new Error(`PII leak detected in output: ${piiLeaks.join(", ")}`);
  }

  if (!args.dryRun) {
    writeFileSync(outPath, jsonl);
  }

  const counts = competencyCounts(capped);
  const manifest: PipelineManifest = {
    schema_version: args.datasetVersion === "v2" ? "real-data-pipeline-v2" : "real-data-pipeline-v1",
    generated_at: new Date().toISOString(),
    corpus_rounds: roundsCount,
    candidates_generated: candidates.length,
    filter_stats: stats!,
    judge_model: getJudgeModel(),
    generator_model: getGeneratorModel(),
    golden_agreement_rate: golden.rate,
    openrouter_spent_usd: budget?.spent,
    openrouter_budget_cap_usd: budget?.cap,
    target_per_competency: args.targetPerCompetency,
    dataset_version: args.datasetVersion,
    review_queue_stats: queueStats,
    competency_counts: counts,
  };
  writeFileSync(join(REAL_DIR, "pipeline-manifest.json"), JSON.stringify(manifest, null, 2));

  saveCheckpoint(args.checkpointPath, {
    schema_version: "real-data-checkpoint-v1",
    saved_at: new Date().toISOString(),
    phase: "accepted",
    corpus_rounds: roundsCount,
    candidates,
    filter_stats: stats,
    passed,
    judged,
    accepted: capped,
  });

  console.log(`[real-data] gold dataset: ${capped.length} cases → ${outPath}`);
  console.log("[real-data] competency counts:", counts);
  if (budget) {
    console.log(`[real-data] OpenRouter spent: $${budget.spent.toFixed(6)} / cap $${budget.cap}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await runRealDataPipeline(args);
  process.exit(0);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
