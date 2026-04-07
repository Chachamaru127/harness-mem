import { createSimpleReranker, createCrossEncoderReranker } from "./simple-reranker";
import { createCohereReranker } from "./cohere-reranker";
import { createHfReranker } from "./hf-reranker";
import { createStReranker } from "./st-reranker";
import { createOnnxCrossEncoderReranker } from "./onnx-cross-encoder";
import type { IReranker, RerankerConfig, RerankerRegistryResult } from "./types";

function parseEnabled(raw: unknown): boolean {
  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return false;
}

/**
 * IReranker プロバイダーを設定に基づいて生成する。
 * APIキーがない場合は simple-v1 にフォールバックし、警告を返す。
 */
export function createReranker(config: RerankerConfig): { reranker: IReranker; warnings: string[] } {
  const warnings: string[] = [];

  switch (config.provider) {
    case "cohere": {
      const apiKey = config.apiKey ?? process.env.COHERE_API_KEY ?? "";
      if (!apiKey) {
        warnings.push("COHERE_API_KEY is not set; falling back to simple-v1 reranker");
        return { reranker: createSimpleIRerankerAdapter(), warnings };
      }
      return { reranker: createCohereReranker(apiKey, config.model), warnings };
    }
    case "huggingface": {
      const apiKey = config.apiKey ?? process.env.HF_TOKEN ?? "";
      if (!apiKey) {
        warnings.push("HF_TOKEN is not set; falling back to simple-v1 reranker");
        return { reranker: createSimpleIRerankerAdapter(), warnings };
      }
      return { reranker: createHfReranker(apiKey, config.model), warnings };
    }
    case "sentence-transformers": {
      const endpoint = config.endpoint ?? process.env.SENTENCE_TRANSFORMERS_ENDPOINT;
      return { reranker: createStReranker(endpoint), warnings };
    }
    case "simple":
    default: {
      return { reranker: createSimpleIRerankerAdapter(), warnings };
    }
  }
}

/**
 * 既存同期 Reranker を IReranker（非同期）として包む。
 */
function createSimpleIRerankerAdapter(): IReranker {
  const simple = createSimpleReranker();
  return {
    name: simple.name,
    async rerank(query, items, options) {
      const input = {
        query,
        items: items.map((item, index) => ({
          id: String(item.id),
          score: item.score,
          created_at: new Date().toISOString(),
          title: item.title,
          content: item.content,
          source_index: index,
        })),
      };
      const output = simple.rerank(input);
      const topK = options?.topK ?? output.length;
      return output.slice(0, topK).map((o) => ({
        id: Number(o.id),
        score: o.score,
        rerank_score: o.rerank_score,
      }));
    },
  };
}

export function createRerankerRegistry(enabledInput: unknown): RerankerRegistryResult {
  const enabled = parseEnabled(enabledInput);
  if (!enabled) {
    return {
      enabled: false,
      reranker: null,
      warnings: [],
    };
  }

  // 環境変数でプロバイダーを切り替え
  const provider = (process.env.HARNESS_MEM_RERANKER_PROVIDER ?? "simple") as RerankerConfig["provider"];
  const model = process.env.HARNESS_MEM_RERANKER_MODEL;

  if (provider === "simple") {
    // cross-encoder-v1 をデフォルトに: N-gram overlap でコンテンツ類似度を捕捉
    return {
      enabled: true,
      reranker: createCrossEncoderReranker(),
      warnings: [],
    };
  }

  if (provider === "onnx-cross-encoder") {
    // ONNX ローカル推論 cross-encoder。
    // ロード失敗時は reranker 内部で simple-v1 にフォールバックするため
    // warnings は不要。
    return {
      enabled: true,
      reranker: createOnnxCrossEncoderReranker(),
      warnings: [],
    };
  }

  // 非同期プロバイダーを simple Reranker インターフェースにラップして返す
  // observation-store は同期 Reranker を使っているため、既存パスは維持
  const { warnings } = createReranker({ provider, model });
  // APIキー未設定でフォールバックの場合は simple-v1 を返す
  if (warnings.length > 0) {
    return {
      enabled: true,
      reranker: createSimpleReranker(),
      warnings,
    };
  }

  return {
    enabled: true,
    reranker: createSimpleReranker(),
    warnings: [`Provider '${provider}' is configured; use createReranker() for async access`],
  };
}
