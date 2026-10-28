export interface TriageItem {
  observationId: string;
  content: string;
}

export interface TriageDecision {
  observationId: string;
  score: number | null;
  /** Probability that the item is durable (decision, pattern, preference, lesson). */
  durable: number | null;
  decision: "keep" | "compact";
  fallback: boolean;
  failureReason?: "missing_credentials" | "timeout" | "network_error" | "invalid_answer" | `http_${number}`;
}

export interface JevClientOptions {
  model: string;
  threshold: number;
  concurrency: number;
  timeoutMs: number;
  accountId?: string;
  apiToken?: string;
  /**
   * Full URL for a System One endpoint. Defaults to the Cloudflare AI run
   * route, which is built from accountId. Set this to `http://127.0.0.1:11434/v1/systemone`
   * or another compatible endpoint to swap providers.
   */
  endpoint?: string;
  /** Cloudflare wraps the payload in `input`; Ollama's /v1/systemone does not. */
  requestShape?: "cloudflare" | "systemone";
  /** Omit the Authorization header for local endpoints. */
  auth?: "bearer" | "none";
  /** Test seam. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** Retry delay in ms for attempt 1. Defaults to 200-400 ms jitter. */
  backoffMs?: (attempt: number) => number;
}

const CLOUDFLARE_AI_RUN = "https://api.cloudflare.com/client/v4/accounts";
const NEEDED_INSTRUCTIONS = "これは今後の開発で再利用する記憶として残すべきか";
const DURABLE_INSTRUCTIONS =
  "これは今後の判断に直接使う決定、方針、手順、好み、または失敗から学んだ教訓か";

/** Stage 1 triage over a System One endpoint. Every failure keeps the item. */
export class JevTriageClient {
  constructor(private readonly options: JevClientOptions) {}

  async triage(items: TriageItem[]): Promise<TriageDecision[]> {
    const decisions = new Array<TriageDecision>(items.length);
    const limit = Math.max(1, Math.min(Math.floor(this.options.concurrency) || 1, items.length));
    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const index = next++;
        if (index >= items.length) return;
        decisions[index] = await this.classify(items[index]!);
      }
    };
    await Promise.all(Array.from({ length: limit }, worker));
    return decisions;
  }

  private fallback(item: TriageItem, failureReason: NonNullable<TriageDecision["failureReason"]>): TriageDecision {
    return {
      observationId: item.observationId,
      score: null,
      durable: null,
      decision: "keep",
      fallback: true,
      failureReason,
    };
  }

  private async classify(item: TriageItem): Promise<TriageDecision> {
    if (this.options.auth !== "none" && (!this.options.accountId || !this.options.apiToken)) {
      return this.fallback(item, "missing_credentials");
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      let status: number;
      let text: string;
      try {
        ({ status, text } = await this.request(item));
      } catch (error) {
        // Network failure or timeout. Repeating it would only extend the stall.
        return this.fallback(item, error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network_error");
      }

      if (status === 429 || status >= 500) {
        if (attempt === 0) {
          await this.pause(attempt + 1);
          continue;
        }
        return this.fallback(item, `http_${status}`);
      }
      // 401 and every other non-2xx status are not retryable.
      if (status < 200 || status >= 300) return this.fallback(item, `http_${status}`);

      const answers = extractAnswers(text);
      if (answers.score === null) return this.fallback(item, "invalid_answer");
      return {
        observationId: item.observationId,
        score: answers.score,
        durable: answers.durable,
        decision: answers.score >= this.options.threshold ? "keep" : "compact",
        fallback: false,
      };
    }
    return this.fallback(item, "network_error");
  }

  private endpointUrl(): string {
    if (this.options.endpoint) return this.options.endpoint;
    return `${CLOUDFLARE_AI_RUN}/${encodeURIComponent(this.options.accountId!)}/ai/run`;
  }

  private async request(item: TriageItem): Promise<{ status: number; text: string }> {
    const controller = new AbortController();
    const timeoutMs = this.options.timeoutMs;
    const timer = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;
    const questions = {
      needed: { type: "noul", instructions: NEEDED_INSTRUCTIONS },
      durable: { type: "noul", instructions: DURABLE_INSTRUCTIONS },
    };
    const body = this.options.requestShape === "systemone"
      ? { model: this.options.model, state: item.content, questions }
      : { model: this.options.model, input: { state: item.content, questions } };
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.options.auth !== "none" && this.options.apiToken) {
      headers.Authorization = `Bearer ${this.options.apiToken}`;
    }
    try {
      const response = await (this.options.fetchImpl ?? globalThis.fetch)(this.endpointUrl(), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return { status: response.status, text: await response.text() };
    } catch (error) {
      if (controller.signal.aborted) throw new DOMException("Jev timed out", "TimeoutError");
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async pause(attempt: number): Promise<void> {
    const delay = this.options.backoffMs?.(attempt) ?? 200 + Math.floor(Math.random() * 200);
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, delay)));
  }
}

function extractAnswers(text: string): { score: number | null; durable: number | null } {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { score: null, durable: null };
  }
  if (!body || typeof body !== "object") return { score: null, durable: null };
  const root = body as { result?: unknown; answers?: unknown };
  if (!root.result && root.answers && typeof root.answers === "object") {
    const direct = root.answers as { needed?: { noul?: unknown }; durable?: { noul?: unknown } };
    return numbers(direct);
  }
  const result = root.result;
  if (!result || typeof result !== "object") return { score: null, durable: null };
  const inner = (result as { result?: unknown }).result;
  const answers = (inner && typeof inner === "object" ? inner : result) as {
    answers?: { needed?: { noul?: unknown }; durable?: { noul?: unknown } };
  };
  return numbers(answers.answers);
}

function numbers(answers: { needed?: { noul?: unknown }; durable?: { noul?: unknown } } | undefined): { score: number | null; durable: number | null } {
  const score = answers?.needed?.noul;
  const durable = answers?.durable?.noul;
  return {
    score: typeof score === "number" && Number.isFinite(score) ? score : null,
    durable: typeof durable === "number" && Number.isFinite(durable) ? durable : null,
  };
}
