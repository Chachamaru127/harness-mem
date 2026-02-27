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

/**
 * IMP-008: テキストの言語を検出する。
 * 日本語文字（ひらがな・カタカナ・漢字）の比率が閾値以上なら "ja"、それ以外は "en"。
 */
export function detectLanguage(text: string): "ja" | "en" {
  if (!text || text.length === 0) {
    return "en";
  }
  // 日本語文字：ひらがな (U+3040-U+309F)、カタカナ (U+30A0-U+30FF)、CJK漢字 (U+4E00-U+9FFF)
  const japanesePattern = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/g;
  const matches = text.match(japanesePattern);
  const japaneseCount = matches ? matches.length : 0;
  const ratio = japaneseCount / text.length;
  return ratio >= 0.1 ? "ja" : "en";
}

/**
 * IMP-008: 言語に応じてデフォルトモデルIDを選択する。
 * - 日本語: ruri-v3-30m
 * - 英語: gte-small
 */
export function selectModelByLanguage(language: "ja" | "en"): string {
  return language === "ja" ? "ruri-v3-30m" : "gte-small";
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
    // IMP-008: "auto" の場合は言語自動選択（デフォルト言語モデルを使用）
    const rawModelId = (options.localModelId || process.env.HARNESS_MEM_EMBEDDING_MODEL || "ruri-v3-30m").trim();
    const modelId = rawModelId === "auto"
      ? selectModelByLanguage(options.defaultLanguage ?? "ja")
      : rawModelId;
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
