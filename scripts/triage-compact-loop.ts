#!/usr/bin/env bun
/**
 * Triage-driven compaction loop: L1 archive + L2 vector prune, one batch at a
 * time. No hard purge, no observation deletion, no VACUUM.
 *
 * Usage:
 *   bun run scripts/triage-compact-loop.ts --limit 100                 # plan
 *   bun run scripts/triage-compact-loop.ts --limit 100 --execute --prune-vectors
 *   bun run scripts/triage-compact-loop.ts --limit 100 --execute --prune-vectors --max-batches 10
 */
import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { HarnessMemCore, getConfig, type ApiResponse } from "../memory-server/src/core/harness-mem-core";
import type { Config } from "../memory-server/src/core/types";

interface Args {
  dbPath: string;
  limit: number;
  execute: boolean;
  reason: string;
  model?: string;
  project?: string;
  allowRunningDaemon: boolean;
  pruneVectors: boolean;
  maxBatches: number;
  timeBudgetMs: number;
  sleepMs: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    dbPath: process.env.HARNESS_MEM_DB_PATH || join(homedir(), ".harness-mem", "harness-mem.db"),
    limit: 100,
    execute: false,
    reason: "triage-compact-loop",
    allowRunningDaemon: false,
    pruneVectors: false,
    maxBatches: 1,
    timeBudgetMs: 0,
    sleepMs: 0,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--db-path") args.dbPath = argv[++i];
    else if (arg === "--limit") args.limit = Number(argv[++i]);
    else if (arg === "--execute") args.execute = true;
    else if (arg === "--reason") args.reason = argv[++i];
    else if (arg === "--model") args.model = argv[++i];
    else if (arg === "--project") args.project = argv[++i];
    else if (arg === "--allow-running-daemon") args.allowRunningDaemon = true;
    else if (arg === "--prune-vectors") args.pruneVectors = true;
    else if (arg === "--max-batches") args.maxBatches = Number(argv[++i]);
    else if (arg === "--time-budget-ms") args.timeBudgetMs = Number(argv[++i]);
    else if (arg === "--sleep-ms") args.sleepMs = Number(argv[++i]);
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: bun run scripts/triage-compact-loop.ts [--db-path <db>] [--limit 1..500] [--execute] [--prune-vectors] [--max-batches N] [--time-budget-ms N] [--sleep-ms N] [--reason <text>] [--model <id>] [--project <p>] [--allow-running-daemon]");
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 500) {
    throw new Error("--limit must be an integer from 1 to 500");
  }
  if (!Number.isInteger(args.maxBatches) || args.maxBatches < 1) {
    throw new Error("--max-batches must be a positive integer");
  }
  if (!Number.isInteger(args.timeBudgetMs) || args.timeBudgetMs < 0) {
    throw new Error("--time-budget-ms must be a non-negative integer");
  }
  if (!Number.isInteger(args.sleepMs) || args.sleepMs < 0) {
    throw new Error("--sleep-ms must be a non-negative integer");
  }
  if (args.execute && !args.reason.trim()) {
    throw new Error("--reason must be non-empty when --execute is used");
  }
  return args;
}

async function daemonIsUp(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const response = await fetch("http://127.0.0.1:37888/health/ready", { signal: controller.signal });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

function selectCompacts(args: Args): string[] {
  const db = new Database(args.dbPath, { readonly: true });
  try {
    const model = args.model
      ?? (db.query<{ value: string }, []>("SELECT value FROM mem_meta WHERE key = 'triage.active_model'").get()?.value ?? null);
    const conditions: string[] = [
      "o.archived_at IS NULL",
      "d.decision = 'compact'",
      "COALESCE(d.durable, 0) < 0.5",
      "EXISTS (SELECT 1 FROM mem_summary_jobs j WHERE j.session_id = o.session_id AND j.status = 'completed')",
      "NOT EXISTS (SELECT 1 FROM mem_archive_stubs s WHERE s.observation_id = o.id AND s.archive_state = 'archived')",
    ];
    const values: string[] = [];
    if (model) {
      conditions.push("d.model = ?");
      values.push(model);
    }
    if (args.project) {
      conditions.push("o.project = ?");
      values.push(args.project);
    }
    const sql = `
      SELECT o.id
        FROM mem_observations o
        JOIN mem_triage_decisions d ON d.observation_id = o.id
       WHERE ${conditions.join(" AND ")}
       ORDER BY o.created_at ASC
       LIMIT ?`;
    return db.query<{ id: string }, (string | number)[]>(sql).all(...values, args.limit).map((row) => row.id);
  } finally {
    db.close();
  }
}

function firstItem(response: ApiResponse): Record<string, unknown> {
  return (response.items[0] ?? {}) as Record<string, unknown>;
}

function deleteVectors(core: HarnessMemCore, ids: string[]): { json: number; map: number } {
  if (ids.length === 0) return { json: 0, map: 0 };
  const placeholders = ids.map(() => "?").join(", ");
  const db = core.getRawDb();
  return db.transaction(() => {
    const json = db.query(`DELETE FROM mem_vectors WHERE observation_id IN (${placeholders})`).run(...ids).changes ?? 0;
    const map = db.query(`DELETE FROM mem_vectors_vec_map WHERE observation_id IN (${placeholders})`).run(...ids).changes ?? 0;
    return { json, map };
  })();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const daemonRunning = await daemonIsUp();
  if (args.execute && !args.allowRunningDaemon && daemonRunning) {
    throw new Error("daemon is running; stop it first or pass --allow-running-daemon");
  }
  // The ready daemon owns exhaustive schema validation. This maintenance child
  // checks schema markers, and must not reclaim the daemon's running jobs.
  if (args.allowRunningDaemon && daemonRunning) {
    process.env.HARNESS_MEM_ARCHIVE_CHILD_PROCESS = "1";
  }

  const config: Config = { ...getConfig(), dbPath: args.dbPath, backgroundWorkersEnabled: false, partialFinalizeEnabled: false, reindexVectorsEnabled: false };
  const core = new HarnessMemCore(config);
  const deadline = args.timeBudgetMs > 0 ? Date.now() + args.timeBudgetMs : 0;
  const totals = { batches: 0, candidates: 0, archived: 0, vector_json: 0, vector_map: 0 };
  try {
    for (let batch = 0; batch < args.maxBatches; batch += 1) {
      const ids = selectCompacts(args);
      if (ids.length === 0) break;

      const plan = core.adminForgetArchive({ candidate_ids: ids });
      if (!plan.ok) throw new Error(plan.error || "archive plan failed");
      const planItem = firstItem(plan);
      const manifest = String(planItem.manifest_sha256 ?? "");
      const candidateCount = Number(planItem.candidate_count ?? 0);
      if (!args.execute) {
        console.log(JSON.stringify({
          ok: true, mode: "plan", batch: batch + 1, candidate_count: candidateCount,
          manifest_sha256: manifest, cross_store_impact: planItem.cross_store_impact ?? null,
        }, null, 1));
        break;
      }
      if (!manifest || candidateCount === 0) break;

      const executed = core.adminForgetArchive({
        candidate_ids: ids,
        execute: true,
        manifest_sha256: manifest,
        reason: args.reason,
      });
      if (!executed.ok) throw new Error(executed.error || "archive execute failed");
      const archived = Number(firstItem(executed).archived_count ?? 0);
      const pruned = args.pruneVectors ? deleteVectors(core, ids) : { json: 0, map: 0 };
      totals.batches += 1;
      totals.candidates += candidateCount;
      totals.archived += archived;
      totals.vector_json += pruned.json;
      totals.vector_map += pruned.map;
      console.log(JSON.stringify({
        ok: true, mode: "execute", batch: batch + 1, candidate_count: candidateCount,
        archived, vector_json_deleted: pruned.json, vector_map_deleted: pruned.map,
        elapsed_ms: 0,
      }, null, 1));

      if (deadline > 0 && Date.now() >= deadline) break;
      if (args.sleepMs > 0) await new Promise((resolve) => setTimeout(resolve, args.sleepMs));
    }
    console.log(JSON.stringify({ ok: true, totals }, null, 1));
  } finally {
    await core.shutdown("triage-compact-loop");
  }
}

main().catch((error) => {
  console.error(`[triage-compact-loop] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
