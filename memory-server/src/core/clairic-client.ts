export interface ClairicFacts {
  decision: string | null;
  reason: string | null;
  date: string | null;
  version: string | null;
  files: string[];
}

export interface ClairicClientOptions {
  accountId?: string;
  apiToken?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  backoffMs?: (attempt: number) => number;
}

const CLOUDFLARE_AI_RUN = "https://api.cloudflare.com/client/v4/accounts";
const DEFAULT_MODEL = "@cf/cloudflare/clairic";
const DEFAULT_TIMEOUT_MS = 30_000;

/** Typed extraction contract sent with every request. */
const FIELDS = {
  decision: { type: "text", instructions: "採った決定" },
  reason: { type: "text", instructions: "決定の理由" },
  date: { type: "date", instructions: "決定日" },
  version: { type: "text", instructions: "対象のバージョン" },
  files: { type: "list", items: "text", instructions: "変更したファイル" },
} as const;

/**
 * Workers AI Clairic extraction. Every failure (missing credentials, non-2xx,
 * timeout, bad JSON, missing answers) returns empty facts instead of throwing,
 * so callers can fall through to the next stage of the cascade.
 */
export class ClairicClient {
  constructor(private readonly options: ClairicClientOptions = {}) {}

  async extract(state: string): Promise<ClairicFacts> {
    if (!this.options.accountId || !this.options.apiToken) return emptyFacts();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      let status: number;
      let text: string;
      try {
        ({ status, text } = await this.request(state));
      } catch {
        // Network failure or timeout. Repeating it would only extend the stall.
        return emptyFacts();
      }

      if (status === 429 || status >= 500) {
        if (attempt === 0) {
          await this.pause(attempt + 1);
          continue;
        }
        return emptyFacts();
      }
      // 401 and every other non-2xx status are not retryable.
      if (status < 200 || status >= 300) return emptyFacts();

      return readFacts(text);
    }
    return emptyFacts();
  }

  private model(): string {
    return this.options.model ?? DEFAULT_MODEL;
  }

  private endpointUrl(): string {
    return `${CLOUDFLARE_AI_RUN}/${encodeURIComponent(this.options.accountId!)}/ai/run/${this.model()}`;
  }

  private async request(state: string): Promise<{ status: number; text: string }> {
    const controller = new AbortController();
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;
    const body = {
      model: this.model().split("/").pop() ?? this.model(),
      state,
      fields: FIELDS,
    };
    try {
      const response = await (this.options.fetchImpl ?? globalThis.fetch)(this.endpointUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.options.apiToken}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return { status: response.status, text: await response.text() };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async pause(attempt: number): Promise<void> {
    const delay = this.options.backoffMs?.(attempt) ?? 200 + Math.floor(Math.random() * 200);
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, delay)));
  }
}

function emptyFacts(): ClairicFacts {
  return { decision: null, reason: null, date: null, version: null, files: [] };
}

function readFacts(text: string): ClairicFacts {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return emptyFacts();
  }
  if (!body || typeof body !== "object") return emptyFacts();

  const root = body as { result?: unknown; answers?: unknown };
  const result = root.result;
  const answers =
    result && typeof result === "object"
      ? (result as { answers?: unknown }).answers
      : root.answers;
  if (!answers || typeof answers !== "object") return emptyFacts();

  const fields = answers as Record<string, { value?: unknown } | undefined>;
  const value = (name: string): unknown => {
    const entry = fields[name];
    return entry && typeof entry === "object" ? entry.value : undefined;
  };
  const asText = (name: string): string | null => {
    const raw = value(name);
    return typeof raw === "string" ? raw : null;
  };
  const rawFiles = value("files");

  return {
    decision: asText("decision"),
    reason: asText("reason"),
    date: asText("date"),
    version: asText("version"),
    files: Array.isArray(rawFiles)
      ? rawFiles.filter((item): item is string => typeof item === "string")
      : [],
  };
}
