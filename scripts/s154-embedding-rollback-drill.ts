#!/usr/bin/env bun
/**
 * S154-512: rollback drill helper (read-only search capture / compare).
 *
 * Supports D29 reversibility checks without mutating vector tables:
 *   capture  — run probes, write ordered observation-id lists to JSON (readonly DB)
 *   compare  — rerun probes, diff against a prior capture (readonly DB)
 *
 * Flag flip / rollback writes are NOT performed here. See the runbook for
 * `setEmbeddingDefaultModel` steps executed separately.
 *
 *   ~/.bun/bin/bun run scripts/s154-embedding-rollback-drill.ts capture \
 *     --db /path/to/harness-mem.db --probes docs/benchmarks/fixtures/s154-512-rollback-probes.json \
 *     --out /tmp/s154-512-baseline-e5.json
 *
 *   ~/.bun/bin/bun run scripts/s154-embedding-rollback-drill.ts compare \
 *     --db /path/to/harness-mem.db --probes docs/benchmarks/fixtures/s154-512-rollback-probes.json \
 *     --baseline /tmp/s154-512-baseline-e5.json
 */

import { Database } from "bun:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { HarnessMemCore, type Config, type EventEnvelope } from "../memory-server/src/core/harness-mem-core";
import { resolveHomePath } from "../memory-server/src/core/core-utils";

export interface RollbackProbe {
  label: string;
  project: string;
  query: string;
  limit?: number;
}

export interface RollbackProbeDocument {
  schema_version?: string;
  probes: RollbackProbe[];
}

export interface RollbackProbeResult {
  label: string;
  project: string;
  query: string;
  limit: number;
  observation_ids: string[];
}

export interface RollbackCaptureArtifact {
  schema_version: "s154-512-rollback-capture.v1";
  task_id: "S154-512";
  mode: "capture";
  captured_at: string;
  embedding_flag_note: string;
  db_path: string;
  probes: RollbackProbeResult[];
}

export interface RollbackCompareMismatch {
  label: string;
  before: string[];
  after: string[];
}

export interface RollbackCompareResult {
  schema_version: "s154-512-rollback-compare.v1";
  task_id: "S154-512";
  mode: "compare";
  compared_at: string;
  baseline_path: string;
  db_path: string;
  probe_count: number;
  mismatches: RollbackCompareMismatch[];
  passed: boolean;
}

function parseArgs(argv: string[]): {
  command: "capture" | "compare" | null;
  dbPath: string;
  probesPath: string;
  outPath?: string;
  baselinePath?: string;
} {
  let command: "capture" | "compare" | null = null;
  let dbPath = "";
  let probesPath = "docs/benchmarks/fixtures/s154-512-rollback-probes.json";
  let outPath: string | undefined;
  let baselinePath: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "capture" || token === "compare") {
      command = token;
    } else if (token === "--db" && argv[i + 1]) {
      dbPath = argv[++i];
    } else if (token === "--probes" && argv[i + 1]) {
      probesPath = argv[++i];
    } else if (token === "--out" && argv[i + 1]) {
      outPath = argv[++i];
    } else if (token === "--baseline" && argv[i + 1]) {
      baselinePath = argv[++i];
    } else if (token === "--help" || token === "-h") {
      process.stdout.write(
        "Usage:\n" +
          "  bun run scripts/s154-embedding-rollback-drill.ts capture --db PATH [--probes PATH] --out PATH\n" +
          "  bun run scripts/s154-embedding-rollback-drill.ts compare --db PATH [--probes PATH] --baseline PATH\n",
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${token}`);
    }
  }

  if (!command) {
    throw new Error("missing subcommand: capture | compare");
  }
  if (!dbPath) {
    throw new Error("--db is required");
  }
  if (command === "capture" && !outPath) {
    throw new Error("capture requires --out");
  }
  if (command === "compare" && !baselinePath) {
    throw new Error("compare requires --baseline");
  }

  return {
    command,
    dbPath: resolveHomePath(dbPath),
    probesPath: resolve(probesPath),
    outPath: outPath ? resolve(outPath) : undefined,
    baselinePath: baselinePath ? resolve(baselinePath) : undefined,
  };
}

function loadProbes(path: string): RollbackProbe[] {
  const doc = JSON.parse(readFileSync(path, "utf8")) as RollbackProbeDocument;
  if (!Array.isArray(doc.probes) || doc.probes.length === 0) {
    throw new Error(`probe document has no probes: ${path}`);
  }
  for (const probe of doc.probes) {
    if (!probe.label || !probe.project || !probe.query) {
      throw new Error(`invalid probe entry in ${path}: ${JSON.stringify(probe)}`);
    }
    if (probe.project.includes("__REPLACE_WITH_PROJECT__")) {
      throw new Error(
        `probe ${probe.label} still uses placeholder project — edit ${path} before execution`,
      );
    }
  }
  return doc.probes;
}

function createReadonlyConfig(dbPath: string): Config {
  return {
    dbPath,
    bindHost: "127.0.0.1",
    bindPort: 0,
    vectorDimension: 384,
    captureEnabled: false,
    retrievalEnabled: true,
    injectionEnabled: false,
    codexHistoryEnabled: false,
    codexProjectRoot: process.cwd(),
    codexSessionsRoot: process.cwd(),
    codexIngestIntervalMs: 5000,
    codexBackfillHours: 24,
    opencodeIngestEnabled: false,
    cursorIngestEnabled: false,
    antigravityIngestEnabled: false,
    consolidationEnabled: false,
  };
}

export function runRollbackProbes(core: HarnessMemCore, probes: RollbackProbe[]): RollbackProbeResult[] {
  return probes.map((probe) => {
    const limit = probe.limit ?? 10;
    const response = core.search({
      query: probe.query,
      project: probe.project,
      limit,
      include_private: true,
    }) as { ok: boolean; items: Array<{ id: string }> };
    if (!response.ok) {
      throw new Error(`search failed for probe ${probe.label}`);
    }
    return {
      label: probe.label,
      project: probe.project,
      query: probe.query,
      limit,
      observation_ids: response.items.map((item) => item.id),
    };
  });
}

export function compareCaptures(
  baseline: RollbackCaptureArtifact,
  current: RollbackProbeResult[],
): RollbackCompareResult {
  const mismatches: RollbackCompareMismatch[] = [];
  const baselineByLabel = new Map(baseline.probes.map((probe) => [probe.label, probe]));

  for (const probe of current) {
    const before = baselineByLabel.get(probe.label);
    if (!before) {
      mismatches.push({ label: probe.label, before: [], after: probe.observation_ids });
      continue;
    }
    const same =
      before.observation_ids.length === probe.observation_ids.length &&
      before.observation_ids.every((id, index) => id === probe.observation_ids[index]);
    if (!same) {
      mismatches.push({
        label: probe.label,
        before: before.observation_ids,
        after: probe.observation_ids,
      });
    }
  }

  return {
    schema_version: "s154-512-rollback-compare.v1",
    task_id: "S154-512",
    mode: "compare",
    compared_at: new Date().toISOString(),
    baseline_path: "",
    db_path: "",
    probe_count: current.length,
    mismatches,
    passed: mismatches.length === 0,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const probes = loadProbes(args.probesPath);
  const core = new HarnessMemCore(createReadonlyConfig(args.dbPath));

  try {
    if (args.command === "capture") {
      const capture: RollbackCaptureArtifact = {
        schema_version: "s154-512-rollback-capture.v1",
        task_id: "S154-512",
        mode: "capture",
        captured_at: new Date().toISOString(),
        embedding_flag_note:
          "Record current mem_meta embedding_default_model in operator notes when capturing.",
        db_path: args.dbPath,
        probes: runRollbackProbes(core, probes),
      };
      writeFileSync(args.outPath!, `${JSON.stringify(capture, null, 2)}\n`, "utf8");
      process.stdout.write(`${JSON.stringify(capture, null, 2)}\n`);
      return;
    }

    const baseline = JSON.parse(readFileSync(args.baselinePath!, "utf8")) as RollbackCaptureArtifact;
    const current = runRollbackProbes(core, probes);
    const result = compareCaptures(baseline, current);
    result.baseline_path = args.baselinePath!;
    result.db_path = args.dbPath;
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.passed) {
      process.stderr.write("[s154-512-rollback-drill] D29 reversibility check FAILED\n");
      process.exitCode = 1;
    }
  } finally {
    core.shutdown("rollback-drill");
  }
}

if (import.meta.main) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[s154-512-rollback-drill] ${message}\n`);
    process.exit(1);
  });
}
