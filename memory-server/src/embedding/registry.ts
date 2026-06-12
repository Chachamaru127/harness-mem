import { createFallbackEmbeddingProvider, withCircuitBreaker } from "./fallback";
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

export interface EmbeddingShadowProviderCandidate {
  model_id: string;
  vector_model: string;
  provider: "local";
  inference: "onnx";
  dimension: number;
  installed: boolean;
  local_only: true;
  separate_vector_table_required: boolean;
  status: "ready" | "not_installed" | "unknown_model";
  skip_reason?: string;
}

export interface EmbeddingShadowProviderOptions {
  modelIds?: string[];
  currentVectorModel?: string;
  currentVectorDimension: number;
  localModelsDir?: string;
}

// S154-502: 2026-generation candidates. ruri-v3-30m is already judged
// (composite -0.2325, keep) and bge-m3 is demoted to opportunistic
// measurement via --models (MMTEB 59.56, superseded generation).
const DEFAULT_EMBEDDING_SHADOW_MODEL_IDS = ["qwen3-embedding-0.6b", "granite-embedding-311m-r2"] as const;

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
    nativeDimension: catalogEntry.nativeDimension,
    matryoshka: catalogEntry.matryoshka,
    pooling: catalogEntry.pooling,
    appendText: catalogEntry.appendText,
    maxSeqLength: catalogEntry.maxSeqLength,
    queryPrefix: catalogEntry.queryPrefix,
    passagePrefix: catalogEntry.passagePrefix,
    fallback,
  });
}

export function resolveEmbeddingShadowProviders(
  options: EmbeddingShadowProviderOptions
): EmbeddingShadowProviderCandidate[] {
  const modelIds =
    options.modelIds && options.modelIds.length > 0
      ? options.modelIds
      : [...DEFAULT_EMBEDDING_SHADOW_MODEL_IDS];
  const manager = new ModelManager(options.localModelsDir || process.env.HARNESS_MEM_LOCAL_MODELS_DIR);
  const currentVectorModel = options.currentVectorModel ?? "";
  const seen = new Set<string>();
  const candidates: EmbeddingShadowProviderCandidate[] = [];

  for (const rawId of modelIds) {
    const modelId = rawId.trim();
    if (!modelId || seen.has(modelId)) {
      continue;
    }
    seen.add(modelId);

    const catalogEntry = findModelById(modelId);
    if (!catalogEntry) {
      candidates.push({
        model_id: modelId,
        vector_model: `local:${modelId}`,
        provider: "local",
        inference: "onnx",
        dimension: 0,
        installed: false,
        local_only: true,
        separate_vector_table_required: true,
        status: "unknown_model",
        skip_reason: "unknown_model",
      });
      continue;
    }

    const vectorModel = `local:${modelId}`;
    const installed = Boolean(manager.getModelPath(modelId));
    candidates.push({
      model_id: modelId,
      vector_model: vectorModel,
      provider: "local",
      inference: "onnx",
      dimension: catalogEntry.dimension,
      installed,
      local_only: true,
      separate_vector_table_required:
        catalogEntry.dimension !== options.currentVectorDimension ||
        (currentVectorModel !== "" && currentVectorModel !== vectorModel),
      status: installed ? "ready" : "not_installed",
      ...(installed ? {} : { skip_reason: `model_not_installed:${modelId}` }),
    });
  }

  return candidates;
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
    // S81-D01 (Codex round 3 P2.4): wrap remote provider in circuit
    // breaker so consecutive failures trigger a cooldown and divert
    // to the local fallback instead of hammering the flapping endpoint.
    provider = withCircuitBreaker(
      createOpenAiEmbeddingProvider({
        dimension: options.dimension,
        apiKey: options.openaiApiKey,
        model: options.openaiEmbedModel,
        fallback,
      }),
      { fallbackTo: fallback }
    );
  } else if (providerName === "ollama") {
    provider = withCircuitBreaker(
      createOllamaEmbeddingProvider({
        dimension: options.dimension,
        baseUrl: options.ollamaBaseUrl,
        model: options.ollamaEmbedModel,
        fallback,
      }),
      { fallbackTo: fallback }
    );
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
        nativeDimension: catalogEntry.nativeDimension,
        matryoshka: catalogEntry.matryoshka,
        pooling: catalogEntry.pooling,
        appendText: catalogEntry.appendText,
        maxSeqLength: catalogEntry.maxSeqLength,
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
        nativeDimension: catalogEntry.nativeDimension,
        matryoshka: catalogEntry.matryoshka,
        pooling: catalogEntry.pooling,
        appendText: catalogEntry.appendText,
        maxSeqLength: catalogEntry.maxSeqLength,
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
