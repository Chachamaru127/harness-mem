import { type LocomoAdapterRecord, type LocomoQuestionInput } from "./locomo-mem0-adapter";

export interface ClaudeMemLocomoAdapterOptions {
  baseUrl: string;
  project: string;
  token?: string;
  fetchImpl?: typeof fetch;
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

export class ClaudeMemLocomoAdapter {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ClaudeMemLocomoAdapterOptions) {
    this.fetchImpl = options.fetchImpl || fetch;
  }

  async answerQuestion(input: LocomoQuestionInput): Promise<LocomoAdapterRecord> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.options.token) {
      headers["x-harness-mem-token"] = this.options.token;
      headers.authorization = `Bearer ${this.options.token}`;
    }

    const response = await this.fetchImpl(`${this.options.baseUrl.replace(/\/$/, "")}/v1/search`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: input.question,
        project: this.options.project,
        include_private: true,
        strict_project: true,
        limit: 5,
      }),
    });

    if (!response.ok) {
      throw new Error(`claude-mem adapter request failed: HTTP ${response.status}`);
    }

    const payload = (await response.json()) as {
      items?: Array<{ content?: string; summary?: string; title?: string }>;
    };
    const first = payload.items?.[0];
    const prediction = String(first?.content || first?.summary || first?.title || "");
    const em = normalize(prediction) === normalize(input.answer) ? 1 : 0;
    const f1 = tokenF1(prediction, input.answer);
    return {
      ...input,
      prediction,
      em,
      f1,
    };
  }
}
