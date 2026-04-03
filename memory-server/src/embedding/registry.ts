import { createFallbackEmbeddingProvider } from "./fallback";
import { createOllamaEmbeddingProvider } from "./ollama";
import { createOpenAiEmbeddingProvider } from "./openai";
import { createProApiEmbeddingProvider } from "./pro-api-provider";
import { createLocalOnnxEmbeddingProvider } from "./local-onnx";
import { ModelManager } from "./model-manager";
import { findModelById, formatSize } from "./model-catalog";
import { createAdaptiveEmbeddingProvider } from "./adaptive-provider";
import {
  DEFAULT_ADAPTIVE_CODE_THRESHOLD,
  DEFAULT_ADAPTIVE_JA_THRESHOLD,
  detectLanguage,
  selectModelByLanguage,
} from "./query-analyzer";
import {
  type EmbeddingProvider,
  type EmbeddingProviderName,
  type EmbeddingRegistryOptions,
  type EmbeddingRegistryResult,
} from "./types";

type NormalizedProviderName = Exclude<EmbeddingProviderName, "pro-api"> | "auto";

function normalizeProviderName(name: string | undefined): NormalizedProviderName | null {
  if (!name || !name.trim()) {
    return "fallback";
  }
  const normalized = name.trim().toLowerCase();
  if (
    normalized === "fallback" ||
    normalized === "openai" ||
    normalized === "ollama" ||
    normalized === "local" ||
    normalized === "adaptive" ||
    normalized === "auto"
  ) {
    return normalized;
  }
  return null;
}

function createLocalOrFallbackProvider(
  manager: ModelManager,
  warnings: string[],
  fallback: EmbeddingProvider,
  modelId: string
): EmbeddingProvider {
  const catalogEntry = findModelById(modelId);
  if (!catalogEntry) {
    warnings.push(
      `Unknown local model id "${modelId}". Falling back to "fallback". Run 'harness-mem model list' to see available models.`
    );
    return fallback;
  }

  const modelPath = manager.getModelPath(modelId);
  if (!modelPath) {
    warnings.push(
      `Local model "${modelId}" (${formatSize(catalogEntry.sizeBytes)}) is not installed. ` +
      `Run 'harness-mem model pull ${modelId}' to download it. Falling back to "fallback".`
    );
    return fallback;
  }

  return createLocalOnnxEmbeddingProvider({
    modelId,
    modelPath,
    dimension: catalogEntry.dimension,
    queryPrefix: catalogEntry.queryPrefix,
    passagePrefix: catalogEntry.passagePrefix,
    fallback,
  });
}

export function createEmbeddingProviderRegistry(options: EmbeddingRegistryOptions): EmbeddingRegistryResult {
  const warnings: string[] = [];
  const requestedProvider = (options.providerName || "fallback").trim().toLowerCase() || "fallback";
  const providerName = normalizeProviderName(requestedProvider);
  const fallback = createFallbackEmbeddingProvider({ dimension: options.dimension });

  if (providerName === null) {
    warnings.push(
      `Invalid HARNESS_MEM_EMBEDDING_PROVIDER=\"${requestedProvider}\". Falling back to "fallback".`
    );
    return {
      provider: fallback,
      warnings,
      requestedProvider,
    };
  }

  let provider: EmbeddingProvider = fallback;
  const rawModelId = (options.localModelId || process.env.HARNESS_MEM_EMBEDDING_MODEL || "multilingual-e5").trim();
  const modelId = rawModelId === "auto"
    ? selectModelByLanguage(options.defaultLanguage ?? "ja")
    : rawModelId;
  const catalogEntry = findModelById(modelId);
  const manager = new ModelManager(options.localModelsDir || process.env.HARNESS_MEM_LOCAL_MODELS_DIR);
  const modelPath = catalogEntry ? manager.getModelPath(modelId) : null;

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
  } else if (providerName === "adaptive") {
    const japaneseProvider = createLocalOrFallbackProvider(manager, warnings, fallback, "ruri-v3-30m");
    const freeGeneralProvider = createLocalOrFallbackProvider(manager, warnings, fallback, "multilingual-e5");
    const hasProApi = Boolean(options.proApiKey && options.proApiUrl);
    const generalProvider = hasProApi
      ? createProApiEmbeddingProvider({
          dimension: options.dimension,
          apiKey: options.proApiKey,
          baseUrl: options.proApiUrl,
          model: options.openaiEmbedModel || "text-embedding-3-large",
          fallback: freeGeneralProvider,
        })
      : freeGeneralProvider;

    if ((options.proApiKey || options.proApiUrl) && !hasProApi) {
      warnings.push(
        "HARNESS_MEM_PRO_API_KEY and HARNESS_MEM_PRO_API_URL must both be set to enable the Pro adaptive path. Falling back to the free secondary model."
      );
    }

    provider = createAdaptiveEmbeddingProvider({
      japaneseProvider,
      generalProvider,
      generalFallbackProvider: hasProApi ? freeGeneralProvider : undefined,
      dimension: options.dimension,
      jaThreshold: options.adaptiveJaThreshold ?? DEFAULT_ADAPTIVE_JA_THRESHOLD,
      codeThreshold: options.adaptiveCodeThreshold ?? DEFAULT_ADAPTIVE_CODE_THRESHOLD,
    });
  } else if (providerName === "auto") {
    if (!catalogEntry) {
      warnings.push(
        `Unknown local model id "${modelId}". Falling back to "fallback". Run 'harness-mem model list' to see available models.`
      );
    } else if (modelPath) {
      provider = createLocalOnnxEmbeddingProvider({
        modelId,
        modelPath,
        dimension: catalogEntry.dimension,
        queryPrefix: catalogEntry.queryPrefix,
        passagePrefix: catalogEntry.passagePrefix,
        fallback,
      });
    }
  } else if (providerName === "local") {
    if (!catalogEntry) {
      warnings.push(
        `Unknown local model id "${modelId}". Falling back to "fallback". Run 'harness-mem model list' to see available models.`
      );
    } else if (!modelPath) {
      warnings.push(
        `Local model "${modelId}" (${formatSize(catalogEntry.sizeBytes)}) is not installed. ` +
        `Run 'harness-mem model pull ${modelId}' to download it. Falling back to "fallback".`
      );
    } else {
      provider = createLocalOnnxEmbeddingProvider({
        modelId,
        modelPath,
        dimension: catalogEntry.dimension,
        queryPrefix: catalogEntry.queryPrefix,
        passagePrefix: catalogEntry.passagePrefix,
        fallback,
      });
    }
  }

  return {
    provider,
    warnings,
    requestedProvider,
  };
}

export { detectLanguage, selectModelByLanguage };
