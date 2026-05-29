import { AgentmemoryAdapter } from "../adapters/agentmemory";
import { ClaudeMemAdapter } from "../adapters/claude-mem";
import { HarnessMemAdapter } from "../adapters/harness-mem";
import { ImportPublishedAdapter } from "../adapters/import-published";
import { SupermemoryAdapter } from "../adapters/supermemory";
import type { MemoryBenchmarkAdapter } from "../adapters/types";

export function createAdapter(competitorId: string): MemoryBenchmarkAdapter {
  switch (competitorId) {
    case "harness-mem":
      return new HarnessMemAdapter();
    case "agentmemory":
      return new AgentmemoryAdapter();
    case "supermemory":
      return new SupermemoryAdapter();
    case "claude-mem":
      return new ClaudeMemAdapter();
    case "mem0":
      return new ImportPublishedAdapter("mem0");
    case "mempalace":
      return new ImportPublishedAdapter("mempalace");
    default:
      throw new Error(`unknown competitor: ${competitorId}`);
  }
}

/**
 * Default reproduced (locally measured) target. Only harness-mem is measured
 * by default; every other competitor is treated as published (reference-only).
 */
export const DEFAULT_REPRODUCED_COMPETITORS = ["harness-mem"] as const;

/**
 * Competitors carried as published reference-only rows. They are rendered in a
 * separate table and are never mixed into the reproduced ranking.
 */
export const PUBLISHED_REFERENCE_COMPETITORS = [
  "agentmemory",
  "supermemory",
  "claude-mem",
  "mem0",
  "mempalace",
] as const;

/**
 * External competitors that can be live-measured opt-in by passing them to
 * `--competitors`. When live-measured they move from published to reproduced.
 */
export const OPTIONAL_LIVE_COMPETITORS = ["agentmemory", "supermemory", "claude-mem"] as const;
