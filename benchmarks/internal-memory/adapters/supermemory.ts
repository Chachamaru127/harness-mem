import type { BenchmarkCase } from "../lib/types";
import type { AdapterQueryResult, AdapterRunContext } from "../lib/types";
import { httpSearchQuery } from "./http-search";
import type { MemoryBenchmarkAdapter } from "./types";

export class SupermemoryAdapter implements MemoryBenchmarkAdapter {
  readonly id = "supermemory";

  private readonly apiKey = process.env.SUPERMEMORY_API_KEY?.trim() ?? "";
  private readonly baseUrl =
    process.env.SUPERMEMORY_BASE_URL?.trim() ?? "https://api.supermemory.ai";

  private missingCredentials(): AdapterQueryResult {
    return {
      status: "skipped_missing_credentials",
      hits: [],
      latency_ms: 0,
      skip_reason: "SUPERMEMORY_API_KEY is not set",
    };
  }

  async prepareCase(): Promise<void> {
    // Supermemory ingest is account-scoped; benchmark assumes pre-seeded or API search-only for Phase 1.
  }

  async query(caseRow: BenchmarkCase, context: AdapterRunContext): Promise<AdapterQueryResult> {
    if (!this.apiKey) return this.missingCredentials();
    const result = await httpSearchQuery(
      {
        competitorId: this.id,
        baseUrl: this.baseUrl,
        token: this.apiKey,
        searchPath: process.env.SUPERMEMORY_SEARCH_PATH ?? "/v3/search",
        projectField: "containerTag",
      },
      caseRow,
      `${context.project_prefix}:${caseRow.project}`,
    );
    return {
      ...result,
      metadata: {
        ...(result.metadata ?? {}),
        external_api_required: true,
        cost_proxy: "per_request",
      },
    };
  }

  async dispose(): Promise<void> {}
}
