import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import type { Config } from "./types";
import { clampLimit, nowIso, parseArrayJson } from "./core-utils";
import { scanForEgress } from "./secret-scanner";
import { ClairicClient, type ClairicFacts } from "./clairic-client";
import { SummaryClient, type SummaryInput, type SummaryResult } from "./summary-client";
import {
  claimSummaryJob,
  completeSummaryJob,
  failSummaryJob,
  insertSummaryObservation,
  linkSummaryToSources,
  startSummaryJob,
  type SummaryJobKey,
} from "./summary-store";

export interface SummaryRunResult {
  scanned: number;
  summarized: number;
  blocked: number;
  failed: number;
  failureReasons?: string[];
  skipped?: "disabled" | "no_sessions";
}

export interface SummaryDeps {
  clairic?: { extract(state: string): Promise<ClairicFacts> };
  summary?: { summarize(input: SummaryInput): Promise<SummaryResult> };
}

interface SessionRow {
  session_id: string;
  project: string;
  first_at: string;
}

interface SourceRow {
  id: string;
  content: string;
  privacy_tags_json: string | null;
}

const EMPTY_FACTS: ClairicFacts = {
  decision: null,
  reason: null,
  date: null,
  version: null,
  files: [],
};
const MAX_LOG_CHARS = 6000;
const STALE_RUNNING_MS = 60 * 60 * 1000;

function emptyResult(skipped?: SummaryRunResult["skipped"]): SummaryRunResult {
  return { scanned: 0, summarized: 0, blocked: 0, failed: 0, skipped };
}

function isLoopbackEndpoint(endpoint: string | undefined): boolean {
  if (!endpoint) return true;
  try {
    const host = new URL(endpoint).hostname.replace(/^\[|\]$/g, "");
    // Only a literal IPv4 in 127.0.0.0/8: a DNS name such as 127.remote.example is remote.
    const loopbackV4 = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    return host === "localhost" || host === "::1"
      || (loopbackV4 !== null && loopbackV4.slice(1).every((octet) => Number(octet) <= 255));
  } catch {
    return false;
  }
}

function summaryIdFor(sessionId: string, model: string): string {
  return `obs_summary_${createHash("sha256").update(`${sessionId}:${model}`).digest("hex").slice(0, 24)}`;
}

/**
 * Stage 2 summary batch. For each session with compact, non-durable rows and
 * no completed summary job:
 *   scanner -> Clairic facts -> generative summary -> S row + links -> job completed.
 * The source rows stay in place; the existing compact loop archives them and
 * prunes their vectors. A blocked or failed session writes no S row.
 */
export async function runSummaryBatch(
  db: Database,
  config: Config,
  deps: SummaryDeps = {},
): Promise<SummaryRunResult> {
  if (config.summaryEnabled !== true) return emptyResult("disabled");
  const model = config.summaryModel || "glm-5.3-flash:cloud";
  // Every remote path needs the explicit cloud opt-in: Claude/Codex backends, Ollama ":cloud" models, and Clairic.
  const remoteSummary = config.summaryBackend === "codex-app-server" || config.summaryBackend === "claude-code"
    || model.endsWith(":cloud") || !isLoopbackEndpoint(config.summaryEndpoint);
  if (remoteSummary && config.cloudLlmEnabled !== true) return emptyResult("disabled");
  const clairicAllowed = config.clairicEnabled !== false && config.cloudLlmEnabled === true;
  const now = nowIso();
  // A worker that died between start and completion leaves a 'running' row.
  // After an hour, treat it as failed so the retry path can pick it up.
  const staleBefore = new Date(Date.now() - STALE_RUNNING_MS).toISOString();
  const staleJob = db.query(`
    SELECT 1 FROM mem_summary_jobs
    WHERE status = 'running' AND updated_at < ? LIMIT 1
  `).get(staleBefore);
  if (staleJob) {
    db.query(`
      UPDATE mem_summary_jobs
      SET status = 'failed', error = 'stale_running', updated_at = ?
      WHERE status = 'running' AND updated_at < ?
    `).run(now, staleBefore);
  }
  const maxSessions = clampLimit(config.summaryMaxSessions, 5, 1, 20);
  const maxSources = clampLimit(config.summaryMaxSources, 50, 1, 200);
  const clairic = deps.clairic ?? (!clairicAllowed
    ? { extract: async () => EMPTY_FACTS }
    : new ClairicClient({
        accountId: config.cloudflareAccountId,
        apiToken: config.cloudflareApiToken,
        model: config.clairicModel || "@cf/cloudflare/clairic",
      }));
  const summary = deps.summary ?? new SummaryClient({
    backend: config.summaryBackend,
    endpoint: config.summaryEndpoint,
    model,
  });

  const sessions = db
    .query<SessionRow, [number]>(
      `SELECT o.session_id, o.project, MIN(o.created_at) AS first_at
         FROM mem_observations o
         JOIN mem_triage_decisions d ON d.observation_id = o.id
        WHERE d.decision = 'compact'
          AND COALESCE(d.durable, 0) < 0.5
          AND NOT EXISTS (
            SELECT 1 FROM mem_summary_jobs j
             WHERE j.session_id = o.session_id
               AND j.status IN ('completed', 'running', 'blocked')
          )
        GROUP BY o.session_id, o.project
        ORDER BY COUNT(*) DESC, first_at ASC
        LIMIT ?`,
    )
    .all(maxSessions);

  if (sessions.length === 0) return emptyResult("no_sessions");

  const result: SummaryRunResult = { scanned: sessions.length, summarized: 0, blocked: 0, failed: 0 };
  const recordFailure = (reason: string): void => {
    result.failed += 1;
    (result.failureReasons ??= []).push(reason);
  };
  const sourceQuery = db.query<SourceRow, [string, number]>(
    `SELECT o.id, o.content, o.privacy_tags_json
       FROM mem_observations o
       JOIN mem_triage_decisions d ON d.observation_id = o.id
      WHERE o.session_id = ?
        AND d.decision = 'compact'
        AND COALESCE(d.durable, 0) < 0.5
      ORDER BY o.created_at ASC
      LIMIT ?`,
  );
  const markBlocked = db.query(
    `UPDATE mem_summary_jobs SET status = 'blocked', error = ?, updated_at = ?
      WHERE session_id = ? AND model = ?`,
  );
  const resetFailed = db.query(
    `UPDATE mem_summary_jobs SET status = 'pending', error = NULL, updated_at = ?
      WHERE session_id = ? AND model = ? AND status = 'failed'`,
  );
  const summaryExists = db.query<{ present: number }, [string]>(
    `SELECT 1 AS present FROM mem_observations WHERE id = ?`,
  );

  const processSession = async (session: SessionRow): Promise<void> => {
    const key: SummaryJobKey = {
      sessionId: session.session_id,
      project: session.project,
      model,
    };
    try {
      resetFailed.run(nowIso(), key.sessionId, key.model);
      claimSummaryJob(db, key);
      if (!startSummaryJob(db, key)) return;

      const sources = sourceQuery.all(session.session_id, maxSources);
      if (sources.length === 0) {
        failSummaryJob(db, key, "no_compact_sources");
        recordFailure("no_compact_sources");
        return;
      }
      const blocked = sources.some((source) =>
        scanForEgress(source.content, parseArrayJson(source.privacy_tags_json)).blocked);
      if (blocked) {
        markBlocked.run("egress_scan_blocked", nowIso(), key.sessionId, key.model);
        result.blocked += 1;
        return;
      }

      // Only rows whose whole content fits in the prompt are linked as summarized; the
      // archive loop archives linked rows only, so truncated rows stay in the primary layer.
      const covered: SourceRow[] = [];
      let text = "";
      for (const source of sources) {
        const next = covered.length === 0 ? source.content : `${text}\n---\n${source.content}`;
        if (next.length > MAX_LOG_CHARS) {
          if (covered.length === 0) text = source.content.slice(0, MAX_LOG_CHARS);
          break;
        }
        text = next;
        covered.push(source);
      }
      const facts = config.clairicEnabled === false ? EMPTY_FACTS : await clairic.extract(text);
      // Scan everything the summary model will receive, including model-generated facts.
      // Fact values are scanned raw: JSON escaping would hide quoted assignments from the scanner.
      const factText = Object.values(facts).flat().filter((v): v is string => typeof v === "string").join("\n");
      const promptScan = scanForEgress([text, factText, session.project, session.session_id].join("\n"), []);
      if (promptScan.blocked) {
        markBlocked.run(`prompt_scan:${promptScan.reasons.join(",")}`, nowIso(), key.sessionId, key.model);
        result.blocked += 1;
        return;
      }
      const generated = await summary.summarize({
        project: session.project,
        sessionId: session.session_id,
        text,
        facts,
      });
      if (!generated.ok) {
        if (generated.reason === "empty") {
          markBlocked.run("empty_summary", nowIso(), key.sessionId, key.model);
          result.blocked += 1;
        } else {
          failSummaryJob(db, key, generated.reason);
          recordFailure(/^[a-z0-9_]+$/.test(generated.reason) ? generated.reason : "summary_generation_failed");
        }
        return;
      }
      const outputScan = scanForEgress(generated.summary, []);
      if (outputScan.blocked) {
        markBlocked.run(`summary_scan:${outputScan.reasons.join(",")}`, nowIso(), key.sessionId, key.model);
        result.blocked += 1;
        return;
      }

      const summaryId = summaryIdFor(session.session_id, model);
      // Content, coverage links and completion commit together. A summary row left by an
      // earlier partial run is rewritten and its links replaced, so links never point at
      // rows the stored content does not describe.
      db.transaction(() => {
        if (summaryExists.get(summaryId)) {
          db.query("UPDATE mem_observations SET content = ?, content_redacted = ?, updated_at = ? WHERE id = ?")
            .run(generated.summary, generated.summary, nowIso(), summaryId);
          db.query("DELETE FROM mem_links WHERE from_observation_id = ? AND relation = 'summarizes'").run(summaryId);
        } else {
          insertSummaryObservation(db, {
            id: summaryId,
            project: session.project,
            sessionId: session.session_id,
            title: `要約: ${session.session_id}`,
            content: generated.summary,
            tags: [
              "summary",
              `session:${session.session_id}`,
              ...(facts.version ? [`version:${facts.version}`] : []),
            ],
          });
        }
        linkSummaryToSources(db, summaryId, covered.map((source) => source.id), nowIso());
        completeSummaryJob(db, key, summaryId);
      })();
      result.summarized += 1;
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      const reason = typeof code === "string" && /^SQLITE_[A-Z_]+$/.test(code) ? code : "summary_storage_error";
      try {
        failSummaryJob(db, key, reason);
      } catch {
        // best effort
      }
      recordFailure(reason);
    }
  
  };

  const concurrency = clampLimit(config.summaryConcurrency, 2, 1, 6);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= sessions.length) return;
      await processSession(sessions[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, sessions.length) }, worker));

  return result;
}
