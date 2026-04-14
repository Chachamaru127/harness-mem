import { timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { resolveTokenIdentity, loadAuthConfig, extractBearerToken, type AuthConfig, type ResolvedIdentity } from "./auth/token-resolver";
import { buildAccessFilter } from "./auth/access-control";
import { createRateLimiterFromEnv, type TokenBucketRateLimiter } from "./middleware/rate-limiter";
import { createDefaultValidator, type RequestValidator } from "./middleware/validator";
import { createSyncStore, handleSyncPush, handleSyncPull, type SyncStore } from "./sync/sync-store";
import type { Changeset, ConflictPolicy } from "./sync/engine";
import { ConnectorRegistry } from "./sync/connector-registry";
import { GitHubConnector } from "./sync/github-connector";
import { NotionConnector } from "./sync/notion-connector";
import { GoogleDriveConnector } from "./sync/gdrive-connector";
import type { ConnectorConfig } from "./sync/types";
import { EmbeddingReadinessError, HarnessMemCore } from "./core/harness-mem-core";
import { SqliteTeamRepository } from "./db/repositories/SqliteTeamRepository.js";
import type { ITeamRepository } from "./db/repositories/ITeamRepository.js";
import { createLeaseStore, type LeaseStore } from "./lease/lease-store";
import { createSignalStore, type SignalStore } from "./lease/signal-store";
import type {
  FeedRequest,
  ImportJobStatusRequest,
  ApiResponse,
  BackupRequest,
  Config,
  ConsolidationRunRequest,
  EventEnvelope,
  FinalizeSessionRequest,
  GetObservationsRequest,
  AuditLogRequest,
  MemoryType,
  RecordCheckpointRequest,
  ResumePackRequest,
  SearchFacetsRequest,
  SearchRequest,
  SessionThreadRequest,
  SessionsListRequest,
  StreamEvent,
  TimelineRequest,
  VerifyImportRequest,
} from "./core/types.js";

function jsonResponse(body: ApiResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function rawJsonResponse(body: unknown, status = 200): Response {
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

function serviceUnavailable(message: string, extra: Record<string, unknown> = {}): Response {
  const response: ApiResponse = {
    ok: false,
    source: "core",
    items: [],
    meta: {
      count: 0,
      latency_ms: 0,
      sla_latency_ms: 200,
      filters: {},
      ranking: "embedding_readiness_v1",
      ...extra,
    },
    error: message,
  };
  return new Response(JSON.stringify(response), {
    status: 503,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": "1",
    },
  });
}

function requiresAdminToken(method: string, pathname: string): boolean {
  if (pathname.startsWith("/v1/admin/")) {
    return true;
  }
  // GET エンドポイントで admin 認証が必要なもの
  if (method === "GET") {
    if (["/v1/export", "/v1/graph/neighbors"].includes(pathname)) {
      return true;
    }
    // S74-004: fact history contains potentially sensitive data
    if (pathname.startsWith("/v1/facts/") && pathname.endsWith("/history")) {
      return true;
    }
    return false;
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
    "/v1/ingest/github-issues",
    "/v1/ingest/knowledge-file",
    "/v1/ingest/gemini-history",
    "/v1/ingest/gemini-events",
    "/v1/ingest/claude-code-history",
    "/v1/ingest/claude-code-sessions",
    "/v1/links/create",
    "/v1/observations/bulk-delete",
    "/v1/observations/share",
    "/v1/ingest/document",
    "/v1/ingest/audio",
  ].includes(pathname);
}

let adminTokenWarningLogged = false;

function isLocalhostRequest(remoteAddress: string | null): boolean {
  if (!remoteAddress) {
    return false;
  }
  return remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "localhost";
}

// キャッシュされた AuthConfig（起動後に loadAuthConfig で一度だけ読み込む）
let _cachedAuthConfig: AuthConfig | null | undefined = undefined;

function getAuthConfig(): AuthConfig | null {
  if (_cachedAuthConfig !== undefined) return _cachedAuthConfig;
  const configPath = process.env.HARNESS_MEM_CONFIG_PATH ||
    `${process.env.HOME || "~"}/.harness-mem/config.json`;
  _cachedAuthConfig = loadAuthConfig(configPath);
  return _cachedAuthConfig;
}

/**
 * リクエストの Bearer Token を AuthConfig / HARNESS_MEM_ADMIN_TOKEN で解決する。
 * - AuthConfig が存在すればマルチトークン認証を使用
 * - AuthConfig がなければ HARNESS_MEM_ADMIN_TOKEN のみで認証
 */
export function resolveRequestIdentity(request: Request): ResolvedIdentity | null {
  const token = extractBearerToken(request);
  const authConfig = getAuthConfig();

  if (authConfig) {
    return resolveTokenIdentity(token, authConfig);
  }

  // フォールバック: 従来の HARNESS_MEM_ADMIN_TOKEN のみ
  // TEAM-005 設計意図: AuthConfig も ADMIN_TOKEN も未設定 = ローカル単一ユーザーモード。
  // admin ロールを返すことで全テナントフィルタがスキップされる（後方互換性維持）。
  // マルチテナント環境では必ず AuthConfig を設定すること。
  const configured = (process.env.HARNESS_MEM_ADMIN_TOKEN || "").trim();
  if (!configured) return { user_id: "admin", role: "admin" };
  if (!token || token.length !== configured.length) return null;
  if (timingSafeEqual(Buffer.from(token), Buffer.from(configured))) {
    return { user_id: "admin", role: "admin" };
  }
  return null;
}

/**
 * TEAM-005: テナント分離ヘルパー
 * resolveRequestIdentity + buildAccessFilter のボイラープレートを集約。
 * admin ロールまたは未認証時は user_id/team_id が undefined → フィルタなし（後方互換性維持）
 *
 * AuthConfig が設定されている場合に identity が解決できなければ
 * 401 Response を返す。呼び出し元は戻り値が Response かどうかで判定する。
 */
function resolveAccess(request: Request, alias: string = "o"):
  | { user_id: string | undefined; team_id: string | undefined }
  | Response {
  const identity = resolveRequestIdentity(request);
  // AuthConfig が設定されている場合に identity が null → 無効トークン → 401
  if (getAuthConfig() !== null && identity === null) {
    return unauthorized("missing or invalid token");
  }
  const filter = identity ? buildAccessFilter(alias, identity) : null;
  return {
    user_id: filter?.user_id ?? undefined,
    team_id: filter?.team_id ?? undefined,
  };
}

function hasValidAdminToken(request: Request, remoteAddress: string | null): boolean {
  const configured = (process.env.HARNESS_MEM_ADMIN_TOKEN || "").trim();
  if (!configured) {
    if (!adminTokenWarningLogged) {
      console.warn(
        "[harness-mem] WARNING: HARNESS_MEM_ADMIN_TOKEN is not set. " +
        "Admin API is only accessible from localhost."
      );
      adminTokenWarningLogged = true;
    }
    // When no token is configured, allow only localhost requests
    return isLocalhostRequest(remoteAddress);
  }

  // AuthConfig が存在する場合はマルチトークン認証を使用（admin ロールのみ許可）
  const authConfig = getAuthConfig();
  if (authConfig) {
    const identity = resolveTokenIdentity(extractBearerToken(request), authConfig);
    return identity !== null && identity.role === "admin";
  }

  const rawAuth = request.headers.get("authorization");
  const bearer = rawAuth?.startsWith("Bearer ") ? rawAuth.slice(7).trim() : "";
  const provided = request.headers.get("x-harness-mem-token") || bearer || "";
  if (provided.length !== configured.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(provided), Buffer.from(configured));
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

/**
 * リモートバインド安全チェック。
 * host が 127.0.0.1 / localhost 以外でかつ HARNESS_MEM_ADMIN_TOKEN が未設定の場合、
 * エラーメッセージを返す。安全な場合は null を返す。
 */
export function checkRemoteBindSafety(host: string): string | null {
  if (host === "127.0.0.1" || host === "localhost" || host === "::1") return null;
  const adminToken = (process.env.HARNESS_MEM_ADMIN_TOKEN || "").trim();
  const authConfig = getAuthConfig();
  if (!adminToken && !authConfig) {
    return (
      `[harness-mem] FATAL: リモートモードで起動しようとしていますが認証設定がありません。` +
      ` host=${host} でのリモートバインドには HARNESS_MEM_ADMIN_TOKEN または auth_config.json の設定が必須です。` +
      ` HARNESS_MEM_ADMIN_TOKEN 環境変数を設定するか auth_config.json を配置してから再起動してください。`
    );
  }
  console.warn(
    `[harness-mem] リモートモード (remote mode) で起動: host=${host}. ` +
    "TLS リバースプロキシ（Caddy / Nginx）経由での接続を推奨します。"
  );
  return null;
}

function tooManyRequests(resetAt: number): Response {
  const response: ApiResponse = {
    ok: false,
    source: "core",
    items: [],
    meta: { count: 0, latency_ms: 0, sla_latency_ms: 0, filters: {}, ranking: "hybrid_v3" },
    error: "Too Many Requests",
  };
  return new Response(JSON.stringify(response), {
    status: 429,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))),
    },
  });
}

export function startHarnessMemServer(core: HarnessMemCore, config: Config) {
  // HARDEN-003: Sync エンドポイント用インメモリストア（サーバー起動時に初期化）
  const syncStore: SyncStore = createSyncStore();

  // V5-005: Cloud Sync コネクタレジストリ
  const connectorRegistry = new ConnectorRegistry();

  // V5-010: Rate Limiter + Validator（環境変数 HARNESS_MEM_RATE_LIMIT=0 で無効化）
  const rateLimiter: TokenBucketRateLimiter | null = createRateLimiterFromEnv();
  const validator: RequestValidator = createDefaultValidator();

  // TEAM-003: Team CRUD リポジトリ
  const teamRepo: ITeamRepository = new SqliteTeamRepository(core.getRawDb());

  // S80-A02/A03: Lease + Signal primitives for dual-agent coordination.
  const leaseStore: LeaseStore = createLeaseStore(core.getRawDb());
  const signalStore: SignalStore = createSignalStore(core.getRawDb());

  return Bun.serve({
    hostname: config.bindHost,
    port: config.bindPort,
    fetch: async (request: Request, server): Promise<Response> => {
      try {
        const url = new URL(request.url);
        const remoteAddress = server?.requestIP(request)?.address ?? null;

        // V5-010: Rate Limiting（全エンドポイントに適用）
        if (rateLimiter) {
          const rateLimitKey = remoteAddress ?? "unknown";
          const consume = rateLimiter.tryConsume(rateLimitKey);
          if (!consume.allowed) {
            return tooManyRequests(consume.resetAt);
          }
        }

        if (requiresAdminToken(request.method, url.pathname) && !hasValidAdminToken(request, remoteAddress)) {
          return unauthorized("missing or invalid admin token");
        }

        if (request.method === "GET" && url.pathname === "/health") {
          return jsonResponse(core.health());
        }

        if (request.method === "GET" && url.pathname === "/health/ready") {
          const readiness = core.readiness();
          const readinessItem = readiness.items[0] as Record<string, unknown> | undefined;
          return jsonResponse(readiness, readinessItem?.ready === true ? 200 : 503);
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
          // S80-B02: accept forget_policy as a sub-object on the run request.
          let forgetPolicy: ConsolidationRunRequest["forget_policy"];
          if (body.forget_policy && typeof body.forget_policy === "object") {
            const fp = body.forget_policy as Record<string, unknown>;
            forgetPolicy = {
              dry_run: typeof fp.dry_run === "boolean" ? fp.dry_run : undefined,
              score_threshold:
                typeof fp.score_threshold === "number" ? fp.score_threshold : undefined,
              limit: typeof fp.limit === "number" ? fp.limit : undefined,
              protect_accessed:
                typeof fp.protect_accessed === "boolean" ? fp.protect_accessed : undefined,
              weights:
                fp.weights && typeof fp.weights === "object"
                  ? (fp.weights as { access?: number; signal?: number; age?: number })
                  : undefined,
            };
          }
          // S80-B03: accept contradiction_scan sub-object.
          let contradictionScan: ConsolidationRunRequest["contradiction_scan"];
          if (body.contradiction_scan && typeof body.contradiction_scan === "object") {
            const cs = body.contradiction_scan as Record<string, unknown>;
            contradictionScan = {
              jaccard_threshold:
                typeof cs.jaccard_threshold === "number" ? cs.jaccard_threshold : undefined,
              min_confidence:
                typeof cs.min_confidence === "number" ? cs.min_confidence : undefined,
              max_pairs_per_group:
                typeof cs.max_pairs_per_group === "number" ? cs.max_pairs_per_group : undefined,
            };
          }
          const req: ConsolidationRunRequest = {
            reason: typeof body.reason === "string" ? body.reason : undefined,
            project: typeof body.project === "string" ? body.project : undefined,
            session_id: typeof body.session_id === "string" ? body.session_id : undefined,
            limit: parseIntegerLike(body.limit),
            forget_policy: forgetPolicy,
            contradiction_scan: contradictionScan,
          };
          return jsonResponse(await core.runConsolidation(req));
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
          const resolvedPath = resolve(sourceDbPath);
          if (resolvedPath.includes("\0")) {
            return badRequest("source_db_path contains invalid characters");
          }
          if (!resolvedPath.endsWith(".db") && !resolvedPath.endsWith(".sqlite") && !resolvedPath.endsWith(".sqlite3")) {
            return badRequest("source_db_path must point to a .db, .sqlite, or .sqlite3 file");
          }
          return jsonResponse(
            core.startClaudeMemImport({
              source_db_path: resolvedPath,
              project: typeof body.project === "string" ? body.project : undefined,
              dry_run: parseBooleanLike(body.dry_run, false),
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
          // V5-010: 入力バリデーション
          const evtValidation = validator.validateRecordEvent(body);
          if (!evtValidation.valid) {
            return badRequest(evtValidation.errors.join("; "));
          }
          const event = toRecord(body.event) as unknown as EventEnvelope;
          // TEAM-005: テナント分離 — member ロール時はサーバー解決の identity で上書き
          const writeIdentity = resolveRequestIdentity(request);
          if (writeIdentity && writeIdentity.role !== "admin") {
            (event as unknown as Record<string, unknown>).user_id = writeIdentity.user_id;
            (event as unknown as Record<string, unknown>).team_id = writeIdentity.team_id;
          }
          const result = await core.recordEventQueued(event);
          if (result === "queue_full") {
            return new Response(
              JSON.stringify({ ok: false, error: "write queue full, retry later" }),
              {
                status: 503,
                headers: {
                  "content-type": "application/json; charset=utf-8",
                  "retry-after": "1",
                },
              }
            );
          }
          return jsonResponse(result);
        }

        if (request.method === "POST" && url.pathname === "/v1/search") {
          const body = await parseRequestJson(request);
          // V5-010: 入力バリデーション
          const searchValidation = validator.validateSearch(body);
          if (!searchValidation.valid) {
            return badRequest(searchValidation.errors.join("; "));
          }
          const query = typeof body.query === "string" ? body.query : "";
          if (!query) {
            return badRequest("query is required");
          }

          const questionKind = typeof body.question_kind === "string" ? body.question_kind : undefined;
          const validKinds = ["profile", "timeline", "graph", "vector", "hybrid"];
          const validMemoryTypes: MemoryType[] = ["episodic", "semantic", "procedural"];
          const rawMemoryType = body.memory_type;
          const parsedMemoryType = Array.isArray(rawMemoryType)
            ? (rawMemoryType.filter((t): t is MemoryType => typeof t === "string" && validMemoryTypes.includes(t as MemoryType)) as MemoryType[])
            : (typeof rawMemoryType === "string" && validMemoryTypes.includes(rawMemoryType as MemoryType) ? rawMemoryType as MemoryType : undefined);

          // TEAM-005: member ロール適用 — identity を解決してアクセス制御フィルタを生成
          const searchIdentity = resolveRequestIdentity(request);
          const searchAccessFilter = searchIdentity
            ? buildAccessFilter("o", searchIdentity)
            : null;

          const req: SearchRequest = {
            query,
            project: typeof body.project === "string" ? body.project : undefined,
            session_id: typeof body.session_id === "string" ? body.session_id : undefined,
            since: typeof body.since === "string" ? body.since : undefined,
            until: typeof body.until === "string" ? body.until : undefined,
            as_of: typeof body.as_of === "string" ? body.as_of : undefined,
            limit: parseIntegerLike(body.limit),
            include_private: parseBooleanLike(body.include_private, false),
            expand_links: parseBooleanLike(body.expand_links, true),
            strict_project: parseBooleanLike(body.strict_project, true),
            debug: parseBooleanLike(body.debug, false),
            question_kind: questionKind && validKinds.includes(questionKind)
              ? questionKind as SearchRequest["question_kind"]
              : undefined,
            sector: typeof body.sector === "string" ? body.sector as SearchRequest["sector"] : undefined,
            memory_type: parsedMemoryType || undefined,
            // TEAM-005: member スコープ（admin は user_id/team_id なし → フィルタなし）
            user_id: searchAccessFilter?.user_id ?? undefined,
            team_id: searchAccessFilter?.team_id ?? undefined,
            // S43-SEARCH: sort_by
            sort_by: typeof body.sort_by === "string" && ["relevance", "date_desc", "date_asc"].includes(body.sort_by)
              ? body.sort_by as SearchRequest["sort_by"]
              : undefined,
          };
          return jsonResponse(await core.searchPrepared(req));
        }

      if (request.method === "GET" && url.pathname === "/v1/feed") {
        // TEAM-005: member ロール適用 — identity を解決してアクセス制御フィルタを生成
        // TEAM-009 + S-2: user_id / team_id フィルターは認証設定がある場合（AuthConfig）のみ受け付ける。
        // 匿名モード（AuthConfig なし）では任意の user_id を渡すと他ユーザーのデータを参照できるため、
        // クエリパラメータの user_id / team_id を無視する。
        const feedIdentity = resolveRequestIdentity(request);
        const feedAccessFilter = feedIdentity
          ? buildAccessFilter("o", feedIdentity)
          : null;
        const feedAuthConfig = getAuthConfig();
        const validMemoryTypesFeed: MemoryType[] = ["episodic", "semantic", "procedural"];
        const rawMemoryTypeFeed = url.searchParams.get("memory_type") || undefined;
        const parsedMemoryTypeFeed = rawMemoryTypeFeed && validMemoryTypesFeed.includes(rawMemoryTypeFeed as MemoryType)
          ? rawMemoryTypeFeed as MemoryType
          : undefined;

        // member ロールの場合は identity から user_id/team_id を強制適用（クエリパラメータより優先）
        // admin ロールまたは匿名の場合はクエリパラメータを使用
        // isMemberScope=true の場合は OR 条件（自分 OR 同チーム）で結合する
        const isMemberScope = feedIdentity !== null && feedIdentity.role === "member";
        const feedUserId = feedAccessFilter?.user_id
          ?? (feedAuthConfig ? (url.searchParams.get("user_id") || undefined) : undefined);
        const feedTeamId = feedAccessFilter?.team_id
          ?? (feedAuthConfig ? (url.searchParams.get("team_id") || undefined) : undefined);

        const req: FeedRequest = {
          cursor: url.searchParams.get("cursor") || undefined,
          limit: parseInteger(url.searchParams.get("limit"), 40),
          project: url.searchParams.get("project") || undefined,
          type: url.searchParams.get("type") || undefined,
          include_private: parseBoolean(url.searchParams.get("include_private"), false),
          user_id: feedUserId,
          team_id: feedTeamId ?? undefined,
          _member_scope: isMemberScope,
          memory_type: parsedMemoryTypeFeed,
        };
        return jsonResponse(core.feed(req));
      }

      if (request.method === "GET" && url.pathname === "/v1/sessions/list") {
        // TEAM-005: member ロール適用
        const sessListIdentity = resolveRequestIdentity(request);
        const sessListFilter = sessListIdentity
          ? buildAccessFilter("s", sessListIdentity)
          : null;
        const req: SessionsListRequest = {
          project: url.searchParams.get("project") || undefined,
          limit: parseInteger(url.searchParams.get("limit"), 50),
          include_private: parseBoolean(url.searchParams.get("include_private"), false),
          user_id: sessListFilter?.user_id ?? undefined,
          team_id: sessListFilter?.team_id ?? undefined,
        };
        return jsonResponse(core.sessionsList(req));
      }

      if (request.method === "GET" && url.pathname === "/v1/sessions/thread") {
        const sessionId = url.searchParams.get("session_id") || "";
        if (!sessionId) {
          return badRequest("session_id is required");
        }
        // TEAM-005: member ロール適用
        const sessThreadIdentity = resolveRequestIdentity(request);
        const sessThreadFilter = sessThreadIdentity
          ? buildAccessFilter("o", sessThreadIdentity)
          : null;
        const req: SessionThreadRequest = {
          session_id: sessionId,
          project: url.searchParams.get("project") || undefined,
          limit: parseInteger(url.searchParams.get("limit"), 200),
          include_private: parseBoolean(url.searchParams.get("include_private"), false),
          user_id: sessThreadFilter?.user_id ?? undefined,
          team_id: sessThreadFilter?.team_id ?? undefined,
        };
        return jsonResponse(core.sessionThread(req));
      }

      if (request.method === "GET" && url.pathname === "/v1/search/facets") {
        // TEAM-005: テナント分離
        const facetsAccess = resolveAccess(request);
        if (facetsAccess instanceof Response) return facetsAccess;
        const req: SearchFacetsRequest = {
          query: url.searchParams.get("query") || undefined,
          project: url.searchParams.get("project") || undefined,
          include_private: parseBoolean(url.searchParams.get("include_private"), false),
          user_id: facetsAccess.user_id,
          team_id: facetsAccess.team_id,
        };
        return jsonResponse(core.searchFacets(req));
      }

      if (request.method === "POST" && url.pathname === "/v1/timeline") {
        const body = await parseRequestJson(request);
        if (typeof body.id !== "string" || body.id.trim() === "") {
          return badRequest("id is required");
        }

        // TEAM-005: テナント分離
        const timelineAccess = resolveAccess(request);
        if (timelineAccess instanceof Response) return timelineAccess;
        const req: TimelineRequest = {
          id: body.id,
          before: typeof body.before === "number" ? body.before : undefined,
          after: typeof body.after === "number" ? body.after : undefined,
          include_private: parseBooleanLike(body.include_private, false),
          user_id: timelineAccess.user_id,
          team_id: timelineAccess.team_id,
        };
        return jsonResponse(await core.timeline(req));
      }

      if (request.method === "POST" && url.pathname === "/v1/observations/get") {
        const body = await parseRequestJson(request);
        // TEAM-005: テナント分離
        const getObsAccess = resolveAccess(request);
        if (getObsAccess instanceof Response) return getObsAccess;
        const req: GetObservationsRequest = {
          ids: toStringArray(body.ids),
          include_private: parseBooleanLike(body.include_private, false),
          compact: body.compact !== false,
          user_id: getObsAccess.user_id,
          team_id: getObsAccess.team_id,
        };
        return jsonResponse(core.getObservations(req));
      }

      // S80-C03: citation trace / provenance verify.
      if (request.method === "POST" && url.pathname === "/v1/observations/verify") {
        const body = await parseRequestJson(request);
        const observationId =
          typeof body.observation_id === "string" ? body.observation_id : "";
        if (!observationId) {
          return badRequest("observation_id is required");
        }
        return jsonResponse(
          core.verifyObservation({
            observation_id: observationId,
            include_private: parseBooleanLike(body.include_private, false),
          })
        );
      }

      if (request.method === "POST" && url.pathname === "/v1/checkpoints/record") {
        const body = await parseRequestJson(request);
        // V5-010: 入力バリデーション
        const cpValidation = validator.validateCheckpoint(body);
        if (!cpValidation.valid) {
          return badRequest(cpValidation.errors.join("; "));
        }
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
          correlation_id: typeof body.correlation_id === "string" ? body.correlation_id : undefined,
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

        // TEAM-005: テナント分離 — resume-pack にアクセス制御フィルタを適用
        const resumeAccess = resolveAccess(request);
        if (resumeAccess instanceof Response) return resumeAccess;

        const req: ResumePackRequest = {
          project,
          session_id: typeof body.session_id === "string" ? body.session_id : undefined,
          correlation_id: typeof body.correlation_id === "string" ? body.correlation_id : undefined,
          limit: typeof body.limit === "number" ? body.limit : undefined,
          include_private: parseBooleanLike(body.include_private, false),
          resume_pack_max_tokens: typeof body.resume_pack_max_tokens === "number" ? body.resume_pack_max_tokens : undefined,
          user_id: resumeAccess.user_id,
          team_id: resumeAccess.team_id,
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
        const projectFilterMembers = projectFilter
          ? new Set(core.expandProjectSelection(projectFilter, "observations"))
          : null;
        const replayHistory = parseBoolean(url.searchParams.get("replay"), true);
        const typeFilter = url.searchParams.get("type") || "";
        let lastEventId = parseInteger(
          url.searchParams.get("since") || request.headers.get("last-event-id"),
          0
        );
        if (!replayHistory && lastEventId <= 0) {
          lastEventId = core.getLatestStreamEventId();
        }

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
              if (projectFilterMembers && eventProject && !projectFilterMembers.has(eventProject)) {
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
                const payload = { ...event.data } as Record<string, unknown>;
                if (typeof payload.project === "string" && !("canonical_project" in payload)) {
                  payload.canonical_project = core.getCanonicalProjectName(payload.project);
                }
                controller.enqueue(toSseChunk(event.type, payload, event.id));
              }
            };

            controller.enqueue(
              toSseChunk("ready", {
                ts: new Date().toISOString(),
                include_private: includePrivate,
                project: projectFilter || null,
                type: typeFilter || null,
                replay: replayHistory,
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

      if (
        request.method === "POST" &&
        (url.pathname === "/v1/ingest/claude-code-history" || url.pathname === "/v1/ingest/claude-code-sessions")
      ) {
        return jsonResponse(core.ingestClaudeCodeHistory());
      }

      if (request.method === "POST" && url.pathname === "/v1/ingest/github-issues") {
        const body = await parseRequestJson(request);
        return jsonResponse(
          core.ingestGitHubIssues({
            repo: typeof body.repo === "string" ? body.repo : "",
            json: typeof body.json === "string" ? body.json : "",
            project: typeof body.project === "string" ? body.project : undefined,
            platform: typeof body.platform === "string" ? body.platform : undefined,
            session_id: typeof body.session_id === "string" ? body.session_id : undefined,
          })
        );
      }

      if (request.method === "POST" && url.pathname === "/v1/ingest/knowledge-file") {
        const body = await parseRequestJson(request);
        return jsonResponse(
          core.ingestKnowledgeFile({
            file_path: typeof body.file_path === "string" ? body.file_path : "",
            content: typeof body.content === "string" ? body.content : "",
            kind:
              body.kind === "decisions_md" || body.kind === "adr" ? body.kind : undefined,
            project: typeof body.project === "string" ? body.project : undefined,
            platform: typeof body.platform === "string" ? body.platform : undefined,
            session_id: typeof body.session_id === "string" ? body.session_id : undefined,
          })
        );
      }

      if (request.method === "POST" && url.pathname === "/v1/admin/backup") {
        const body = await parseRequestJson(request);
        let destDir: string | undefined;
        if (typeof body.dest_dir === "string" && body.dest_dir.trim()) {
          const resolvedDir = resolve(body.dest_dir);
          if (resolvedDir.includes("\0")) {
            return badRequest("dest_dir contains invalid characters");
          }
          destDir = resolvedDir;
        }
        return jsonResponse(core.backup(destDir ? { destDir } : undefined));
      }

      if (request.method === "POST" && url.pathname === "/v1/admin/reindex-vectors") {
        const body = await parseRequestJson(request);
        return jsonResponse(core.reindexVectors(typeof body.limit === "number" ? body.limit : undefined));
      }

      // TEAM-003: Team CRUD エンドポイント（POST/GET /v1/admin/teams）
      if (request.method === "POST" && url.pathname === "/v1/admin/teams") {
        if (!teamRepo) return badRequest("Team management is only available in SQLite mode");
        const body = await parseRequestJson(request);
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name) return badRequest("name is required");
        const description = typeof body.description === "string" ? body.description : null;
        const now = new Date().toISOString();
        const teamId = typeof body.team_id === "string" && body.team_id.trim()
          ? body.team_id.trim()
          : `team_${Math.random().toString(36).slice(2, 10)}`;
        const team = await teamRepo.create({ team_id: teamId, name, description, created_at: now, updated_at: now });
        return jsonResponse({
          ok: true,
          source: "core",
          items: [team],
          meta: { count: 1, latency_ms: 0, sla_latency_ms: 0, filters: {}, ranking: "team_v1" },
        }, 201);
      }

      if (request.method === "GET" && url.pathname === "/v1/admin/teams") {
        if (!teamRepo) return badRequest("Team management is only available in SQLite mode");
        const teams = await teamRepo.findAll();
        return jsonResponse({
          ok: true,
          source: "core",
          items: teams,
          meta: { count: teams.length, latency_ms: 0, sla_latency_ms: 0, filters: {}, ranking: "team_v1" },
        });
      }

      // TEAM-003: GET/PUT/DELETE /v1/admin/teams/:id（動的パス）
      const teamByIdMatch = url.pathname.match(/^\/v1\/admin\/teams\/([^/]+)$/);
      if (teamByIdMatch) {
        if (!teamRepo) return badRequest("Team management is only available in SQLite mode");
        const teamId = decodeURIComponent(teamByIdMatch[1] || "");
        if (!teamId) return badRequest("team_id is required");

        if (request.method === "GET") {
          const team = await teamRepo.findById(teamId);
          if (!team) {
            return jsonResponse({
              ok: false,
              source: "core",
              items: [],
              meta: { count: 0, latency_ms: 0, sla_latency_ms: 0, filters: {}, ranking: "team_v1" },
              error: `Team '${teamId}' not found`,
            }, 404);
          }
          return jsonResponse({
            ok: true,
            source: "core",
            items: [team],
            meta: { count: 1, latency_ms: 0, sla_latency_ms: 0, filters: {}, ranking: "team_v1" },
          });
        }

        if (request.method === "PUT") {
          const body = await parseRequestJson(request);
          const now = new Date().toISOString();
          const updateInput: { name?: string; description?: string | null; updated_at: string } = { updated_at: now };
          if (typeof body.name === "string") updateInput.name = body.name.trim();
          if ("description" in body) updateInput.description = typeof body.description === "string" ? body.description : null;
          const updated = await teamRepo.update(teamId, updateInput);
          if (!updated) {
            return jsonResponse({
              ok: false,
              source: "core",
              items: [],
              meta: { count: 0, latency_ms: 0, sla_latency_ms: 0, filters: {}, ranking: "team_v1" },
              error: `Team '${teamId}' not found`,
            }, 404);
          }
          return jsonResponse({
            ok: true,
            source: "core",
            items: [updated],
            meta: { count: 1, latency_ms: 0, sla_latency_ms: 0, filters: {}, ranking: "team_v1" },
          });
        }

        if (request.method === "DELETE") {
          const deleted = await teamRepo.delete(teamId);
          if (!deleted) {
            return jsonResponse({
              ok: false,
              source: "core",
              items: [],
              meta: { count: 0, latency_ms: 0, sla_latency_ms: 0, filters: {}, ranking: "team_v1" },
              error: `Team '${teamId}' not found`,
            }, 404);
          }
          return jsonResponse({
            ok: true,
            source: "core",
            items: [{ team_id: teamId, deleted: true }],
            meta: { count: 1, latency_ms: 0, sla_latency_ms: 0, filters: {}, ranking: "team_v1" },
          });
        }
      }

      // TEAM-004: メンバー管理エンドポイント（POST/GET /v1/admin/teams/:id/members および PATCH/DELETE /v1/admin/teams/:id/members/:userId）
      const memberMatch = url.pathname.match(/^\/v1\/admin\/teams\/([^/]+)\/members(?:\/([^/]+))?$/);
      if (memberMatch) {
        if (!teamRepo) return badRequest("Team management is only available in SQLite mode");
        const teamId = decodeURIComponent(memberMatch[1] || "");
        const userId = memberMatch[2] ? decodeURIComponent(memberMatch[2]) : null;
        if (!teamId) return badRequest("team_id is required");

        // POST /v1/admin/teams/:id/members — メンバー追加
        if (request.method === "POST" && !userId) {
          const body = await parseRequestJson(request);
          const memberId = typeof body.user_id === "string" ? body.user_id.trim() : "";
          const role = typeof body.role === "string" ? body.role.trim() : "member";
          if (!memberId) return badRequest("user_id is required");
          await teamRepo.addMember(teamId, memberId, role);
          return jsonResponse({
            ok: true,
            source: "core",
            items: [{ team_id: teamId, user_id: memberId, role }],
            meta: { count: 1, latency_ms: 0, sla_latency_ms: 0, filters: {}, ranking: "team_v1" },
          }, 201);
        }

        // GET /v1/admin/teams/:id/members — メンバー一覧取得
        if (request.method === "GET" && !userId) {
          const members = await teamRepo.getMembers(teamId);
          return jsonResponse({
            ok: true,
            source: "core",
            items: members,
            meta: { count: members.length, latency_ms: 0, sla_latency_ms: 0, filters: {}, ranking: "team_v1" },
          });
        }

        // PATCH /v1/admin/teams/:id/members/:userId — メンバーロール更新
        if (request.method === "PATCH" && userId) {
          const body = await parseRequestJson(request);
          const role = typeof body.role === "string" ? body.role.trim() : "";
          if (!role) return badRequest("role is required");
          const updated = await teamRepo.updateMemberRole(teamId, userId, role);
          if (!updated) {
            return jsonResponse({
              ok: false,
              source: "core",
              items: [],
              meta: { count: 0, latency_ms: 0, sla_latency_ms: 0, filters: {}, ranking: "team_v1" },
              error: `Member '${userId}' not found in team '${teamId}'`,
            }, 404);
          }
          return jsonResponse({
            ok: true,
            source: "core",
            items: [{ team_id: teamId, user_id: userId, role }],
            meta: { count: 1, latency_ms: 0, sla_latency_ms: 0, filters: {}, ranking: "team_v1" },
          });
        }

        // DELETE /v1/admin/teams/:id/members/:userId — メンバー削除
        if (request.method === "DELETE" && userId) {
          const removed = await teamRepo.removeMember(teamId, userId);
          if (!removed) {
            return jsonResponse({
              ok: false,
              source: "core",
              items: [],
              meta: { count: 0, latency_ms: 0, sla_latency_ms: 0, filters: {}, ranking: "team_v1" },
              error: `Member '${userId}' not found in team '${teamId}'`,
            }, 404);
          }
          return jsonResponse({
            ok: true,
            source: "core",
            items: [{ team_id: teamId, user_id: userId, removed: true }],
            meta: { count: 1, latency_ms: 0, sla_latency_ms: 0, filters: {}, ranking: "team_v1" },
          });
        }
      }

      if (request.method === "POST" && url.pathname === "/v1/links/create") {
        const body = await parseRequestJson(request);
        const fromId = typeof body.from_observation_id === "string" ? body.from_observation_id : "";
        const toId = typeof body.to_observation_id === "string" ? body.to_observation_id : "";
        const relation = typeof body.relation === "string" ? body.relation : "";
        if (!fromId || !toId || !relation) {
          return badRequest("from_observation_id, to_observation_id, relation are required");
        }
        const weight = typeof body.weight === "number" ? body.weight : 1.0;
        return jsonResponse(core.createLink({ from_observation_id: fromId, to_observation_id: toId, relation: relation as "updates" | "extends" | "derives" | "follows" | "shared_entity", weight }));
      }

      if (request.method === "POST" && url.pathname === "/v1/observations/bulk-delete") {
        const body = await parseRequestJson(request);
        const ids = toStringArray(body.ids);
        if (ids.length === 0) {
          return badRequest("ids is required and must not be empty");
        }
        // TEAM-005: テナント分離 — member は自分の observation のみ削除可
        const bulkDelAccess = resolveAccess(request);
        if (bulkDelAccess instanceof Response) return bulkDelAccess;
        return jsonResponse(core.bulkDeleteObservations({ ids, user_id: bulkDelAccess.user_id, team_id: bulkDelAccess.team_id }));
      }

      // S58-005: POST /v1/observations/share — observation の team_id を更新してチームに共有
      if (request.method === "POST" && url.pathname === "/v1/observations/share") {
        const body = await parseRequestJson(request);
        const observationId = typeof body.observation_id === "string" ? body.observation_id.trim() : "";
        const teamId = typeof body.team_id === "string" ? body.team_id.trim() : "";
        if (!observationId) {
          return badRequest("observation_id is required");
        }
        if (!teamId) {
          return badRequest("team_id is required");
        }
        // identity から user_id を取得（権限チェック用）
        const shareIdentity = resolveRequestIdentity(request);
        const userId = shareIdentity?.role === "member" ? shareIdentity.user_id : undefined;
        return jsonResponse(core.shareObservationToTeam({ observation_id: observationId, team_id: teamId, user_id: userId }));
      }

      if (request.method === "GET" && url.pathname === "/v1/export") {
        // TEAM-005: テナント分離
        const exportAccess = resolveAccess(request);
        if (exportAccess instanceof Response) return exportAccess;
        const project = url.searchParams.get("project") || undefined;
        const limit = parseInteger(url.searchParams.get("limit"), 1000);
        const includePrivate = parseBoolean(url.searchParams.get("include_private"), false);
        return jsonResponse(core.exportObservations({ project, limit, include_private: includePrivate, user_id: exportAccess.user_id, team_id: exportAccess.team_id }));
      }

      // S74-004: Fact History API
      // TEAM-005: factsMode — facts は全社共有だが認証は強制する
      if (request.method === "GET" && url.pathname.startsWith("/v1/facts/") && url.pathname.endsWith("/history")) {
        const factsAccess = resolveAccess(request);
        if (factsAccess instanceof Response) return factsAccess;
        const factKey = decodeURIComponent(url.pathname.replace("/v1/facts/", "").replace("/history", ""));
        const project = url.searchParams.get("project") || undefined;
        const limit = parseInteger(url.searchParams.get("limit"), 100);
        return jsonResponse(core.getFactHistory({ fact_key: factKey, project, limit, user_id: factsAccess.user_id, team_id: factsAccess.team_id }));
      }

      // V5-006: Analytics API
      // TEAM-005: テナント分離 — analytics 全エンドポイントにアクセス制御適用
      if (request.method === "GET" && url.pathname === "/v1/analytics/usage") {
        const analyticsAccess = resolveAccess(request);
        if (analyticsAccess instanceof Response) return analyticsAccess;
        const period = url.searchParams.get("period") || "day";
        const validPeriods = ["day", "week", "month"];
        const stats = await core.usageStats({
          period: validPeriods.includes(period) ? (period as "day" | "week" | "month") : "day",
          from: url.searchParams.get("from") || undefined,
          to: url.searchParams.get("to") || undefined,
          project: url.searchParams.get("project") || undefined,
          user_id: analyticsAccess.user_id,
          team_id: analyticsAccess.team_id,
        });
        return jsonResponse({
          ok: true,
          source: "core",
          items: [stats],
          meta: { count: stats.rows.length, latency_ms: 0, sla_latency_ms: 0, filters: {}, ranking: "analytics_v1" },
        });
      }

      if (request.method === "GET" && url.pathname === "/v1/analytics/entities") {
        const entitiesAccess = resolveAccess(request);
        if (entitiesAccess instanceof Response) return entitiesAccess;
        const limit = parseInteger(url.searchParams.get("limit"), 50);
        const stats = await core.entityDistribution({
          limit: Math.min(limit, 500),
          project: url.searchParams.get("project") || undefined,
          entity_type: url.searchParams.get("entity_type") || undefined,
          user_id: entitiesAccess.user_id,
          team_id: entitiesAccess.team_id,
        });
        return jsonResponse({
          ok: true,
          source: "core",
          items: stats,
          meta: { count: stats.length, latency_ms: 0, sla_latency_ms: 0, filters: {}, ranking: "analytics_v1" },
        });
      }

      if (request.method === "GET" && url.pathname === "/v1/analytics/timeline-stats") {
        const tlStatsAccess = resolveAccess(request);
        if (tlStatsAccess instanceof Response) return tlStatsAccess;
        const stats = await core.timelineStats({
          from: url.searchParams.get("from") || undefined,
          to: url.searchParams.get("to") || undefined,
          project: url.searchParams.get("project") || undefined,
          user_id: tlStatsAccess.user_id,
          team_id: tlStatsAccess.team_id,
        });
        return jsonResponse({
          ok: true,
          source: "core",
          items: [stats],
          meta: { count: stats.buckets.length, latency_ms: 0, sla_latency_ms: 0, filters: {}, ranking: "analytics_v1" },
        });
      }

      if (request.method === "GET" && url.pathname === "/v1/analytics/overview") {
        const overviewAccess = resolveAccess(request);
        if (overviewAccess instanceof Response) return overviewAccess;
        const stats = await core.overviewStats({
          project: url.searchParams.get("project") || undefined,
          user_id: overviewAccess.user_id,
          team_id: overviewAccess.team_id,
        });
        return jsonResponse({
          ok: true,
          source: "core",
          items: [stats],
          meta: { count: 1, latency_ms: 0, sla_latency_ms: 0, filters: {}, ranking: "analytics_v1" },
        });
      }

      // V5-001: サブグラフ取得 API
      // TEAM-005: テナント分離
      if (request.method === "GET" && url.pathname === "/v1/graph") {
        const graphAccess = resolveAccess(request);
        if (graphAccess instanceof Response) return graphAccess;
        const entity = url.searchParams.get("entity") || "";
        if (!entity) {
          return badRequest("entity is required");
        }
        const depthParam = parseInteger(url.searchParams.get("depth"), 2);
        const depth = Math.min(Math.max(depthParam, 1), 5);
        const limitParam = parseInteger(url.searchParams.get("limit"), 100);
        const limit = Math.min(limitParam, 100);
        const project = url.searchParams.get("project") || undefined;
        const result = core.getSubgraph(entity, depth, { project, limit, user_id: graphAccess.user_id, team_id: graphAccess.team_id });
        return rawJsonResponse({ ok: true, ...result });
      }

      if (request.method === "GET" && url.pathname === "/v1/graph/neighbors") {
        // TEAM-005: テナント分離
        const neighborsAccess = resolveAccess(request);
        if (neighborsAccess instanceof Response) return neighborsAccess;
        const observationId = url.searchParams.get("observation_id") || "";
        if (!observationId) {
          return badRequest("observation_id is required");
        }
        const relation = url.searchParams.get("relation") || undefined;
        const depthRaw = url.searchParams.get("depth");
        const depth = depthRaw ? Math.min(Math.max(parseInt(depthRaw, 10) || 1, 1), 5) : 1;
        return jsonResponse(core.getLinks({ observation_id: observationId, relation, depth, user_id: neighborsAccess.user_id, team_id: neighborsAccess.team_id }));
      }

      if (request.method === "POST" && url.pathname === "/v1/ingest/document") {
        const body = await parseRequestJson(request);
        return jsonResponse(
          core.ingestKnowledgeFile({
            file_path: typeof body.file_path === "string" ? body.file_path : "",
            content: typeof body.content === "string" ? body.content : "",
            kind:
              body.kind === "decisions_md" || body.kind === "adr" ? body.kind : undefined,
            project: typeof body.project === "string" ? body.project : undefined,
            platform: typeof body.platform === "string" ? body.platform : undefined,
            session_id: typeof body.session_id === "string" ? body.session_id : undefined,
          })
        );
      }

      // V5-008: POST /v1/ingest/audio — 音声ファイルをトランスクリプションして観察として記録
      if (request.method === "POST" && url.pathname === "/v1/ingest/audio") {
        let formData: FormData;
        try {
          formData = await request.formData();
        } catch {
          return badRequest("multipart/form-data parsing failed");
        }

        const fileEntry = formData.get("file");
        if (!fileEntry || !(fileEntry instanceof File)) {
          return badRequest("file field is required (multipart/form-data)");
        }

        const filename = fileEntry.name || "audio.wav";
        const audioBuffer = Buffer.from(await fileEntry.arrayBuffer());

        if (audioBuffer.length === 0) {
          return badRequest("audio file is empty");
        }

        const project = typeof formData.get("project") === "string"
          ? (formData.get("project") as string)
          : undefined;
        const sessionId = typeof formData.get("session_id") === "string"
          ? (formData.get("session_id") as string)
          : undefined;
        const language = typeof formData.get("language") === "string"
          ? (formData.get("language") as string) || undefined
          : undefined;
        const rawTags = formData.get("tags");
        const tags: string[] = typeof rawTags === "string" && rawTags
          ? rawTags.split(",").map((t) => t.trim()).filter(Boolean)
          : [];

        const result = await core.ingestAudio({
          audioBuffer,
          filename,
          project,
          session_id: sessionId,
          tags,
          language,
        });

        if (!result.ok) {
          return jsonResponse({
            ok: false,
            source: "audio_ingest",
            items: [],
            meta: { count: 0, latency_ms: 0, sla_latency_ms: 0, filters: {}, ranking: "audio_v1" },
            error: result.error,
          }, 400);
        }

        return jsonResponse({
          ok: true,
          source: "audio_ingest",
          items: [{
            observation_id: result.observation_id,
            transcript: result.transcript,
            duration_seconds: result.duration_seconds,
          }],
          meta: { count: 1, latency_ms: 0, sla_latency_ms: 0, filters: {}, ranking: "audio_v1" },
        });
      }

      // HARDEN-003: POST /v1/sync/push — リモート changeset を受信してマージ
      if (request.method === "POST" && url.pathname === "/v1/sync/push") {
        if (!hasValidAdminToken(request, remoteAddress)) {
          return unauthorized("missing or invalid admin token");
        }
        const body = await parseRequestJson(request);
        const deviceId = typeof body.device_id === "string" ? body.device_id : "";
        const since = typeof body.since === "string" ? body.since : null;
        const rawRecords = Array.isArray(body.records) ? body.records : [];
        if (!deviceId) {
          return badRequest("device_id is required");
        }
        const records = rawRecords.filter(
          (r): r is Record<string, unknown> => typeof r === "object" && r !== null
        );
        if (records.length > 10000) {
          return badRequest("records must not exceed 10000 items per push");
        }
        const changeset: Changeset = {
          device_id: deviceId,
          since,
          records: records.map((r) => ({
            id: typeof r.id === "string" ? r.id : "",
            content: typeof r.content === "string" ? r.content : "",
            updated_at: typeof r.updated_at === "string" ? r.updated_at : new Date().toISOString(),
            device_id: typeof r.device_id === "string" ? r.device_id : deviceId,
          })),
        };
        const policy: ConflictPolicy =
          body.conflict_policy === "local-wins" || body.conflict_policy === "remote-wins"
            ? (body.conflict_policy as ConflictPolicy)
            : "last-write-wins";
        const result = handleSyncPush(syncStore, changeset, policy);
        return jsonResponse({
          ok: result.ok,
          source: "sync",
          items: [{ merged: result.merged, conflicts: result.conflicts }],
          meta: {
            count: result.merged.length,
            latency_ms: 0,
            sla_latency_ms: 0,
            filters: {},
            ranking: "sync_v1",
          },
        });
      }

      // HARDEN-003: GET /v1/sync/pull — since 以降の差分 changeset を返す
      if (request.method === "GET" && url.pathname === "/v1/sync/pull") {
        if (!hasValidAdminToken(request, remoteAddress)) {
          return unauthorized("missing or invalid admin token");
        }
        const sinceParam = url.searchParams.get("since") || null;
        // ISO 8601 簡易バリデーション: 指定された場合は "YYYY-" で始まる有効な日付文字列であること
        if (sinceParam !== null && (!/^\d{4}-/.test(sinceParam) || Number.isNaN(Date.parse(sinceParam)))) {
          return badRequest("since must be a valid ISO 8601 date string");
        }
        const since = sinceParam;
        const deviceId = url.searchParams.get("device_id") || "server";
        const changeset = handleSyncPull(syncStore, deviceId, since);
        return jsonResponse({
          ok: true,
          source: "sync",
          items: [changeset],
          meta: {
            count: changeset.records.length,
            latency_ms: 0,
            sla_latency_ms: 0,
            filters: {},
            ranking: "sync_v1",
          },
        });
      }

      // V5-005: GET /v1/sync/connectors — コネクタ一覧
      if (request.method === "GET" && url.pathname === "/v1/sync/connectors") {
        if (!hasValidAdminToken(request, remoteAddress)) {
          return unauthorized("missing or invalid admin token");
        }
        const connectors = connectorRegistry.list().map((c) => ({
          name: c.name,
          type: c.type,
        }));
        return jsonResponse({
          ok: true,
          source: "sync",
          items: connectors,
          meta: { count: connectors.length, latency_ms: 0, sla_latency_ms: 0, filters: {}, ranking: "sync_v1" },
        });
      }

      // V5-005: POST /v1/sync/connectors — コネクタ登録
      if (request.method === "POST" && url.pathname === "/v1/sync/connectors") {
        if (!hasValidAdminToken(request, remoteAddress)) {
          return unauthorized("missing or invalid admin token");
        }
        const body = await parseRequestJson(request);
        const name = typeof body.name === "string" ? body.name.trim() : "";
        const type = body.type as string;

        if (!name) {
          return badRequest("name is required");
        }
        if (!["github", "notion", "gdrive"].includes(type)) {
          return badRequest("type must be one of: github, notion, gdrive");
        }

        const connectorConfig: ConnectorConfig = {
          type: type as "github" | "notion" | "gdrive",
          credentials: toRecord(body.credentials) as Record<string, string>,
          settings: toRecord(body.settings),
        };

        let connector;
        if (type === "github") {
          connector = new GitHubConnector(name);
        } else if (type === "notion") {
          connector = new NotionConnector(name);
        } else {
          connector = new GoogleDriveConnector(name);
        }

        await connector.initialize(connectorConfig);
        connectorRegistry.register(connector);

        return jsonResponse({
          ok: true,
          source: "sync",
          items: [{ name, type }],
          meta: { count: 1, latency_ms: 0, sla_latency_ms: 0, filters: {}, ranking: "sync_v1" },
        });
      }

      // V5-005: DELETE /v1/sync/connectors/:name — コネクタ削除
      if (request.method === "DELETE" && url.pathname.startsWith("/v1/sync/connectors/")) {
        if (!hasValidAdminToken(request, remoteAddress)) {
          return unauthorized("missing or invalid admin token");
        }
        const namePart = url.pathname.slice("/v1/sync/connectors/".length);
        if (!namePart || namePart.includes("/")) {
          return badRequest("invalid connector name");
        }
        const removed = connectorRegistry.unregister(namePart);
        return jsonResponse({
          ok: removed,
          source: "sync",
          items: [{ name: namePart, removed }],
          meta: { count: removed ? 1 : 0, latency_ms: 0, sla_latency_ms: 0, filters: {}, ranking: "sync_v1" },
        }, removed ? 200 : 404);
      }

      // V5-005: POST /v1/sync/connectors/:name/test — 接続テスト
      if (request.method === "POST" && /^\/v1\/sync\/connectors\/[^/]+\/test$/.test(url.pathname)) {
        if (!hasValidAdminToken(request, remoteAddress)) {
          return unauthorized("missing or invalid admin token");
        }
        const parts = url.pathname.split("/");
        const connName = parts[parts.length - 2];
        const connector = connectorRegistry.get(connName);
        if (!connector) {
          return jsonResponse({ ok: false, source: "sync", items: [], meta: { count: 0, latency_ms: 0, sla_latency_ms: 0, filters: {}, ranking: "sync_v1" }, error: `Connector '${connName}' not found` }, 404);
        }
        const testResult = await connector.testConnection();
        return jsonResponse({
          ok: testResult.ok,
          source: "sync",
          items: [testResult],
          meta: { count: 1, latency_ms: 0, sla_latency_ms: 0, filters: {}, ranking: "sync_v1" },
        });
      }

      // V5-005: POST /v1/sync/connectors/:name/sync — 個別同期実行
      if (request.method === "POST" && /^\/v1\/sync\/connectors\/[^/]+\/sync$/.test(url.pathname)) {
        if (!hasValidAdminToken(request, remoteAddress)) {
          return unauthorized("missing or invalid admin token");
        }
        const parts = url.pathname.split("/");
        const connName = parts[parts.length - 2];
        const body = await parseRequestJson(request);
        const changes = Array.isArray(body.changes) ? body.changes : [];
        const syncResult = await connectorRegistry.syncConnector(connName, changes);
        return jsonResponse({
          ok: syncResult.errors.length === 0,
          source: "sync",
          items: [syncResult],
          meta: { count: 1, latency_ms: 0, sla_latency_ms: 0, filters: {}, ranking: "sync_v1" },
        });
      }

      // S80-A02: Lease primitives.
      if (request.method === "POST" && url.pathname === "/v1/lease/acquire") {
        const body = await parseRequestJson(request);
        const res = leaseStore.acquire({
          target: typeof body.target === "string" ? body.target : "",
          agentId: typeof body.agent_id === "string" ? body.agent_id : "",
          project: typeof body.project === "string" ? body.project : undefined,
          ttlMs: typeof body.ttl_ms === "number" ? body.ttl_ms : undefined,
          metadata:
            body.metadata && typeof body.metadata === "object"
              ? (body.metadata as Record<string, unknown>)
              : undefined,
        });
        return jsonResponse(res);
      }

      if (request.method === "POST" && url.pathname === "/v1/lease/release") {
        const body = await parseRequestJson(request);
        const leaseId = typeof body.lease_id === "string" ? body.lease_id : "";
        const agentId = typeof body.agent_id === "string" ? body.agent_id : "";
        if (!leaseId || !agentId) {
          return badRequest("lease_id and agent_id are required");
        }
        return jsonResponse(leaseStore.release(leaseId, agentId));
      }

      if (request.method === "POST" && url.pathname === "/v1/lease/renew") {
        const body = await parseRequestJson(request);
        const leaseId = typeof body.lease_id === "string" ? body.lease_id : "";
        const agentId = typeof body.agent_id === "string" ? body.agent_id : "";
        if (!leaseId || !agentId) {
          return badRequest("lease_id and agent_id are required");
        }
        const ttlMs = typeof body.ttl_ms === "number" ? body.ttl_ms : undefined;
        return jsonResponse(leaseStore.renew(leaseId, agentId, ttlMs));
      }

      // S80-A03: Signal primitives.
      if (request.method === "POST" && url.pathname === "/v1/signal/send") {
        const body = await parseRequestJson(request);
        const res = signalStore.send({
          from: typeof body.from === "string" ? body.from : "",
          to: typeof body.to === "string" ? body.to : null,
          threadId: typeof body.thread_id === "string" ? body.thread_id : null,
          replyTo: typeof body.reply_to === "string" ? body.reply_to : null,
          content: typeof body.content === "string" ? body.content : "",
          project: typeof body.project === "string" ? body.project : undefined,
          expiresInMs: typeof body.expires_in_ms === "number" ? body.expires_in_ms : undefined,
        });
        return jsonResponse(res);
      }

      if (request.method === "POST" && url.pathname === "/v1/signal/read") {
        const body = await parseRequestJson(request);
        const agentId = typeof body.agent_id === "string" ? body.agent_id : "";
        if (!agentId) return badRequest("agent_id is required");
        const signals = signalStore.read({
          agentId,
          threadId: typeof body.thread_id === "string" ? body.thread_id : undefined,
          includeBroadcast: body.include_broadcast !== false,
          limit: typeof body.limit === "number" ? body.limit : undefined,
        });
        return jsonResponse({ ok: true, signals });
      }

      if (request.method === "POST" && url.pathname === "/v1/signal/ack") {
        const body = await parseRequestJson(request);
        const signalId = typeof body.signal_id === "string" ? body.signal_id : "";
        const agentId = typeof body.agent_id === "string" ? body.agent_id : "";
        if (!signalId || !agentId) {
          return badRequest("signal_id and agent_id are required");
        }
        return jsonResponse(signalStore.ack({ signalId, agentId }));
      }

        return new Response("Not Found", { status: 404 });
      } catch (error) {
        if (error instanceof EmbeddingReadinessError) {
          return serviceUnavailable(error.message, {
            embedding_provider_status: error.readiness.providerStatus,
            embedding_provider_details: error.readiness.details,
            embedding_ready: error.readiness.ready,
            embedding_readiness_required: error.readiness.required,
            embedding_readiness_state: error.readiness.state,
            embedding_readiness_retryable: error.readiness.retryable,
            embedding_error_code: error.code,
          });
        }
        throw error;
      }
    },
  });
}
