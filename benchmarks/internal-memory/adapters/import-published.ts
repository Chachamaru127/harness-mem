import type { BenchmarkCase } from "../lib/types";
import type { AdapterQueryResult, AdapterRunContext } from "../lib/types";
import type { MemoryBenchmarkAdapter } from "./types";

/**
 * Published (reference-only) competitor values.
 *
 * These are NEVER mixed with locally reproduced numbers. `recall_at_10` is the
 * published claim where a comparable number exists, or `null` when no
 * comparable published retrieval@10 benchmark is available (reference-only).
 * Live measurement of agentmemory / supermemory / claude-mem is opt-in via the
 * runner `--competitors <id>` flag; only then are they treated as reproduced.
 */
export interface PublishedReference {
  recall_at_10: number | null;
  domain: string;
  source: string;
  note: string;
  reference_only: true;
}

export const PUBLISHED_REFERENCES: Record<string, PublishedReference> = {
  agentmemory: {
    recall_at_10: null,
    domain: "generic-agent",
    source: "Vendor docs / marketing — no comparable published retrieval@10 benchmark.",
    note: "Reference only, not reproduced. Run --competitors agentmemory with credentials to live-measure.",
    reference_only: true,
  },
  supermemory: {
    recall_at_10: null,
    domain: "generic-agent",
    source: "Vendor docs / marketing — no comparable published retrieval@10 benchmark.",
    note: "Reference only, not reproduced. Run --competitors supermemory with credentials to live-measure.",
    reference_only: true,
  },
  "claude-mem": {
    recall_at_10: null,
    domain: "developer-workflow",
    source: "No published benchmark — community project.",
    note: "Reference only, not reproduced. Run --competitors claude-mem against a compatible /v1/search endpoint to live-measure.",
    reference_only: true,
  },
  mem0: {
    recall_at_10: null,
    domain: "generic-agent",
    source: "Mem0 LoCoMo / marketing claims.",
    note: "Reference only — no reproduced number recorded here. Domain (generic-agent) differs from developer-workflow.",
    reference_only: true,
  },
  mempalace: {
    recall_at_10: 0.966,
    domain: "general-lifelog",
    source: "LongMemEval paper claim (96.6%).",
    note: "Reference only, not reproduced. general-lifelog domain mismatch with developer-workflow; not comparable to harness-mem scores.",
    reference_only: true,
  },
};

export function getPublishedReference(id: string): PublishedReference | undefined {
  return PUBLISHED_REFERENCES[id];
}

export class ImportPublishedAdapter implements MemoryBenchmarkAdapter {
  constructor(readonly id: string) {}

  async prepareCase(): Promise<void> {}

  async query(caseRow: BenchmarkCase, _context: AdapterRunContext): Promise<AdapterQueryResult> {
    const ref = PUBLISHED_REFERENCES[this.id];
    const reason = ref
      ? `published(reference-only): ${ref.note}`
      : "published(reference-only): no published value frame";
    return {
      status: "skipped_missing_credentials",
      hits: [],
      latency_ms: 0,
      skip_reason: reason,
      metadata: {
        measurement: "published",
        reference_only: true,
        published_recall_at_10: ref?.recall_at_10 ?? null,
        published_source: ref?.source ?? null,
        case_id: caseRow.case_id,
      },
    };
  }

  async dispose(): Promise<void> {}
}
