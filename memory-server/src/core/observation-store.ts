/**
 * observation-store.ts
 *
 * 観察ストアモジュール。
 * HarnessMemCore から分割された観察・検索責務を担う。
 *
 * 担当 API:
 *   - search (ハイブリッド検索: lexical + vector + graph + recency + tag + importance)
 *   - feed
 *   - searchFacets
 *   - timeline
 *   - getObservations
 */

import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { buildTokenEstimateMeta, estimateTokenCount } from "../utils/token-estimate";
import { routeQuery, type RouteDecision } from "../retrieval/router";
import { compileAnswer } from "../answer/compiler";
import type { Reranker, RerankInputItem, RerankOutputItem } from "../rerank/types";
import type { VectorEngine } from "../vector/providers";
import type {
  ApiResponse,
  Config,
  FeedRequest,
  GetObservationsRequest,
  ResumePackRequest,
  SearchFacetsRequest,
  SearchRequest,
  TimelineRequest,
} from "./types.js";
import {
  buildFtsQuery,
  clampLimit,
  cosineSimilarity,
  EVENT_TYPE_IMPORTANCE,
  hasPrivateVisibilityTag,
  isPrivateTag,
  loadObservations,
  makeErrorResponse,
  makeResponse,
  normalizeScoreMap,
  normalizeVectorDimension,
  normalizeWeights,
  nowIso,
  parseArrayJson,
  recencyScore,
  tokenize,
  visibilityFilterSql,
  type RankingWeights,
  type SearchCandidate,
  type VectorSearchResult,
} from "./core-utils.js";

// ---------------------------------------------------------------------------
// ObservationStoreDeps: HarnessMemCore から渡される内部依存
// ---------------------------------------------------------------------------

export interface ObservationStoreDeps {
  db: Database;
  config: Config;
  ftsEnabled: boolean;
  /** normalizeProjectInput のバインド済みバージョン */
  normalizeProject: (project: string) => string;
  /** platformVisibilityFilterSql のバインド済みバージョン */
  platformVisibilityFilterSql: (alias: string) => string;
  /** writeAuditLog のバインド済みバージョン */
  writeAuditLog: (
    action: string,
    targetType: string,
    targetId: string,
    details: Record<string, unknown>
  ) => void;
  // ---- vector 検索に必要な依存 ----
  getVectorEngine: () => VectorEngine;
  getVectorModelVersion: () => string;
  vectorDimension: number;
  getVecTableReady: () => boolean;
  setVecTableReady: (value: boolean) => void;
  /** embeddingProvider.embed() のバインド済みバージョン */
  embedContent: (content: string) => number[];
  refreshEmbeddingHealth: () => void;
  getEmbeddingProviderName: () => string;
  embeddingProviderModel: string;
  getEmbeddingHealthStatus: () => string;
  // ---- reranker ----
  getRerankerEnabled: () => boolean;
  getReranker: () => Reranker | null;
  // ---- managed backend shadow read ----
  managedShadowRead:
    | ((
        query: string,
        ids: string[],
        opts: { project: string | undefined; limit: number }
      ) => Promise<void>)
    | null;
  // ---- search config ----
  searchRanking: string;
  searchExpandLinks: boolean;
}

// ---------------------------------------------------------------------------
// ユーティリティ（このモジュール内でのみ使用）
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// ObservationStore クラス
// ---------------------------------------------------------------------------

export class ObservationStore {
  private migrationComplete = false;

  constructor(private readonly deps: ObservationStoreDeps) {}

  // ---------------------------------------------------------------------------
  // applyCommonFilters: SQL WHERE 句に共通フィルタを追加
  // ---------------------------------------------------------------------------

  private applyCommonFilters(
    sql: string,
    params: unknown[],
    alias: string,
    filters: {
      project?: string;
      session_id?: string;
      since?: string;
      until?: string;
      include_private?: boolean;
      strict_project?: boolean;
    },
    options: { skipPrivacy?: boolean } = {}
  ): string {
    let nextSql = sql;
    const strictProject = filters.strict_project !== false;

    if (filters.project && strictProject) {
      nextSql += ` AND ${alias}.project = ?`;
      params.push(filters.project);
    }

    if (filters.session_id) {
      nextSql += ` AND ${alias}.session_id = ?`;
      params.push(filters.session_id);
    }

    if (filters.since) {
      nextSql += ` AND ${alias}.created_at >= ?`;
      params.push(filters.since);
    }

    if (filters.until) {
      nextSql += ` AND ${alias}.created_at <= ?`;
      params.push(filters.until);
    }

    nextSql += this.deps.platformVisibilityFilterSql(alias);
    if (!options.skipPrivacy) {
      nextSql += visibilityFilterSql(alias, Boolean(filters.include_private));
    }
    return nextSql;
  }

  // ---------------------------------------------------------------------------
  // lexicalSearch
  // ---------------------------------------------------------------------------

  private lexicalSearch(request: SearchRequest, internalLimit: number): Map<string, number> {
    if (!this.deps.ftsEnabled) {
      const tokens = tokenize(request.query);
      if (tokens.length === 0) return new Map<string, number>();

      const params: unknown[] = [];
      let sql = `
        SELECT
          o.id AS id,
          o.title AS title,
          o.content_redacted AS content
        FROM mem_observations o
        WHERE 1 = 1
      `;

      sql = this.applyCommonFilters(sql, params, "o", request);
      sql += " ORDER BY o.created_at DESC LIMIT ?";
      params.push(Math.max(internalLimit * 4, 200));

      const rows = this.deps.db
        .query(sql)
        .all(...(params as any[])) as Array<{ id: string; title: string; content: string }>;

      const raw = new Map<string, number>();
      for (const row of rows) {
        const title = (row.title || "").toLowerCase();
        const content = (row.content || "").toLowerCase();
        let score = 0;
        for (const token of tokens) {
          if (title.includes(token)) score += 2;
          if (content.includes(token)) score += 1;
        }
        if (score > 0) raw.set(row.id, score);
      }

      return normalizeScoreMap(raw);
    }

    const params: unknown[] = [];
    let sql = `
      SELECT
        o.id AS id,
        bm25(mem_observations_fts) AS bm25
      FROM mem_observations_fts
      JOIN mem_observations o ON o.rowid = mem_observations_fts.rowid
      WHERE mem_observations_fts MATCH ?
    `;

    params.push(buildFtsQuery(request.query));
    sql = this.applyCommonFilters(sql, params, "o", request);
    sql += " ORDER BY bm25 ASC LIMIT ?";
    params.push(internalLimit);

    const rows = this.deps.db
      .query(sql)
      .all(...(params as any[])) as Array<{ id: string; bm25: number }>;
    const raw = new Map<string, number>();
    for (const row of rows) {
      raw.set(row.id, -Number(row.bm25));
    }

    return normalizeScoreMap(raw);
  }

  // ---------------------------------------------------------------------------
  // vectorSearch
  // ---------------------------------------------------------------------------

  private vectorSearch(request: SearchRequest, internalLimit: number): VectorSearchResult {
    if (this.deps.getVectorEngine() === "disabled") {
      return { scores: new Map<string, number>(), coverage: 0 };
    }

    const queryVector = normalizeVectorDimension(
      this.deps.embedContent(request.query),
      this.deps.vectorDimension
    );
    this.deps.refreshEmbeddingHealth();
    const queryVectorJson = JSON.stringify(queryVector);

    if (this.deps.getVectorEngine() === "sqlite-vec" && this.deps.getVecTableReady()) {
      try {
        const params: unknown[] = [
          queryVectorJson,
          internalLimit * 3,
          this.deps.getVectorModelVersion(),
          this.deps.vectorDimension,
        ];
        let sql = `
          SELECT
            c.id AS id,
            c.distance AS distance,
            o.created_at AS created_at
          FROM (
            SELECT
              m.observation_id AS id,
              v.distance AS distance
            FROM mem_vectors_vec v
            JOIN mem_vectors_vec_map m ON m.rowid = v.rowid
            WHERE v.embedding MATCH ? AND k = ?
          ) c
          JOIN mem_vectors mv
            ON mv.observation_id = c.id
            AND mv.model = ?
            AND mv.dimension = ?
          JOIN mem_observations o ON o.id = c.id
          WHERE 1 = 1
        `;
        sql = this.applyCommonFilters(sql, params, "o", request);
        sql += " ORDER BY c.distance ASC LIMIT ?";
        params.push(internalLimit);

        const rows = this.deps.db
          .query(sql)
          .all(...(params as any[])) as Array<{
          id: string;
          distance: number;
          created_at: string;
        }>;

        const raw = new Map<string, number>();
        for (const row of rows) {
          const distance = Number(row.distance);
          if (Number.isNaN(distance)) continue;
          raw.set(row.id, 1 / (1 + Math.max(0, distance)));
        }
        const normalized = normalizeScoreMap(raw);
        const migrationWarning = this.getMigrationProgress(this.deps.getVectorModelVersion()) ?? undefined;
        return {
          scores: normalized,
          coverage: rows.length === 0 ? 0 : normalized.size / rows.length,
          migrationWarning,
        };
      } catch {
        this.deps.setVecTableReady(false);
      }
    }

    // JS brute-force path
    const strictProjectWindow =
      request.project && request.strict_project !== false
        ? Math.min(1500, Math.max(600, internalLimit * 12))
        : Math.min(2000, Math.max(800, internalLimit * 20));

    const runBruteForce = (model: string): Array<{ id: string; score: number }> => {
      const p: unknown[] = [model, this.deps.vectorDimension];
      let q = `
        SELECT
          v.observation_id AS id,
          v.vector_json AS vector_json,
          o.created_at AS created_at
        FROM mem_vectors v
        JOIN mem_observations o ON o.id = v.observation_id
        WHERE v.model = ? AND v.dimension = ?
      `;
      q = this.applyCommonFilters(q, p, "o", request);
      q += " ORDER BY o.created_at DESC LIMIT ?";
      p.push(strictProjectWindow);

      const bfRows = this.deps.db
        .query(q)
        .all(...(p as any[])) as Array<{
        id: string;
        vector_json: string;
        created_at: string;
      }>;
      const bfScored: Array<{ id: string; score: number }> = [];
      for (const row of bfRows) {
        let vector: number[];
        try {
          const parsed = JSON.parse(row.vector_json);
          if (!Array.isArray(parsed)) continue;
          vector = parsed.filter((value): value is number => typeof value === "number");
        } catch {
          continue;
        }
        const cosine = cosineSimilarity(queryVector, vector);
        bfScored.push({ id: row.id, score: (cosine + 1) / 2 });
      }
      return bfScored;
    };

    const scored = runBruteForce(this.deps.getVectorModelVersion());
    const migrationWarning: string | undefined =
      this.getMigrationProgress(this.deps.getVectorModelVersion()) ?? undefined;

    scored.sort((lhs, rhs) => rhs.score - lhs.score);
    const sliced = scored.slice(0, internalLimit);

    const raw = new Map<string, number>();
    for (const entry of sliced) {
      raw.set(entry.id, entry.score);
    }

    const normalized = normalizeScoreMap(raw);
    return {
      scores: normalized,
      coverage: scored.length === 0 ? 0 : normalized.size / scored.length,
      migrationWarning,
    };
  }

  private resolveFallbackVectorModel(currentModel: string): string | null {
    const row = this.deps.db
      .query(
        `SELECT model, COUNT(*) AS cnt
         FROM mem_vectors
         WHERE model != ?
         GROUP BY model
         ORDER BY cnt DESC
         LIMIT 1`
      )
      .get(currentModel) as { model: string; cnt: number } | null;
    return row?.model ?? null;
  }

  private getMigrationProgress(currentModel: string): string | null {
    if (this.migrationComplete) return null;

    const totals = this.deps.db
      .query(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN model = ? THEN 1 ELSE 0 END) AS current_count
         FROM mem_vectors`
      )
      .get(currentModel) as { total: number; current_count: number } | null;

    if (!totals || totals.total === 0) return null;
    const total = Number(totals.total);
    const current = Number(totals.current_count);
    if (current >= total) {
      this.migrationComplete = true;
      return null;
    }
    const pct = Math.round((current / total) * 100);
    return `vector_migration: ${current}/${total} vectors reindexed (${pct}%)`;
  }

  private tagMatchScore(tagsJson: unknown, queryTokens: string[]): number {
    const tags = parseArrayJson(tagsJson);
    if (tags.length === 0 || queryTokens.length === 0) return 0;

    let matches = 0;
    for (const tag of tags) {
      const normalizedTag = tag.toLowerCase();
      for (const token of queryTokens) {
        if (
          normalizedTag === token ||
          normalizedTag.includes(token) ||
          token.includes(normalizedTag)
        ) {
          matches += 1;
          break;
        }
      }
    }

    return matches / Math.max(tags.length, queryTokens.length);
  }

  private expandByLinks(
    topIds: string[],
    request: SearchRequest,
    existingIds: Set<string>
  ): Map<string, number> {
    if (topIds.length === 0) return new Map<string, number>();

    const placeholders = topIds.map(() => "?").join(", ");
    const params: unknown[] = [...topIds];

    let sql = `
      SELECT
        o.id AS id,
        MAX(l.weight) AS weight
      FROM mem_links l
      JOIN mem_observations o ON o.id = l.to_observation_id
      WHERE l.from_observation_id IN (${placeholders})
        AND l.relation IN ('shared_entity', 'follows', 'extends', 'derives')
    `;

    sql = this.applyCommonFilters(sql, params, "o", request);
    sql += " GROUP BY o.id ORDER BY weight DESC, o.created_at DESC LIMIT 40";

    try {
      const rows = this.deps.db
        .query(sql)
        .all(...(params as any[])) as Array<{ id: string; weight: number }>;

      const raw = new Map<string, number>();
      for (const row of rows) {
        const id = typeof row.id === "string" ? row.id : "";
        const weight = Number(row.weight ?? 0);
        if (!id || existingIds.has(id) || Number.isNaN(weight)) continue;
        raw.set(id, weight);
      }
      return normalizeScoreMap(raw);
    } catch {
      return new Map<string, number>();
    }
  }

  private resolveSearchWeights(vectorCoverage: number): RankingWeights {
    const base: RankingWeights = {
      lexical: 0.32,
      vector: 0.28,
      recency: 0.10,
      tag_boost: 0.12,
      importance: 0.08,
      graph: 0.10,
    };
    if (vectorCoverage < 0.2) {
      return normalizeWeights({ ...base, vector: 0 });
    }
    return normalizeWeights(base);
  }

  private buildRerankInput(
    ranked: SearchCandidate[],
    observations: Map<string, Record<string, unknown>>
  ): RerankInputItem[] {
    return ranked.map((item, index) => {
      const observation = observations.get(item.id) ?? {};
      return {
        id: item.id,
        score: item.final,
        created_at: item.created_at,
        title: typeof observation.title === "string" ? observation.title : "",
        content:
          typeof observation.content_redacted === "string" ? observation.content_redacted : "",
        source_index: index,
      };
    });
  }

  private applyRerank(
    query: string,
    ranked: SearchCandidate[],
    observations: Map<string, Record<string, unknown>>
  ): {
    ranked: SearchCandidate[];
    pre: Array<Record<string, unknown>>;
    post: Array<Record<string, unknown>>;
  } {
    const pre = ranked.slice(0, 25).map((item, index) => ({
      rank: index + 1,
      id: item.id,
      score: Number(item.final.toFixed(6)),
    }));

    if (!this.deps.getRerankerEnabled() || !this.deps.getReranker() || ranked.length === 0) {
      for (const item of ranked) {
        item.rerank = item.final;
      }
      return { ranked, pre, post: pre };
    }

    const reranked = this.deps.getReranker()!.rerank({
      query,
      items: this.buildRerankInput(ranked, observations),
    });
    const rerankScoreById = new Map<string, number>();
    const rerankOrderById = new Map<string, number>();
    reranked.forEach((item: RerankOutputItem, index: number) => {
      rerankScoreById.set(item.id, item.rerank_score);
      rerankOrderById.set(item.id, index);
    });

    ranked.sort((lhs, rhs) => {
      const lhsOrder = rerankOrderById.get(lhs.id);
      const rhsOrder = rerankOrderById.get(rhs.id);
      if (typeof lhsOrder === "number" && typeof rhsOrder === "number" && lhsOrder !== rhsOrder) {
        return lhsOrder - rhsOrder;
      }
      const lhsScore = rerankScoreById.get(lhs.id) ?? lhs.final;
      const rhsScore = rerankScoreById.get(rhs.id) ?? rhs.final;
      if (rhsScore !== lhsScore) return rhsScore - lhsScore;
      return lhs.id.localeCompare(rhs.id);
    });

    for (const item of ranked) {
      item.rerank = rerankScoreById.get(item.id) ?? item.final;
    }

    const post = ranked.slice(0, 25).map((item, index) => ({
      rank: index + 1,
      id: item.id,
      score: Number((item.rerank ?? item.final).toFixed(6)),
    }));

    return { ranked, pre, post };
  }

  // ---------------------------------------------------------------------------
  // search: ハイブリッド検索（lexical + vector + graph + recency + tag + importance）
  // ---------------------------------------------------------------------------

  search(request: SearchRequest): ApiResponse {
    const startedAt = performance.now();

    if (!this.deps.config.retrievalEnabled) {
      return makeResponse(startedAt, [], request as unknown as Record<string, unknown>, {
        retrieval_enabled: false,
      });
    }

    if (!request.query || !request.query.trim()) {
      return makeErrorResponse(
        startedAt,
        "query is required",
        request as unknown as Record<string, unknown>
      );
    }

    const limit = clampLimit(request.limit, 20, 1, 100);
    const internalLimit = Math.min(500, limit * 5);
    const includePrivate = Boolean(request.include_private);
    const strictProject = request.strict_project !== false;
    const expandLinks =
      this.deps.searchExpandLinks !== false && request.expand_links !== false;
    const normalizedProject = request.project
      ? this.deps.normalizeProject(request.project)
      : request.project;
    const normalizedRequest: SearchRequest = {
      ...request,
      project: normalizedProject,
      include_private: includePrivate,
      strict_project: strictProject,
      expand_links: expandLinks,
    };

    const lexical = this.lexicalSearch(normalizedRequest, internalLimit);
    const vectorResult = this.vectorSearch(normalizedRequest, internalLimit);
    const vector = vectorResult.scores;
    const graph = new Map<string, number>();

    const candidateIds = new Set<string>([...lexical.keys(), ...vector.keys()]);
    if (expandLinks && candidateIds.size > 0) {
      const topIds = [...candidateIds]
        .sort((lhs, rhs) => {
          const lhsScore = (lexical.get(lhs) ?? 0) + (vector.get(lhs) ?? 0);
          const rhsScore = (lexical.get(rhs) ?? 0) + (vector.get(rhs) ?? 0);
          return rhsScore - lhsScore;
        })
        .slice(0, 10);
      const linked = this.expandByLinks(topIds, normalizedRequest, candidateIds);
      for (const [id, score] of linked.entries()) {
        candidateIds.add(id);
        graph.set(id, score);
      }
    }

    // IMP-002: exclude_updated=true の場合、updatesリンクで上書きされた旧観察を除外
    const updatedObsIds = new Set<string>();
    if (request.exclude_updated && candidateIds.size > 0) {
      try {
        const MAX_BATCH = 500;
        const allCandidates = [...candidateIds];
        for (let i = 0; i < allCandidates.length; i += MAX_BATCH) {
          const batch = allCandidates.slice(i, i + MAX_BATCH);
          const placeholders = batch.map(() => "?").join(", ");
          const updatedRows = this.deps.db
            .query(
              `SELECT to_observation_id FROM mem_links
               WHERE relation = 'updates' AND to_observation_id IN (${placeholders})`
            )
            .all(...batch) as Array<{ to_observation_id: string }>;
          for (const row of updatedRows) {
            updatedObsIds.add(row.to_observation_id);
          }
        }
      } catch {
        // best effort
      }
    }

    const observations = loadObservations(this.deps.db, [...candidateIds]);
    const queryTokens = tokenize(request.query);

    const ranked: SearchCandidate[] = [];
    let vectorCandidateCount = 0;
    let privacyExcludedCount = 0;
    let boundaryExcludedCount = 0;
    for (const id of candidateIds) {
      const observation = observations.get(id);
      if (!observation) continue;

      // IMP-002: updatesリンクで上書きされた旧観察を除外
      if (request.exclude_updated && updatedObsIds.has(id)) continue;

      const observationProject =
        typeof observation.project === "string" ? observation.project : "";
      if (strictProject && normalizedProject && observationProject !== normalizedProject) {
        boundaryExcludedCount++;
        continue;
      }

      const privacyTags = parseArrayJson(observation.privacy_tags_json);
      if (!includePrivate && hasPrivateVisibilityTag(privacyTags)) {
        privacyExcludedCount++;
        continue;
      }

      const createdAt =
        typeof observation.created_at === "string" ? observation.created_at : nowIso();
      const lexicalScore = lexical.get(id) ?? 0;
      const vectorScore = vector.get(id) ?? 0;
      if (vector.has(id)) vectorCandidateCount += 1;
      const recency = recencyScore(createdAt);
      const tagBoost = this.tagMatchScore(observation.tags_json, queryTokens);
      const eventType =
        typeof observation.event_type === "string" ? observation.event_type : "";
      const baseImportance = EVENT_TYPE_IMPORTANCE[eventType] ?? 0.5;
      // IMP-009: signal_score を加算 (上限1.0、下限0.0)
      const signalAdj =
        typeof observation.signal_score === "number" ? observation.signal_score : 0;
      const importance = Math.min(1.0, Math.max(0.0, baseImportance + signalAdj));
      const graphScore = graph.get(id) ?? 0;

      ranked.push({
        id,
        lexical: lexicalScore,
        vector: vectorScore,
        recency,
        tag_boost: tagBoost,
        importance,
        graph: graphScore,
        final: 0,
        rerank: 0,
        created_at: createdAt,
      });
    }

    // アクセス頻度による importance 加点（mem_audit_log の search_hit を一括集計）
    if (ranked.length > 0) {
      const ids = ranked.map((r) => r.id);
      const placeholders = ids.map(() => "?").join(",");
      try {
        const hitCounts = this.deps.db
          .query(
            `SELECT target_id, COUNT(*) AS cnt
             FROM mem_audit_log
             WHERE action = 'search_hit' AND target_type = 'observation' AND target_id IN (${placeholders})
             GROUP BY target_id`
          )
          .all(...ids) as Array<{ target_id: string; cnt: number }>;
        const hitMap = new Map<string, number>();
        for (const row of hitCounts) {
          hitMap.set(row.target_id, Number(row.cnt));
        }
        for (const item of ranked) {
          const cnt = hitMap.get(item.id) ?? 0;
          // access_count >= 10 → +0.2, >= 5 → +0.1（上限 +0.2）
          const boost = cnt >= 10 ? 0.2 : cnt >= 5 ? 0.1 : 0;
          item.importance = Math.min(1.0, item.importance + boost);
        }
      } catch {
        // best effort: アクセス頻度加点に失敗しても検索は継続
      }
    }

    const vectorCoverage = ranked.length === 0 ? 0 : vectorCandidateCount / ranked.length;

    // Route query to determine retrieval strategy and weight overrides
    const routeDecision: RouteDecision = routeQuery(request.query, request.question_kind);
    const baseWeights = this.resolveSearchWeights(vectorCoverage);
    // Blend router weights with existing weights: router takes precedence
    // when a specific question kind is detected (confidence > 0.5)
    const weights = routeDecision.confidence > 0.5 ? routeDecision.weights : baseWeights;

    for (const item of ranked) {
      item.final =
        weights.lexical * item.lexical +
        weights.vector * item.vector +
        weights.recency * item.recency +
        weights.tag_boost * item.tag_boost +
        weights.importance * item.importance +
        weights.graph * item.graph;
    }

    ranked.sort((lhs, rhs) => {
      if (rhs.final !== lhs.final) return rhs.final - lhs.final;
      if (rhs.created_at !== lhs.created_at) {
        return String(rhs.created_at).localeCompare(String(lhs.created_at));
      }
      return lhs.id.localeCompare(rhs.id);
    });

    const rerankResult = this.applyRerank(request.query, ranked, observations);
    const rankedAfterRerank = rerankResult.ranked;

    const items = rankedAfterRerank.slice(0, limit).map((entry) => {
      const observation = observations.get(entry.id) ?? {};
      const tags = parseArrayJson(observation.tags_json);
      const privacyTags = parseArrayJson(observation.privacy_tags_json);

      const item: Record<string, unknown> = {
        id: entry.id,
        event_id: observation.event_id,
        platform: observation.platform,
        project: observation.project,
        session_id: observation.session_id,
        title: observation.title,
        content:
          typeof observation.content_redacted === "string"
            ? observation.content_redacted.slice(0, 2000)
            : "",
        observation_type: observation.observation_type || "context",
        created_at: observation.created_at,
        tags,
        privacy_tags: privacyTags,
        scores: {
          lexical: Number(entry.lexical.toFixed(6)),
          vector: Number(entry.vector.toFixed(6)),
          recency: Number(entry.recency.toFixed(6)),
          tag_boost: Number(entry.tag_boost.toFixed(6)),
          importance: Number(entry.importance.toFixed(6)),
          graph: Number(entry.graph.toFixed(6)),
          final: Number(entry.final.toFixed(6)),
          rerank: Number((entry.rerank || entry.final).toFixed(6)),
        },
      };

      if (request.debug) {
        const total = entry.final;
        item.recall_trace = {
          lexical: Number((weights.lexical * entry.lexical).toFixed(6)),
          vector: Number((weights.vector * entry.vector).toFixed(6)),
          recency: Number((weights.recency * entry.recency).toFixed(6)),
          tag_boost: Number((weights.tag_boost * entry.tag_boost).toFixed(6)),
          importance: Number((weights.importance * entry.importance).toFixed(6)),
          graph: Number((weights.graph * entry.graph).toFixed(6)),
          total: Number(total.toFixed(6)),
        };
      }

      return item;
    });

    const meta: Record<string, unknown> = {
      ranking: this.deps.searchRanking,
      question_kind: routeDecision.kind,
      question_kind_confidence: Number(routeDecision.confidence.toFixed(3)),
      vector_engine: this.deps.getVectorEngine(),
      vector_model: this.deps.getVectorModelVersion(),
      fts_enabled: this.deps.ftsEnabled,
      embedding_provider: this.deps.getEmbeddingProviderName(),
      embedding_provider_status: this.deps.getEmbeddingHealthStatus(),
      lexical_candidates: lexical.size,
      vector_candidates: vector.size,
      graph_candidates: graph.size,
      candidate_counts: {
        lexical: lexical.size,
        vector: vector.size,
        graph: graph.size,
        final: rankedAfterRerank.length,
      },
      vector_coverage: Number(vectorCoverage.toFixed(6)),
    };
    // Append migration warning when vectors are in a mixed-model state
    if (vectorResult.migrationWarning) {
      const existingWarnings = Array.isArray(meta.warnings)
        ? (meta.warnings as string[])
        : [];
      meta.warnings = [...existingWarnings, vectorResult.migrationWarning];
    }
    meta.token_estimate = buildTokenEstimateMeta({
      input: {
        query: request.query,
        limit,
        project: request.project,
      },
      output: items.map((item) => ({
        id: item.id,
        title: item.title,
      })),
      strategy: "index",
    });
    if (request.debug) {
      meta.debug = {
        strict_project: strictProject,
        expand_links: expandLinks,
        weights,
        vector_backend_coverage: Number(vectorResult.coverage.toFixed(6)),
        embedding_provider: this.deps.getEmbeddingProviderName(),
        embedding_model: this.deps.embeddingProviderModel,
        reranker: {
          enabled: this.deps.getRerankerEnabled(),
          name: this.deps.getReranker()?.name || null,
        },
        rerank_pre: rerankResult.pre,
        rerank_post: rerankResult.post,
      };
    }

    try {
      this.deps.writeAuditLog("read.search", "project", normalizedProject || "", {
        query: request.query,
        limit,
        include_private: includePrivate,
        count: items.length,
        privacy_excluded_count: privacyExcludedCount,
        boundary_excluded_count: boundaryExcludedCount,
      });
      if (privacyExcludedCount > 0) {
        this.deps.writeAuditLog(
          "privacy_filter",
          "search",
          normalizedProject || "",
          {
            reason: "include_private_false",
            query: request.query,
            returned_count: items.length,
            excluded_count: privacyExcludedCount,
            path: `search/${normalizedProject || "global"}`,
            ts: nowIso(),
          }
        );
      }
      if (boundaryExcludedCount > 0) {
        this.deps.writeAuditLog(
          "boundary_filter",
          "search",
          normalizedProject || "",
          {
            reason: "workspace_boundary",
            excluded_count: boundaryExcludedCount,
            project: normalizedProject,
          }
        );
      }
      // 返却した observation の search_hit をバッチで1件記録（write amplification 対策）
      if (items.length > 0) {
        const resultIds = items.map((item) => item.id as string).filter(Boolean);
        this.deps.writeAuditLog("search_hit", "observation", "", {
          query: request.query,
          project: normalizedProject,
          result_ids: resultIds,
          count: resultIds.length,
        });
      }
    } catch {
      // best effort
    }

    // Shadow-read: compare results with managed backend (fire-and-forget)
    if (this.deps.managedShadowRead) {
      const resultIds = items.map((item) => item.id as string);
      this.deps.managedShadowRead(request.query, resultIds, {
        project: normalizedProject,
        limit,
      }).catch(() => {
        // fire-and-forget, errors tracked in shadow metrics
      });
    }

    // Evidence-bound answer compilation
    const compiled = compileAnswer({
      question_kind: routeDecision.kind,
      observations: items.map((item) => ({
        id: item.id as string,
        platform: item.platform as string,
        project: item.project as string,
        title: item.title as string | null,
        content_redacted: item.content as string,
        created_at: item.created_at as string,
        tags_json: JSON.stringify(item.tags),
        session_id: item.session_id as string,
        final_score: (item.scores as { final: number }).final,
      })),
      privacy_excluded_count: privacyExcludedCount,
    });
    meta.compiled = {
      question_kind: compiled.question_kind,
      evidence_count: compiled.evidence_count,
      platforms: compiled.meta.platforms,
      projects: compiled.meta.projects,
      time_span: compiled.meta.time_span,
      cross_session: compiled.meta.cross_session,
      privacy_excluded: compiled.meta.privacy_excluded,
    };

    return makeResponse(startedAt, items, request as unknown as Record<string, unknown>, meta);
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
      typeof request.type === "string" && request.type.trim()
        ? request.type.trim()
        : undefined;
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
    sql += visibilityFilterSql("o", includePrivate);

    if (cursor) {
      sql += " AND (o.created_at < ? OR (o.created_at = ? AND o.id < ?))";
      params.push(cursor.created_at, cursor.created_at, cursor.id);
    }

    sql += " ORDER BY o.created_at DESC, o.id DESC LIMIT ?";
    params.push(limit + 1);

    const rows = this.deps.db
      .query(sql)
      .all(...(params as any[])) as Array<Record<string, unknown>>;
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
    const params: unknown[] = [];

    let sql = `
      SELECT
        o.project,
        o.created_at,
        o.tags_json,
        o.privacy_tags_json,
        e.event_type
      FROM mem_observations o
      LEFT JOIN mem_events e ON e.event_id = o.event_id
      WHERE 1 = 1
    `;

    if (normalizedProject) {
      sql += " AND o.project = ?";
      params.push(normalizedProject);
    }

    sql += this.deps.platformVisibilityFilterSql("o");
    sql += visibilityFilterSql("o", includePrivate);

    const query = (request.query || "").trim();
    if (query) {
      if (this.deps.ftsEnabled) {
        sql += `
          AND o.rowid IN (
            SELECT rowid
            FROM mem_observations_fts
            WHERE mem_observations_fts MATCH ?
          )
        `;
        params.push(buildFtsQuery(query));
      } else {
        const escapedLike = escapeLikePattern(query);
        sql +=
          " AND (o.title LIKE ? ESCAPE '\\' OR o.content_redacted LIKE ? ESCAPE '\\')";
        params.push(`%${escapedLike}%`, `%${escapedLike}%`);
      }
    }

    sql += " ORDER BY o.created_at DESC LIMIT 5000";

    const rows = this.deps.db.query(sql).all(...(params as any[])) as Array<{
      project: string;
      created_at: string;
      tags_json: string;
      privacy_tags_json: string;
      event_type: string;
    }>;

    const projectCounts = new Map<string, number>();
    const eventTypeCounts = new Map<string, number>();
    const tagCounts = new Map<string, number>();
    const timeBucketCounts = new Map<string, number>([
      ["24h", 0],
      ["7d", 0],
      ["30d", 0],
      ["older", 0],
    ]);

    const now = Date.now();
    for (const row of rows) {
      const project = row.project || "unknown";
      const eventType = row.event_type || "unknown";
      projectCounts.set(project, (projectCounts.get(project) || 0) + 1);
      eventTypeCounts.set(eventType, (eventTypeCounts.get(eventType) || 0) + 1);

      const tags = parseArrayJson(row.tags_json);
      for (const tag of tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }

      const createdMs = Date.parse(row.created_at || "");
      if (!Number.isNaN(createdMs)) {
        const ageHours = (now - createdMs) / (1000 * 60 * 60);
        if (ageHours <= 24) {
          timeBucketCounts.set("24h", (timeBucketCounts.get("24h") || 0) + 1);
        } else if (ageHours <= 24 * 7) {
          timeBucketCounts.set("7d", (timeBucketCounts.get("7d") || 0) + 1);
        } else if (ageHours <= 24 * 30) {
          timeBucketCounts.set("30d", (timeBucketCounts.get("30d") || 0) + 1);
        } else {
          timeBucketCounts.set("older", (timeBucketCounts.get("older") || 0) + 1);
        }
      }
    }

    const toFacetArray = (map: Map<string, number>) =>
      [...map.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort(
          (lhs, rhs) => rhs.count - lhs.count || lhs.value.localeCompare(rhs.value)
        );

    return makeResponse(
      startedAt,
      [
        {
          query: query || null,
          total_candidates: rows.length,
          projects: toFacetArray(projectCounts).slice(0, 30),
          event_types: toFacetArray(eventTypeCounts).slice(0, 20),
          tags: toFacetArray(tagCounts).slice(0, 50),
          time_buckets: toFacetArray(timeBucketCounts),
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

    const includePrivate = Boolean(request.include_private);

    if (!includePrivate) {
      const centerPrivacyTags = parseArrayJson(
        typeof center.privacy_tags_json === "string" ? center.privacy_tags_json : "[]"
      );
      if (isPrivateTag(centerPrivacyTags)) {
        return makeErrorResponse(startedAt, `observation not found: ${request.id}`, {
          id: request.id,
        });
      }
    }

    const centerProject = typeof center.project === "string" ? center.project : "";
    const centerSession = typeof center.session_id === "string" ? center.session_id : "";
    const centerCreatedAt =
      typeof center.created_at === "string" ? center.created_at : nowIso();
    const visibility = visibilityFilterSql("o", includePrivate);

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
      .all(centerProject, centerSession, centerCreatedAt, before) as Array<
      Record<string, unknown>
    >;

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
      .all(centerProject, centerSession, centerCreatedAt, after) as Array<
      Record<string, unknown>
    >;

    const normalizeItem = (
      row: Record<string, unknown>,
      position: "before" | "center" | "after"
    ) => ({
      id: row.id,
      position,
      created_at: row.created_at,
      title: row.title,
      content:
        typeof row.content_redacted === "string" ? row.content_redacted.slice(0, 1200) : "",
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

    const observationMap = loadObservations(this.deps.db, ids);
    const includePrivate = Boolean(request.include_private);
    const compact = request.compact !== false;

    const items: Array<Record<string, unknown>> = [];
    for (const id of ids) {
      const row = observationMap.get(id);
      if (!row) continue;

      const privacyTags = parseArrayJson(row.privacy_tags_json);
      if (!includePrivate && isPrivateTag(privacyTags)) continue;

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

  // ---------------------------------------------------------------------------
  // resumePack
  // ---------------------------------------------------------------------------

  resumePack(request: ResumePackRequest): ApiResponse {
    const startedAt = performance.now();

    if (!this.deps.config.injectionEnabled) {
      return makeResponse(startedAt, [], request as unknown as Record<string, unknown>, { injection_enabled: false });
    }

    if (!request.project) {
      return makeErrorResponse(startedAt, "project is required", request as unknown as Record<string, unknown>);
    }

    const normalizedProject = this.deps.normalizeProject(request.project);
    const limit = clampLimit(request.limit, 5, 1, 20);
    const includePrivate = Boolean(request.include_private);
    const visibility = visibilityFilterSql("o", includePrivate);

    // max_tokens: request > config > env > default (2000)
    const requestedBudget = request.resume_pack_max_tokens;
    const maxTokens: number = (() => {
      if (typeof requestedBudget === "number" && requestedBudget >= 0) {
        return requestedBudget;
      }
      if (typeof this.deps.config.resumePackMaxTokens === "number" && this.deps.config.resumePackMaxTokens > 0) {
        return this.deps.config.resumePackMaxTokens;
      }
      const envRaw = Number(process.env.HARNESS_MEM_RESUME_PACK_MAX_TOKENS);
      if (Number.isFinite(envRaw) && envRaw > 0) {
        return envRaw;
      }
      return 2000;
    })();

    if (maxTokens === 0) {
      return makeResponse(startedAt, [], request as unknown as Record<string, unknown>, {
        include_summary: false,
        correlation_id: request.correlation_id ?? null,
        compaction_ratio: 0,
        resume_pack_max_tokens: 0,
        detailed_count: 0,
        compacted_count: 0,
      });
    }

    const useCorrelationId = Boolean(request.correlation_id);
    const correlationId = request.correlation_id ?? null;

    const latestSummary = this.deps.db
      .query(
        `
          SELECT s.session_id, s.summary, s.ended_at
          FROM mem_sessions s
          WHERE s.project = ?
          ${useCorrelationId ? "AND s.correlation_id = ?" : "AND s.summary IS NOT NULL"}
          ORDER BY s.ended_at DESC
          LIMIT 1
        `
      )
      .get(...(useCorrelationId ? [normalizedProject, correlationId as string] : [normalizedProject])) as { session_id: string; summary: string; ended_at: string } | null;

    let rows: Array<Record<string, unknown>>;

    if (useCorrelationId) {
      rows = this.deps.db
        .query(
          `
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
            JOIN mem_sessions s ON o.session_id = s.session_id
            LEFT JOIN mem_events e ON o.event_id = e.event_id
            WHERE o.project = ?
              AND s.correlation_id = ?
              ${request.session_id ? "AND o.session_id <> ?" : ""}
            ${visibility}
            ORDER BY o.created_at DESC
            LIMIT ?
          `
        )
        .all(...(request.session_id ? [normalizedProject, correlationId as string, request.session_id, limit] : [normalizedProject, correlationId as string, limit])) as Array<Record<string, unknown>>;
    } else {
      rows = this.deps.db
        .query(
          `
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
            LEFT JOIN mem_events e ON o.event_id = e.event_id
            WHERE o.project = ?
            ${request.session_id ? "AND o.session_id <> ?" : ""}
            ${visibility}
            ORDER BY o.created_at DESC
            LIMIT ?
          `
        )
        .all(...(request.session_id ? [normalizedProject, request.session_id, limit] : [normalizedProject, limit])) as Array<Record<string, unknown>>;
    }

    interface RankedRow {
      row: Record<string, unknown>;
      score: number;
    }
    const rankedRows: RankedRow[] = rows.map((row) => {
      const eventType = typeof row.event_type === "string" ? row.event_type : "";
      const importance = typeof EVENT_TYPE_IMPORTANCE[eventType] === "number" ? EVENT_TYPE_IMPORTANCE[eventType] : 0.5;
      const recency = recencyScore(typeof row.created_at === "string" ? row.created_at : "");
      return { row, score: importance * recency };
    });
    rankedRows.sort((a, b) => b.score - a.score);

    const summaryTokens = latestSummary ? estimateTokenCount(latestSummary.summary ?? "") : 0;
    const observationBudget = Math.max(0, maxTokens - summaryTokens);

    const detailedItems: Array<Record<string, unknown>> = [];
    const compactItems: Array<Record<string, unknown>> = [];
    let usedTokens = 0;
    let originalTokens = 0;

    for (const { row } of rankedRows) {
      const content = typeof row.content_redacted === "string" ? row.content_redacted.slice(0, 800) : "";
      const fullItem = {
        id: row.id,
        type: "observation",
        event_id: row.event_id,
        platform: row.platform,
        project: row.project,
        session_id: row.session_id,
        title: row.title,
        content,
        created_at: row.created_at,
        tags: parseArrayJson(row.tags_json),
        privacy_tags: parseArrayJson(row.privacy_tags_json),
      };
      const fullTokens = estimateTokenCount(JSON.stringify(fullItem));
      originalTokens += fullTokens;

      if (usedTokens + fullTokens <= observationBudget) {
        detailedItems.push(fullItem);
        usedTokens += fullTokens;
      } else {
        const title = typeof row.title === "string" && row.title.length > 0 ? row.title : typeof row.id === "string" ? row.id : "observation";
        const date = typeof row.created_at === "string" ? row.created_at.slice(0, 10) : "";
        const summaryLine = `- ${title} (${date})`;
        compactItems.push({
          id: row.id,
          type: "observation_summary",
          title,
          created_at: row.created_at,
          summary: summaryLine,
        });
        usedTokens += estimateTokenCount(summaryLine);
      }
    }

    const compressedTokens = summaryTokens + usedTokens;
    const totalOriginalTokens = summaryTokens + originalTokens;
    const compaction_ratio = totalOriginalTokens > 0
      ? Math.max(0, 1 - compressedTokens / totalOriginalTokens)
      : 0;

    const items: Array<Record<string, unknown>> = [];

    if (latestSummary) {
      items.push({
        id: `session:${latestSummary.session_id}`,
        type: "session_summary",
        session_id: latestSummary.session_id,
        summary: latestSummary.summary,
        ended_at: latestSummary.ended_at,
      });
    }
    for (const item of detailedItems) items.push(item);
    for (const item of compactItems) items.push(item);

    const activeFacts = this.deps.db
      .query(
        `
          SELECT fact_type, fact_key, fact_value, confidence
          FROM mem_facts
          WHERE project = ?
            AND merged_into_fact_id IS NULL
            AND superseded_by IS NULL
          ORDER BY fact_type ASC, fact_key ASC, created_at ASC
        `
      )
      .all(normalizedProject) as Array<{
        fact_type: string;
        fact_key: string;
        fact_value: string;
        confidence: number;
      }>;

    interface StaticSection {
      content: string;
      content_hash: string;
      cache_hint: "stable";
      fact_count: number;
    }

    interface DynamicSection {
      content: string;
      cache_hint: "volatile";
      observation_count: number;
    }

    let static_section: StaticSection | undefined;
    let dynamic_section: DynamicSection | undefined;

    if (activeFacts.length > 0) {
      const factLines = activeFacts.map(
        (f) => `[${f.fact_type}] ${f.fact_key}: ${f.fact_value} (confidence=${f.confidence.toFixed(2)})`
      );
      const staticContent = `# Project Facts\n\n${factLines.join("\n")}`;
      const contentHash = createHash("sha256").update(staticContent, "utf8").digest("hex");
      static_section = {
        content: staticContent,
        content_hash: contentHash,
        cache_hint: "stable",
        fact_count: activeFacts.length,
      };
    }

    const dynamicLines: string[] = [];
    if (latestSummary) {
      dynamicLines.push(`## Session Summary (${latestSummary.session_id})\n${latestSummary.summary}`);
    }
    if (detailedItems.length > 0) {
      dynamicLines.push(
        "## Recent Observations\n" +
          detailedItems
            .map((item) => {
              const title = typeof item.title === "string" ? item.title : String(item.id);
              const content = typeof item.content === "string" ? item.content.slice(0, 200) : "";
              const date = typeof item.created_at === "string" ? item.created_at.slice(0, 10) : "";
              return `### ${title} (${date})\n${content}`;
            })
            .join("\n\n")
      );
    }
    if (compactItems.length > 0) {
      dynamicLines.push(
        "## Compacted Observations\n" +
          compactItems.map((item) => (typeof item.summary === "string" ? item.summary : String(item.id))).join("\n")
      );
    }

    if (dynamicLines.length > 0) {
      dynamic_section = {
        content: dynamicLines.join("\n\n"),
        cache_hint: "volatile",
        observation_count: detailedItems.length + compactItems.length,
      };
    }

    return makeResponse(startedAt, items, request as unknown as Record<string, unknown>, {
      include_summary: Boolean(latestSummary),
      correlation_id: request.correlation_id ?? null,
      compaction_ratio: Math.round(compaction_ratio * 1000) / 1000,
      resume_pack_max_tokens: maxTokens,
      detailed_count: detailedItems.length,
      compacted_count: compactItems.length,
      ...(static_section !== undefined ? { static_section } : {}),
      ...(dynamic_section !== undefined ? { dynamic_section } : {}),
    });
  }
}
