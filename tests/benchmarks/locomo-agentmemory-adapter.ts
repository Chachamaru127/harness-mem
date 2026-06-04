import {
  agentmemoryHealthCheck,
  assertLocalhostOnly,
  normalizeAgentmemoryHits,
  resolveAgentmemoryConfig,
  type AgentmemoryRestConfig,
} from "../../benchmarks/internal-memory/adapters/agentmemory-rest";
import { synthesizeLocomoAnswer, type LocomoSearchItem } from "./locomo-answer-synth";
import { type LocomoSample } from "./locomo-loader";
import { type LocomoAdapterRecord, type LocomoQuestionInput } from "./locomo-mem0-adapter";

export interface AgentmemoryLocomoAdapterOptions {
  baseUrl?: string;
  secret?: string;
  fetchImpl?: typeof fetch;
  agentId?: string;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function tokenF1(prediction: string, answer: string): number {
  const predTokens = normalize(prediction).split(" ").filter(Boolean);
  const goldTokens = normalize(answer).split(" ").filter(Boolean);
  if (predTokens.length === 0 || goldTokens.length === 0) return 0;

  const bag = new Map<string, number>();
  for (const token of goldTokens) {
    bag.set(token, (bag.get(token) || 0) + 1);
  }

  let overlap = 0;
  for (const token of predTokens) {
    const count = bag.get(token) || 0;
    if (count > 0) {
      overlap += 1;
      bag.set(token, count - 1);
    }
  }
  if (overlap === 0) return 0;
  const precision = overlap / predTokens.length;
  const recall = overlap / goldTokens.length;
  return (2 * precision * recall) / (precision + recall);
}

function scoreRecord(base: Omit<LocomoAdapterRecord, "em" | "f1">): LocomoAdapterRecord {
  const em = normalize(base.prediction) === normalize(base.answer) ? 1 : 0;
  const f1 = tokenF1(base.prediction, base.answer);
  return { ...base, em, f1 };
}

function authHeaders(secret?: string): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret) {
    headers.authorization = `Bearer ${secret}`;
  }
  return headers;
}

export function resolveAgentmemoryLocomoConfig(
  options: AgentmemoryLocomoAdapterOptions = {},
): AgentmemoryRestConfig {
  const resolved = resolveAgentmemoryConfig();
  const baseUrl = (options.baseUrl || resolved.baseUrl).replace(/\/$/, "");
  assertLocalhostOnly(baseUrl);
  return {
    baseUrl,
    secret: options.secret ?? resolved.secret,
    fetchImpl: options.fetchImpl,
    agentId: options.agentId ?? "locomo-benchmark",
  };
}

export async function agentmemoryLocomoHealthCheck(
  options: AgentmemoryLocomoAdapterOptions = {},
): Promise<boolean> {
  try {
    return await agentmemoryHealthCheck(resolveAgentmemoryLocomoConfig(options));
  } catch {
    return false;
  }
}

export class AgentmemoryLocomoAdapter {
  private readonly config: AgentmemoryRestConfig;

  constructor(options: AgentmemoryLocomoAdapterOptions = {}) {
    this.config = resolveAgentmemoryLocomoConfig(options);
  }

  private projectForSample(sampleId: string): string {
    return `locomo-${sampleId}`;
  }

  async ingestSample(sample: LocomoSample): Promise<void> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const project = this.projectForSample(sample.sample_id);
    const headers = authHeaders(this.config.secret);
    const agentId = this.config.agentId ?? "locomo-benchmark";

    for (const [index, turn] of sample.conversation.entries()) {
      const response = await fetchImpl(`${this.config.baseUrl}/agentmemory/remember`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          project,
          title: `${sample.sample_id}-turn-${index + 1}`,
          content: turn.text,
          agentId,
          metadata: {
            external_id: `${sample.sample_id}-turn-${index + 1}`,
            sample_id: sample.sample_id,
            speaker: turn.speaker,
            turn_index: index + 1,
          },
        }),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `agentmemory remember failed: HTTP ${response.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`,
        );
      }
    }
  }

  async searchItems(project: string, query: string, limit = 12): Promise<LocomoSearchItem[]> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const started = performance.now();
    const response = await fetchImpl(`${this.config.baseUrl}/agentmemory/smart-search`, {
      method: "POST",
      headers: authHeaders(this.config.secret),
      body: JSON.stringify({ project, query, limit }),
    });
    if (!response.ok) {
      throw new Error(`agentmemory smart-search failed: HTTP ${response.status}`);
    }
    const payload = await response.json();
    void started;
    return normalizeAgentmemoryHits(payload).map((hit, index) => ({
      id: hit.id,
      text: hit.content,
      rank: hit.rank ?? index + 1,
      query_order: 0,
    }));
  }

  async answerQuestion(input: LocomoQuestionInput, sampleId: string): Promise<LocomoAdapterRecord> {
    const project = this.projectForSample(sampleId);
    const searchItems = await this.searchItems(project, input.question);
    const synthesis = synthesizeLocomoAnswer(searchItems, input.question, {
      category: input.category,
    });
    return scoreRecord({
      ...input,
      prediction: synthesis.prediction,
    });
  }
}