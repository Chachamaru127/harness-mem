/**
 * observation-store.ts
 *
 * 観察ストアモジュール。
 * HarnessMemCore から分割された観察・検索責務を担う。
 *
 * 担当 API:
 *   - getObservations
 *   - search (委譲)
 *   - feed
 *   - searchFacets
 *   - timeline
 */

import type { Database } from "bun:sqlite";
import { buildTokenEstimateMeta } from "../utils/token-estimate";
import { type AccessFilter } from "../auth/access-control";
import type {
  ApiResponse,
  Config,
  FeedRequest,
  GetObservationsRequest,
  SearchFacetsRequest,
  SearchRequest,
  TimelineRequest,
} from "./harness-mem-core";

// ---------------------------------------------------------------------------
// ObservationStoreDeps: HarnessMemCore から渡される内部依存
// ---------------------------------------------------------------------------

export interface ObservationStoreDeps {
  db: Database;
  config: Config;
  ftsEnabled: boolean;
  /** normalizeProjectInput のバインド済みバージョン */
  normalizeProject: (project: string) => string;
  /** visibilityFilterSql のバインド済みバージョン */
  visibilityFilterSql: (alias: string, includePrivate: boolean) => string;
  /** platformVisibilityFilterSql のバインド済みバージョン */
  platformVisibilityFilterSql: (alias: string) => string;
  /** buildFtsQuery のバインド済みバージョン */
  buildFtsQuery: (query: string) => string;
  /** loadObservations のバインド済みバージョン */
  loadObservations: (ids: string[]) => Map<string, Record<string, unknown>>;
  /** writeAuditLog のバインド済みバージョン */
  writeAuditLog: (action: string, targetType: string, targetId: string, details: Record<string, unknown>) => void;
  /** search の内部実装への委譲 */
  doSearch: (request: SearchRequest) => ApiResponse;
  /** アクセス制御フィルタ（TEAM-005）。未設定時は全許可 */
  accessFilter?: AccessFilter;
}

// ---------------------------------------------------------------------------
// ユーティリティ（このモジュール内でのみ使用）
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function clampLimit(input: unknown, fallback: number, min = 0, max = 1000): number {
  const n = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function parseArrayJson(value: unknown): string[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function isPrivateTag(tags: string[]): boolean {
  return tags.includes("private") || tags.includes("sensitive");
}

function escapeLikePattern(input: string): string {
  return input.replace(/([\\%_])/g, "\\$1");
}

interface FeedCursor {
  created_at: string;
  id: string;
}

function encodeFeedCursor(cursor: FeedCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeFeedCursor(input: string | undefined): FeedCursor | null {
  if (!input) return null;
  try {
    const decoded = Buffer.from(input, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).created_at === "string" &&
      typeof (parsed as Record<string, unknown>).id === "string"
    ) {
      return parsed as FeedCursor;
    }
  } catch {
    // ignore
  }
  return null;
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
// ObservationStore クラス
// ---------------------------------------------------------------------------

export class ObservationStore {
  constructor(private readonly deps: ObservationStoreDeps) {}

  // ---------------------------------------------------------------------------
  // search: 内部実装は HarnessMemCore に残し、ここではデリゲーション
  // ---------------------------------------------------------------------------

  search(request: SearchRequest): ApiResponse {
    return this.deps.doSearch(request);
  }

  // ---------------------------------------------------------------------------
  // feed
  // ---------------------------------------------------------------------------

  feed(request: FeedRequest): ApiResponse {
    const startedAt = performance.now();

    if (!this.deps.config.retrievalEnabled) {
      return makeResponse(startedAt, [], request as unknown as Record<string, unknown>, {
        retrieval_enabled: false,
      });
    }

    const limit = clampLimit(request.limit, 40, 1, 200);
    const includePrivate = Boolean(request.include_private);
    const cursor = decodeFeedCursor(request.cursor);
    const typeFilter =
      typeof request.type === "string" && request.type.trim() ? request.type.trim() : undefined;
    const normalizedProject = request.project
      ? this.deps.normalizeProject(request.project)
      : undefined;

    const params: unknown[] = [];
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
        o.user_id,
        o.team_id,
        o.created_at,
        e.event_type AS event_type
      FROM mem_observations o
      LEFT JOIN mem_events e ON e.event_id = o.event_id
      WHERE 1 = 1
    `;

    if (normalizedProject) {
      sql += " AND o.project = ?";
      params.push(normalizedProject);
    }

    if (typeFilter) {
      sql += " AND COALESCE(e.event_type, '') = ?";
      params.push(typeFilter);
    }

    sql += this.deps.platformVisibilityFilterSql("o");
    sql += this.deps.visibilityFilterSql("o", includePrivate);

    if (this.deps.accessFilter?.sql) {
      sql += " " + this.deps.accessFilter.sql;
      params.push(...this.deps.accessFilter.params);
    }

    if (cursor) {
      sql += " AND (o.created_at < ? OR (o.created_at = ? AND o.id < ?))";
      params.push(cursor.created_at, cursor.created_at, cursor.id);
    }

    sql += " ORDER BY o.created_at DESC, o.id DESC LIMIT ?";
    params.push(limit + 1);

    const rows = this.deps.db.query(sql).all(...(params as any[])) as Array<Record<string, unknown>>;
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const items = pageRows.map((row) => {
      const eventTypeRaw = typeof row.event_type === "string" ? row.event_type : "";
      const eventType = eventTypeRaw || "unknown";
      const cardType = eventType === "session_end" ? "session_summary" : eventType;
      const content = typeof row.content_redacted === "string" ? row.content_redacted : "";
      const privacyTags = parseArrayJson(row.privacy_tags_json);

      return {
        id: row.id,
        event_id: row.event_id,
        platform: row.platform,
        project: row.project,
        session_id: row.session_id,
        event_type: eventType,
        card_type: cardType,
        title: row.title || eventType,
        content: content.slice(0, 1200),
        created_at: row.created_at,
        tags: parseArrayJson(row.tags_json),
        privacy_tags: privacyTags,
        user_id: row.user_id,
        team_id: row.team_id,
      };
    });

    let nextCursor: string | null = null;
    if (hasMore && pageRows.length > 0) {
      const last = pageRows[pageRows.length - 1];
      const createdAt = typeof last.created_at === "string" ? last.created_at : "";
      const id = typeof last.id === "string" ? last.id : "";
      if (createdAt && id) {
        nextCursor = encodeFeedCursor({ created_at: createdAt, id });
      }
    }

    return makeResponse(startedAt, items, request as unknown as Record<string, unknown>, {
      ranking: "feed_v1",
      next_cursor: nextCursor,
      has_more: hasMore,
    });
  }

  // ---------------------------------------------------------------------------
  // searchFacets
  // ---------------------------------------------------------------------------

  searchFacets(request: SearchFacetsRequest): ApiResponse {
    const startedAt = performance.now();
    const includePrivate = Boolean(request.include_private);
    const normalizedProject = request.project
      ? this.deps.normalizeProject(request.project)
      : undefined;
    const query = (request.query || "").trim();

    // MAJOR-5: SQL GROUP BY で project・event_type・時間バケットを集計し、
    // JS 側の全件ループを排除する。tags_json のみ JS でパースが必要なため
    // 別途 LIMIT 付きで取得する。

    // 共通 WHERE 条件を構築するヘルパー
    const buildBaseFilter = (): { whereClauses: string; baseParams: unknown[] } => {
      const baseParams: unknown[] = [];
      let whereClauses = " WHERE 1 = 1";
      if (normalizedProject) {
        whereClauses += " AND o.project = ?";
        baseParams.push(normalizedProject);
      }
      whereClauses += this.deps.platformVisibilityFilterSql("o");
      whereClauses += this.deps.visibilityFilterSql("o", includePrivate);
      if (this.deps.accessFilter?.sql) {
        whereClauses += " " + this.deps.accessFilter.sql;
        baseParams.push(...this.deps.accessFilter.params);
      }
      if (query) {
        if (this.deps.ftsEnabled) {
          whereClauses += ` AND o.rowid IN (SELECT rowid FROM mem_observations_fts WHERE mem_observations_fts MATCH ?)`;
          baseParams.push(this.deps.buildFtsQuery(query));
        } else {
          const escapedLike = escapeLikePattern(query);
          whereClauses += " AND (o.title LIKE ? ESCAPE '\\' OR o.content_redacted LIKE ? ESCAPE '\\')";
          baseParams.push(`%${escapedLike}%`, `%${escapedLike}%`);
        }
      }
      return { whereClauses, baseParams };
    };

    const { whereClauses, baseParams } = buildBaseFilter();

    // (1) project 集計: SQL GROUP BY
    const projectRows = this.deps.db
      .query(
        `SELECT COALESCE(o.project,'unknown') AS value, COUNT(*) AS cnt
         FROM mem_observations o${whereClauses}
         GROUP BY o.project
         ORDER BY cnt DESC
         LIMIT 30`
      )
      .all(...(baseParams as any[])) as Array<{ value: string; cnt: number }>;

    // (2) event_type 集計: SQL GROUP BY
    const eventTypeRows = this.deps.db
      .query(
        `SELECT COALESCE(e.event_type,'unknown') AS value, COUNT(*) AS cnt
         FROM mem_observations o
         LEFT JOIN mem_events e ON e.event_id = o.event_id${whereClauses}
         GROUP BY e.event_type
         ORDER BY cnt DESC
         LIMIT 20`
      )
      .all(...(baseParams as any[])) as Array<{ value: string; cnt: number }>;

    // (3) 時間バケット集計: SQL CASE 式で分類
    const nowIsoForSql = new Date().toISOString();
    const bucketRows = this.deps.db
      .query(
        `SELECT
           CASE
             WHEN o.created_at >= datetime(?, '-1 day')   THEN '24h'
             WHEN o.created_at >= datetime(?, '-7 days')  THEN '7d'
             WHEN o.created_at >= datetime(?, '-30 days') THEN '30d'
             ELSE 'older'
           END AS value,
           COUNT(*) AS cnt
         FROM mem_observations o${whereClauses}
         GROUP BY value`
      )
      .all(nowIsoForSql, nowIsoForSql, nowIsoForSql, ...(baseParams as any[])) as Array<{ value: string; cnt: number }>;

    // (4) total_candidates
    const totalRow = this.deps.db
      .query(`SELECT COUNT(*) AS cnt FROM mem_observations o${whereClauses}`)
      .get(...(baseParams as any[])) as { cnt: number } | null;
    const totalCandidates = Number(totalRow?.cnt ?? 0);

    // (5) tags_json: JS パースが必要なため LIMIT 付きで取得
    const tagRows = this.deps.db
      .query(
        `SELECT o.tags_json
         FROM mem_observations o${whereClauses}
         ORDER BY o.created_at DESC
         LIMIT 5000`
      )
      .all(...(baseParams as any[])) as Array<{ tags_json: string }>;

    const tagCounts = new Map<string, number>();
    for (const row of tagRows) {
      const tags = parseArrayJson(row.tags_json);
      for (const tag of tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }

    const toFacetArray = (map: Map<string, number>) =>
      [...map.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((lhs, rhs) => rhs.count - lhs.count || lhs.value.localeCompare(rhs.value));

    const toFacetArrayFromRows = (rows: Array<{ value: string; cnt: number }>) =>
      rows.map((r) => ({ value: r.value, count: Number(r.cnt) }));

    // 時間バケットは固定順で返す
    const bucketMap = new Map<string, number>(
      bucketRows.map((r) => [r.value, Number(r.cnt)])
    );
    const timeBuckets = [
      { value: "24h", count: bucketMap.get("24h") ?? 0 },
      { value: "7d", count: bucketMap.get("7d") ?? 0 },
      { value: "30d", count: bucketMap.get("30d") ?? 0 },
      { value: "older", count: bucketMap.get("older") ?? 0 },
    ];

    return makeResponse(
      startedAt,
      [
        {
          query: query || null,
          total_candidates: totalCandidates,
          projects: toFacetArrayFromRows(projectRows),
          event_types: toFacetArrayFromRows(eventTypeRows),
          tags: toFacetArray(tagCounts).slice(0, 50),
          time_buckets: timeBuckets,
        },
      ],
      {
        query: query || undefined,
        project: request.project,
        include_private: includePrivate,
      },
      { ranking: "search_facets_v1" }
    );
  }

  // ---------------------------------------------------------------------------
  // timeline
  // ---------------------------------------------------------------------------

  timeline(request: TimelineRequest): ApiResponse {
    const startedAt = performance.now();

    const before = clampLimit(request.before, 5, 0, 50);
    const after = clampLimit(request.after, 5, 0, 50);

    const center = this.deps.db
      .query(
        `
          SELECT id, project, session_id, created_at, title, content_redacted, tags_json, privacy_tags_json
          FROM mem_observations
          WHERE id = ?
        `
      )
      .get(request.id) as unknown as Record<string, unknown> | null;

    if (!center) {
      return makeErrorResponse(startedAt, `observation not found: ${request.id}`, {
        id: request.id,
      });
    }

    const centerProject = typeof center.project === "string" ? center.project : "";
    const centerSession = typeof center.session_id === "string" ? center.session_id : "";
    const centerCreatedAt = typeof center.created_at === "string" ? center.created_at : nowIso();

    const includePrivate = Boolean(request.include_private);
    const visibility = this.deps.visibilityFilterSql("o", includePrivate);

    const beforeRows = this.deps.db
      .query(
        `
          SELECT o.id, o.created_at, o.title, o.content_redacted, o.tags_json, o.privacy_tags_json
          FROM mem_observations o
          WHERE o.project = ? AND o.session_id = ? AND o.created_at < ?
          ${visibility}
          ORDER BY o.created_at DESC
          LIMIT ?
        `
      )
      .all(centerProject, centerSession, centerCreatedAt, before) as Array<Record<string, unknown>>;

    const afterRows = this.deps.db
      .query(
        `
          SELECT o.id, o.created_at, o.title, o.content_redacted, o.tags_json, o.privacy_tags_json
          FROM mem_observations o
          WHERE o.project = ? AND o.session_id = ? AND o.created_at > ?
          ${visibility}
          ORDER BY o.created_at ASC
          LIMIT ?
        `
      )
      .all(centerProject, centerSession, centerCreatedAt, after) as Array<Record<string, unknown>>;

    const normalizeItem = (
      row: Record<string, unknown>,
      position: "before" | "center" | "after"
    ) => ({
      id: row.id,
      position,
      created_at: row.created_at,
      title: row.title,
      content: typeof row.content_redacted === "string" ? row.content_redacted.slice(0, 1200) : "",
      tags: parseArrayJson(row.tags_json),
      privacy_tags: parseArrayJson(row.privacy_tags_json),
    });

    const items = [
      ...beforeRows.reverse().map((row) => normalizeItem(row, "before")),
      normalizeItem(center, "center"),
      ...afterRows.map((row) => normalizeItem(row, "after")),
    ];

    try {
      this.deps.writeAuditLog("read.timeline", "observation", request.id, {
        before,
        after,
        include_private: includePrivate,
        count: items.length,
      });
    } catch {
      // best effort
    }

    return makeResponse(startedAt, items, request as unknown as Record<string, unknown>, {
      center_id: request.id,
      token_estimate: buildTokenEstimateMeta({
        input: {
          id: request.id,
          before,
          after,
        },
        output: items,
        strategy: "timeline",
      }),
    });
  }

  // ---------------------------------------------------------------------------
  // getObservations
  // ---------------------------------------------------------------------------

  getObservations(request: GetObservationsRequest): ApiResponse {
    const startedAt = performance.now();
    const ids = Array.isArray(request.ids)
      ? request.ids.filter((id): id is string => typeof id === "string")
      : [];

    if (ids.length === 0) {
      return makeResponse(startedAt, [], request as unknown as Record<string, unknown>, {
        token_estimate: buildTokenEstimateMeta({
          input: { ids: [] },
          output: [],
          strategy: "details",
        }),
      });
    }

    const observationMap = this.deps.loadObservations(ids);
    const includePrivate = Boolean(request.include_private);
    const compact = request.compact !== false;
    const accessFilter = this.deps.accessFilter;

    const items: Array<Record<string, unknown>> = [];
    for (const id of ids) {
      const row = observationMap.get(id);
      if (!row) {
        continue;
      }

      // アクセス制御: admin は全許可、member は自分 or 同チームのみ
      if (accessFilter?.sql) {
        const rowUserId = typeof row.user_id === "string" ? row.user_id : "";
        const rowTeamId = typeof row.team_id === "string" ? row.team_id : null;
        const params = accessFilter.params as string[];
        const allowedUserId = params[0] ?? "";
        const allowedTeamId = params[1] ?? null;
        const allowed = rowUserId === allowedUserId ||
          (allowedTeamId !== null && rowTeamId === allowedTeamId);
        if (!allowed) {
          continue;
        }
      }

      const privacyTags = parseArrayJson(row.privacy_tags_json);
      if (!includePrivate && isPrivateTag(privacyTags)) {
        continue;
      }

      const content = typeof row.content_redacted === "string" ? row.content_redacted : "";

      items.push({
        id,
        event_id: row.event_id,
        platform: row.platform,
        project: row.project,
        session_id: row.session_id,
        title: row.title,
        content: compact ? content.slice(0, 800) : content,
        created_at: row.created_at,
        updated_at: row.updated_at,
        tags: parseArrayJson(row.tags_json),
        privacy_tags: privacyTags,
      });
    }

    const warnings: string[] = [];
    if (ids.length >= 20) {
      warnings.push(
        "Large details request detected. Prefer 3-layer workflow: search -> timeline -> get_observations (targeted IDs)."
      );
    }

    try {
      this.deps.writeAuditLog("read.get_observations", "observation", ids[0] || "", {
        requested_ids: ids.length,
        returned_ids: items.length,
        include_private: includePrivate,
        compact,
      });
    } catch {
      // best effort
    }

    return makeResponse(startedAt, items, request as unknown as Record<string, unknown>, {
      compact,
      token_estimate: buildTokenEstimateMeta({
        input: { ids, compact },
        output: items,
        strategy: "details",
      }),
      warnings,
    });
  }
}
