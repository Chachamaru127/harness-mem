import { createFallbackEmbeddingProvider } from "./fallback";
import { createOllamaEmbeddingProvider } from "./ollama";
import { createOpenAiEmbeddingProvider } from "./openai";
import { createLocalOnnxEmbeddingProvider } from "./local-onnx";
import { ModelManager } from "./model-manager";
import { findModelById, formatSize } from "./model-catalog";
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
  if (normalized === "fallback" || normalized === "openai" || normalized === "ollama" || normalized === "local") {
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
  } else if (providerName === "local") {
    const modelId = (options.localModelId || process.env.HARNESS_MEM_EMBEDDING_MODEL || "ruri-v3-30m").trim();
    const catalogEntry = findModelById(modelId);

    if (!catalogEntry) {
      warnings.push(
        `Unknown local model id "${modelId}". Falling back to "fallback". Run 'harness-mem model list' to see available models.`
      );
    } else {
      const manager = new ModelManager(options.localModelsDir);
      const modelPath = manager.getModelPath(modelId);

      if (!modelPath) {
        warnings.push(
          `Local model "${modelId}" (${formatSize(catalogEntry.sizeBytes)}) is not installed. ` +
          `Run 'harness-mem model pull ${modelId}' to download it. Falling back to "fallback".`
        );
      } else {
        const localDimension = catalogEntry.dimension;
        provider = createLocalOnnxEmbeddingProvider({
          modelId,
          modelPath,
          dimension: localDimension,
          queryPrefix: catalogEntry.queryPrefix,
          passagePrefix: catalogEntry.passagePrefix,
          fallback,
        });
      }
    }
  }

  return {
    provider,
    warnings,
    requestedProvider,
  };
}
