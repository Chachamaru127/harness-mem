import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import type { Config } from "./types";
import { clampLimit, nowIso, parseArrayJson } from "./core-utils";
import { scanForEgress } from "./secret-scanner";
import {
  JevTriageClient,
  type TriageDecision,
  type TriageItem,
} from "./jev-client";

export interface TriageRunResult {
  scanned: number;
  decided: number;
  kept: number;
  compacted: number;
  fallback: number;
  retryableFailures?: number;
  failureReasons?: Record<string, number>;
  skipped?: "disabled" | "missing_credentials" | "model_changed" | "no_rows";
}

export interface TriageClientLike {
  triage(items: TriageItem[]): Promise<TriageDecision[]>;
}

interface ObservationRow {
  id: string;
  project: string;
  content: string;
  privacy_tags_json: string | null;
  observation_type: string | null;
}

/** Types whose rows are durable by construction; keeping them without Jev is safe. */
const HEURISTIC_KEEP_TYPES = new Set(["summary", "decision", "lesson", "pattern", "preference"]);

const ACTIVE_MODEL_KEY = "triage.active_model";

function emptyResult(skipped?: TriageRunResult["skipped"]): TriageRunResult {
  return { scanned: 0, decided: 0, kept: 0, compacted: 0, fallback: 0, skipped };
}

function buildClient(config: Config): JevTriageClient {
  return new JevTriageClient({
    model: config.triageModel || "typesafe/jev-1.14.0",
    threshold: config.triageThreshold ?? 0.3,
    concurrency: clampLimit(config.triageConcurrency, 4, 1, 8),
    timeoutMs: clampLimit(config.triageTimeoutMs, 30000, 1000, 120000),
    accountId: config.cloudflareAccountId,
    apiToken: config.cloudflareApiToken,
  });
}

/**
 * Stage 1 triage for one bounded batch.
 *
 * - Disabled unless both triage and cloud egress are explicitly on.
 * - When triagePrefilterEnabled is on, durable observation types (decision,
 *   lesson, pattern, preference, summary) are kept without egress.
 * - Rows that the local scanner blocks never leave the machine and are recorded
 *   as keep with fallback=1, so they are not retried forever.
 * - Any model failure keeps the row in P (the client already does this).
 * - Idempotent per (observation_id, model) through INSERT OR IGNORE.
 */
export async function runTriageBatch(
  db: Database,
  config: Config,
  client: TriageClientLike = buildClient(config),
): Promise<TriageRunResult> {
  if (config.triageEnabled !== true || config.cloudLlmEnabled !== true) {
    return emptyResult("disabled");
  }
  const model = config.triageModel || "typesafe/jev-1.14.0";
  if (!config.cloudflareAccountId || !config.cloudflareApiToken) {
    return emptyResult("missing_credentials");
  }

  const active = db
    .query<{ value: string }, []>(`SELECT value FROM mem_meta WHERE key = '${ACTIVE_MODEL_KEY}'`)
    .get();
  if (active?.value && active.value !== model) {
    return emptyResult("model_changed");
  }
  db.query(
    `INSERT INTO mem_meta(key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(ACTIVE_MODEL_KEY, model, nowIso());

  const limit = clampLimit(config.triageMaxPerTick, 100, 1, 1000);
  const rows = db
    .query<ObservationRow, [string, number]>(
      `SELECT o.id, o.project, o.content, o.privacy_tags_json, o.observation_type
         FROM mem_observations o
        WHERE o.archived_at IS NULL
          AND o.content IS NOT NULL
          AND length(o.content) > 0
          AND NOT EXISTS (
            SELECT 1 FROM mem_triage_decisions d
             WHERE d.observation_id = o.id AND d.model = ?
               AND (d.fallback = 0 OR d.batch_id LIKE 'blocked-%' OR d.batch_id LIKE 'rejected-%')
          )
        ORDER BY o.created_at DESC
        LIMIT ?`,
    )
    .all(model, limit);

  if (rows.length === 0) return emptyResult("no_rows");

  const threshold = config.triageThreshold ?? 0.3;
  const batchId = `triage-${nowIso()}-${randomUUID().slice(0, 8)}`;
  const blockedBatchId = `blocked-${nowIso()}-${randomUUID().slice(0, 8)}`;
  const createdAt = nowIso();
  const heuristicRows =
    config.triagePrefilterEnabled === true
      ? rows.filter((row) => row.observation_type !== null && HEURISTIC_KEEP_TYPES.has(row.observation_type))
      : [];
  const heuristicIds = new Set(heuristicRows.map((row) => row.id));
  const apiRows = rows.filter((row) => !heuristicIds.has(row.id));
  const heuristicBatchId = heuristicRows.length > 0
    ? `heuristic-${nowIso()}-${randomUUID().slice(0, 8)}`
    : "";
  const insert = db.query(
    `INSERT INTO mem_triage_decisions
       (observation_id, project, model, threshold, score, durable, decision, fallback, batch_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(observation_id, model) DO UPDATE SET
       score = excluded.score,
       durable = excluded.durable,
       decision = excluded.decision,
       fallback = excluded.fallback,
       threshold = excluded.threshold,
       batch_id = excluded.batch_id,
       created_at = excluded.created_at
     WHERE mem_triage_decisions.batch_id NOT LIKE 'blocked-%'`,
  );

  const items: TriageItem[] = [];
  const blocked: ObservationRow[] = [];
  for (const row of apiRows) {
    const scan = scanForEgress(row.content, parseArrayJson(row.privacy_tags_json));
    if (scan.blocked) blocked.push(row);
    else items.push({ observationId: row.id, content: row.content });
  }

  const result: TriageRunResult = {
    scanned: rows.length,
    decided: 0,
    kept: 0,
    compacted: 0,
    fallback: 0,
  };

  const entries: Array<[string, string, string, number, number | null, number | null, "keep" | "compact", number, string, string]> = [];
  for (const row of heuristicRows) {
    entries.push([row.id, row.project, model, threshold, 1, 1, "keep", 0, heuristicBatchId, createdAt]);
    result.decided += 1;
    result.kept += 1;
  }
  for (const row of blocked) {
    entries.push([row.id, row.project, model, threshold, null, null, "keep", 1, blockedBatchId, createdAt]);
    result.decided += 1;
    result.kept += 1;
    result.fallback += 1;
  }

  if (items.length > 0) {
    let decisions: TriageDecision[] = [];
    try {
      decisions = await client.triage(items);
    } catch {
      decisions = items.map((item) => ({
        observationId: item.observationId,
        score: null,
        durable: null,
        decision: "keep" as const,
        fallback: true,
      }));
    }
    const byId = new Map(decisions.map((decision) => [decision.observationId, decision]));
    const projectById = new Map(apiRows.map((row) => [row.id, row.project]));
    for (const item of items) {
      const decision = byId.get(item.observationId) ?? {
        observationId: item.observationId,
        score: null,
        durable: null,
        decision: "keep" as const,
        fallback: true,
      };
      entries.push([
        item.observationId,
        projectById.get(item.observationId) ?? "",
        model,
        threshold,
        decision.score,
        decision.durable,
        decision.decision,
        decision.fallback ? 1 : 0,
        decision.fallback && ["http_400", "http_413", "http_422"].includes(decision.failureReason ?? "")
          ? `rejected-${decision.failureReason}-${batchId}` : batchId,
        createdAt,
      ]);
      result.decided += 1;
      if (decision.decision === "keep") result.kept += 1;
      else result.compacted += 1;
      if (decision.fallback) {
        result.fallback += 1;
        result.retryableFailures = (result.retryableFailures ?? 0) + 1;
        const reason = decision.failureReason ?? "unknown";
        const reasons = result.failureReasons ??= {};
        reasons[reason] = (reasons[reason] ?? 0) + 1;
      }
    }
  }

  // One commit per batch: the live DB is write-bound, so per-row autocommit is
  // not acceptable even for a background task.
  db.transaction(() => {
    for (const entry of entries) insert.run(...entry);
  })();

  return result;
}
