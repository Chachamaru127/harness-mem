#!/usr/bin/env bun
/**
 * Real-data benchmark pipeline (§140 pilot).
 * Export → mask → generate → filter → judge → human review → gold jsonl
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exportMaskedCorpus } from "../lib/export-corpus";
import { loadBenchmarkEnvFiles } from "../lib/load-env";
import { getSharedOpenRouterBudget, resetSharedOpenRouterBudget } from "../lib/openrouter-budget";
import { scanJsonlForPii } from "../lib/pii-scan";
import { generateCandidatesFromCorpus } from "../lib/real-data/generate-candidates";
import { filterCandidates } from "../lib/real-data/filters";
import {
  computeGoldenAgreement,
  getGeneratorModel,
  getJudgeModel,
  judgeCandidate,
  passesJudgeGate,
} from "../lib/real-data/judge-gate";
import { applyHumanReview } from "../lib/real-data/human-review";
import type { CandidateCase, PipelineManifest } from "../lib/real-data/types";
import { assertBenchmarkCase } from "../lib/schema";
import type { BenchmarkCase } from "../lib/types";

const ROOT = join(import.meta.dir, "..");
const DATASETS = join(ROOT, "datasets");
const REAL_DIR = join(DATASETS, "real-data-pilot");

function parseArgs(argv: string[]): {
  dbPath?: string;
  corpusLimit: number;
  perCompetency: number;
  useOpenRouter: boolean;
  envFiles: string[];
  dryRun: boolean;
} {
  let dbPath: string | undefined;
  let corpusLimit = 800;
  let perCompetency = 15;
  let useOpenRouter = process.env.INTERNAL_BENCH_USE_OPENROUTER === "1";
  const envFiles: string[] = [];
  let dryRun = false;

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
    } else if (t === "--use-openrouter") {
      useOpenRouter = true;
    } else if (t === "--env-file" && i + 1 < argv.length) {
      envFiles.push(argv[i + 1]);
      i += 1;
    } else if (t === "--dry-run") {
      dryRun = true;
    }
  }
  return { dbPath, corpusLimit, perCompetency, useOpenRouter, envFiles, dryRun };
}

function toBenchmarkCase(c: CandidateCase): BenchmarkCase {
  const { source_round_ids: _s, generation_model: _g, filter_passed: _f, filter_reason: _r, judge_scores: _j, ...rest } = c;
  return rest;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadBenchmarkEnvFiles(args.envFiles, { override: true });
  resetSharedOpenRouterBudget();
  const budget = args.useOpenRouter ? getSharedOpenRouterBudget() : undefined;

  console.log("[real-data] exporting masked corpus (read-only)...");
  const rounds = exportMaskedCorpus({ dbPath: args.dbPath, limit: args.corpusLimit });
  console.log(`[real-data] corpus rounds: ${rounds.length}`);

  mkdirSync(REAL_DIR, { recursive: true });
  writeFileSync(
    join(REAL_DIR, "masked-corpus.jsonl"),
    rounds.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );

  console.log("[real-data] generating candidates...");
  const candidates = generateCandidatesFromCorpus(rounds, {
    perCompetency: args.perCompetency,
    generatorModel: getGeneratorModel(),
  });
  console.log(`[real-data] candidates generated: ${candidates.length}`);

  const { passed, stats } = filterCandidates(candidates);
  console.log("[real-data] filter stats:", stats);

  const judged: CandidateCase[] = [];
  for (const c of passed) {
    const scores = await judgeCandidate(c, budget, 3);
    c.judge_scores = scores;
    if (passesJudgeGate(scores)) judged.push(c);
  }
  console.log(`[real-data] judge passed: ${judged.length}`);

  const golden = computeGoldenAgreement(judged.slice(0, Math.min(30, judged.length)));
  console.log(`[real-data] golden agreement rate: ${(golden.rate * 100).toFixed(1)}%`);

  const { accepted, log } = applyHumanReview(judged, { autoAcceptFiltered: true });
  writeFileSync(join(REAL_DIR, "review-log.json"), JSON.stringify(log, null, 2));

  // Cap to 50-100 for pilot
  const finalCases = accepted.slice(0, 100);
  for (let i = 0; i < finalCases.length; i += 1) {
    assertBenchmarkCase(toBenchmarkCase(finalCases[i]), i + 1);
  }

  const outPath = join(DATASETS, "coding-memory-real-ja-mixed-v1.jsonl");
  const jsonl = finalCases.map((c) => JSON.stringify(toBenchmarkCase(c))).join("\n") + "\n";
  const piiLeaks = scanJsonlForPii(jsonl);
  if (piiLeaks.length > 0) {
    throw new Error(`PII leak detected in output: ${piiLeaks.join(", ")}`);
  }

  if (!args.dryRun) {
    writeFileSync(outPath, jsonl);
  }

  const manifest: PipelineManifest = {
    schema_version: "real-data-pipeline-v1",
    generated_at: new Date().toISOString(),
    corpus_rounds: rounds.length,
    candidates_generated: candidates.length,
    filter_stats: stats,
    judge_model: getJudgeModel(),
    generator_model: getGeneratorModel(),
    golden_agreement_rate: golden.rate,
    openrouter_spent_usd: budget?.spent,
  };
  writeFileSync(join(REAL_DIR, "pipeline-manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`[real-data] gold dataset: ${finalCases.length} cases → ${outPath}`);
  if (budget) {
    console.log(`[real-data] OpenRouter spent: $${budget.spent.toFixed(6)}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
