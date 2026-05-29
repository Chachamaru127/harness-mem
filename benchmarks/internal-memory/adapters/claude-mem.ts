import type { BenchmarkCase } from "../lib/types";
import type { AdapterQueryResult, AdapterRunContext } from "../lib/types";
import { httpSearchQuery } from "./http-search";
import type { MemoryBenchmarkAdapter } from "./types";

export class ClaudeMemAdapter implements MemoryBenchmarkAdapter {
  readonly id = "claude-mem";

  private readonly baseUrl =
    process.env.CLAUDE_MEM_BASE_URL?.trim() ??
    process.env.HARNESS_MEM_BASE_URL?.trim() ??
    "http://127.0.0.1:37888";
  private readonly token = process.env.HARNESS_MEM_TOKEN?.trim() ?? process.env.CLAUDE_MEM_TOKEN?.trim();

  private scopedProject(caseRow: BenchmarkCase, context: AdapterRunContext): string {
    return `${context.project_prefix}:${caseRow.project}`;
  }

  async prepareCase(): Promise<void> {
    // Claude-mem Phase 1 uses harness-mem compatible search against an existing daemon when configured.
  }

  async query(caseRow: BenchmarkCase, context: AdapterRunContext): Promise<AdapterQueryResult> {
    return httpSearchQuery(
      {
        competitorId: this.id,
        baseUrl: this.baseUrl,
        token: this.token,
        searchPath: "/v1/search",
      },
      caseRow,
      this.scopedProject(caseRow, context),
    );
  }

  async dispose(): Promise<void> {}
}
