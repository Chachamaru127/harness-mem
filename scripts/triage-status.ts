#!/usr/bin/env bun
/**
 * Stage 1 triage status. Read-only.
 *
 * Usage: bun scripts/triage-status.ts [--json]
 * DB path: HARNESS_MEM_DB_PATH or ~/.harness-mem/harness-mem.db
 */
import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";

const dbPath = process.env.HARNESS_MEM_DB_PATH || join(homedir(), ".harness-mem", "harness-mem.db");
const asJson = process.argv.includes("--json");
const db = new Database(dbPath, { readonly: true });

const totals = db
  .query<{ total: number; keep: number; compact: number; fallback: number; blocked: number }, []>(
    `SELECT COUNT(*) AS total,
            SUM(decision = 'keep') AS keep,
            SUM(decision = 'compact') AS compact,
            SUM(fallback = 1) AS fallback,
            SUM(batch_id LIKE 'blocked-%') AS blocked
       FROM mem_triage_decisions`,
  )
  .get() ?? { total: 0, keep: 0, compact: 0, fallback: 0, blocked: 0 };

const active = db
  .query<{ value: string }, []>("SELECT value FROM mem_meta WHERE key = 'triage.active_model'")
  .get();
const model = active?.value ?? null;

const pending = model
  ? (db
      .query<{ n: number }, [string]>(
        `SELECT COUNT(*) AS n
           FROM mem_observations o
          WHERE o.archived_at IS NULL
            AND o.content IS NOT NULL
            AND length(o.content) > 0
            AND NOT EXISTS (
              SELECT 1 FROM mem_triage_decisions d
               WHERE d.observation_id = o.id AND d.model = ?
                 AND (d.fallback = 0 OR d.batch_id LIKE 'blocked-%' OR d.batch_id LIKE 'rejected-%')
            )`,
      )
      .get(model)?.n ?? 0)
  : 0;

const last24h = db
  .query<{ n: number }, []>(
    "SELECT COUNT(*) AS n FROM mem_triage_decisions WHERE julianday(created_at) > julianday('now','-1 day')",
  )
  .get()?.n ?? 0;
const rejected = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM mem_triage_decisions WHERE batch_id LIKE 'rejected-%'").get()?.n ?? 0;
const last10m = db
  .query<{ n: number }, []>(
    "SELECT COUNT(*) AS n FROM mem_triage_decisions WHERE julianday(created_at) > julianday('now','-10 minutes')",
  )
  .get()?.n ?? 0;

// The 24h rate includes ramp-up and idle gaps. Prefer the last 10 minutes when
// the worker is actually running, and fall back to the daily rate otherwise.
const perMinute = last10m > 0 ? last10m / 10 : last24h / (24 * 60);
const etaDays = perMinute > 0 ? pending / perMinute / (60 * 24) : null;

const result = {
  db_path: dbPath,
  model,
  totals,
  pending,
  rejected,
  last_24h: last24h,
  last_10m: last10m,
  per_minute: Number(perMinute.toFixed(2)),
  eta_days: etaDays === null ? null : Number(etaDays.toFixed(1)),
};

if (asJson) {
  console.log(JSON.stringify(result, null, 1));
} else {
  console.log(`model      ${result.model ?? "(not set)"}`);
  console.log(`decided    ${totals.total} (keep ${totals.keep}, compact ${totals.compact})`);
  console.log(`fallback   ${totals.fallback} (blocked ${totals.blocked})`);
  console.log(`pending    ${pending}`);
  console.log(`retained   ${rejected} (request rejected; no automatic retry)`);
  console.log(`last 10m   ${last10m}   last 24h ${last24h} (${result.per_minute}/min)`);
  console.log(`ETA        ${result.eta_days === null ? "n/a" : `${result.eta_days} days`}`);
}
db.close();
