/**
 * session-manager.ts
 *
 * セッション管理モジュール。
 * HarnessMemCore から分割されたセッション管理責務を担う。
 *
 * 担当 API:
 *   - sessionsList
 *   - sessionThread
 *   - recordCheckpoint
 *   - finalizeSession
 *   - resolveSessionChain
 */

import type { Database } from "bun:sqlite";
import { basename } from "node:path";
import type {
  ApiResponse,
  Config,
  EventEnvelope,
  FinalizeSessionRequest,
  RecordCheckpointRequest,
  SessionsListRequest,
  SessionThreadRequest,
  StreamEvent,
} from "./harness-mem-core";

// ---------------------------------------------------------------------------
// CoreDependencies: HarnessMemCore から渡される内部依存
// ---------------------------------------------------------------------------

export interface SessionManagerDeps {
  db: Database;
  config: Config;
  /** normalizeProjectInput のバインド済みバージョン */
  normalizeProject: (project: string) => string;
  /** visibilityFilterSql のバインド済みバージョン */
  visibilityFilterSql: (alias: string, includePrivate: boolean) => string;
  /** platformVisibilityFilterSql のバインド済みバージョン */
  platformVisibilityFilterSql: (alias: string) => string;
  /** recordEvent への参照（recordCheckpoint が内部で使用） */
  recordEvent: (event: EventEnvelope) => ApiResponse;
  /** appendStreamEvent への参照 */
  appendStreamEvent: (type: StreamEvent["type"], data: Record<string, unknown>) => StreamEvent;
  /** enqueueConsolidation への参照 */
  enqueueConsolidation: (project: string, sessionId: string, reason: string) => void;
}

// ---------------------------------------------------------------------------
// ユーティリティ（このモジュール内でのみ使用）
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function clampLimit(input: unknown, fallback: number, min = 1, max = 200): number {
  const n = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function parseArrayJson(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function makeResponse(
  startedAt: number,
  items: unknown[],
  filters: Record<string, unknown>,
  extra: Record<string, unknown> = {}
): ApiResponse {
  const latency = performance.now() - startedAt;
  return {
    ok: true,
    source: "core",
    items,
    meta: {
      count: items.length,
      latency_ms: Math.round(latency * 100) / 100,
      sla_latency_ms: 200,
      filters,
      ranking: "default",
      ...extra,
    },
  };
}

function makeErrorResponse(
  startedAt: number,
  message: string,
  filters: Record<string, unknown>
): ApiResponse {
  const latency = performance.now() - startedAt;
  return {
    ok: false,
    source: "core",
    items: [],
    meta: {
      count: 0,
      latency_ms: Math.round(latency * 100) / 100,
      sla_latency_ms: 200,
      filters,
      ranking: "error",
    },
    error: message,
  };
}

// ---------------------------------------------------------------------------
// SessionManager クラス
// ---------------------------------------------------------------------------

export class SessionManager {
  constructor(private readonly deps: SessionManagerDeps) {}

  sessionsList(request: SessionsListRequest): ApiResponse {
    const startedAt = performance.now();
    const limit = clampLimit(request.limit, 50, 1, 200);
    const includePrivate = Boolean(request.include_private);
    const normalizedProject = request.project
      ? this.deps.normalizeProject(request.project)
      : undefined;

    const params: unknown[] = [];
    let sql = `
      SELECT
        s.session_id,
        s.platform,
        s.project,
        s.started_at,
        s.ended_at,
        s.summary,
        s.summary_mode,
        s.updated_at,
        MAX(o.created_at) AS last_event_at,
        COUNT(o.id) AS observation_count,
        SUM(CASE WHEN e.event_type = 'user_prompt' THEN 1 ELSE 0 END) AS prompt_count,
        SUM(CASE WHEN e.event_type = 'tool_use' THEN 1 ELSE 0 END) AS tool_count,
        SUM(CASE WHEN e.event_type = 'checkpoint' THEN 1 ELSE 0 END) AS checkpoint_count,
        SUM(CASE WHEN e.event_type = 'session_end' THEN 1 ELSE 0 END) AS summary_count
      FROM mem_sessions s
      LEFT JOIN mem_observations o
        ON o.session_id = s.session_id
        ${this.deps.visibilityFilterSql("o", includePrivate)}
      LEFT JOIN mem_events e ON e.event_id = o.event_id
      WHERE 1 = 1
    `;

    if (normalizedProject) {
      sql += " AND s.project = ?";
      params.push(normalizedProject);
    }
    sql += this.deps.platformVisibilityFilterSql("s");

    sql += `
      GROUP BY
        s.session_id, s.platform, s.project, s.started_at,
        s.ended_at, s.summary, s.summary_mode, s.updated_at
      ORDER BY COALESCE(MAX(o.created_at), s.updated_at) DESC
      LIMIT ?
    `;
    params.push(limit);

    const rows = this.deps.db.query(sql).all(...(params as any[])) as Array<Record<string, unknown>>;
    const items = rows.map((row) => ({
      session_id: row.session_id,
      platform: row.platform,
      project: row.project,
      started_at: row.started_at,
      ended_at: row.ended_at,
      updated_at: row.updated_at,
      last_event_at: row.last_event_at,
      summary: row.summary,
      summary_mode: row.summary_mode,
      counts: {
        observations: Number(row.observation_count || 0),
        prompts: Number(row.prompt_count || 0),
        tools: Number(row.tool_count || 0),
        checkpoints: Number(row.checkpoint_count || 0),
        summaries: Number(row.summary_count || 0),
      },
    }));

    return makeResponse(startedAt, items, request as unknown as Record<string, unknown>, {
      ranking: "sessions_list_v1",
    });
  }

  sessionThread(request: SessionThreadRequest): ApiResponse {
    const startedAt = performance.now();
    if (!request.session_id) {
      return makeErrorResponse(startedAt, "session_id is required", {});
    }

    const includePrivate = Boolean(request.include_private);
    const limit = clampLimit(request.limit, 200, 1, 1000);
    const normalizedProject = request.project
      ? this.deps.normalizeProject(request.project)
      : undefined;
    const params: unknown[] = [request.session_id];
    let sql = `
      SELECT
        o.id,
        o.event_id,
        o.platform,
        o.project,
        o.session_id,
        o.title,
        o.content_redacted,
        o.tags_json,
        o.privacy_tags_json,
        o.created_at,
        e.event_type
      FROM mem_observations o
      LEFT JOIN mem_events e ON e.event_id = o.event_id
      WHERE o.session_id = ?
    `;

    if (normalizedProject) {
      sql += " AND o.project = ?";
      params.push(normalizedProject);
    }

    sql += this.deps.platformVisibilityFilterSql("o");
    sql += this.deps.visibilityFilterSql("o", includePrivate);
    sql += " ORDER BY o.created_at ASC, o.id ASC LIMIT ?";
    params.push(limit);

    const rows = this.deps.db.query(sql).all(...(params as any[])) as Array<Record<string, unknown>>;
    const items = rows.map((row, index) => ({
      step: index + 1,
      id: row.id,
      event_id: row.event_id,
      event_type: row.event_type || "unknown",
      platform: row.platform,
      project: row.project,
      session_id: row.session_id,
      title: row.title,
      content: typeof row.content_redacted === "string" ? row.content_redacted.slice(0, 2000) : "",
      created_at: row.created_at,
      tags: parseArrayJson(row.tags_json),
      privacy_tags: parseArrayJson(row.privacy_tags_json),
    }));

    return makeResponse(
      startedAt,
      items,
      {
        session_id: request.session_id,
        project: normalizedProject,
        include_private: includePrivate,
      },
      { ranking: "session_thread_v1" }
    );
  }

  recordCheckpoint(request: RecordCheckpointRequest): ApiResponse {
    const event: EventEnvelope = {
      platform: request.platform || "claude",
      project: request.project || basename(process.cwd()),
      session_id: request.session_id,
      event_type: "checkpoint",
      ts: nowIso(),
      payload: {
        title: request.title,
        content: request.content,
      },
      tags: request.tags || [],
      privacy_tags: request.privacy_tags || [],
    };

    return this.deps.recordEvent(event);
  }

  finalizeSession(request: FinalizeSessionRequest): ApiResponse {
    const startedAt = performance.now();

    if (!request.session_id) {
      return makeErrorResponse(
        startedAt,
        "session_id is required",
        request as unknown as Record<string, unknown>
      );
    }

    const summaryMode = request.summary_mode || "standard";
    const rows = this.deps.db
      .query(
        `
          SELECT title, content_redacted, created_at
          FROM mem_observations
          WHERE session_id = ?
          ORDER BY created_at DESC
          LIMIT 12
        `
      )
      .all(request.session_id) as Array<{
      title: string;
      content_redacted: string;
      created_at: string;
    }>;

    const lines: string[] = [];
    for (const row of rows.reverse()) {
      const title = row.title || "untitled";
      const snippet = (row.content_redacted || "").replace(/\s+/g, " ").trim().slice(0, 100);
      lines.push(`- ${title}: ${snippet}`);
    }

    const summary =
      lines.length > 0
        ? `Session ${request.session_id} summary (${summaryMode})\n${lines.join("\n")}`
        : `Session ${request.session_id} summary (${summaryMode})\n- no observations`;

    const current = nowIso();
    this.deps.db
      .query(
        `
          UPDATE mem_sessions
          SET ended_at = ?, summary = ?, summary_mode = ?, updated_at = ?
          WHERE session_id = ?
        `
      )
      .run(current, summary, summaryMode, current, request.session_id);

    this.deps.recordEvent({
      platform: request.platform || "claude",
      project: request.project || basename(process.cwd()),
      session_id: request.session_id,
      event_type: "session_end",
      ts: current,
      payload: {
        summary,
        summary_mode: summaryMode,
      },
      tags: ["finalized"],
      privacy_tags: [],
    });

    this.deps.appendStreamEvent("session.finalized", {
      session_id: request.session_id,
      project: request.project || basename(process.cwd()),
      summary_mode: summaryMode,
      finalized_at: current,
    });
    this.deps.enqueueConsolidation(
      request.project || basename(process.cwd()),
      request.session_id,
      "finalize"
    );

    return makeResponse(
      startedAt,
      [
        {
          session_id: request.session_id,
          summary_mode: summaryMode,
          summary,
          finalized_at: current,
        },
      ],
      request as unknown as Record<string, unknown>
    );
  }

  resolveSessionChain(correlationId: string, project: string): ApiResponse {
    const startedAt = performance.now();

    if (!correlationId || !project) {
      return makeErrorResponse(startedAt, "correlation_id and project are required", {
        correlation_id: correlationId,
        project,
      });
    }

    const normalizedProject = this.deps.normalizeProject(project);
    const sessions = this.deps.db
      .query(
        `
          SELECT session_id, platform, project, started_at, ended_at, correlation_id
          FROM mem_sessions
          WHERE correlation_id = ? AND project = ?
          ORDER BY started_at ASC
        `
      )
      .all(correlationId, normalizedProject) as Array<{
      session_id: string;
      platform: string;
      project: string;
      started_at: string;
      ended_at: string | null;
      correlation_id: string;
    }>;

    const items = sessions.map((s) => ({
      session_id: s.session_id,
      platform: s.platform,
      project: s.project,
      started_at: s.started_at,
      ended_at: s.ended_at,
      correlation_id: s.correlation_id,
    }));

    return makeResponse(
      startedAt,
      items,
      { correlation_id: correlationId, project: normalizedProject },
      { chain_length: items.length }
    );
  }
}
