import type { Database } from "bun:sqlite";
import { createFallbackEmbeddingProvider, withCircuitBreaker } from "./fallback";
import { createOllamaEmbeddingProvider } from "./ollama";
import { createOpenAiEmbeddingProvider } from "./openai";
import { createProApiEmbeddingProvider } from "./pro-api-provider";
import { createLocalOnnxEmbeddingProvider } from "./local-onnx";
import { ModelManager } from "./model-manager";
import {
  findModelById,
  formatSize,
  parseEmbeddingDefaultModelFlag,
  type EmbeddingDefaultModelFlag,
} from "./model-catalog";
import { EMBEDDING_DEFAULT_MODEL_KEY, INCUMBENT_EMBEDDING_MODEL } from "../core/config-manager";
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

// parseEmbeddingDefaultModelFlag + EmbeddingDefaultModelFlag now live in
// model-catalog (pure) so the config-manager setter can validate the same
// format without an import cycle. Re-exported here for existing callers.
export { parseEmbeddingDefaultModelFlag };
export type { EmbeddingDefaultModelFlag };

function readEmbeddingDefaultModelFlagRaw(db: Database): string {
  const row = db
    .query("SELECT value FROM mem_meta WHERE key = ?")
    .get(EMBEDDING_DEFAULT_MODEL_KEY) as { value: string } | null;
  return row?.value?.trim() ?? "";
}

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
  const explicitEnvModel = (process.env.HARNESS_MEM_EMBEDDING_MODEL || "").trim();
  const explicitOptionModel = (options.localModelId || "").trim();
  // Explicit env / non-incumbent option pin wins over the mem_meta flag so the
  // S154-510 wiring never overrides an operator's deliberate choice.
  const modelPinned =
    explicitEnvModel !== "" ||
    (explicitOptionModel !== "" && explicitOptionModel !== INCUMBENT_EMBEDDING_MODEL);

  const manager = new ModelManager(options.localModelsDir || process.env.HARNESS_MEM_LOCAL_MODELS_DIR);

  let flagDimension: number | undefined;
  let flagModelId: string | undefined;
  if (!modelPinned && options.db) {
    const rawFlag = readEmbeddingDefaultModelFlagRaw(options.db);
    if (rawFlag) {
      const parsed = parseEmbeddingDefaultModelFlag(rawFlag);
      if (!parsed.ok) {
        warnings.push(
          `Invalid embedding_default_model flag "${rawFlag}" (${parsed.reason}). ` +
            `Falling back to incumbent "${INCUMBENT_EMBEDDING_MODEL}".`,
        );
      } else if (parsed.dimension !== options.dimension) {
        // P2 fix: the store normalizes/stores/searches options.dimension (the
        // vector engine's effective dimension). A resolved flag dimension that
        // differs would be padded/sliced outside the local provider's Matryoshka
        // truncate+renormalize path, producing vectors incompatible with the
        // index. Reject and fail-safe instead of silently corrupting embeddings.
        warnings.push(
          `Invalid embedding_default_model flag "${rawFlag}" (dimension mismatch: ` +
            `flag resolved ${parsed.dimension} but vector store is ${options.dimension}; ` +
            `use ${parsed.modelId}@${options.dimension} or rebuild the index). ` +
            `Falling back to incumbent "${INCUMBENT_EMBEDDING_MODEL}".`,
        );
      } else if (!manager.getModelPath(parsed.modelId)) {
        // P2 (round 3): the flag passes catalog + dimension validation but the
        // model is not installed yet (e.g. granite-embedding-311m-r2@384 before
        // `model pull` completes). Accepting it would make the local/auto path
        // see modelPath === null and leave the synthetic hash fallback as the
        // provider, so searches would ignore existing local:multilingual-e5
        // vectors until the candidate lands. Treat uninstalled as a flag failure
        // and keep the incumbent provider instead.
        warnings.push(
          `embedding_default_model flag "${rawFlag}" points at a model that is not installed. ` +
            `Run 'harness-mem model pull ${parsed.modelId}' to download it. ` +
            `Falling back to incumbent "${INCUMBENT_EMBEDDING_MODEL}".`,
        );
      } else {
        flagModelId = parsed.modelId;
        flagDimension = parsed.dimension;
      }
    }
  }

  const rawModelId = (
    flagModelId || options.localModelId || explicitEnvModel || INCUMBENT_EMBEDDING_MODEL
  ).trim();
  const modelId = rawModelId === "auto"
    ? selectModelByLanguage(options.defaultLanguage ?? "ja")
    : rawModelId;
  const catalogEntry = findModelById(modelId);
  const localDimension = flagDimension ?? catalogEntry?.dimension ?? options.dimension;
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
        dimension: localDimension,
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
        dimension: localDimension,
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
