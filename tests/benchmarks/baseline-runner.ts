import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  HarnessMemCore,
  type ApiResponse,
  type Config,
  type EventEnvelope,
} from "../../memory-server/src/core/harness-mem-core";

const DEFAULT_PROJECT = "world1-baseline";
const DEFAULT_QUERY_COUNT = 30;
const DEFAULT_BACKGROUND_EVENTS = 600;
const DEFAULT_SAMPLE_LIMIT = 10;

export interface BenchmarkRunnerOptions {
  runLabel?: string;
  outputPath?: string;
  project?: string;
  rerankerEnabled?: boolean;
}

interface QuerySeed {
  query: string;
  expectedObservationId: string;
}

interface QueryBenchmarkResult {
  query: string;
  expected_observation_id: string;
  top_hit_id: string | null;
  hit_rank: number | null;
  recall_at_10: number;
  reciprocal_rank: number;
}

export interface BaselineSnapshot {
  schema_version: "world1-baseline-v1";
  generated_at: string;
  run_label: string;
  pipeline: {
    reranker_enabled: boolean;
  };
  dataset: {
    project: string;
    observation_count: number;
    query_count: number;
  };
  quality: {
    recall_at_10: number;
    mrr_at_10: number;
    queries: QueryBenchmarkResult[];
  };
  performance: {
    search_latency_ms: {
      min: number;
      p50: number;
      p95: number;
      max: number;
      samples: number[];
    };
  };
  token_efficiency: {
    progressive_estimated_tokens: number;
    single_shot_estimated_tokens: number;
    reduction_ratio: number;
  };
}

function createCore(tempDir: string, rerankerEnabled: boolean): HarnessMemCore {
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
    rerankerEnabled,
  };
  return new HarnessMemCore(config);
}

function createEvent(overrides: Partial<EventEnvelope>): EventEnvelope {
  return {
    platform: "codex",
    project: DEFAULT_PROJECT,
    session_id: "world1-benchmark-session",
    event_type: "tool_use",
    ts: "2026-02-01T00:00:00.000Z",
    payload: { content: "world1 benchmark default payload" },
    tags: ["benchmark"],
    privacy_tags: [],
    ...overrides,
  };
}

function asItems(response: ApiResponse): Array<Record<string, unknown>> {
  return response.items as Array<Record<string, unknown>>;
}

function quantile(sortedValues: number[], q: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }
  const clamped = Math.min(1, Math.max(0, q));
  const index = Math.floor((sortedValues.length - 1) * clamped);
  return Number(sortedValues[index].toFixed(3));
}

function estimateTokens(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Math.max(1, Math.ceil(text.length / 4));
}

function parseArgs(argv: string[]): BenchmarkRunnerOptions {
  const options: BenchmarkRunnerOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if ((token === "--run-label" || token === "--label") && i + 1 < argv.length) {
      options.runLabel = argv[i + 1];
      i += 1;
      continue;
    }
    if ((token === "--output" || token === "-o") && i + 1 < argv.length) {
      options.outputPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--project" && i + 1 < argv.length) {
      options.project = argv[i + 1];
      i += 1;
      continue;
    }
    if ((token === "--reranker" || token === "--rerank") && i + 1 < argv.length) {
      const value = argv[i + 1]?.trim().toLowerCase() || "";
      options.rerankerEnabled = ["1", "true", "yes", "on", "enabled"].includes(value);
      i += 1;
    }
  }
  return options;
}

function seedDataset(core: HarnessMemCore, project: string): QuerySeed[] {
  const baseTs = Date.parse("2026-01-01T00:00:00.000Z");
  for (let i = 0; i < DEFAULT_BACKGROUND_EVENTS; i += 1) {
    const ts = new Date(baseTs + i * 30_000).toISOString();
    core.recordEvent(
      createEvent({
        event_id: `bg-${i}`,
        project,
        session_id: `bg-session-${i % 20}`,
        ts,
        payload: {
          content: `background feature-${i % 80} dependency migration note ${i}`,
        },
        tags: ["benchmark", `feature-${i % 80}`],
      })
    );
  }

  const seeds: QuerySeed[] = [];
  for (let i = 0; i < DEFAULT_QUERY_COUNT; i += 1) {
    const uniqueToken = `world1-needle-${i}`;
    const eventId = `needle-${i}`;
    const ts = new Date(baseTs + (DEFAULT_BACKGROUND_EVENTS + i) * 60_000).toISOString();
    core.recordEvent(
      createEvent({
        event_id: eventId,
        project,
        session_id: `needle-session-${i % 5}`,
        ts,
        payload: {
          content: `${uniqueToken} release checklist automation baseline query target ${i}`,
        },
        tags: ["benchmark", "needle", `needle-${i}`],
      })
    );
    seeds.push({
      query: `${uniqueToken} release checklist`,
      expectedObservationId: `obs_${eventId}`,
    });
  }
  return seeds;
}

export async function createBaselineSnapshot(options: BenchmarkRunnerOptions = {}): Promise<BaselineSnapshot> {
  const runLabel = options.runLabel || "before";
  const project = options.project || DEFAULT_PROJECT;
  const rerankerEnabled = options.rerankerEnabled === true;
  const tempDir = mkdtempSync(join(tmpdir(), "harness-mem-benchmark-"));
  const core = createCore(tempDir, rerankerEnabled);

  try {
    const querySeeds = seedDataset(core, project);
    const queryResults: QueryBenchmarkResult[] = [];
    const searchLatencies: number[] = [];
    let progressiveTokens = 0;
    let singleShotTokens = 0;

    for (const seed of querySeeds) {
      const searchResponse = core.search({
        query: seed.query,
        project,
        include_private: true,
        strict_project: true,
        limit: DEFAULT_SAMPLE_LIMIT,
      });
      const searchItems = asItems(searchResponse);
      const itemIds = searchItems.map((item) => String(item.id ?? ""));
      const hitRank = itemIds.indexOf(seed.expectedObservationId);
      const topHitId = itemIds[0] || null;
      const recallAt10 = hitRank >= 0 ? 1 : 0;
      const reciprocalRank = hitRank >= 0 ? 1 / (hitRank + 1) : 0;
      const searchLatency = Number(searchResponse.meta.latency_ms ?? 0);
      searchLatencies.push(searchLatency);

      queryResults.push({
        query: seed.query,
        expected_observation_id: seed.expectedObservationId,
        top_hit_id: topHitId,
        hit_rank: hitRank >= 0 ? hitRank + 1 : null,
        recall_at_10: recallAt10,
        reciprocal_rank: Number(reciprocalRank.toFixed(6)),
      });

      const detailIds = itemIds.slice(0, 2);
      const fullIds = itemIds.slice(0, DEFAULT_SAMPLE_LIMIT);
      if (topHitId) {
        const timelineResponse = core.timeline({
          id: topHitId,
          before: 2,
          after: 2,
          include_private: true,
        });
        progressiveTokens += estimateTokens({
          ids: itemIds.slice(0, DEFAULT_SAMPLE_LIMIT),
          timeline: timelineResponse.items,
        });
      } else {
        progressiveTokens += estimateTokens({ ids: itemIds.slice(0, DEFAULT_SAMPLE_LIMIT) });
      }

      const progressiveDetails = detailIds.length
        ? core.getObservations({ ids: detailIds, include_private: true, compact: true })
        : { items: [] };
      progressiveTokens += estimateTokens((progressiveDetails as ApiResponse).items || []);

      const singleShotDetails = fullIds.length
        ? core.getObservations({ ids: fullIds, include_private: true, compact: false })
        : { items: [] };
      singleShotTokens += estimateTokens((singleShotDetails as ApiResponse).items || []);
    }

    const sortedLatencies = [...searchLatencies].sort((a, b) => a - b);
    const recallAt10 =
      queryResults.reduce((sum, result) => sum + result.recall_at_10, 0) / Math.max(1, queryResults.length);
    const mrr =
      queryResults.reduce((sum, result) => sum + result.reciprocal_rank, 0) / Math.max(1, queryResults.length);
    const reductionRatio =
      singleShotTokens === 0 ? 0 : Number((1 - progressiveTokens / singleShotTokens).toFixed(6));

    const snapshot: BaselineSnapshot = {
      schema_version: "world1-baseline-v1",
      generated_at: new Date().toISOString(),
      run_label: runLabel,
      pipeline: {
        reranker_enabled: rerankerEnabled,
      },
      dataset: {
        project,
        observation_count: DEFAULT_BACKGROUND_EVENTS + DEFAULT_QUERY_COUNT,
        query_count: DEFAULT_QUERY_COUNT,
      },
      quality: {
        recall_at_10: Number(recallAt10.toFixed(6)),
        mrr_at_10: Number(mrr.toFixed(6)),
        queries: queryResults,
      },
      performance: {
        search_latency_ms: {
          min: quantile(sortedLatencies, 0),
          p50: quantile(sortedLatencies, 0.5),
          p95: quantile(sortedLatencies, 0.95),
          max: quantile(sortedLatencies, 1),
          samples: searchLatencies.map((value) => Number(value.toFixed(3))),
        },
      },
      token_efficiency: {
        progressive_estimated_tokens: progressiveTokens,
        single_shot_estimated_tokens: singleShotTokens,
        reduction_ratio: reductionRatio,
      },
    };

    if (options.outputPath) {
      const absolutePath = resolve(options.outputPath);
      mkdirSync(dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    }
    return snapshot;
  } finally {
    core.shutdown("benchmark");
    rmSync(tempDir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const options = parseArgs(process.argv.slice(2));
  const snapshot = await createBaselineSnapshot(options);
  process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
}
