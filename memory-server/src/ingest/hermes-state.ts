import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { Database } from "bun:sqlite";
import type { ApiResponse, EventEnvelope } from "../core/types.js";

export interface HermesStateIngestRequest {
  source_db_path: string;
  project?: string;
  dry_run?: boolean;
  limit?: number;
  since?: string | number;
  after_message_id?: number;
  max_content_chars?: number;
  include_tool_content?: boolean;
}

export interface HermesStateSessionRow {
  id: string;
  source: string | null;
  user_id: string | null;
  model: string | null;
  title: string | null;
  started_at: number | null;
  ended_at: number | null;
  end_reason: string | null;
  message_count: number | null;
  tool_call_count: number | null;
}

export interface HermesStateMessageRow {
  id: number;
  session_id: string;
  role: string;
  content: string | null;
  tool_call_id: string | null;
  tool_calls: string | null;
  tool_name: string | null;
  timestamp: number | null;
  token_count: number | null;
  finish_reason: string | null;
  session_source: string | null;
  session_title: string | null;
  session_model: string | null;
  session_user_id: string | null;
}

export interface HermesStateBackfillEvent {
  event: EventEnvelope;
  source_kind: "session_start" | "session_end" | "message";
  source_id: string;
}

export interface HermesStateBackfillStats {
  source_db_path: string;
  project: string;
  dry_run: boolean;
  sessions_seen: number;
  messages_seen: number;
  messages_total: number;
  events_planned: number;
  events_recorded: number;
  events_deduped: number;
  events_failed: number;
  limit: number | null;
  since: string | null;
  after_message_id: number | null;
  last_message_id: number | null;
  failed_samples?: Array<{ source_id: string; event_id: string; error: string }>;
}

export interface HermesStateBackfillResult {
  stats: HermesStateBackfillStats;
  events?: HermesStateBackfillEvent[];
}

interface RecordEventResult {
  ok: boolean;
  meta?: Record<string, unknown>;
  error?: string;
}

interface BuildEventOptions {
  project: string;
  sourceKey: string;
  maxContentChars: number;
  includeToolContent: boolean;
}

export function buildHermesStateBackfillEvents(params: {
  sessions: HermesStateSessionRow[];
  messages: HermesStateMessageRow[];
  project: string;
  sourceDbPath?: string;
  maxContentChars?: number;
  includeToolContent?: boolean;
}): HermesStateBackfillEvent[] {
  const project = normalizeProject(params.project);
  const sourceKey = buildSourceKey(params.sourceDbPath || "inline");
  const maxContentChars = normalizeMaxContentChars(params.maxContentChars);
  const includeToolContent = params.includeToolContent === true;
  const events: HermesStateBackfillEvent[] = [];

  for (const session of params.sessions) {
    const startEvent = buildSessionEvent(session, "session_start", { project, sourceKey, maxContentChars, includeToolContent });
    if (startEvent) {
      events.push(startEvent);
    }
  }

  for (const message of params.messages) {
    const messageEvent = buildMessageEvent(message, { project, sourceKey, maxContentChars, includeToolContent });
    if (messageEvent) {
      events.push(messageEvent);
    }
  }

  for (const session of params.sessions) {
    const endEvent = buildSessionEvent(session, "session_end", { project, sourceKey, maxContentChars, includeToolContent });
    if (endEvent) {
      events.push(endEvent);
    }
  }

  return events;
}

export function readHermesStateBackfillPlan(request: HermesStateIngestRequest): HermesStateBackfillResult {
  const sourceDbPath = normalizeSourceDbPath(request.source_db_path);
  const project = normalizeProject(request.project);
  const sinceSeconds = parseSinceSeconds(request.since);
  const limit = normalizeLimit(request.limit);
  const afterMessageId = normalizeAfterMessageId(request.after_message_id);
  const maxContentChars = normalizeMaxContentChars(request.max_content_chars);
  const includeToolContent = request.include_tool_content === true;

  let db: Database | null = null;
  try {
    db = new Database(sourceDbPath, { readonly: true, create: false });
    db.exec("PRAGMA busy_timeout = 5000;");
    assertHermesStateSchema(db);

    const messagesTotal = countMessages(db, sinceSeconds);
    const messages = loadMessages(db, { sinceSeconds, afterMessageId, limit });
    const sessionIds = uniqueStrings(messages.map((message) => message.session_id));
    const includeAllSessions = (limit === null && sinceSeconds === null) || afterMessageId === 0;
    const sessions = includeAllSessions
      ? loadSessions(db, { sinceSeconds, limit: null })
      : sessionIds.length > 0
      ? loadSessionsById(db, sessionIds)
      : loadSessions(db, { sinceSeconds, limit });
    const events = buildHermesStateBackfillEvents({
      sessions,
      messages,
      project,
      sourceDbPath,
      maxContentChars,
      includeToolContent,
    });

    return {
      stats: {
        source_db_path: sourceDbPath,
        project,
        dry_run: request.dry_run !== false,
        sessions_seen: sessions.length,
        messages_seen: messages.length,
        messages_total: messagesTotal,
        events_planned: events.length,
        events_recorded: 0,
        events_deduped: 0,
        events_failed: 0,
        limit,
        since: normalizeSinceForStats(request.since),
        after_message_id: afterMessageId,
        last_message_id: messages.length > 0 ? Math.max(...messages.map((message) => message.id)) : null,
      },
      events,
    };
  } finally {
    if (db) {
      db.close(false);
    }
  }
}

export function ingestHermesStateDb(params: {
  request: HermesStateIngestRequest;
  recordEvent: (event: EventEnvelope, options?: { allowQueue: boolean }) => ApiResponse | RecordEventResult;
}): HermesStateBackfillStats {
  const plan = readHermesStateBackfillPlan(params.request);
  const stats = { ...plan.stats, dry_run: params.request.dry_run !== false };
  if (stats.dry_run) {
    return stats;
  }

  const failedSamples: Array<{ source_id: string; event_id: string; error: string }> = [];
  for (const entry of plan.events ?? []) {
    const result = recordEventWithRetry(() => params.recordEvent(entry.event, { allowQueue: false }) as RecordEventResult);
    const deduped = Boolean((result.meta as Record<string, unknown> | undefined)?.deduped);
    if (result.ok && deduped) {
      stats.events_deduped += 1;
    } else if (result.ok) {
      stats.events_recorded += 1;
    } else {
      stats.events_failed += 1;
      if (failedSamples.length < 5) {
        failedSamples.push({
          source_id: entry.source_id,
          event_id: entry.event.event_id || "",
          error: result.error || "recordEvent failed",
        });
      }
    }
  }
  if (failedSamples.length > 0) {
    stats.failed_samples = failedSamples;
  }

  return stats;
}

export async function ingestHermesStateDbQueued(params: {
  request: HermesStateIngestRequest;
  recordEvent: (event: EventEnvelope, options?: { allowQueue: boolean }) => Promise<RecordEventResult | "queue_full">;
}): Promise<HermesStateBackfillStats> {
  const plan = readHermesStateBackfillPlan(params.request);
  const stats = { ...plan.stats, dry_run: params.request.dry_run !== false };
  if (stats.dry_run) {
    return stats;
  }

  const failedSamples: Array<{ source_id: string; event_id: string; error: string }> = [];
  for (const entry of plan.events ?? []) {
    const result = await recordEventQueuedWithRetry(() => params.recordEvent(entry.event, { allowQueue: true }));
    const deduped = result !== "queue_full" && Boolean((result.meta as Record<string, unknown> | undefined)?.deduped);
    if (result !== "queue_full" && result.ok && deduped) {
      stats.events_deduped += 1;
    } else if (result !== "queue_full" && result.ok) {
      stats.events_recorded += 1;
    } else {
      stats.events_failed += 1;
      if (failedSamples.length < 5) {
        failedSamples.push({
          source_id: entry.source_id,
          event_id: entry.event.event_id || "",
          error: result === "queue_full" ? "write queue full" : result.error || "recordEvent failed",
        });
      }
    }
  }
  if (failedSamples.length > 0) {
    stats.failed_samples = failedSamples;
  }

  return stats;
}

function recordEventWithRetry(record: () => RecordEventResult): RecordEventResult {
  let last: RecordEventResult = { ok: false, error: "recordEvent failed" };
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      last = record();
      if (last.ok) {
        return last;
      }
    } catch (error) {
      last = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (attempt < 4 && isRetryableRecordFailure(last.error)) {
      sleepSync(150 * (attempt + 1));
    } else {
      break;
    }
  }
  return last;
}

function isRetryableRecordFailure(error: unknown): boolean {
  const message = normalizeString(error).toLowerCase();
  if (!message) {
    return true;
  }
  return message.includes("busy") || message.includes("locked") || message.includes("timeout");
}

function sleepSync(ms: number): void {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, ms);
}

async function recordEventQueuedWithRetry(
  record: () => Promise<RecordEventResult | "queue_full">
): Promise<RecordEventResult | "queue_full"> {
  let last: RecordEventResult | "queue_full" = { ok: false, error: "recordEvent failed" };
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      last = await record();
      if (last !== "queue_full" && last.ok) {
        return last;
      }
    } catch (error) {
      last = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    const error = last === "queue_full" ? "queue full" : last.error;
    if (attempt < 4 && (last === "queue_full" || isRetryableRecordFailure(error))) {
      await sleep(150 * (attempt + 1));
    } else {
      break;
    }
  }
  return last;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSessionEvent(
  session: HermesStateSessionRow,
  eventType: "session_start" | "session_end",
  options: BuildEventOptions,
): HermesStateBackfillEvent | null {
  const sessionId = normalizeString(session.id);
  if (!sessionId) {
    return null;
  }

  const isStart = eventType === "session_start";
  const tsSeconds = isStart ? session.started_at : session.ended_at;
  if (!isStart && !toFiniteNumber(tsSeconds)) {
    return null;
  }

  const title = normalizeString(session.title) || `Hermes session ${isStart ? "started" : "ended"}`;
  const source = normalizeString(session.source) || "unknown";
  const model = normalizeString(session.model) || "unknown";
  const content = clipText(
    [
      `Hermes session ${isStart ? "started" : "ended"}: ${title}`,
      `source=${source}`,
      `model=${model}`,
      `messages=${Math.max(0, Math.floor(Number(session.message_count || 0)))}`,
      `tools=${Math.max(0, Math.floor(Number(session.tool_call_count || 0)))}`,
      !isStart && normalizeString(session.end_reason) ? `end_reason=${normalizeString(session.end_reason)}` : "",
    ].filter(Boolean).join("\n"),
    options.maxContentChars,
  );

  const sourceId = `${options.sourceKey}:${eventType}:${sessionId}`;
  return {
    source_kind: eventType,
    source_id: sourceId,
    event: {
      event_id: stableEventId(options.project, sourceId),
      platform: "hermes",
      project: options.project,
      session_id: sessionId,
      event_type: eventType,
      ts: fromUnixSeconds(tsSeconds) || new Date(0).toISOString(),
      observed_at: fromUnixSeconds(tsSeconds) || null,
      event_time: fromUnixSeconds(tsSeconds) || null,
      payload: {
        source_type: "hermes_state_db",
        title,
        content,
        hermes_session_id: sessionId,
        hermes_source: source,
        model,
        message_count: Math.max(0, Math.floor(Number(session.message_count || 0))),
        tool_call_count: Math.max(0, Math.floor(Number(session.tool_call_count || 0))),
        end_reason: normalizeString(session.end_reason) || undefined,
        meta: {
          hermes_source: source,
          hermes_model: model,
          hermes_source_db_key: options.sourceKey,
          source_row: sourceId,
        },
      },
      metadata: {
        source_type: "hermes_state_db",
        hermes_session_id: sessionId,
        hermes_source_db_key: options.sourceKey,
      },
      tags: ["hermes", "hermes_state_db", "backfill"],
      privacy_tags: [],
      dedupe_hash: stableDedupeHash(options.project, sourceId),
      thread_id: sessionId,
      user_id: normalizeString(session.user_id) || undefined,
    },
  };
}

function buildMessageEvent(message: HermesStateMessageRow, options: BuildEventOptions): HermesStateBackfillEvent | null {
  const sessionId = normalizeString(message.session_id);
  const role = normalizeString(message.role).toLowerCase();
  if (!sessionId || !role) {
    return null;
  }

  const messageId = Math.max(0, Math.floor(Number(message.id || 0)));
  if (messageId <= 0) {
    return null;
  }

  const content = clipText(messageContent(message, role, options.includeToolContent), options.maxContentChars);
  const toolName = normalizeString(message.tool_name) || inferToolName(message.tool_calls) || inferToolName(message.content);
  const eventType = role === "user" ? "user_prompt" : role === "tool" ? "tool_use" : "checkpoint";
  const title = messageTitle(message, role, toolName);
  const sourceId = `${options.sourceKey}:message:${messageId}`;
  const ts = fromUnixSeconds(message.timestamp) || new Date(0).toISOString();
  const payload: Record<string, unknown> = {
    source_type: "hermes_state_db",
    role,
    title,
    content,
    hermes_message_id: messageId,
      hermes_session_id: sessionId,
      hermes_source_db_key: options.sourceKey,
      hermes_source: normalizeString(message.session_source) || "unknown",
    session_title: normalizeString(message.session_title) || undefined,
    model: normalizeString(message.session_model) || undefined,
    token_count: toFiniteNumber(message.token_count) ?? undefined,
    finish_reason: normalizeString(message.finish_reason) || undefined,
    tool_call_id: normalizeString(message.tool_call_id) || undefined,
    tool_name: toolName || undefined,
    meta: {
      hermes_message_id: messageId,
      hermes_session_id: sessionId,
      hermes_source_db_key: options.sourceKey,
      source_row: sourceId,
      tool_calls_present: Boolean(normalizeString(message.tool_calls)),
    },
  };
  if (eventType === "user_prompt") {
    payload.prompt = content || "(empty user message)";
  }
  if (eventType === "tool_use") {
    payload.command = toolName || content || "Hermes tool result";
  }

  return {
    source_kind: "message",
    source_id: sourceId,
    event: {
      event_id: stableEventId(options.project, sourceId),
      platform: "hermes",
      project: options.project,
      session_id: sessionId,
      event_type: eventType,
      ts,
      observed_at: ts,
      event_time: ts,
      payload,
      metadata: {
        source_type: "hermes_state_db",
        hermes_message_id: messageId,
        hermes_session_id: sessionId,
        hermes_source_db_key: options.sourceKey,
      },
      tags: ["hermes", "hermes_state_db", "backfill", `role:${role}`],
      privacy_tags: [],
      dedupe_hash: stableDedupeHash(options.project, sourceId),
      thread_id: sessionId,
      user_id: normalizeString(message.session_user_id) || undefined,
    },
  };
}

function loadMessages(db: Database, params: {
  sinceSeconds: number | null;
  afterMessageId: number | null;
  limit: number | null;
}): HermesStateMessageRow[] {
  const conditions: string[] = [];
  const bindings: number[] = [];
  if (params.sinceSeconds !== null) {
    conditions.push("m.timestamp >= ?");
    bindings.push(params.sinceSeconds);
  }
  if (params.afterMessageId !== null) {
    conditions.push("m.id > ?");
    bindings.push(params.afterMessageId);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = params.limit !== null ? "LIMIT ?" : "";
  if (params.limit !== null) {
    bindings.push(params.limit);
  }
  return db
    .query(`
      SELECT
        m.id AS id,
        m.session_id AS session_id,
        m.role AS role,
        m.content AS content,
        m.tool_call_id AS tool_call_id,
        m.tool_calls AS tool_calls,
        m.tool_name AS tool_name,
        m.timestamp AS timestamp,
        m.token_count AS token_count,
        m.finish_reason AS finish_reason,
        s.source AS session_source,
        s.title AS session_title,
        s.model AS session_model,
        s.user_id AS session_user_id
      FROM messages m
      LEFT JOIN sessions s ON s.id = m.session_id
      ${where}
      ORDER BY m.id ASC
      ${limit}
    `)
    .all(...bindings) as HermesStateMessageRow[];
}

function loadSessionsById(db: Database, sessionIds: string[]): HermesStateSessionRow[] {
  if (sessionIds.length === 0) {
    return [];
  }
  const placeholders = sessionIds.map(() => "?").join(", ");
  return db
    .query(`
      SELECT
        id, source, user_id, model, title, started_at, ended_at,
        end_reason, message_count, tool_call_count
      FROM sessions
      WHERE id IN (${placeholders})
      ORDER BY started_at ASC, id ASC
    `)
    .all(...sessionIds) as HermesStateSessionRow[];
}

function loadSessions(db: Database, params: { sinceSeconds: number | null; limit: number | null }): HermesStateSessionRow[] {
  const where = params.sinceSeconds !== null ? "WHERE started_at >= ? OR ended_at >= ?" : "";
  const limit = params.limit !== null ? "LIMIT ?" : "";
  const bindings = params.sinceSeconds !== null
    ? params.limit !== null ? [params.sinceSeconds, params.sinceSeconds, params.limit] : [params.sinceSeconds, params.sinceSeconds]
    : params.limit !== null ? [params.limit] : [];
  return db
    .query(`
      SELECT
        id, source, user_id, model, title, started_at, ended_at,
        end_reason, message_count, tool_call_count
      FROM sessions
      ${where}
      ORDER BY started_at ASC, id ASC
      ${limit}
    `)
    .all(...bindings) as HermesStateSessionRow[];
}

function countMessages(db: Database, sinceSeconds: number | null): number {
  const row = sinceSeconds !== null
    ? db.query(`SELECT COUNT(*) AS count FROM messages WHERE timestamp >= ?`).get(sinceSeconds)
    : db.query(`SELECT COUNT(*) AS count FROM messages`).get();
  return Math.max(0, Math.floor(Number((row as { count?: number } | null)?.count || 0)));
}

function assertHermesStateSchema(db: Database): void {
  const tables = db
    .query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('sessions', 'messages')`)
    .all() as Array<{ name?: string }>;
  const names = new Set(tables.map((row) => normalizeString(row.name)));
  if (!names.has("sessions") || !names.has("messages")) {
    throw new Error("source_db_path is not a Hermes state.db: sessions/messages tables are required");
  }
}

function normalizeSourceDbPath(input: string): string {
  const trimmed = normalizeString(input);
  if (!trimmed) {
    throw new Error("source_db_path is required");
  }
  const expanded = trimmed.startsWith("~/") ? `${process.env.HOME || ""}/${trimmed.slice(2)}` : trimmed;
  if (expanded.includes("\0")) {
    throw new Error("source_db_path contains invalid characters");
  }
  if (!existsSync(expanded)) {
    throw new Error(`source_db_path not found: ${expanded}`);
  }
  return realpathSync(expanded);
}

function normalizeProject(project: unknown): string {
  const normalized = normalizeString(project);
  return normalized || "default";
}

function normalizeLimit(limit: unknown): number | null {
  if (limit === undefined || limit === null || limit === "") {
    return null;
  }
  const parsed = Number(limit);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.min(Math.floor(parsed), 100_000);
}

function normalizeAfterMessageId(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.floor(parsed);
}

function normalizeSinceForStats(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? String(value) : null;
  }
  return normalizeString(value) || null;
}

function normalizeMaxContentChars(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 16_000;
  }
  return Math.min(Math.max(Math.floor(parsed), 1_000), 100_000);
}

function parseSinceSeconds(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) {
      return null;
    }
    return value > 10_000_000_000 ? value / 1000 : value;
  }
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }
  const numeric = Number(normalized);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 10_000_000_000 ? numeric / 1000 : numeric;
  }
  const parsedMs = Date.parse(normalized);
  if (!Number.isFinite(parsedMs)) {
    throw new Error("since must be an ISO timestamp or Unix timestamp");
  }
  return parsedMs / 1000;
}

function messageContent(message: HermesStateMessageRow, role: string, includeToolContent: boolean): string {
  const content = normalizeString(message.content);
  const toolCalls = normalizeString(message.tool_calls);
  if (role === "tool" && !includeToolContent) {
    const toolName = normalizeString(message.tool_name) || inferToolName(message.tool_calls) || inferToolName(message.content);
    const chars = content.length;
    return [
      `Hermes tool result${toolName ? `: ${toolName}` : ""}`,
      `result_present=${content ? "true" : "false"}`,
      `result_chars=${chars}`,
      "tool result body omitted by default; rerun with include_tool_content=true to import it",
    ].join("\n");
  }
  if (role === "assistant" && toolCalls && !content && !includeToolContent) {
    return [
      "Hermes assistant tool calls",
      "tool_calls_present=true",
      `tool_calls_chars=${toolCalls.length}`,
      "tool call arguments omitted by default; rerun with include_tool_content=true to import them",
    ].join("\n");
  }
  if (content) {
    return content;
  }
  if (toolCalls) {
    return toolCalls;
  }
  if (role === "assistant") {
    return "(empty assistant message)";
  }
  if (role === "tool") {
    return "(empty tool result)";
  }
  return "(empty message)";
}

function messageTitle(message: HermesStateMessageRow, role: string, toolName: string): string {
  if (role === "user") {
    return clipText(normalizeString(message.content) || "Hermes user message", 120);
  }
  if (role === "tool") {
    return toolName ? `Hermes tool: ${toolName}` : "Hermes tool result";
  }
  if (role === "assistant") {
    return "Hermes assistant response";
  }
  return `Hermes ${role} message`;
}

function inferToolName(raw: unknown): string {
  const text = normalizeString(raw);
  if (!text) {
    return "";
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      return normalizeString(record.name) || normalizeString(record.tool_name);
    }
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (typeof item === "object" && item !== null) {
          const record = item as Record<string, unknown>;
          const direct = normalizeString(record.name) || normalizeString(record.tool_name);
          if (direct) {
            return direct;
          }
          const functionCall = record.function;
          if (typeof functionCall === "object" && functionCall !== null) {
            const name = normalizeString((functionCall as Record<string, unknown>).name);
            if (name) {
              return name;
            }
          }
        }
      }
    }
  } catch {
    // best effort
  }
  return "";
}

function buildSourceKey(sourceDbPath: string): string {
  return hash(`hermes_state_db_source:${sourceDbPath}`).slice(0, 16);
}

function stableEventId(project: string, sourceId: string): string {
  return `hermes_state_${hash(`${project}:${sourceId}`).slice(0, 32)}`;
}

function stableDedupeHash(project: string, sourceId: string): string {
  return hash(`hermes_state_db:${project}:${sourceId}`);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function clipText(value: string, maxChars: number): string {
  const normalized = normalizeString(value);
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 24))}\n[truncated by harness-mem]`;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeString).filter(Boolean)));
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fromUnixSeconds(value: unknown): string {
  const seconds = toFiniteNumber(value);
  if (seconds === null || seconds <= 0) {
    return "";
  }
  return new Date(seconds * 1000).toISOString();
}
