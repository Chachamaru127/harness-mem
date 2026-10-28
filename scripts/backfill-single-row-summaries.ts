#!/usr/bin/env bun
/**
 * Backfill S rows for sessions that have exactly one compact, non-durable,
 * unarchived observation. A one-row session does not benefit from a
 * generative summary: the row is the session. This writes a bounded
 * extractive S row (default 1200 chars), links it to the source, and marks
 * the summary job completed with the same model the daemon uses. The normal
 * archive loop then sees the session as summary-complete.
 *
 * The source row stays in place until the archive/purge path removes it.
 * The full payload remains in the archive backup; the S row is the searchable
 * extract.
 *
 * Usage:
 *   bun run scripts/backfill-single-row-summaries.ts                 # dry run
 *   bun run scripts/backfill-single-row-summaries.ts --execute --limit 100
 *   bun run scripts/backfill-single-row-summaries.ts --execute --time-budget-ms 600000
 */
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  claimSummaryJob,
  completeSummaryJob,
  insertSummaryObservation,
  linkSummaryToSources,
  startSummaryJob,
} from "../memory-server/src/core/summary-store";

interface Args {
  dbPath: string;
  execute: boolean;
  limit: number;
  maxChars: number;
  batch: number;
  timeBudgetMs: number;
  model?: string;
}

interface Row {
  id: string;
  session_id: string;
  project: string;
  content: string;
  privacy_tags_json: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    dbPath: process.env.HARNESS_MEM_DB_PATH || join(homedir(), ".harness-mem", "harness-mem.db"),
    execute: false,
    limit: 100000,
    maxChars: 1200,
    batch: 200,
    timeBudgetMs: 10 * 60 * 1000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    const next = argv[i + 1];
    switch (value) {
      case "--execute":
        args.execute = true;
        break;
      case "--db-path":
        args.dbPath = next!;
        i += 1;
        break;
      case "--limit":
        args.limit = Number(next);
        i += 1;
        break;
      case "--max-chars":
        args.maxChars = Number(next);
        i += 1;
        break;
      case "--batch":
        args.batch = Number(next);
        i += 1;
        break;
      case "--time-budget-ms":
        args.timeBudgetMs = Number(next);
        i += 1;
        break;
      case "--model":
        args.model = next;
        i += 1;
        break;
      default:
        throw new Error(`unknown argument: ${value}`);
    }
  }
  return args;
}

function summaryIdFor(sessionId: string, model: string): string {
  return `obs_summary_${createHash("sha256").update(`${sessionId}:${model}`).digest("hex").slice(0, 24)}`;
}

function parseTags(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…`;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const db = new Database(args.dbPath);
  db.exec("PRAGMA busy_timeout=30000;");

  const activeModel = db
    .query<{ value: string }, []>("SELECT value FROM mem_meta WHERE key = 'triage.active_model'")
    .get()?.value ?? null;
  const model = args.model
    ?? db.query<{ model: string }, []>(
      "SELECT model FROM mem_summary_jobs GROUP BY model ORDER BY COUNT(*) DESC LIMIT 1",
    ).get()?.model
    ?? "glm-5.3-flash:cloud";

  const modelFilter = activeModel ? "AND d.model = ?" : "";
  const selection = db.query<Row, unknown[]>(`
    WITH single AS (
      SELECT o.session_id, COUNT(*) AS c
        FROM mem_observations o
        JOIN mem_triage_decisions d ON d.observation_id = o.id
       WHERE d.decision = 'compact'
         AND COALESCE(d.durable, 0) < 0.5
         AND o.archived_at IS NULL
         ${modelFilter}
       GROUP BY o.session_id
      HAVING c = 1
    )
    SELECT o.id, o.session_id, o.project, o.content, o.privacy_tags_json
      FROM single s
      JOIN mem_observations o ON o.session_id = s.session_id
      JOIN mem_triage_decisions d ON d.observation_id = o.id
     WHERE d.decision = 'compact'
       AND COALESCE(d.durable, 0) < 0.5
       AND o.archived_at IS NULL
       ${modelFilter}
       AND NOT EXISTS (
         SELECT 1 FROM mem_summary_jobs j
          WHERE j.session_id = o.session_id
            AND j.model = ?
            AND j.status IN ('completed', 'running', 'blocked')
       )
     ORDER BY o.created_at ASC
     LIMIT ?
  `);

  const params: unknown[] = [];
  if (activeModel) params.push(activeModel);
  if (activeModel) params.push(activeModel);
  params.push(model, args.limit);
  const rows = selection.all(...params);

  const summaryExists = db.query<{ present: number }, [string]>(
    "SELECT 1 AS present FROM mem_observations WHERE id = ?",
  );
  const resetFailed = db.query(
    "UPDATE mem_summary_jobs SET status = 'pending', error = NULL, updated_at = ? WHERE session_id = ? AND model = ? AND status = 'failed'",
  );

  const stats = { scanned: rows.length, inserted: 0, linked: 0, completed: 0, skipped: 0, truncated_unlinked: 0 };
  const started = Date.now();

  const apply = (row: Row): void => {
    const key = { sessionId: row.session_id, project: row.project, model };
    const now = new Date().toISOString();
    resetFailed.run(now, key.sessionId, key.model);
    claimSummaryJob(db, key);
    if (!startSummaryJob(db, key)) {
      stats.skipped += 1;
      return;
    }
    const summaryId = summaryIdFor(row.session_id, model);
    if (!summaryExists.get(summaryId)) {
      insertSummaryObservation(db, {
        id: summaryId,
        project: row.project,
        sessionId: row.session_id,
        title: `要約: ${row.session_id}`,
        content: truncate(row.content, args.maxChars),
        tags: ["summary", `session:${row.session_id}`, "summary_kind:single_row_extract"],
        privacyTags: parseTags(row.privacy_tags_json),
      });
      stats.inserted += 1;
    }
    // A truncated extract does not cover the row, so it is not linked and stays out of archive.
    if (row.content.length <= args.maxChars) stats.linked += linkSummaryToSources(db, summaryId, [row.id], now);
    else stats.truncated_unlinked += 1;
    completeSummaryJob(db, key, summaryId);
    stats.completed += 1;
  };

  if (!args.execute) {
    console.log(JSON.stringify({
      mode: "plan",
      db: args.dbPath,
      model,
      active_triage_model: activeModel,
      max_chars: args.maxChars,
      ...stats,
      sample: rows.slice(0, 5).map((row) => ({
        session_id: row.session_id,
        project: row.project,
        content_chars: row.content.length,
      })),
    }, null, 2));
    db.close();
    return;
  }

  const applyBatch = db.transaction((batch: Row[]) => {
    for (const row of batch) apply(row);
  });

  for (let offset = 0; offset < rows.length; offset += args.batch) {
    if (Date.now() - started > args.timeBudgetMs) {
      console.log(JSON.stringify({ stopped: "time_budget", done: offset, ...stats }));
      break;
    }
    applyBatch(rows.slice(offset, offset + args.batch));
    if ((offset / args.batch) % 10 === 0) {
      console.log(JSON.stringify({ progress: offset + args.batch, ...stats }));
    }
  }

  console.log(JSON.stringify({
    mode: "execute",
    db: args.dbPath,
    model,
    max_chars: args.maxChars,
    elapsed_ms: Date.now() - started,
    ...stats,
  }, null, 2));
  db.close();
}

main();
