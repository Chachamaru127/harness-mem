import type { BenchmarkCase } from "../lib/types";
import type { AdapterQueryResult, AdapterRunContext } from "../lib/types";
import { httpIngestMemories, httpSearchQuery } from "./http-search";
import type { MemoryBenchmarkAdapter } from "./types";

export class AgentmemoryAdapter implements MemoryBenchmarkAdapter {
  readonly id = "agentmemory";

  private readonly baseUrl = process.env.AGENTMEMORY_BASE_URL?.trim() ?? "";
  private readonly token = process.env.AGENTMEMORY_API_KEY?.trim();

  private missingCredentials(): AdapterQueryResult {
    return {
      status: "skipped_missing_credentials",
      hits: [],
      latency_ms: 0,
      skip_reason: "AGENTMEMORY_BASE_URL is not set",
    };
  }

  private scopedProject(caseRow: BenchmarkCase, context: AdapterRunContext): string {
    return `${context.project_prefix}:${caseRow.project}`;
  }

  async prepareCase(caseRow: BenchmarkCase, context: AdapterRunContext): Promise<void> {
    if (!this.baseUrl) return;
    await httpIngestMemories(
      {
        competitorId: this.id,
        baseUrl: this.baseUrl,
        token: this.token,
        ingestPath: process.env.AGENTMEMORY_INGEST_PATH ?? "/v1/memories",
      },
      caseRow,
      this.scopedProject(caseRow, context),
    );
  }

  async query(caseRow: BenchmarkCase, context: AdapterRunContext): Promise<AdapterQueryResult> {
    if (!this.baseUrl) return this.missingCredentials();
    return httpSearchQuery(
      {
        competitorId: this.id,
        baseUrl: this.baseUrl,
        token: this.token,
        searchPath: process.env.AGENTMEMORY_SEARCH_PATH ?? "/v1/search",
      },
      caseRow,
      this.scopedProject(caseRow, context),
    );
  }

  async dispose(): Promise<void> {}
}
