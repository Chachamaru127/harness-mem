/**
 * Ollama LLM プロバイダー
 *
 * V5-009: Ollama ファーストクラス対応
 * - API キー不要
 * - fetch ベース (curl 非依存)
 * - デフォルト endpoint: http://localhost:11434
 * - generate: POST /api/chat
 * - embed: POST /api/embed (モデル: nomic-embed-text)
 */

import type { LLMConfig, LLMProvider, GenerateOptions } from "./types";

const DEFAULT_ENDPOINT = "http://localhost:11434";
const DEFAULT_GENERATE_MODEL = "llama3.2";
const DEFAULT_EMBED_MODEL = "nomic-embed-text";
const GENERATE_TIMEOUT_MS = 30_000;
const EMBED_TIMEOUT_MS = 10_000;
const TEST_TIMEOUT_MS = 5_000;

export class OllamaProvider implements LLMProvider {
  readonly name = "ollama";
  private readonly endpoint: string;
  private readonly defaultModel: string;

  constructor(config: LLMConfig = { provider: "ollama" }) {
    this.endpoint = (config.endpoint || process.env.HARNESS_MEM_OLLAMA_HOST || DEFAULT_ENDPOINT).replace(/\/+$/, "");
    this.defaultModel = (config.model || process.env.HARNESS_MEM_FACT_LLM_MODEL || DEFAULT_GENERATE_MODEL).trim();
  }

  async generate(prompt: string, options: GenerateOptions = {}): Promise<string> {
    const model = (options.model || this.defaultModel).trim();
    const messages: Array<{ role: string; content: string }> = [];

    if (options.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const body: Record<string, unknown> = {
      model,
      stream: false,
      format: "json",
      messages,
    };
    if (options.temperature !== undefined) {
      body.options = { temperature: options.temperature };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.endpoint}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Ollama generate failed: HTTP ${response.status}`);
      }

      const parsed = await response.json() as { message?: { content?: unknown } };
      const content = parsed?.message?.content;
      if (typeof content !== "string") {
        throw new Error("Ollama generate: unexpected response shape");
      }
      return content;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async embed(text: string): Promise<number[]> {
    const model = DEFAULT_EMBED_MODEL;
    const body = JSON.stringify({ model, input: text.slice(0, 12_000) });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.endpoint}/api/embed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Ollama embed failed: HTTP ${response.status}`);
      }

      const parsed = await response.json() as { embeddings?: number[][]; embedding?: number[] };
      // /api/embed returns { embeddings: [[...]] }
      // /api/embeddings (legacy) returns { embedding: [...] }
      const embedding =
        Array.isArray(parsed?.embeddings) && parsed.embeddings.length > 0
          ? parsed.embeddings[0]
          : Array.isArray(parsed?.embedding)
            ? parsed.embedding
            : null;

      if (!embedding || !Array.isArray(embedding)) {
        throw new Error("Ollama embed: no embedding in response");
      }

      return embedding.filter((v): v is number => typeof v === "number");
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.endpoint}/api/tags`, {
        method: "GET",
        signal: controller.signal,
      });

      if (!response.ok) {
        return { ok: false, message: `Ollama server returned HTTP ${response.status}` };
      }

      return { ok: true, message: `Ollama is available at ${this.endpoint}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, message: `Ollama connection failed: ${msg}` };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
