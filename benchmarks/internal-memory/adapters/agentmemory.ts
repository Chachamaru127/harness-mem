import type { BenchmarkCase } from "../lib/types";
import type { AdapterQueryResult, AdapterRunContext } from "../lib/types";
import {
  agentmemoryHealthCheck,
  agentmemoryRememberMemories,
  agentmemorySmartSearch,
  resolveAgentmemoryConfig,
} from "./agentmemory-rest";
import type { MemoryBenchmarkAdapter } from "./types";

export class AgentmemoryAdapter implements MemoryBenchmarkAdapter {
  readonly id = "agentmemory";

  private readonly config = resolveAgentmemoryConfig();
  private preflightOk: boolean | null = null;

  private scopedProject(caseRow: BenchmarkCase, context: AdapterRunContext): string {
    return `${context.project_prefix}:${caseRow.project}`;
  }

  private async ensureReady(): Promise<AdapterQueryResult | null> {
    if (this.preflightOk === true) return null;
    if (this.preflightOk === false) {
      return {
        status: "skipped_missing_credentials",
        hits: [],
        latency_ms: 0,
        skip_reason: `agentmemory health check failed at ${this.config.baseUrl}/agentmemory/health`,
      };
    }
    try {
      const ok = await agentmemoryHealthCheck(this.config);
      this.preflightOk = ok;
      if (!ok) {
        return {
          status: "skipped_missing_credentials",
          hits: [],
          latency_ms: 0,
          skip_reason: `agentmemory health check failed at ${this.config.baseUrl}/agentmemory/health`,
        };
      }
      return null;
    } catch (error) {
      this.preflightOk = false;
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: "skipped_missing_credentials",
        hits: [],
        latency_ms: 0,
        skip_reason: `agentmemory unreachable: ${message}`,
      };
    }
  }

  async prepareCase(caseRow: BenchmarkCase, context: AdapterRunContext): Promise<void> {
    const blocked = await this.ensureReady();
    if (blocked) return;
    await agentmemoryRememberMemories(
      this.config,
      caseRow,
      this.scopedProject(caseRow, context),
    );
  }

  async query(caseRow: BenchmarkCase, context: AdapterRunContext): Promise<AdapterQueryResult> {
    const blocked = await this.ensureReady();
    if (blocked) return blocked;
    return agentmemorySmartSearch(
      this.config,
      caseRow,
      this.scopedProject(caseRow, context),
    );
  }

  async dispose(): Promise<void> {}
}
