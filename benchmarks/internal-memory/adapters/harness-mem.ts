import { mkdtempSync, rmSync } from "node:fs";
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
  /** Dedupe seeded memories across cases that share the same row corpus. */
  private readonly seededMemoryKeys = new Set<string>();
  /** Dedupe passage embedding primes across cases (real-data v2 has repeated corpus). */
  private readonly primedPassages = new Set<string>();

  private async ensureCore(): Promise<HarnessMemCore> {
    if (this.core) return this.core;
    this.tempDir = mkdtempSync(join(tmpdir(), "internal-mem-bench-"));
    const useLocalEmbedding = process.env.HARNESS_MEM_INTERNAL_BENCH_EMBEDDING === "1";
    const useSearchOffload = process.env.HARNESS_MEM_INTERNAL_BENCH_SEARCH_OFFLOAD === "1";
    if (!useSearchOffload) {
      // The benchmark uses a small temp DB; persistent search-worker offload can
      // stall long scale runs at worker boundaries without improving fidelity.
      process.env.HARNESS_MEM_SEARCH_OFFLOAD = "0";
      process.env.HARNESS_MEM_SEARCH_WORKER = "0";
    }
    const config: Config = {
      dbPath: join(this.tempDir, "harness-mem.db"),
      bindHost: "127.0.0.1",
      bindPort: 0,
      vectorDimension: 384,
      // Scale real-data v2 (~1400 cases) uses hash fallback for wall-clock sanity;
      // set HARNESS_MEM_INTERNAL_BENCH_EMBEDDING=1 for ONNX smoke tests.
      embeddingProvider: useLocalEmbedding ? "local" : "fallback",
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

  /** Shared row session for MemoryAgentBench; per-case session for other datasets. */
  private benchSessionId(caseRow: BenchmarkCase): string {
    const mabMemory = caseRow.memories.find((memory) => /^mab-.+-m\d+$/.test(memory.id));
    if (mabMemory) {
      return `bench-${mabMemory.id.replace(/-m\d+$/, "")}`;
    }
    if (caseRow.case_id.startsWith("mab-") && caseRow.source_split) {
      const prefix = `mab-${caseRow.source_split}-`;
      if (caseRow.case_id.startsWith(prefix)) {
        const row = caseRow.case_id.slice(prefix.length).split("-")[0];
        if (row) return `bench-mab-${caseRow.source_split}-${row}`;
      }
    }
    return `bench-${caseRow.case_id}`;
  }

  /** @internal benchmark tests only */
  benchSessionIdForCase(caseRow: BenchmarkCase): string {
    return this.benchSessionId(caseRow);
  }

  /** @internal benchmark tests only */
  seededMemoryKeyCount(): number {
    return this.seededMemoryKeys.size;
  }

  async prepareCase(caseRow: BenchmarkCase, context: AdapterRunContext): Promise<void> {
    const key = `${context.competitor_id}:${caseRow.case_id}`;
    if (this.prepared.has(key)) return;

    const core = await this.ensureCore();
    const project = this.scopedProject(caseRow, context);
    const sessionId = this.benchSessionId(caseRow);
    for (const memory of caseRow.memories) {
      const memoryKey = `${project}:${memory.id}`;
      if (this.seededMemoryKeys.has(memoryKey)) continue;

      const passageKey = `${memory.content.length}:${memory.content.slice(0, 256)}`;
      if (!this.primedPassages.has(passageKey)) {
        await core.primeEmbedding(memory.content, "passage");
        this.primedPassages.add(passageKey);
      }
      core.recordEvent({
        event_id: memory.id,
        platform: "cursor",
        project,
        session_id: sessionId,
        event_type: "user_prompt",
        ts: memory.timestamp ?? new Date().toISOString(),
        payload: { content: memory.content },
        tags: caseRow.workspace_id ? [`workspace:${caseRow.workspace_id}`] : [],
        privacy_tags: [],
      });
      this.seededMemoryKeys.add(memoryKey);
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
      session_id: this.benchSessionId(caseRow),
      limit: 10,
      strict_project: true,
      safe_mode: true,
      vector_search: false,
      graph_weight: 0,
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
    this.core?.shutdown("internal-memory-benchmark");
    this.core = null;
    if (this.tempDir) {
      rmSync(this.tempDir, { recursive: true, force: true });
    }
    this.tempDir = null;
    this.prepared.clear();
    this.seededMemoryKeys.clear();
    this.primedPassages.clear();
  }
}
