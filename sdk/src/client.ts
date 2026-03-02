/**
 * @harness-mem/sdk - HTTP Client
 *
 * Provides a typed TypeScript client for the harness-mem memory server API.
 */

import type {
  HarnessMemClientOptions,
  ApiResponse,
  RecordEventInput,
  SearchInput,
  SearchResultItem,
  ResumePackInput,
  TimelineInput,
  GetObservationsInput,
  ObservationItem,
  RecordCheckpointInput,
  FinalizeSessionInput,
  SessionFinalizeItem,
  ConsolidationRunInput,
  AuditLogInput,
  AuditLogItem,
  SearchFacetsInput,
} from "./types.js";

export class HarnessMemClient {
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(options: HarnessMemClientOptions = {}) {
    this.baseUrl = (options.baseUrl || "http://localhost:37888").replace(/\/$/, "");
    this.timeout = options.timeout ?? 10_000;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: body ? { "content-type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const data = await response.json() as ApiResponse<T>;
      return data;
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        return {
          ok: false,
          source: "sdk",
          items: [],
          meta: {} as Record<string, unknown>,
          error: `Request timeout after ${this.timeout}ms`,
        };
      }
      return {
        ok: false,
        source: "sdk",
        items: [],
        meta: {} as Record<string, unknown>,
        error: String(err),
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Record an event to the memory server.
   * Maps to POST /v1/events/record
   */
  async record(input: RecordEventInput): Promise<ApiResponse<{ id: string }>> {
    return this.request<{ id: string }>("POST", "/v1/events/record", input);
  }

  /**
   * Search observations using hybrid (lexical + vector + graph) ranking.
   * Maps to POST /v1/search
   */
  async search(input: SearchInput): Promise<ApiResponse<SearchResultItem>> {
    return this.request<SearchResultItem>("POST", "/v1/search", input);
  }

  /**
   * Get a condensed resume pack for context injection.
   * Maps to POST /v1/resume-pack
   */
  async resumePack(input: ResumePackInput): Promise<ApiResponse<Record<string, unknown>>> {
    return this.request<Record<string, unknown>>("POST", "/v1/resume-pack", input);
  }

  /**
   * Get timeline context around a specific observation.
   * Maps to POST /v1/timeline
   */
  async timeline(input: TimelineInput): Promise<ApiResponse<ObservationItem>> {
    return this.request<ObservationItem>("POST", "/v1/timeline", input);
  }

  /**
   * Get full details of specific observations by ID.
   * Maps to POST /v1/observations/get
   */
  async getObservations(input: GetObservationsInput): Promise<ApiResponse<ObservationItem>> {
    return this.request<ObservationItem>("POST", "/v1/observations/get", input);
  }

  /**
   * Record a checkpoint for a session.
   * Maps to POST /v1/checkpoints/record
   */
  async recordCheckpoint(input: RecordCheckpointInput): Promise<ApiResponse<ObservationItem>> {
    return this.request<ObservationItem>("POST", "/v1/checkpoints/record", input);
  }

  /**
   * Finalize a session (generate summary and close).
   * Maps to POST /v1/sessions/finalize
   */
  async finalizeSession(input: FinalizeSessionInput): Promise<ApiResponse<SessionFinalizeItem>> {
    return this.request<SessionFinalizeItem>("POST", "/v1/sessions/finalize", input);
  }

  /**
   * Trigger a consolidation run.
   * Maps to POST /v1/admin/consolidation/run
   */
  async runConsolidation(input: ConsolidationRunInput = {}): Promise<ApiResponse<Record<string, unknown>>> {
    return this.request<Record<string, unknown>>("POST", "/v1/admin/consolidation/run", input);
  }

  /**
   * Get consolidation queue status.
   * Maps to GET /v1/admin/consolidation/status
   */
  async consolidationStatus(): Promise<ApiResponse<Record<string, unknown>>> {
    return this.request<Record<string, unknown>>("GET", "/v1/admin/consolidation/status");
  }

  /**
   * Get audit log entries.
   * Maps to GET /v1/admin/audit-log
   */
  async auditLog(input: AuditLogInput = {}): Promise<ApiResponse<AuditLogItem>> {
    const params = new URLSearchParams();
    if (input.limit !== undefined) params.set("limit", String(input.limit));
    if (input.action) params.set("action", input.action);
    if (input.target_type) params.set("target_type", input.target_type);
    const qs = params.toString();
    return this.request<AuditLogItem>("GET", `/v1/admin/audit-log${qs ? `?${qs}` : ""}`);
  }

  /**
   * Get search facets (aggregated metadata about search results).
   * Maps to GET /v1/search/facets
   */
  async searchFacets(input: SearchFacetsInput = {}): Promise<ApiResponse<Record<string, unknown>>> {
    const params = new URLSearchParams();
    if (input.query) params.set("query", input.query);
    if (input.project) params.set("project", input.project);
    if (input.include_private) params.set("include_private", "true");
    const qs = params.toString();
    return this.request<Record<string, unknown>>("GET", `/v1/search/facets${qs ? `?${qs}` : ""}`);
  }

  /**
   * Check server health.
   * Maps to GET /health
   */
  async health(): Promise<ApiResponse<Record<string, unknown>>> {
    return this.request<Record<string, unknown>>("GET", "/health");
  }
}
