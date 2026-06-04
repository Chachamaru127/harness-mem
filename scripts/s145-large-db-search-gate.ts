#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  runLargeDbSearchHarness,
  type LargeDbSearchHarnessManifest,
} from "./s145-large-db-search-harness";

type GateMode = "warn" | "enforce";
type GateStatus = "pass" | "warn";

export interface LargeDbSearchGateThresholds {
  p95_ms: number;
  empty_error_count: number;
}

export interface LargeDbSearchGateManifest {
  schema: "harness_mem.large_db_search_gate.v1";
  task_id: "S145-009";
  generated_at: string;
  mode: GateMode;
  source_path: string;
  thresholds: LargeDbSearchGateThresholds;
  harness: LargeDbSearchHarnessManifest;
  metrics: {
    p95_ms: { value: number; threshold: number; status: GateStatus };
    empty_error_count: { value: number; threshold: number; status: GateStatus };
  };
  summary: {
    status: GateStatus;
    warnings: string[];
  };
}

const DEFAULT_THRESHOLDS: LargeDbSearchGateThresholds = {
  p95_ms: Number(process.env.HARNESS_MEM_LARGE_DB_P95_MS || 15_000),
  empty_error_count: 0,
};

function evaluateNumeric(
  value: number,
  threshold: number,
  comparator: "<=" | ">=",
): GateStatus {
  if (comparator === "<=") {
    return value <= threshold ? "pass" : "warn";
  }
  return value >= threshold ? "pass" : "warn";
}

export async function runLargeDbSearchGate(options: {
  sourcePath: string;
  queriesPath?: string;
  mode?: GateMode;
  thresholds?: Partial<LargeDbSearchGateThresholds>;
}): Promise<LargeDbSearchGateManifest> {
  const thresholds: LargeDbSearchGateThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...options.thresholds,
  };
  const harness = await runLargeDbSearchHarness({
    sourcePath: options.sourcePath,
    queriesPath: options.queriesPath,
  });

  const p95Status = evaluateNumeric(harness.p95_ms, thresholds.p95_ms, "<=");
  const emptyStatus = evaluateNumeric(harness.empty_error_count, thresholds.empty_error_count, "<=");
  const warnings: string[] = [];
  if (p95Status === "warn") {
    warnings.push(`p95_ms=${harness.p95_ms} exceeds ${thresholds.p95_ms}`);
  }
  if (emptyStatus === "warn") {
    warnings.push(`empty_error_count=${harness.empty_error_count} exceeds ${thresholds.empty_error_count}`);
  }

  return {
    schema: "harness_mem.large_db_search_gate.v1",
    task_id: "S145-009",
    generated_at: new Date().toISOString(),
    mode: options.mode ?? "warn",
    source_path: resolve(options.sourcePath),
    thresholds,
    harness,
    metrics: {
      p95_ms: {
        value: harness.p95_ms,
        threshold: thresholds.p95_ms,
        status: p95Status,
      },
      empty_error_count: {
        value: harness.empty_error_count,
        threshold: thresholds.empty_error_count,
        status: emptyStatus,
      },
    },
    summary: {
      status: warnings.length === 0 ? "pass" : "warn",
      warnings,
    },
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let sourcePath = process.env.HARNESS_MEM_LARGE_DB_SNAPSHOT_PATH || "";
  let queriesPath: string | undefined;
  let outPath: string | null = null;
  let mode: GateMode = "warn";
  let enforce = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--source" && args[index + 1]) {
      sourcePath = args[++index];
    } else if (arg === "--queries" && args[index + 1]) {
      queriesPath = args[++index];
    } else if (arg === "--out" && args[index + 1]) {
      outPath = resolve(args[++index]);
    } else if (arg === "--enforce") {
      enforce = true;
      mode = "enforce";
    } else if (arg === "--help") {
      process.stdout.write(
        "Usage: bun scripts/s145-large-db-search-gate.ts --source <read-only-db-copy> [--queries path.json] [--out path.json] [--enforce]\n",
      );
      return;
    }
  }

  if (!sourcePath) {
    throw new Error("Provide --source or HARNESS_MEM_LARGE_DB_SNAPSHOT_PATH.");
  }

  const manifest = await runLargeDbSearchGate({ sourcePath, queriesPath, mode });
  if (outPath) {
    writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }

  process.stdout.write(
    `[s145-gate] status=${manifest.summary.status} p95=${manifest.harness.p95_ms}ms empty=${manifest.harness.empty_error_count}\n`,
  );
  if (outPath) {
    process.stdout.write(`[s145-gate] artifact: ${outPath}\n`);
  }

  if (enforce && manifest.summary.status !== "pass") {
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`[s145-gate] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
