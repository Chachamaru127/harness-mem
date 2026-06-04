import { HarnessMemCore } from "../../memory-server/src/core/harness-mem-core";
import {
  buildQueryVariants,
  detectQuestionKind,
  resolveSearchPolicy,
  synthesizeLocomoAnswer,
  type AnswerTraceCandidate,
  type LocomoAnswerTrace,
  type LocomoSearchItem,
} from "./locomo-answer-synth";
import { type LocomoSample } from "./locomo-loader";

export type { AnswerTraceCandidate, LocomoAnswerTrace as HarnessLocomoAnswerTrace };

export interface HarnessLocomoReplayResult {
  prediction: string;
  search_hit_count: number;
  candidate_ids: string[];
  selected_evidence_ids: string[];
  answer_strategy: string;
  question_kind: string;
  answer_trace: LocomoAnswerTrace;
  search_latency_ms: number;
  token_estimate_input_tokens: number;
  token_estimate_output_tokens: number;
  token_estimate_total_tokens: number;
}

export interface HarnessLocomoAdapterOptions {
  project: string;
  session_id?: string;
}

interface AnswerQuestionOptions {
  category?: string;
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export class HarnessMemLocomoAdapter {
  private readonly sessionId: string;

  constructor(
    private readonly core: HarnessMemCore,
    private readonly options: HarnessLocomoAdapterOptions
  ) {
    this.sessionId = options.session_id || "locomo-session";
  }

  private getPrimeEmbeddingInvoker():
    | ((text: string, mode?: "passage" | "query") => unknown)
    | null {
    const maybeCore = this.core as unknown as {
      primeEmbedding?: (text: string, mode?: "passage" | "query") => unknown;
    };
    if (typeof maybeCore.primeEmbedding !== "function") {
      return null;
    }
    return maybeCore.primeEmbedding.bind(this.core);
  }

  private async primeEmbeddingTexts(
    texts: string[],
    mode: "passage" | "query" = "passage"
  ): Promise<boolean> {
    const invoker = this.getPrimeEmbeddingInvoker();
    if (!invoker) {
      return false;
    }

    const normalized = [...new Set(texts.map((text) => text.trim()).filter((text) => text.length > 0))];
    if (normalized.length === 0) {
      return false;
    }

    try {
      for (const text of normalized) {
        const result = invoker(text, mode);
        if (isPromiseLike(result)) {
          await result;
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  async primeBeforeIngest(sample: LocomoSample): Promise<boolean> {
    const texts = sample.conversation.map((turn) => turn.text);
    return this.primeEmbeddingTexts(texts, "passage");
  }

  async primeBeforeSearch(question: string, options: AnswerQuestionOptions = {}): Promise<boolean> {
    const kind = detectQuestionKind(question, options.category);
    const policy = resolveSearchPolicy(kind, options.category);
    const queries = buildQueryVariants(question, kind, policy, options.category);
    return this.primeEmbeddingTexts(queries, "query");
  }

  async readCacheStats(): Promise<Record<string, unknown> | null> {
    const maybeCore = this.core as unknown as {
      getEmbeddingRuntimeInfo?: () => unknown;
    };
    if (typeof maybeCore.getEmbeddingRuntimeInfo !== "function") {
      return null;
    }
    try {
      const runtime = toRecord(maybeCore.getEmbeddingRuntimeInfo.call(this.core));
      const cacheStats = toRecord(runtime.cacheStats);
      return Object.keys(cacheStats).length > 0 ? cacheStats : null;
    } catch {
      return null;
    }
  }

  ingestSample(sample: LocomoSample): void {
    const baseTs = Date.parse("2026-01-01T00:00:00.000Z");
    sample.conversation.forEach((turn, index) => {
      // Prefer the real LoCoMo session timestamp so relative expressions
      // ("yesterday", "last week") can be resolved against the actual date.
      // Fall back to a synthetic monotonic timestamp when absent.
      const ts = turn.timestamp || new Date(baseTs + index * 1000).toISOString();
      this.core.recordEvent({
        event_id: `locomo-${this.sessionId}-${sample.sample_id}-${index + 1}`,
        platform: "codex",
        project: this.options.project,
        session_id: this.sessionId,
        event_type: "user_prompt",
        ts,
        payload: {
          content: turn.text,
          speaker: turn.speaker,
          sample_id: sample.sample_id,
          ...(turn.timestamp ? { event_time: turn.timestamp } : {}),
        },
        tags: ["locomo", sample.sample_id],
        privacy_tags: [],
      });
    });
  }

  answerQuestion(question: string, options: AnswerQuestionOptions = {}): HarnessLocomoReplayResult {
    const kind = detectQuestionKind(question, options.category);
    const policy = resolveSearchPolicy(kind, options.category);
    const queries = buildQueryVariants(question, kind, policy, options.category);
    void this.primeEmbeddingTexts(queries, "query");

    const merged = new Map<string, LocomoSearchItem>();
    let latencyTotal = 0;
    let tokenInputTotal = 0;
    let tokenOutputTotal = 0;
    let tokenTotal = 0;

    queries.forEach((query, queryOrder) => {
      const response = this.core.search({
        query,
        project: this.options.project,
        session_id: this.sessionId,
        include_private: true,
        strict_project: true,
        limit: policy.limit,
      });
      const items = response.items as Array<Record<string, unknown>>;
      const meta = (response.meta || {}) as Record<string, unknown>;
      const tokenEstimate = (meta.token_estimate || {}) as Record<string, unknown>;

      latencyTotal += Number(meta.latency_ms || 0);
      tokenInputTotal += Number(tokenEstimate.estimated_input_tokens || 0);
      tokenOutputTotal += Number(tokenEstimate.estimated_output_tokens || 0);
      tokenTotal += Number(tokenEstimate.estimated_total_tokens || 0);

      items.forEach((item, index) => {
        const id = String(item.id || "").trim();
        if (!id) return;
        const text = String(item.content || item.summary || item.title || "").trim();
        if (!text) return;
        const createdAt = String(item.created_at || "").trim() || undefined;
        const current = merged.get(id);
        if (!current) {
          merged.set(id, { id, text, rank: index, query_order: queryOrder, created_at: createdAt });
          return;
        }
        const isBetter = queryOrder < current.query_order || (queryOrder === current.query_order && index < current.rank);
        if (isBetter) {
          merged.set(id, { id, text, rank: index, query_order: queryOrder, created_at: createdAt || current.created_at });
        }
      });
    });

    const mergedItems = [...merged.values()].sort((lhs, rhs) => {
      if (lhs.query_order !== rhs.query_order) return lhs.query_order - rhs.query_order;
      return lhs.rank - rhs.rank;
    });

    const synthesis = synthesizeLocomoAnswer(mergedItems, question, {
      category: options.category,
      query_variants: queries,
      search_policy: policy,
    });

    return {
      prediction: synthesis.prediction,
      search_hit_count: mergedItems.length,
      candidate_ids: mergedItems.map((item) => item.id),
      selected_evidence_ids: synthesis.selected_evidence_ids,
      answer_strategy: synthesis.answer_strategy,
      question_kind: synthesis.question_kind,
      answer_trace: synthesis.answer_trace,
      search_latency_ms: latencyTotal,
      token_estimate_input_tokens: tokenInputTotal,
      token_estimate_output_tokens: tokenOutputTotal,
      token_estimate_total_tokens: tokenTotal,
    };
  }
}
