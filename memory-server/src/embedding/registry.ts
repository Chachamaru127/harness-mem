import { createFallbackEmbeddingProvider } from "./fallback";
import { createOllamaEmbeddingProvider } from "./ollama";
import { createOpenAiEmbeddingProvider } from "./openai";
import {
  type EmbeddingProvider,
  type EmbeddingProviderName,
  type EmbeddingRegistryOptions,
  type EmbeddingRegistryResult,
} from "./types";

function normalizeProviderName(name: string | undefined): EmbeddingProviderName | null {
  if (!name || !name.trim()) {
    return "fallback";
  }
  const normalized = name.trim().toLowerCase();
  if (normalized === "fallback" || normalized === "openai" || normalized === "ollama") {
    return normalized;
  }
  return null;
}

export function createEmbeddingProviderRegistry(options: EmbeddingRegistryOptions): EmbeddingRegistryResult {
  const warnings: string[] = [];
  const requestedProvider = (options.providerName || "fallback").trim().toLowerCase() || "fallback";
  const providerName = normalizeProviderName(requestedProvider);
  const fallback = createFallbackEmbeddingProvider({ dimension: options.dimension });

  if (providerName === null) {
    warnings.push(
      `Invalid HARNESS_MEM_EMBEDDING_PROVIDER=\"${requestedProvider}\". Falling back to \"fallback\".`
    );
    return {
      provider: fallback,
      warnings,
      requestedProvider,
    };
  }

  let provider: EmbeddingProvider = fallback;
  if (providerName === "openai") {
    provider = createOpenAiEmbeddingProvider({
      dimension: options.dimension,
      apiKey: options.openaiApiKey,
      model: options.openaiEmbedModel,
      fallback,
    });
  } else if (providerName === "ollama") {
    provider = createOllamaEmbeddingProvider({
      dimension: options.dimension,
      baseUrl: options.ollamaBaseUrl,
      model: options.ollamaEmbedModel,
      fallback,
    });
  }

  return {
    provider,
    warnings,
    requestedProvider,
  };
}
