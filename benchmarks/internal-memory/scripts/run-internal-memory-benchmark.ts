#!/usr/bin/env bun
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { loadDefaultDatasets } from "../lib/dataset-loader";
import { loadBenchmarkEnvFiles } from "../lib/load-env";
import { judgeRetrievalGrounding } from "../lib/openrouter-judge";
import { getSharedOpenRouterBudget, resetSharedOpenRouterBudget } from "../lib/openrouter-budget";
import { ImportPublishedAdapter } from "../adapters/import-published";
import {
  createAdapter,
  DEFAULT_REPRODUCED_COMPETITORS,
  PUBLISHED_REFERENCE_COMPETITORS,
} from "../lib/registry";
import { scoreCase } from "../lib/score-case";
import { inferCompetency, usesLlmJudge } from "../scorers/competency";
import { buildSummary } from "../lib/summarize";
import type { ScoredCaseResult } from "../lib/types";
import { writeReportPack } from "./render-dashboard";

export interface RunBenchmarkOptions {
  competitors?: string[];
  limit?: number;
  useOpenRouter?: boolean;
  envFiles?: string[];
}

function parseArgs(argv: string[]): RunBenchmarkOptions {
  const competitors: string[] = [];
  let limit: number | undefined;
  let useOpenRouter = process.env.INTERNAL_BENCH_USE_OPENROUTER === "1";
  const envFiles: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--competitors" && i + 1 < argv.length) {
      competitors.push(
        ...argv[i + 1]
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      );
      i += 1;
      continue;
    }
    if (token === "--limit" && i + 1 < argv.length) {
      limit = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--use-openrouter") {
      useOpenRouter = true;
      continue;
    }
    if (token === "--env-file" && i + 1 < argv.length) {
      envFiles.push(argv[i + 1]);
      i += 1;
    }
  }

  return {
    competitors: competitors.length > 0 ? competitors : [...DEFAULT_REPRODUCED_COMPETITORS],
    limit: Number.isFinite(limit) ? limit : undefined,
    useOpenRouter,
    envFiles: envFiles.length > 0 ? envFiles : undefined,
  };
}

function gitSha(): string | undefined {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

export async function runInternalMemoryBenchmark(
  options: RunBenchmarkOptions = {},
): Promise<{ summaryPath: string; results: ScoredCaseResult[] }> {
  resetSharedOpenRouterBudget();
  const loadedEnvFiles = options.envFiles
    ? loadBenchmarkEnvFiles(options.envFiles, { override: true })
    : loadBenchmarkEnvFiles();

  // Reproduced (locally measured) targets. Default is harness-mem only; passing
  // an external id (agentmemory/supermemory/claude-mem) opts it into live
  // measurement and promotes it from published to reproduced.
  const reproducedTargets = options.competitors ?? [...DEFAULT_REPRODUCED_COMPETITORS];
  // Published reference-only rows are always emitted in a separate table, minus
  // any competitor the caller chose to live-measure this run.
  const publishedTargets = PUBLISHED_REFERENCE_COMPETITORS.filter(
    (id) => !reproducedTargets.includes(id),
  );
  const runTargets: Array<{ id: string; published: boolean }> = [
    ...reproducedTargets.map((id) => ({ id, published: false })),
    ...publishedTargets.map((id) => ({ id, published: true })),
  ];
  const cases = loadDefaultDatasets().slice(0, options.limit);
  const runId = `internal-memory-${randomUUID()}`;
  const results: ScoredCaseResult[] = [];

  const useOpenRouter = options.useOpenRouter === true;
  const budget = useOpenRouter ? getSharedOpenRouterBudget() : null;
  if (useOpenRouter && !budget) {
    throw new Error(
      "INTERNAL_BENCH_USE_OPENROUTER=1 requires OPENROUTER_API_KEY in .env (use --env-file if needed)",
    );
  }

  for (const { id: competitorId, published } of runTargets) {
    const adapter = published ? new ImportPublishedAdapter(competitorId) : createAdapter(competitorId);
    const context = {
      run_id: runId,
      competitor_id: competitorId,
      project_prefix: `bench-${runId.slice(0, 8)}`,
    };

    try {
      for (const caseRow of cases) {
        await adapter.prepareCase(caseRow, context);
        const queryResult = await adapter.query(caseRow, context);
        const scored = scoreCase(caseRow, competitorId, queryResult);

        if (budget && scored.status === "ok" && queryResult.hits.length > 0 && usesLlmJudge(inferCompetency(caseRow))) {
          try {
            const judged = await judgeRetrievalGrounding(
              budget,
              caseRow,
              queryResult.hits.map((hit) => hit.content),
            );
            if (judged) {
              scored.llm_grounding_score = judged.llm_grounding_score;
              scored.llm_judge_model = judged.model;
            }
          } catch (error) {
            scored.skip_reason = `openrouter_judge_failed: ${error instanceof Error ? error.message : String(error)}`;
          }
        }

        results.push(scored);
      }
    } finally {
      await adapter.dispose();
    }
  }

  const summary = buildSummary({
    run_id: runId,
    git_sha: gitSha(),
    dataset_ids: ["public-retrieval-v1.jsonl", "coding-memory-ja-mixed-v1.jsonl"],
    results,
    openrouter_budget: budget,
    env_files_loaded: loadedEnvFiles,
    reproduced_ids: reproducedTargets,
  });
  writeReportPack(summary, results);
  return { summaryPath: "benchmarks/internal-memory/reports/latest/summary.json", results };
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const output = await runInternalMemoryBenchmark(args);
  const budget = args.useOpenRouter ? getSharedOpenRouterBudget() : null;
  console.log(
    JSON.stringify(
      {
        ok: true,
        summary: output.summaryPath,
        cases: output.results.length,
        openrouter_spent_usd: budget?.spent ?? 0,
        openrouter_cap_usd: budget?.cap ?? null,
        openrouter_requests: budget?.history.length ?? 0,
      },
      null,
      2,
    ),
  );
  // HarnessMemCore keeps timers alive; force a clean exit after the report is written.
  process.exit(0);
}
