#!/usr/bin/env bun
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HarnessMemCore, type Config } from "../memory-server/src/core/harness-mem-core";

interface HarnessQuery {
  id: string;
  query: string;
  project?: string;
  safe_mode?: boolean;
  limit?: number;
}

interface HarnessCaseResult {
  id: string;
  query: string;
  ok: boolean;
  item_count: number;
  latency_ms: number;
  degradation?: string[];
  fallback?: string;
}

export interface LargeDbSearchHarnessManifest {
  schema: "harness_mem.large_db_search_harness.v1";
  generated_at: string;
  snapshot_path: string;
  source_path: string;
  observation_count: number;
  query_count: number;
  empty_error_count: number;
  p50_ms: number;
  p95_ms: number;
  cases: HarnessCaseResult[];
}

const DEFAULT_QUERIES = resolve("scripts/fixtures/s145-large-db-queries.json");

function percentile(values: number[], pct: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1);
  return Number(sorted[index].toFixed(2));
}

function config(dbPath: string): Config {
  return {
    dbPath,
    bindHost: "127.0.0.1",
    bindPort: 0,
    vectorDimension: 256,
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
    backgroundWorkersEnabled: false,
  };
}

function loadQueries(path: string): HarnessQuery[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as HarnessQuery[];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`query fixture must be a non-empty array: ${path}`);
  }
  return raw;
}

function copySnapshot(sourcePath: string, workDir: string): string {
  mkdirSync(workDir, { recursive: true });
  const snapshotPath = join(workDir, "harness-mem.snapshot.db");
  copyFileSync(sourcePath, snapshotPath);
  for (const suffix of ["-wal", "-shm"]) {
    const sidecarPath = `${sourcePath}${suffix}`;
    if (existsSync(sidecarPath)) {
      copyFileSync(sidecarPath, `${snapshotPath}${suffix}`);
    }
  }
  return snapshotPath;
}

export async function runLargeDbSearchHarness(options: {
  sourcePath: string;
  queriesPath?: string;
  workDir?: string;
}): Promise<LargeDbSearchHarnessManifest> {
  const sourcePath = resolve(options.sourcePath);
  if (!existsSync(sourcePath)) {
    throw new Error(`snapshot source not found: ${sourcePath}`);
  }

  const workDir = options.workDir ?? join(tmpdir(), `harness-mem-s145-${Date.now()}`);
  const snapshotPath = copySnapshot(sourcePath, workDir);
  const queries = loadQueries(resolve(options.queriesPath ?? DEFAULT_QUERIES));

  const core = new HarnessMemCore(config(snapshotPath));
  try {
    const countRow = core.db
      .query(`SELECT COUNT(*) AS count FROM mem_observations WHERE archived_at IS NULL`)
      .get() as { count?: number };
    const observationCount = Number(countRow?.count ?? 0);

    const cases: HarnessCaseResult[] = [];
    for (const queryCase of queries) {
      const startedAt = performance.now();
      const response = await core.searchPrepared({
        query: queryCase.query,
        project: queryCase.project,
        safe_mode: queryCase.safe_mode,
        limit: queryCase.limit ?? 5,
        vector_search: queryCase.safe_mode ? false : true,
      });
      const latencyMs = Number((performance.now() - startedAt).toFixed(2));
      const offload = response.meta.search_offload as Record<string, unknown> | undefined;
      cases.push({
        id: queryCase.id,
        query: queryCase.query,
        ok: response.ok === true,
        item_count: Array.isArray(response.items) ? response.items.length : 0,
        latency_ms: latencyMs,
        degradation: Array.isArray(response.meta.degradation)
          ? (response.meta.degradation as string[])
          : undefined,
        fallback:
          typeof offload?.fallback === "string"
            ? offload.fallback
            : response.meta.error_code === "search_fallback_failed"
              ? "none"
              : undefined,
      });
    }

    const latencies = cases.map((entry) => entry.latency_ms);
    const emptyErrorCount = cases.filter((entry) => entry.ok !== true && entry.item_count === 0).length;

    return {
      schema: "harness_mem.large_db_search_harness.v1",
      generated_at: new Date().toISOString(),
      snapshot_path: snapshotPath,
      source_path: sourcePath,
      observation_count: observationCount,
      query_count: cases.length,
      empty_error_count: emptyErrorCount,
      p50_ms: percentile(latencies, 50),
      p95_ms: percentile(latencies, 95),
      cases,
    };
  } finally {
    core.shutdown("s145-harness");
    if (!options.workDir) {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let sourcePath = process.env.HARNESS_MEM_LARGE_DB_SNAPSHOT_PATH || "";
  let queriesPath = DEFAULT_QUERIES;
  let outPath: string | null = null;
  let keepWorkDir = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--source" && args[index + 1]) {
      sourcePath = args[++index];
    } else if (arg === "--queries" && args[index + 1]) {
      queriesPath = args[++index];
    } else if (arg === "--out" && args[index + 1]) {
      outPath = resolve(args[++index]);
    } else if (arg === "--keep-workdir") {
      keepWorkDir = true;
    } else if (arg === "--help") {
      process.stdout.write(
        "Usage: bun scripts/s145-large-db-search-harness.ts --source <live-db-copy> [--queries scripts/fixtures/s145-large-db-queries.json] [--out path.json] [--keep-workdir]\n",
      );
      return;
    }
  }

  if (!sourcePath) {
    throw new Error("Provide --source or HARNESS_MEM_LARGE_DB_SNAPSHOT_PATH (read-only copy; live DB must not be mutated).");
  }

  const manifest = await runLargeDbSearchHarness({
    sourcePath,
    queriesPath,
    workDir: keepWorkDir ? join(tmpdir(), `harness-mem-s145-${Date.now()}`) : undefined,
  });

  if (outPath) {
    writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }

  process.stdout.write(
    `[s145-harness] obs=${manifest.observation_count} queries=${manifest.query_count} empty=${manifest.empty_error_count} p50=${manifest.p50_ms}ms p95=${manifest.p95_ms}ms\n`,
  );
  if (outPath) {
    process.stdout.write(`[s145-harness] artifact: ${outPath}\n`);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`[s145-harness] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
