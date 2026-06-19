#!/usr/bin/env bun
import { execSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  loadDefaultDatasets,
  loadCodingMemoryDataset,
  resolveRealDataDatasetFile,
  CODINGMEMORY_V3_DATASET_ID,
} from "../lib/dataset-loader";
import {
  loadMemoryAgentBenchDataset,
  MEMORY_AGENT_BENCH_DATASET_ID,
  MEMORY_AGENT_BENCH_REVISION,
  MEMORY_AGENT_BENCH_SPLITS,
  parseMemoryAgentBenchSplit,
  type MemoryAgentBenchSplit,
} from "../lib/memoryagentbench-loader";
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
import type { AdapterQueryResult, BenchmarkCase, BenchmarkDatasetManifest, ScoredCaseResult } from "../lib/types";
import { writeReportPack } from "./render-dashboard";

export interface RunBenchmarkOptions {
  competitors?: string[];
  limit?: number;
  mabRowLimit?: number;
  useOpenRouter?: boolean;
  envFiles?: string[];
  dataset?: "default" | "memoryagentbench" | "codingmemory";
  mabSplit?: MemoryAgentBenchSplit | "all";
  cacheDir?: string;
  revision?: string;
  reportsDir?: string;
}

export function parseArgs(argv: string[]): RunBenchmarkOptions {
  const competitors: string[] = [];
  let limit: number | undefined;
  let mabRowLimit: number | undefined;
  let useOpenRouter = process.env.INTERNAL_BENCH_USE_OPENROUTER === "1";
  const envFiles: string[] = [];
  let dataset: RunBenchmarkOptions["dataset"] = "default";
  let mabSplit: RunBenchmarkOptions["mabSplit"] = "Accurate_Retrieval";
  let cacheDir: string | undefined;
  let revision: string | undefined;
  let reportsDir: string | undefined;

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
    if (token === "--mab-row-limit" && i + 1 < argv.length) {
      mabRowLimit = Number(argv[i + 1]);
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
      continue;
    }
    if (token === "--dataset" && i + 1 < argv.length) {
      const value = argv[i + 1];
      if (value !== "default" && value !== "memoryagentbench" && value !== "codingmemory") {
        throw new Error(`invalid --dataset ${value}; expected default, memoryagentbench, or codingmemory`);
      }
      dataset = value;
      i += 1;
      continue;
    }
    if (token === "--mab-split" && i + 1 < argv.length) {
      const value = argv[i + 1];
      mabSplit = value === "all" ? "all" : parseMemoryAgentBenchSplit(value);
      i += 1;
      continue;
    }
    if (token === "--cache-dir" && i + 1 < argv.length) {
      cacheDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--revision" && i + 1 < argv.length) {
      revision = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--reports-dir" && i + 1 < argv.length) {
      reportsDir = argv[i + 1];
      i += 1;
    }
  }

  return {
    competitors: competitors.length > 0 ? competitors : [...DEFAULT_REPRODUCED_COMPETITORS],
    limit: Number.isFinite(limit) ? limit : undefined,
    mabRowLimit: Number.isFinite(mabRowLimit) ? mabRowLimit : undefined,
    useOpenRouter,
    envFiles: envFiles.length > 0 ? envFiles : undefined,
    dataset,
    mabSplit,
    cacheDir,
    revision,
    reportsDir,
  };
}

function gitSha(): string | undefined {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

async function loadSelectedDataset(options: RunBenchmarkOptions): Promise<{
  cases: BenchmarkCase[];
  dataset_ids: string[];
  dataset_manifest?: BenchmarkDatasetManifest;
}> {
  if (options.dataset === "codingmemory") {
    const cases = loadCodingMemoryDataset("auto").slice(0, options.limit);
    const realFile = resolveRealDataDatasetFile() ?? "coding-memory-real-ja-mixed-v3.jsonl";
    const language_profile: Record<string, number> = {};
    const competency: Record<string, number> = {};
    const source_platform: Record<string, number> = {};
    for (const row of cases) {
      language_profile[row.language_profile] = (language_profile[row.language_profile] ?? 0) + 1;
      const comp = row.competency ?? "AR";
      competency[comp] = (competency[comp] ?? 0) + 1;
      const platform = row.source_platform ?? "unknown";
      source_platform[platform] = (source_platform[platform] ?? 0) + 1;
    }
    return {
      cases,
      dataset_ids: [realFile],
      dataset_manifest: {
        dataset: "codingmemory",
        dataset_id: CODINGMEMORY_V3_DATASET_ID,
        source_url: "benchmarks/internal-memory/datasets/coding-memory-real-ja-mixed-v3.jsonl",
        gate_mode: options.limit ? "smoke" : "public",
        sample_limit: options.limit,
        embedding_profile:
          process.env.HARNESS_MEM_INTERNAL_BENCH_EMBEDDING === "1"
            ? "production_onnx"
            : "hash_fallback",
        language_profile,
        competency,
        source_platform,
        hf_revision: process.env.CODINGMEMORY_HF_REVISION?.trim() || undefined,
        transform_version: "codingmemory-v3-platform-metadata",
      },
    };
  }

  if (options.dataset === "memoryagentbench") {
    const splits =
      options.mabSplit === "all"
        ? [...MEMORY_AGENT_BENCH_SPLITS]
        : [options.mabSplit ?? "Accurate_Retrieval"];
    const loaded = await loadMemoryAgentBenchDataset({
      datasetId: MEMORY_AGENT_BENCH_DATASET_ID,
      splits,
      limit: options.limit,
      rowLimit: options.mabRowLimit,
      cacheDir: options.cacheDir,
      revision: options.revision ?? MEMORY_AGENT_BENCH_REVISION,
    });
    return {
      cases: loaded.cases,
      dataset_ids: [`${MEMORY_AGENT_BENCH_DATASET_ID}:${splits.join("+")}`],
      dataset_manifest: loaded.manifest,
    };
  }

  const cases = loadDefaultDatasets().slice(0, options.limit);
  const realDatasetId = resolveRealDataDatasetFile() ?? "coding-memory-real-ja-mixed-v1.jsonl";
  return {
    cases,
    dataset_ids: [
      "public-retrieval-v1.jsonl",
      "coding-memory-ja-mixed-v1.jsonl",
      ...(cases.some((row) => row.case_id.startsWith("real-")) ? [realDatasetId] : []),
    ],
  };
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
  const { cases, dataset_ids, dataset_manifest } = await loadSelectedDataset(options);
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
      let processed = 0;
      for (const caseRow of cases) {
        const caseStarted = performance.now();
        if (!published && processed >= 700) {
          console.error(
            `[internal-memory] ${competitorId}: starting ${processed + 1}/${cases.length} ${caseRow.case_id}`,
          );
        }
        try {
          await adapter.prepareCase(caseRow, context);
        } catch (error) {
          console.error(
            `[internal-memory] ${competitorId}: prepare failed at ${processed + 1}/${cases.length} ${caseRow.case_id}: ${error instanceof Error ? error.message : String(error)}`,
          );
          throw error;
        }
        let queryResult: AdapterQueryResult;
        try {
          queryResult = await adapter.query(caseRow, context);
        } catch (error) {
          console.error(
            `[internal-memory] ${competitorId}: query failed at ${processed + 1}/${cases.length} ${caseRow.case_id}: ${error instanceof Error ? error.message : String(error)}`,
          );
          throw error;
        }
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
        processed += 1;
        const caseMs = performance.now() - caseStarted;
        if (!published && (processed % 100 === 0 || caseMs > 1_000)) {
          console.error(
            `[internal-memory] ${competitorId}: ${processed}/${cases.length} cases scored (last=${caseRow.case_id}, ${caseMs.toFixed(1)}ms)`,
          );
        }
      }
    } finally {
      await adapter.dispose();
    }
  }

  const summary = buildSummary({
    run_id: runId,
    git_sha: gitSha(),
    dataset_ids,
    results,
    openrouter_budget: budget,
    env_files_loaded: loadedEnvFiles,
    reproduced_ids: reproducedTargets,
    dataset_manifest,
  });
  writeReportPack(
    summary,
    results,
    options.reportsDir ?? join(import.meta.dir, "../reports/latest"),
  );
  const reportRoot = options.reportsDir ?? "benchmarks/internal-memory/reports/latest";
  return { summaryPath: `${reportRoot}/summary.json`, results };
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
