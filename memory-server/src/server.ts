import {
  type FeedRequest,
  HarnessMemCore,
  type ImportJobStatusRequest,
  type ApiResponse,
  type Config,
  type ConsolidationRunRequest,
  type EventEnvelope,
  type FinalizeSessionRequest,
  type GetObservationsRequest,
  type AuditLogRequest,
  type RecordCheckpointRequest,
  type ResumePackRequest,
  type SearchFacetsRequest,
  type SearchRequest,
  type SessionThreadRequest,
  type SessionsListRequest,
  type StreamEvent,
  type TimelineRequest,
  type VerifyImportRequest,
} from "./core/harness-mem-core";

function jsonResponse(body: ApiResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function badRequest(message: string): Response {
  const response: ApiResponse = {
    ok: false,
    source: "core",
    items: [],
    meta: {
      count: 0,
      latency_ms: 0,
      sla_latency_ms: 0,
      filters: {},
      ranking: "hybrid_v3",
    },
    error: message,
  };
  return jsonResponse(response, 400);
}

function unauthorized(message: string): Response {
  const response: ApiResponse = {
    ok: false,
    source: "core",
    items: [],
    meta: {
      count: 0,
      latency_ms: 0,
      sla_latency_ms: 0,
      filters: {},
      ranking: "hybrid_v3",
    },
    error: message,
  };
  return jsonResponse(response, 401);
}

function requiresAdminToken(method: string, pathname: string): boolean {
  if (pathname.startsWith("/v1/admin/")) {
    return true;
  }
  if (method !== "POST") {
    return false;
  }
  return [
    "/v1/events/record",
    "/v1/checkpoints/record",
    "/v1/sessions/finalize",
    "/v1/ingest/codex-history",
    "/v1/ingest/codex-sessions",
    "/v1/ingest/opencode-history",
    "/v1/ingest/opencode-sessions",
    "/v1/ingest/cursor-history",
    "/v1/ingest/cursor-events",
    "/v1/ingest/antigravity-history",
    "/v1/ingest/antigravity-files",
  ].includes(pathname);
}

function hasValidAdminToken(request: Request): boolean {
  const configured = (process.env.HARNESS_MEM_ADMIN_TOKEN || "").trim();
  if (!configured) {
    return true;
  }
  const rawAuth = request.headers.get("authorization");
  const bearer = rawAuth?.startsWith("Bearer ") ? rawAuth.slice(7).trim() : "";
  const provided = request.headers.get("x-harness-mem-token") || bearer || "";
  return provided === configured;
}

async function parseRequestJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (typeof body === "object" && body !== null) {
      return body as Record<string, unknown>;
    }
  } catch {
    // ignored
  }
  return {};
}

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }
  return {};
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((id): id is string => typeof id === "string");
}

function parseBoolean(value: string | null, fallback = false): boolean {
  if (value === null) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseBooleanLike(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return parseBoolean(value, fallback);
  }
  return fallback;
}

function parseIntegerLike(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) {
      return undefined;
    }
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return undefined;
}

function parseInteger(value: string | null, fallback: number): number {
  if (value === null || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.trunc(parsed);
}

function toSseChunk(event: string, data: Record<string, unknown>, id?: number): Uint8Array {
  const lines: string[] = [];
  if (typeof id === "number" && Number.isFinite(id)) {
    lines.push(`id: ${id}`);
  }
  lines.push(`event: ${event}`);
  lines.push(`data: ${JSON.stringify(data)}`);
  lines.push("");
  return new TextEncoder().encode(`${lines.join("\n")}\n`);
}

export function startHarnessMemServer(core: HarnessMemCore, config: Config) {
  return Bun.serve({
    hostname: config.bindHost,
    port: config.bindPort,
    fetch: async (request: Request): Promise<Response> => {
      const url = new URL(request.url);

      if (requiresAdminToken(request.method, url.pathname) && !hasValidAdminToken(request)) {
        return unauthorized("missing or invalid admin token");
      }

      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse(core.health());
      }

      if (request.method === "GET" && url.pathname === "/v1/admin/metrics") {
        return jsonResponse(core.metrics());
      }

      if (request.method === "GET" && url.pathname === "/v1/admin/environment") {
        return jsonResponse(core.environmentSnapshot());
      }

      if (request.method === "GET" && url.pathname === "/v1/admin/shadow-metrics") {
        const status = core.getManagedStatus();
        if (!status) {
          return jsonResponse({
            ok: true,
            source: "core",
            items: [{ backend_mode: "local", managed_backend: null }],
            meta: { count: 1, latency_ms: 0, sla_latency_ms: 0, filters: {}, ranking: "shadow_v1" },
          });
        }
        return jsonResponse({
          ok: true,
          source: "core",
          items: [status],
          meta: { count: 1, latency_ms: 0, sla_latency_ms: 0, filters: {}, ranking: "shadow_v1" },
        });
      }

      if (request.method === "POST" && url.pathname === "/v1/admin/consolidation/run") {
        const body = await parseRequestJson(request);
        const req: ConsolidationRunRequest = {
          reason: typeof body.reason === "string" ? body.reason : undefined,
          project: typeof body.project === "string" ? body.project : undefined,
          session_id: typeof body.session_id === "string" ? body.session_id : undefined,
          limit: parseIntegerLike(body.limit),
        };
        return jsonResponse(core.runConsolidation(req));
      }

      if (request.method === "GET" && url.pathname === "/v1/admin/consolidation/status") {
        return jsonResponse(core.getConsolidationStatus());
      }

      if (request.method === "GET" && url.pathname === "/v1/admin/audit-log") {
        const req: AuditLogRequest = {
          limit: parseInteger(url.searchParams.get("limit"), 50),
          action: url.searchParams.get("action") || undefined,
          target_type: url.searchParams.get("target_type") || undefined,
        };
        return jsonResponse(core.getAuditLog(req));
      }

      if (request.method === "POST" && url.pathname === "/v1/admin/imports/claude-mem") {
        const body = await parseRequestJson(request);
        const sourceDbPath = typeof body.source_db_path === "string" ? body.source_db_path : "";
        if (!sourceDbPath) {
          return badRequest("source_db_path is required");
        }
        return jsonResponse(
          core.startClaudeMemImport({
            source_db_path: sourceDbPath,
            project: typeof body.project === "string" ? body.project : undefined,
            dry_run: Boolean(body.dry_run),
          })
        );
      }

      const importStatusMatch = request.method === "GET"
        ? url.pathname.match(/^\/v1\/admin\/imports\/([^/]+)$/)
        : null;
      if (importStatusMatch) {
        const req: ImportJobStatusRequest = {
          job_id: decodeURIComponent(importStatusMatch[1] || ""),
        };
        return jsonResponse(core.getImportJobStatus(req));
      }

      const importVerifyMatch = request.method === "POST"
        ? url.pathname.match(/^\/v1\/admin\/imports\/([^/]+)\/verify$/)
        : null;
      if (importVerifyMatch) {
        const req: VerifyImportRequest = {
          job_id: decodeURIComponent(importVerifyMatch[1] || ""),
        };
        return jsonResponse(core.verifyClaudeMemImport(req));
      }

      if (request.method === "POST" && url.pathname === "/v1/events/record") {
        const body = await parseRequestJson(request);
        const event = toRecord(body.event) as unknown as EventEnvelope;
        return jsonResponse(core.recordEvent(event));
      }

      if (request.method === "POST" && url.pathname === "/v1/search") {
        const body = await parseRequestJson(request);
        const query = typeof body.query === "string" ? body.query : "";
        if (!query) {
          return badRequest("query is required");
        }

        const questionKind = typeof body.question_kind === "string" ? body.question_kind : undefined;
        const validKinds = ["profile", "timeline", "graph", "vector", "hybrid"];
        const req: SearchRequest = {
          query,
          project: typeof body.project === "string" ? body.project : undefined,
          session_id: typeof body.session_id === "string" ? body.session_id : undefined,
          since: typeof body.since === "string" ? body.since : undefined,
          until: typeof body.until === "string" ? body.until : undefined,
          limit: parseIntegerLike(body.limit),
          include_private: parseBooleanLike(body.include_private, false),
          expand_links: parseBooleanLike(body.expand_links, true),
          strict_project: parseBooleanLike(body.strict_project, true),
          debug: parseBooleanLike(body.debug, false),
          question_kind: questionKind && validKinds.includes(questionKind)
            ? questionKind as SearchRequest["question_kind"]
            : undefined,
        };
        return jsonResponse(core.search(req));
      }

      if (request.method === "GET" && url.pathname === "/v1/feed") {
        const req: FeedRequest = {
          cursor: url.searchParams.get("cursor") || undefined,
          limit: parseInteger(url.searchParams.get("limit"), 40),
          project: url.searchParams.get("project") || undefined,
          type: url.searchParams.get("type") || undefined,
          include_private: parseBoolean(url.searchParams.get("include_private"), false),
        };
        return jsonResponse(core.feed(req));
      }

      if (request.method === "GET" && url.pathname === "/v1/sessions/list") {
        const req: SessionsListRequest = {
          project: url.searchParams.get("project") || undefined,
          limit: parseInteger(url.searchParams.get("limit"), 50),
          include_private: parseBoolean(url.searchParams.get("include_private"), false),
        };
        return jsonResponse(core.sessionsList(req));
      }

      if (request.method === "GET" && url.pathname === "/v1/sessions/thread") {
        const sessionId = url.searchParams.get("session_id") || "";
        if (!sessionId) {
          return badRequest("session_id is required");
        }
        const req: SessionThreadRequest = {
          session_id: sessionId,
          project: url.searchParams.get("project") || undefined,
          limit: parseInteger(url.searchParams.get("limit"), 200),
          include_private: parseBoolean(url.searchParams.get("include_private"), false),
        };
        return jsonResponse(core.sessionThread(req));
      }

      if (request.method === "GET" && url.pathname === "/v1/search/facets") {
        const req: SearchFacetsRequest = {
          query: url.searchParams.get("query") || undefined,
          project: url.searchParams.get("project") || undefined,
          include_private: parseBoolean(url.searchParams.get("include_private"), false),
        };
        return jsonResponse(core.searchFacets(req));
      }

      if (request.method === "POST" && url.pathname === "/v1/timeline") {
        const body = await parseRequestJson(request);
        if (typeof body.id !== "string" || body.id.trim() === "") {
          return badRequest("id is required");
        }

        const req: TimelineRequest = {
          id: body.id,
          before: typeof body.before === "number" ? body.before : undefined,
          after: typeof body.after === "number" ? body.after : undefined,
          include_private: Boolean(body.include_private),
        };
        return jsonResponse(core.timeline(req));
      }

      if (request.method === "POST" && url.pathname === "/v1/observations/get") {
        const body = await parseRequestJson(request);
        const req: GetObservationsRequest = {
          ids: toStringArray(body.ids),
          include_private: Boolean(body.include_private),
          compact: body.compact !== false,
        };
        return jsonResponse(core.getObservations(req));
      }

      if (request.method === "POST" && url.pathname === "/v1/checkpoints/record") {
        const body = await parseRequestJson(request);
        const sessionId = typeof body.session_id === "string" ? body.session_id : "";
        const title = typeof body.title === "string" ? body.title : "";
        const content = typeof body.content === "string" ? body.content : "";

        if (!sessionId || !title || !content) {
          return badRequest("session_id, title, content are required");
        }

        const req: RecordCheckpointRequest = {
          platform: typeof body.platform === "string" ? body.platform : undefined,
          project: typeof body.project === "string" ? body.project : undefined,
          session_id: sessionId,
          title,
          content,
          tags: toStringArray(body.tags),
          privacy_tags: toStringArray(body.privacy_tags),
        };

        return jsonResponse(core.recordCheckpoint(req));
      }

      if (request.method === "POST" && url.pathname === "/v1/sessions/finalize") {
        const body = await parseRequestJson(request);
        const sessionId = typeof body.session_id === "string" ? body.session_id : "";
        if (!sessionId) {
          return badRequest("session_id is required");
        }

        const req: FinalizeSessionRequest = {
          platform: typeof body.platform === "string" ? body.platform : undefined,
          project: typeof body.project === "string" ? body.project : undefined,
          session_id: sessionId,
          summary_mode: typeof body.summary_mode === "string"
            ? (body.summary_mode as FinalizeSessionRequest["summary_mode"])
            : undefined,
        };
        return jsonResponse(core.finalizeSession(req));
      }

      if (request.method === "POST" && url.pathname === "/v1/resume-pack") {
        const body = await parseRequestJson(request);
        const project = typeof body.project === "string" ? body.project : "";
        if (!project) {
          return badRequest("project is required");
        }

        const req: ResumePackRequest = {
          project,
          session_id: typeof body.session_id === "string" ? body.session_id : undefined,
          correlation_id: typeof body.correlation_id === "string" ? body.correlation_id : undefined,
          limit: typeof body.limit === "number" ? body.limit : undefined,
          include_private: Boolean(body.include_private),
        };
        return jsonResponse(core.resumePack(req));
      }

      if (request.method === "GET" && url.pathname === "/v1/sessions/chain") {
        const correlationId = url.searchParams.get("correlation_id") || "";
        const project = url.searchParams.get("project") || "";
        if (!correlationId || !project) {
          return badRequest("correlation_id and project are required");
        }
        return jsonResponse(core.resolveSessionChain(correlationId, project));
      }

      if (request.method === "GET" && url.pathname === "/v1/projects/stats") {
        return jsonResponse(
          core.projectsStats({
            include_private: parseBoolean(url.searchParams.get("include_private"), false),
          })
        );
      }

      if (request.method === "GET" && url.pathname === "/v1/stream") {
        const includePrivate = parseBoolean(url.searchParams.get("include_private"), false);
        const projectFilter = url.searchParams.get("project") || "";
        const typeFilter = url.searchParams.get("type") || "";
        let lastEventId = parseInteger(
          url.searchParams.get("since") || request.headers.get("last-event-id"),
          0
        );

        let streamClosed = false;
        let pollTimer: ReturnType<typeof setInterval> | null = null;
        let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
        let healthSignature = "";

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const close = () => {
              if (streamClosed) {
                return;
              }
              streamClosed = true;
              if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
              }
              if (heartbeatTimer) {
                clearInterval(heartbeatTimer);
                heartbeatTimer = null;
              }
              try {
                controller.close();
              } catch {
                // ignored
              }
            };

            request.signal.addEventListener("abort", close, { once: true });

            const shouldSkip = (event: StreamEvent): boolean => {
              const payload = event.data;
              const eventProject = typeof payload.project === "string" ? payload.project : "";
              const eventType = typeof payload.event_type === "string" ? payload.event_type : "";
              const privacyTags = Array.isArray(payload.privacy_tags)
                ? payload.privacy_tags.filter((tag): tag is string => typeof tag === "string")
                : [];

              if (!includePrivate && (privacyTags.includes("private") || privacyTags.includes("sensitive"))) {
                return true;
              }
              if (projectFilter && eventProject && projectFilter !== eventProject) {
                return true;
              }
              if (typeFilter) {
                if (event.type === "observation.created") {
                  if (eventType !== typeFilter) {
                    return true;
                  }
                } else if (event.type === "session.finalized") {
                  if (!["session_end", "session_summary", "session.finalized"].includes(typeFilter)) {
                    return true;
                  }
                }
              }
              return false;
            };

            const emitHealthChange = () => {
              const health = core.health();
              const item = (health.items[0] || {}) as Record<string, unknown>;
              const signature = JSON.stringify({
                vector_engine: item.vector_engine,
                fts_enabled: item.fts_enabled,
                counts: item.counts,
              });
              if (signature === healthSignature) {
                return;
              }
              healthSignature = signature;
              const payload = {
                ts: new Date().toISOString(),
                status: item.status || "ok",
                vector_engine: item.vector_engine,
                fts_enabled: item.fts_enabled,
                counts: item.counts,
              };
              controller.enqueue(toSseChunk("health.changed", payload));
            };

            const emitEvents = () => {
              const events = core.getStreamEventsSince(lastEventId, 200);
              if (events.length === 0) {
                return;
              }
              for (const event of events) {
                lastEventId = event.id;
                if (shouldSkip(event)) {
                  continue;
                }
                controller.enqueue(toSseChunk(event.type, event.data, event.id));
              }
            };

            controller.enqueue(
              toSseChunk("ready", {
                ts: new Date().toISOString(),
                include_private: includePrivate,
                project: projectFilter || null,
                type: typeFilter || null,
              })
            );
            emitHealthChange();
            emitEvents();

            pollTimer = setInterval(() => {
              if (streamClosed) {
                return;
              }
              emitEvents();
            }, 1000);

            heartbeatTimer = setInterval(() => {
              if (streamClosed) {
                return;
              }
              emitHealthChange();
              controller.enqueue(toSseChunk("ping", { ts: new Date().toISOString() }));
            }, 5000);
          },
          cancel() {
            streamClosed = true;
            if (pollTimer) {
              clearInterval(pollTimer);
              pollTimer = null;
            }
            if (heartbeatTimer) {
              clearInterval(heartbeatTimer);
              heartbeatTimer = null;
            }
          },
        });

        return new Response(stream, {
          status: 200,
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-store",
            connection: "keep-alive",
          },
        });
      }

      if (
        request.method === "POST" &&
        (url.pathname === "/v1/ingest/codex-history" || url.pathname === "/v1/ingest/codex-sessions")
      ) {
        return jsonResponse(core.ingestCodexHistory());
      }

      if (
        request.method === "POST" &&
        (url.pathname === "/v1/ingest/opencode-history" || url.pathname === "/v1/ingest/opencode-sessions")
      ) {
        return jsonResponse(core.ingestOpencodeHistory());
      }

      if (
        request.method === "POST" &&
        (url.pathname === "/v1/ingest/cursor-history" || url.pathname === "/v1/ingest/cursor-events")
      ) {
        return jsonResponse(core.ingestCursorHistory());
      }

      if (
        request.method === "POST" &&
        (url.pathname === "/v1/ingest/antigravity-history" || url.pathname === "/v1/ingest/antigravity-files")
      ) {
        return jsonResponse(core.ingestAntigravityHistory());
      }

      if (
        request.method === "POST" &&
        (url.pathname === "/v1/ingest/gemini-history" || url.pathname === "/v1/ingest/gemini-events")
      ) {
        return jsonResponse(core.ingestGeminiHistory());
      }

      if (request.method === "POST" && url.pathname === "/v1/admin/reindex-vectors") {
        const body = await parseRequestJson(request);
        return jsonResponse(core.reindexVectors(typeof body.limit === "number" ? body.limit : undefined));
      }

      return new Response("Not Found", { status: 404 });
    },
  });
}
