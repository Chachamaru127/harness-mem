import { spawnSync } from "node:child_process";
import { type EmbeddingHealth, type EmbeddingProvider } from "./types";

interface OpenAiProviderOptions {
  dimension: number;
  apiKey?: string;
  model?: string;
  fallback: EmbeddingProvider;
}

export function createOpenAiEmbeddingProvider(options: OpenAiProviderOptions): EmbeddingProvider {
  const model = (options.model || "text-embedding-3-small").trim() || "text-embedding-3-small";
  const dimension = Math.max(8, Math.floor(options.dimension));
  const apiKey = (options.apiKey || "").trim();
  let lastHealth: EmbeddingHealth = {
    status: apiKey ? "healthy" : "degraded",
    details: apiKey ? "openai provider initialized" : "HARNESS_MEM_OPENAI_API_KEY is not set; fallback vectors in use",
  };

  function fallbackWith(message: string, text: string): number[] {
    lastHealth = { status: "degraded", details: message };
    return options.fallback.embed(text);
  }

  return {
    name: "openai",
    model,
    dimension,
    embed(text: string): number[] {
      const prompt = (text || "").slice(0, 12000);
      if (!apiKey) {
        return fallbackWith("HARNESS_MEM_OPENAI_API_KEY is not set; fallback vectors in use", prompt);
      }

      const body = JSON.stringify({
        model,
        input: prompt,
      });

      const result = spawnSync(
        "curl",
        [
          "-sS",
          "--max-time",
          "8",
          "https://api.openai.com/v1/embeddings",
          "-H",
          "content-type: application/json",
          "-H",
          `authorization: Bearer ${apiKey}`,
          "-d",
          body,
        ],
        { encoding: "utf8" }
      );

      if (result.status !== 0) {
        return fallbackWith(`openai request failed: ${result.stderr || "unknown error"}`, prompt);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(result.stdout || "{}");
      } catch {
        return fallbackWith("openai response parse failed", prompt);
      }

      const embedding =
        typeof parsed === "object" &&
        parsed !== null &&
        Array.isArray((parsed as { data?: unknown[] }).data) &&
        Array.isArray((parsed as { data: Array<{ embedding?: unknown[] }> }).data[0]?.embedding)
          ? (parsed as { data: Array<{ embedding?: unknown[] }> }).data[0].embedding
          : null;

      if (!embedding) {
        return fallbackWith("openai response did not include embedding", prompt);
      }

      const numeric = embedding.filter((value): value is number => typeof value === "number");
      if (numeric.length === 0) {
        return fallbackWith("openai embedding was empty", prompt);
      }

      lastHealth = {
        status: "healthy",
        details: `openai embeddings: ${model}`,
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
