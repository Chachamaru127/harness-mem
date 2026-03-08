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

type NormalizedProviderName = EmbeddingProviderName | "auto";

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
    normalized === "auto"
  ) {
    return normalized;
  }
  return null;
}

/**
 * COMP-005: テキストの言語を検出する。
 * - 日本語文字（ひらがな・カタカナ）の比率が閾値以上なら "ja"
 * - ハングル（U+AC00-U+D7AF）が含まれれば "multilingual"
 * - それ以外は "en"
 *
 * 注意: CJK漢字は日本語・中国語・韓国語で共通するため、ひらがな/カタカナで日本語を識別する。
 */
export function detectLanguage(text: string): "ja" | "en" | "multilingual" {
  if (!text || text.length === 0) {
    return "en";
  }
  // ひらがな (U+3040-U+309F) またはカタカナ (U+30A0-U+30FF) で日本語を識別
  const kanaPattern = /[\u3040-\u309F\u30A0-\u30FF]/g;
  const kanaMatches = text.match(kanaPattern);
  const kanaCount = kanaMatches ? kanaMatches.length : 0;
  if (kanaCount / text.length >= 0.05) {
    return "ja";
  }
  // ハングル (U+AC00-U+D7AF, U+1100-U+11FF) → multilingual
  const hangulPattern = /[\uAC00-\uD7AF\u1100-\u11FF]/g;
  if (hangulPattern.test(text)) {
    return "multilingual";
  }
  // CJK漢字のみ（中国語等）も multilingual へ
  const cjkPattern = /[\u4E00-\u9FFF\u3400-\u4DBF]/g;
  const cjkMatches = text.match(cjkPattern);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  if (cjkCount / text.length >= 0.1) {
    return "multilingual";
  }
  return "en";
}

/**
 * COMP-005: 言語に応じてデフォルトモデルIDを選択する。
 * - 日本語: ruri-v3-30m
 * - 多言語（韓国語/中国語等）: multilingual-e5
 * - 英語: gte-small
 */
export function selectModelByLanguage(language: "ja" | "en" | "multilingual"): string {
  if (language === "ja") return "ruri-v3-30m";
  if (language === "multilingual") return "multilingual-e5";
  return "gte-small";
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
  const rawModelId = (options.localModelId || process.env.HARNESS_MEM_EMBEDDING_MODEL || "multilingual-e5").trim();
  const modelId = rawModelId === "auto"
    ? selectModelByLanguage(options.defaultLanguage ?? "ja")
    : rawModelId;
  const catalogEntry = findModelById(modelId);
  const manager = new ModelManager(options.localModelsDir);
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
    } else {
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
