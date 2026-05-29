import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HarnessMemCore,
  type Config,
} from "../../../memory-server/src/core/harness-mem-core";
import type { BenchmarkCase } from "../lib/types";
import type { AdapterQueryResult, AdapterRunContext } from "../lib/types";
import type { MemoryBenchmarkAdapter } from "./types";

export class HarnessMemAdapter implements MemoryBenchmarkAdapter {
  readonly id = "harness-mem";

  private core: HarnessMemCore | null = null;
  private tempDir: string | null = null;
  private readonly prepared = new Set<string>();

  private async ensureCore(): Promise<HarnessMemCore> {
    if (this.core) return this.core;
    this.tempDir = mkdtempSync(join(tmpdir(), "internal-mem-bench-"));
    const config: Config = {
      dbPath: join(this.tempDir, "harness-mem.db"),
      bindHost: "127.0.0.1",
      bindPort: 0,
      vectorDimension: 384,
      embeddingProvider: "local",
      captureEnabled: true,
      retrievalEnabled: true,
      injectionEnabled: true,
      codexHistoryEnabled: false,
      codexProjectRoot: process.cwd(),
      codexSessionsRoot: process.cwd(),
      codexIngestIntervalMs: 5000,
      codexBackfillHours: 24,
      opencodeIngestEnabled: false,
      cursorIngestEnabled: false,
      antigravityIngestEnabled: false,
      rerankerEnabled: false,
    };
    this.core = new HarnessMemCore(config);
    await this.waitReady(this.core);
    return this.core;
  }

  private async waitReady(core: HarnessMemCore): Promise<void> {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const readiness = core.readiness();
      const item = ((readiness.items?.[0] ?? {}) as Record<string, unknown>);
      if (item.ready === true) return;
      try {
        await core.primeEmbedding("__ready__", "passage");
        await core.primeEmbedding("__ready__", "query");
      } catch {
        // retry until timeout
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("harness-mem embedding warmup timeout");
  }

  private scopedProject(caseRow: BenchmarkCase, context: AdapterRunContext): string {
    return `${context.project_prefix}:${caseRow.project}`;
  }

  async prepareCase(caseRow: BenchmarkCase, context: AdapterRunContext): Promise<void> {
    const key = `${context.competitor_id}:${caseRow.case_id}`;
    if (this.prepared.has(key)) return;

    const core = await this.ensureCore();
    const project = this.scopedProject(caseRow, context);
    for (const memory of caseRow.memories) {
      await core.primeEmbedding(memory.content, "passage");
      core.recordEvent({
        event_id: memory.id,
        platform: "cursor",
        project,
        session_id: `bench-${caseRow.case_id}`,
        event_type: "user_prompt",
        ts: memory.timestamp ?? new Date().toISOString(),
        payload: { content: memory.content },
        tags: caseRow.workspace_id ? [`workspace:${caseRow.workspace_id}`] : [],
        privacy_tags: [],
      });
    }
    this.prepared.add(key);
  }

  async query(caseRow: BenchmarkCase, context: AdapterRunContext): Promise<AdapterQueryResult> {
    const core = await this.ensureCore();
    const project = this.scopedProject(caseRow, context);
    await core.primeEmbedding(caseRow.query, "query");
    const started = performance.now();
    const response = core.search({
      query: caseRow.query,
      project,
      limit: 10,
      strict_project: true,
      question_kind: "hybrid",
    });
    const latency_ms = performance.now() - started;
    const items = ((response.items ?? []) as Array<Record<string, unknown>>);
    const hits = items.map((item, index) => ({
      id: String(item.id ?? item.observation_id ?? `rank-${index + 1}`),
      rank: index + 1,
      content: String(item.content ?? item.summary ?? item.title ?? ""),
      score: typeof item.score === "number" ? item.score : undefined,
    }));

    return {
      status: "ok",
      hits,
      latency_ms,
      tokens_estimate: Math.ceil((caseRow.query.length + hits.map((h) => h.content).join(" ").length) / 4),
      metadata: { mode: "in-process" },
    };
  }

  async dispose(): Promise<void> {
    this.core = null;
    this.tempDir = null;
    this.prepared.clear();
  }
}
