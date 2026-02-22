import { type Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { dedupeFacts, type ConsolidationFact } from "./deduper";
import { extractFacts } from "./extractor";

export interface ConsolidationRunOptions {
  reason?: string;
  project?: string;
  session_id?: string;
  limit?: number;
}

export interface ConsolidationRunStats {
  jobs_processed: number;
  facts_extracted: number;
  facts_merged: number;
  pending_jobs: number;
}

interface QueueRow {
  id: number;
  project: string;
  session_id: string;
}

function createFactId(project: string, sessionId: string, factKey: string, sourceObservationId: string): string {
  const hash = createHash("sha1");
  hash.update(`${project}:${sessionId}:${factKey}:${sourceObservationId}`);
  return `fact_${hash.digest("hex").slice(0, 24)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function writeAudit(
  db: Database,
  action: string,
  details: Record<string, unknown>,
  targetType = "consolidation",
  targetId = ""
): void {
  db.query(
    `
      INSERT INTO mem_audit_log(action, actor, target_type, target_id, details_json, created_at)
      VALUES (?, 'system', ?, ?, ?, ?)
    `
  ).run(action, targetType, targetId, JSON.stringify(details), nowIso());
}

function loadPendingJobs(db: Database, options: ConsolidationRunOptions): QueueRow[] {
  if (options.project && options.session_id) {
    return [
      {
        id: -1,
        project: options.project,
        session_id: options.session_id,
      },
    ];
  }

  const limit = Math.max(1, Math.min(200, Math.floor(options.limit || 20)));
  const queued = db
    .query(
      `
        SELECT id, project, session_id
        FROM mem_consolidation_queue
        WHERE status = 'pending'
        ORDER BY requested_at ASC, id ASC
        LIMIT ?
      `
    )
    .all(limit) as QueueRow[];
  if (queued.length > 0) {
    return queued;
  }

  return db
    .query(
      `
        SELECT -1 AS id, project, session_id
        FROM mem_sessions
        ORDER BY updated_at DESC
        LIMIT ?
      `
    )
    .all(limit) as QueueRow[];
}

function upsertFactsForSession(db: Database, project: string, sessionId: string): number {
  const observations = db
    .query(
      `
        SELECT id, title, content_redacted, observation_type
        FROM mem_observations
        WHERE project = ? AND session_id = ?
        ORDER BY created_at ASC
      `
    )
    .all(project, sessionId) as Array<{
    id: string;
    title: string;
    content_redacted: string;
    observation_type: string;
  }>;

  let inserted = 0;
  for (const observation of observations) {
    const facts = extractFacts({
      title: observation.title || "",
      content: observation.content_redacted || "",
      observation_type: observation.observation_type || "context",
    });

    for (const fact of facts) {
      const factId = createFactId(project, sessionId, fact.fact_key, observation.id);
      const row = db
        .query(
          `
            INSERT OR IGNORE INTO mem_facts(
              fact_id,
              observation_id,
              project,
              session_id,
              fact_type,
              fact_key,
              fact_value,
              confidence,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          factId,
          observation.id,
          project,
          sessionId,
          fact.fact_type,
          fact.fact_key,
          fact.fact_value,
          fact.confidence,
          nowIso(),
          nowIso()
        );
      inserted += Number((row as { changes?: number }).changes ?? 0);
    }
  }

  return inserted;
}

function dedupeSessionFacts(db: Database, project: string, sessionId: string): number {
  const facts = db
    .query(
      `
        SELECT
          fact_id,
          project,
          session_id,
          fact_type,
          fact_key,
          fact_value,
          created_at
        FROM mem_facts
        WHERE project = ?
          AND session_id = ?
          AND merged_into_fact_id IS NULL
        ORDER BY created_at ASC
      `
    )
    .all(project, sessionId) as ConsolidationFact[];

  const merges = dedupeFacts(facts);
  for (const merge of merges) {
    db.query(
      `
        UPDATE mem_facts
        SET merged_into_fact_id = ?, updated_at = ?
        WHERE fact_id = ?
      `
    ).run(merge.into_fact_id, nowIso(), merge.from_fact_id);
  }

  return merges.length;
}

export function runConsolidationOnce(db: Database, options: ConsolidationRunOptions = {}): ConsolidationRunStats {
  const jobs = loadPendingJobs(db, options);
  let jobsProcessed = 0;
  let factsExtracted = 0;
  let factsMerged = 0;

  for (const job of jobs) {
    if (job.id > 0) {
      db.query(`UPDATE mem_consolidation_queue SET status = 'running', started_at = ? WHERE id = ?`).run(nowIso(), job.id);
    }

    const extracted = upsertFactsForSession(db, job.project, job.session_id);
    const merged = dedupeSessionFacts(db, job.project, job.session_id);

    factsExtracted += extracted;
    factsMerged += merged;
    jobsProcessed += 1;

    writeAudit(
      db,
      "consolidation.run",
      {
        project: job.project,
        session_id: job.session_id,
        facts_extracted: extracted,
        facts_merged: merged,
        reason: options.reason || "manual",
      },
      "session",
      `${job.project}:${job.session_id}`
    );

    if (job.id > 0) {
      db.query(
        `
          UPDATE mem_consolidation_queue
          SET status = 'completed', finished_at = ?, error = NULL
          WHERE id = ?
        `
      ).run(nowIso(), job.id);
    }
  }

  const pendingRow = db
    .query(`SELECT COUNT(*) AS count FROM mem_consolidation_queue WHERE status = 'pending'`)
    .get() as { count?: number } | null;

  return {
    jobs_processed: jobsProcessed,
    facts_extracted: factsExtracted,
    facts_merged: factsMerged,
    pending_jobs: Number(pendingRow?.count ?? 0),
  };
}

export function enqueueConsolidationJob(db: Database, project: string, sessionId: string, reason: string): void {
  db.query(
    `
      INSERT INTO mem_consolidation_queue(project, session_id, reason, status, requested_at)
      VALUES (?, ?, ?, 'pending', ?)
    `
  ).run(project, sessionId, reason.slice(0, 255), nowIso());
}
