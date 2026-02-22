import { spawnSync } from "node:child_process";
import { type EmbeddingHealth, type EmbeddingProvider } from "./types";

interface OllamaProviderOptions {
  dimension: number;
  baseUrl?: string;
  model?: string;
  fallback: EmbeddingProvider;
}

export function createOllamaEmbeddingProvider(options: OllamaProviderOptions): EmbeddingProvider {
  const model = (options.model || "nomic-embed-text").trim() || "nomic-embed-text";
  const baseUrl = (options.baseUrl || "http://127.0.0.1:11434").replace(/\/+$/, "");
  const dimension = Math.max(8, Math.floor(options.dimension));
  let lastHealth: EmbeddingHealth = {
    status: "healthy",
    details: `ollama embeddings: ${model}`,
  };

  function fallbackWith(message: string, text: string): number[] {
    lastHealth = { status: "degraded", details: message };
    return options.fallback.embed(text);
  }

  return {
    name: "ollama",
    model,
    dimension,
    embed(text: string): number[] {
      const prompt = (text || "").slice(0, 12000);
      const body = JSON.stringify({ model, prompt });
      const endpoint = `${baseUrl}/api/embeddings`;

      const result = spawnSync(
        "curl",
        [
          "-sS",
          "--max-time",
          "8",
          endpoint,
          "-H",
          "content-type: application/json",
          "-d",
          body,
        ],
        { encoding: "utf8" }
      );

      if (result.status !== 0) {
        return fallbackWith(`ollama request failed: ${result.stderr || "unknown error"}`, prompt);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(result.stdout || "{}");
      } catch {
        return fallbackWith("ollama response parse failed", prompt);
      }

      const embedding =
        typeof parsed === "object" &&
        parsed !== null &&
        Array.isArray((parsed as { embedding?: unknown[] }).embedding)
          ? (parsed as { embedding?: unknown[] }).embedding
          : Array.isArray((parsed as { data?: unknown[] }).data)
            ? (parsed as { data: unknown[] }).data
            : null;

      if (!embedding) {
        return fallbackWith("ollama response did not include embedding", prompt);
      }

      const numeric = embedding.filter((value): value is number => typeof value === "number");
      if (numeric.length === 0) {
        return fallbackWith("ollama embedding was empty", prompt);
      }

      lastHealth = {
        status: "healthy",
        details: `ollama embeddings: ${model}`,
      };

      if (numeric.length === dimension) {
        return numeric;
      }

      if (numeric.length > dimension) {
        return numeric.slice(0, dimension);
      }

      return [...numeric, ...new Array<number>(dimension - numeric.length).fill(0)];
    },
    health(): EmbeddingHealth {
      return { ...lastHealth };
    },
  };
}
