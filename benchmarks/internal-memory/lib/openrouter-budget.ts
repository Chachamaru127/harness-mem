const DEFAULT_CAP_USD = 20;

/** Strip Markdown code fences that some models wrap JSON output in. */
export function stripJsonFences(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced ? fenced[1] : trimmed).trim();
}

let sharedBudget: OpenRouterBudget | null = null;

export function getSharedOpenRouterBudget(): OpenRouterBudget | null {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return null;
  if (!sharedBudget) {
    sharedBudget = new OpenRouterBudget(apiKey);
  }
  return sharedBudget;
}

export function resetSharedOpenRouterBudget(): void {
  sharedBudget = null;
}

export interface OpenRouterUsageRecord {
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  estimated_usd: number;
}

export class OpenRouterBudget {
  private spentUsd = 0;
  private readonly records: OpenRouterUsageRecord[] = [];

  constructor(
    private readonly apiKey: string,
    private readonly capUsd = Number(process.env.INTERNAL_BENCH_BUDGET_USD ?? DEFAULT_CAP_USD),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get spent(): number {
    return this.spentUsd;
  }

  get cap(): number {
    return this.capUsd;
  }

  get remaining(): number {
    return Math.max(0, this.capUsd - this.spentUsd);
  }

  get history(): OpenRouterUsageRecord[] {
    return [...this.records];
  }

  assertCanSpend(estimateUsd: number): void {
    if (this.spentUsd + estimateUsd > this.capUsd) {
      throw new Error(
        `OpenRouter budget exceeded: spent=${this.spentUsd.toFixed(4)} cap=${this.capUsd} next=${estimateUsd.toFixed(4)}`,
      );
    }
  }

  estimateUsd(model: string, promptTokens: number, completionTokens: number): number {
    const rates: Record<string, { in: number; out: number }> = {
      "google/gemini-2.5-flash-lite": { in: 0.075 / 1_000_000, out: 0.3 / 1_000_000 },
      "openai/gpt-4o-mini": { in: 0.15 / 1_000_000, out: 0.6 / 1_000_000 },
    };
    const rate = rates[model] ?? { in: 0.2 / 1_000_000, out: 0.8 / 1_000_000 };
    return promptTokens * rate.in + completionTokens * rate.out;
  }

  async chatJson<T>(input: {
    model: string;
    messages: Array<{ role: "system" | "user"; content: string }>;
    max_tokens?: number;
  }): Promise<T> {
    const estimate = this.estimateUsd(input.model, 4000, input.max_tokens ?? 256);
    this.assertCanSpend(estimate);

    const response = await this.fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        "HTTP-Referer": "https://github.com/Chachamaru127/harness-mem",
        "X-Title": "harness-mem-internal-benchmark",
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        max_tokens: input.max_tokens ?? 256,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenRouter HTTP ${response.status}: ${body.slice(0, 400)}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const promptTokens = payload.usage?.prompt_tokens ?? 0;
    const completionTokens = payload.usage?.completion_tokens ?? 0;
    const estimated = this.estimateUsd(input.model, promptTokens, completionTokens);
    this.spentUsd += estimated;
    this.records.push({
      model: input.model,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      estimated_usd: estimated,
    });

    const content = payload.choices?.[0]?.message?.content ?? "{}";
    return JSON.parse(stripJsonFences(content)) as T;
  }
}
