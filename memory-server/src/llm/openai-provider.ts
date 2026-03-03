/**
 * OpenAI LLM プロバイダー
 *
 * V5-009: 既存 OpenAI 呼び出しを LLMProvider インターフェースに整理
 * - 環境変数: HARNESS_MEM_OPENAI_API_KEY / OPENAI_API_KEY
 * - API キー未設定時は generate/embed が例外を投げる
 */

import type { LLMConfig, LLMProvider, GenerateOptions } from "./types";

const DEFAULT_GENERATE_MODEL = "gpt-4o-mini";
const DEFAULT_EMBED_MODEL = "text-embedding-3-small";
const GENERATE_TIMEOUT_MS = 15_000;
const EMBED_TIMEOUT_MS = 10_000;
const TEST_TIMEOUT_MS = 5_000;

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  private readonly apiKey: string;
  private readonly defaultModel: string;
  private readonly endpoint: string;

  constructor(config: LLMConfig = { provider: "openai" }) {
    this.apiKey = (
      config.apiKey ||
      process.env.HARNESS_MEM_OPENAI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      ""
    ).trim();
    this.defaultModel = (config.model || DEFAULT_GENERATE_MODEL).trim();
    this.endpoint = (config.endpoint || "https://api.openai.com").replace(/\/+$/, "");
  }

  async generate(prompt: string, options: GenerateOptions = {}): Promise<string> {
    if (!this.apiKey) {
      throw new Error("OpenAI API key is not set (HARNESS_MEM_OPENAI_API_KEY)");
    }

    const model = (options.model || this.defaultModel).trim();
    const messages: Array<{ role: string; content: string }> = [];

    if (options.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const body: Record<string, unknown> = {
      model,
      response_format: { type: "json_object" },
      messages,
    };
    if (options.temperature !== undefined) {
      body.temperature = options.temperature;
    }
    if (options.maxTokens !== undefined) {
      body.max_tokens = options.maxTokens;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.endpoint}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`OpenAI generate failed: HTTP ${response.status}`);
      }

      const parsed = await response.json() as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const content = parsed?.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error("OpenAI generate: unexpected response shape");
      }
      return content;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async embed(text: string): Promise<number[]> {
    if (!this.apiKey) {
      throw new Error("OpenAI API key is not set (HARNESS_MEM_OPENAI_API_KEY)");
    }

    const body = JSON.stringify({
      model: DEFAULT_EMBED_MODEL,
      input: text.slice(0, 12_000),
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.endpoint}/v1/embeddings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${this.apiKey}`,
        },
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`OpenAI embed failed: HTTP ${response.status}`);
      }

      const parsed = await response.json() as {
        data?: Array<{ embedding?: unknown[] }>;
      };
      const embedding = parsed?.data?.[0]?.embedding;
      if (!Array.isArray(embedding)) {
        throw new Error("OpenAI embed: no embedding in response");
      }

      return embedding.filter((v): v is number => typeof v === "number");
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    if (!this.apiKey) {
      return { ok: false, message: "OpenAI API key is not set" };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.endpoint}/v1/models`, {
        method: "GET",
        headers: { "authorization": `Bearer ${this.apiKey}` },
        signal: controller.signal,
      });

      if (!response.ok) {
        return { ok: false, message: `OpenAI API returned HTTP ${response.status}` };
      }

      return { ok: true, message: "OpenAI API is available" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, message: `OpenAI connection failed: ${msg}` };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
