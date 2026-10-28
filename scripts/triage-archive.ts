#!/usr/bin/env bun
/**
 * Triage-driven L1 archive. Reversible: copies the observation payload into
 * mem_archive_* and sets archived_at. Does not purge, delete vectors, or VACUUM.
 *
 * Usage:
 *   bun run scripts/triage-archive.ts --limit 100            # dry run
 *   bun run scripts/triage-archive.ts --limit 100 --execute  # archive
 *
 * Execute refuses to run while the daemon health endpoint answers, unless
 * --allow-running-daemon is passed.
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
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    dbPath: process.env.HARNESS_MEM_DB_PATH || join(homedir(), ".harness-mem", "harness-mem.db"),
    limit: 100,
    execute: false,
    reason: "triage-compact-archive",
    allowRunningDaemon: false,
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
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: bun run scripts/triage-archive.ts [--db-path <db>] [--limit 1..500] [--execute] [--reason <text>] [--model <id>] [--project <p>] [--allow-running-daemon]");
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 500) {
    throw new Error("--limit must be an integer from 1 to 500");
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
      // Same eligibility as triage-compact-loop: only rows a completed summary actually covers.
      "EXISTS (SELECT 1 FROM mem_links l JOIN mem_summary_jobs j ON j.summary_observation_id = l.from_observation_id AND j.status = 'completed' WHERE l.to_observation_id = o.id AND l.relation = 'summarizes')",
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.execute && !args.allowRunningDaemon && await daemonIsUp()) {
    throw new Error("daemon is running; stop it first or pass --allow-running-daemon");
  }
  const ids = selectCompacts(args);
  if (ids.length === 0) {
    console.log(JSON.stringify({ ok: true, skipped: "no_compact_candidates", execute: args.execute }, null, 1));
    return;
  }

  const config: Config = { ...getConfig(), dbPath: args.dbPath, backgroundWorkersEnabled: false, partialFinalizeEnabled: false, reindexVectorsEnabled: false };
  const core = new HarnessMemCore(config);
  try {
    const plan = core.adminForgetArchive({ candidate_ids: ids });
    if (!plan.ok) throw new Error(plan.error || "archive plan failed");
    const planItem = firstItem(plan);
    const manifest = String(planItem.manifest_sha256 ?? "");
    const candidateCount = Number(planItem.candidate_count ?? 0);
    const impact = planItem.cross_store_impact ?? null;

    if (!args.execute) {
      console.log(JSON.stringify({
        ok: true, mode: "plan", candidate_count: candidateCount,
        manifest_sha256: manifest, cross_store_impact: impact,
      }, null, 1));
      return;
    }
    if (!manifest) throw new Error("archive plan returned no manifest");

    const executed = core.adminForgetArchive({
      candidate_ids: ids,
      execute: true,
      manifest_sha256: manifest,
      reason: args.reason,
    });
    if (!executed.ok) throw new Error(executed.error || "archive execute failed");
    const executedItem = firstItem(executed);
    console.log(JSON.stringify({
      ok: true, mode: "execute", archived: executedItem.archived_count,
      skipped_already_archived: executedItem.skipped_already_archived,
      candidate_count: candidateCount, manifest_sha256: manifest,
    }, null, 1));
  } finally {
    await core.shutdown("triage-archive");
  }
}

main().catch((error) => {
  console.error(`[triage-archive] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
