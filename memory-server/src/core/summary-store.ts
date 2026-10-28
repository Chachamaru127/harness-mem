import type { Database } from "bun:sqlite";

/**
 * Living Memory §4.1 / T11: S-row persistence and per-(session_id, model)
 * summary job management. The job row is the state machine of the maintenance
 * worker's summarization step:
 *
 *   claim (INSERT OR IGNORE 'pending') -> start ('running')
 *     -> complete ('completed' + S row id) | fail ('failed' + error)
 *
 * Rows are identified by UNIQUE(session_id, model); `project` is recorded on
 * claim and is not part of the row key, because a session_id belongs to
 * exactly one project (mem_sessions.session_id is the primary key).
 */
export interface SummaryJobKey {
  sessionId: string;
  project: string;
  model: string;
}

/**
 * Registers the summary job if it does not exist yet. Returns true when this
 * call created the pending row, false when a job for (session_id, model)
 * already existed — including one left 'running' by a crashed worker, which
 * is never reset here. Resetting a failed/stale row is the retry loop's job.
 */
export function claimSummaryJob(db: Database, key: SummaryJobKey): boolean {
  const now = new Date().toISOString();
  const result = db.query(`
    INSERT OR IGNORE INTO mem_summary_jobs(session_id, project, model, status, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?)
  `).run(key.sessionId, key.project, key.model, now, now);
  return Number(result.changes) === 1;
}

/**
 * Moves a pending job to running. Returns false when there is nothing to
 * start: no row, a row that is already running, or a job in any other status.
 * Only a pending row can start.
 */
export function startSummaryJob(db: Database, key: SummaryJobKey): boolean {
  const now = new Date().toISOString();
  const result = db.query(`
    UPDATE mem_summary_jobs
    SET status = 'running', updated_at = ?
    WHERE session_id = ? AND model = ? AND status = 'pending'
  `).run(now, key.sessionId, key.model);
  return Number(result.changes) === 1;
}

/**
 * Records the finished S row. Clears `error` so a retry that succeeded does
 * not keep the previous attempt's message. Idempotent: re-completing with the
 * same observation id rewrites the same values.
 */
export function completeSummaryJob(db: Database, key: SummaryJobKey, summaryObservationId: string): void {
  const now = new Date().toISOString();
  db.query(`
    UPDATE mem_summary_jobs
    SET status = 'completed', summary_observation_id = ?, error = NULL, updated_at = ?
    WHERE session_id = ? AND model = ?
  `).run(summaryObservationId, now, key.sessionId, key.model);
}

/**
 * Records the failure reason. The S row id stays null; no summary was written.
 */
export function failSummaryJob(db: Database, key: SummaryJobKey, error: string): void {
  const now = new Date().toISOString();
  db.query(`
    UPDATE mem_summary_jobs
    SET status = 'failed', error = ?, updated_at = ?
    WHERE session_id = ? AND model = ?
  `).run(error, now, key.sessionId, key.model);
}

/**
 * Writes the S row into the existing mem_observations table (§4.1: S rows
 * reuse mem_observations; no new memory_kind column). A plain INSERT, not
 * OR IGNORE: a duplicate id means the caller retried with colliding ids and
 * must hear about it. content_redacted mirrors content because the summary
 * is produced only from rows the privacy/secret scanner already passed
 * (§4.5), and the caller is responsible for passing redacted content.
 */
export function insertSummaryObservation(
  db: Database,
  input: {
    id: string;
    project: string;
    sessionId: string;
    title: string;
    content: string;
    tags?: string[];
    privacyTags?: string[];
  },
): void {
  const now = new Date().toISOString();
  db.query(`
    INSERT INTO mem_observations(
      id, platform, project, session_id, title, content, content_redacted,
      tags_json, privacy_tags_json, observation_type, memory_type,
      created_at, updated_at
    ) VALUES (?, 'harness', ?, ?, ?, ?, ?, ?, ?, 'summary', 'semantic', ?, ?)
  `).run(
    input.id,
    input.project,
    input.sessionId,
    input.title,
    input.content,
    input.content,
    JSON.stringify(input.tags ?? ["summary"]),
    JSON.stringify(input.privacyTags ?? []),
    now,
    now,
  );
}

/**
 * Links the S row to its source observations with relation='summarizes'.
 * INSERT OR IGNORE against idx_mem_links_unique_relation makes a re-run
 * after a crash add nothing. Returns how many pairs were actually inserted,
 * so the caller can detect a no-op retry. Foreign key violations are not
 * swallowed by OR IGNORE: a missing source observation throws.
 */
export function linkSummaryToSources(
  db: Database,
  summaryObservationId: string,
  sourceIds: string[],
  createdAt: string,
): number {
  // RETURNING, not run().changes: mem_links has AFTER INSERT triggers
  // (observed_at backfill, recall-generation bump) and Bun's `changes`
  // counts their writes too, so it cannot report the added-pair count.
  // RETURNING emits a row only for pairs INSERT OR IGNORE actually inserted.
  const statement = db.query<{ to_observation_id: string }, [string, string, string]>(`
    INSERT OR IGNORE INTO mem_links(from_observation_id, to_observation_id, relation, created_at)
    VALUES (?, ?, 'summarizes', ?)
    RETURNING to_observation_id
  `);
  let added = 0;
  for (const sourceId of sourceIds) {
    if (statement.get(summaryObservationId, sourceId, createdAt)) added += 1;
  }
  return added;
}