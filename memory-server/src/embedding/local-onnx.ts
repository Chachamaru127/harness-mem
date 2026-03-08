import type { EmbeddingProvider, EmbeddingHealth, EmbeddingCacheStats } from "./types";

// Lazy import to avoid loading Transformers.js at startup when not needed
type TransformersModule = typeof import("@huggingface/transformers");
type AutoTokenizerInstance = Awaited<ReturnType<TransformersModule["AutoTokenizer"]["from_pretrained"]>>;
type AutoModelInstance = Awaited<ReturnType<TransformersModule["AutoModel"]["from_pretrained"]>>;

export interface LocalOnnxOptions {
  modelId: string;
  modelPath: string;
  dimension: number;
  queryPrefix?: string;
  passagePrefix?: string;
  fallback?: EmbeddingProvider;
  cacheSize?: number;
}

const DEFAULT_LOCAL_ONNX_CACHE_SIZE = 128;
type LocalOnnxErrorCode = "warming" | "init_failed" | "prime_required" | "inference_failed";

type LocalOnnxError = Error & {
  code: LocalOnnxErrorCode;
  modelId: string;
  retryable: boolean;
};

function createLocalOnnxError(
  modelId: string,
  code: LocalOnnxErrorCode,
  details: string,
  retryable: boolean
): LocalOnnxError {
  const error = new Error(details) as LocalOnnxError;
  error.name = "LocalOnnxEmbeddingError";
  error.code = code;
  error.modelId = modelId;
  error.retryable = retryable;
  return error;
}

function meanPooling(embeddings: number[][], attentionMask: number[]): number[] {
  const dim = embeddings[0].length;
  const result = new Array<number>(dim).fill(0);
  let validTokenCount = 0;

  for (let i = 0; i < embeddings.length; i++) {
    if (attentionMask[i] === 1) {
      for (let j = 0; j < dim; j++) {
        result[j] += embeddings[i][j];
      }
      validTokenCount++;
    }
  }

  if (validTokenCount === 0) {
    return result;
  }

  for (let j = 0; j < dim; j++) {
    result[j] /= validTokenCount;
  }

  return result;
}

function l2Normalize(vector: number[]): number[] {
  let norm = 0;
  for (const v of vector) {
    norm += v * v;
  }
  norm = Math.sqrt(norm);
  if (norm < 1e-12) {
    return vector;
  }
  return vector.map((v) => v / norm);
}

// Extract a 2D number[][] from Transformers.js tensor output.
// Supports both 3D [batch, seqLen, hiddenSize] (e.g. multilingual-e5)
// and 2D [seqLen, hiddenSize] (e.g. Ruri V3 30M) tensor shapes.
function extractHiddenStates(output: unknown): number[][] | null {
  // Transformers.js Tensor has .data (Float32Array) and .dims
  const tensor = output as { data?: Float32Array | number[]; dims?: number[] } | null;
  if (!tensor || !tensor.data || !tensor.dims) {
    return null;
  }

  let seqLen: number;
  let hiddenSize: number;

  if (tensor.dims.length === 3) {
    // 3D: [batch, seqLen, hiddenSize] — standard transformer output
    seqLen = tensor.dims[1];
    hiddenSize = tensor.dims[2];
  } else if (tensor.dims.length === 2) {
    // 2D: [seqLen, hiddenSize] — some models omit batch dimension
    seqLen = tensor.dims[0];
    hiddenSize = tensor.dims[1];
  } else {
    return null;
  }

  if (!seqLen || !hiddenSize) {
    return null;
  }

  const data = tensor.data;
  const rows: number[][] = [];
  for (let i = 0; i < seqLen; i++) {
    const row: number[] = [];
    for (let j = 0; j < hiddenSize; j++) {
      row.push(data[i * hiddenSize + j]);
    }
    rows.push(row);
  }
  return rows;
}

export function createLocalOnnxEmbeddingProvider(options: LocalOnnxOptions): EmbeddingProvider {
  const { modelId, modelPath, dimension } = options;
  const queryPrefix = options.queryPrefix ?? "";
  const passagePrefix = options.passagePrefix ?? "";
  const configuredCacheSize = Number.isFinite(options.cacheSize)
    ? Number(options.cacheSize)
    : DEFAULT_LOCAL_ONNX_CACHE_SIZE;
  const cacheCapacity = Math.max(1, Math.floor(configuredCacheSize));

  let tokenizer: AutoTokenizerInstance | null = null;
  let model: AutoModelInstance | null = null;
  let initError: string | null = null;
  let warnedOnce = false;
  let cacheHits = 0;
  let cacheMisses = 0;
  let cacheEvictions = 0;
  const embeddingCache = new Map<string, number[]>();
  const inflightComputations = new Map<string, Promise<number[]>>();
  let lastHealth: EmbeddingHealth = {
    status: "degraded",
    details: `local model ${modelId}: initializing...`,
  };

  function failSyncEmbed(
    text: string,
    prefix: string,
    code: LocalOnnxErrorCode,
    details: string,
    retryable: boolean
  ): never {
    const normalizedText = text || "";
    if (retryable && code !== "init_failed") {
      void primeInternal(normalizedText, prefix, {
        cacheKey: `${prefix}${normalizedText}`,
        skipCacheLookup: true,
      }).catch(() => undefined);
    }
    throw createLocalOnnxError(modelId, code, details, retryable);
  }

  function warnSyncUnavailable(error: unknown): void {
    if (warnedOnce) {
      return;
    }
    warnedOnce = true;

    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[harness-mem][warn] local model ${modelId} unavailable for sync embed: ${message}\n`);
  }

  function getCachedEmbedding(cacheKey: string): number[] | null {
    const cached = embeddingCache.get(cacheKey);
    if (!cached) {
      cacheMisses += 1;
      return null;
    }
    cacheHits += 1;
    // Reinsert to refresh recency (LRU)
    embeddingCache.delete(cacheKey);
    embeddingCache.set(cacheKey, cached);
    return cached;
  }

  function setCachedEmbedding(cacheKey: string, embedding: number[]): void {
    if (embeddingCache.has(cacheKey)) {
      embeddingCache.delete(cacheKey);
    }
    embeddingCache.set(cacheKey, embedding);

    while (embeddingCache.size > cacheCapacity) {
      const oldest = embeddingCache.keys().next().value;
      if (typeof oldest !== "string") {
        break;
      }
      embeddingCache.delete(oldest);
      cacheEvictions += 1;
    }
  }

  // Start async initialization immediately
  const initPromise: Promise<void> = (async () => {
    try {
      // Dynamic import to avoid bundling issues at startup
      const transformers: TransformersModule = await import("@huggingface/transformers");
      const { AutoTokenizer, AutoModel, env } = transformers;

      // Force local-only mode: do not fetch from HuggingFace Hub at inference time
      env.localModelPath = modelPath;
      env.allowRemoteModels = false;
      env.useBrowserCache = false;

      tokenizer = await AutoTokenizer.from_pretrained(modelPath);
      model = await AutoModel.from_pretrained(modelPath, {
        local_files_only: true,
      });

      lastHealth = {
        status: "healthy",
        details: `local ONNX: ${modelId} (dim=${dimension})`,
      };
    } catch (err) {
      initError = String(err);
      lastHealth = {
        status: "degraded",
        details: `local model ${modelId} failed to load: ${initError}`,
      };
    }
  })();

  function embedSync(text: string, prefix: string): number[] {
    const normalizedText = text || "";
    if (initError !== null || tokenizer === null || model === null) {
      const details =
        initError !== null
          ? `local ONNX model ${modelId} failed to initialize: ${initError}`
          : `local ONNX model ${modelId} is still warming up`;
      failSyncEmbed(normalizedText, prefix, initError !== null ? "init_failed" : "warming", details, initError === null);
    }

    const cacheKey = `${prefix}${normalizedText}`;
    const cached = getCachedEmbedding(cacheKey);
    if (cached) {
      return cached;
    }

    // Trigger async inference for next call (fire-and-forget).
    void primeInternal(normalizedText, prefix, {
      cacheKey,
      skipCacheLookup: true,
    });

    failSyncEmbed(
      normalizedText,
      prefix,
      "prime_required",
      `local ONNX model ${modelId} requires async prime before sync embed (${cacheKey.slice(0, 64)})`,
      true
    );
  }

  async function computeEmbedding(text: string, prefix: string): Promise<number[]> {
    if (initError !== null || tokenizer === null || model === null) {
      throw createLocalOnnxError(
        modelId,
        initError !== null ? "init_failed" : "warming",
        initError !== null
          ? `local ONNX model ${modelId} failed to initialize: ${initError}`
          : `local ONNX model ${modelId} is still warming up`,
        initError === null
      );
    }

    const prefixedText = prefix + (text || "");

    const encoded = (tokenizer as unknown as {
      (text: string, opts: { padding: boolean; truncation: boolean; return_tensors: string }): {
        input_ids: { data: number[] | BigInt64Array; dims: number[] };
        attention_mask: { data: number[] | BigInt64Array; dims: number[] };
      };
    })(prefixedText, { padding: true, truncation: true, return_tensors: "pt" });

    // model() returns a Promise in Transformers.js v3
    const output = await (model as unknown as {
      (inputs: typeof encoded): Promise<{ last_hidden_state: unknown }>;
    })(encoded);

    const attentionMaskRaw = encoded.attention_mask.data;
    const attentionMask: number[] = (Array.from(attentionMaskRaw as Iterable<unknown>) as unknown[]).map(
      (v) => Number(v)
    );

    // Models may use different output keys: last_hidden_state (e5, gte),
    // output (Ruri), or token_embeddings. Try each in priority order.
    const outputObj = output as Record<string, unknown>;
    const hiddenStateTensor = outputObj.last_hidden_state ?? outputObj.output ?? outputObj.token_embeddings;
    const hiddenStates = extractHiddenStates(hiddenStateTensor);
    if (!hiddenStates) {
      throw createLocalOnnxError(
        modelId,
        "inference_failed",
        `local ONNX model ${modelId} returned invalid hidden states (keys: ${Object.keys(outputObj).join(", ")})`,
        false
      );
    }

    const pooled = meanPooling(hiddenStates, attentionMask);
    const normalized = l2Normalize(pooled);

    let result: number[];
    if (normalized.length === dimension) {
      result = normalized;
    } else if (normalized.length > dimension) {
      result = normalized.slice(0, dimension);
    } else {
      result = [...normalized, ...new Array<number>(dimension - normalized.length).fill(0)];
    }
    return result;
  }

  async function primeInternal(
    text: string,
    prefix: string,
    optionsForPrime: { cacheKey?: string; skipCacheLookup?: boolean } = {}
  ): Promise<number[]> {
    const normalizedText = text || "";
    const cacheKey = optionsForPrime.cacheKey ?? `${prefix}${normalizedText}`;

    if (!optionsForPrime.skipCacheLookup) {
      const cached = getCachedEmbedding(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const inflight = inflightComputations.get(cacheKey);
    if (inflight) {
      return inflight;
    }

    const running = (async () => {
      await initPromise;
      if (initError !== null || tokenizer === null || model === null) {
        throw createLocalOnnxError(
          modelId,
          initError !== null ? "init_failed" : "warming",
          initError !== null
            ? `local ONNX model ${modelId} failed to initialize: ${initError}`
            : `local ONNX model ${modelId} is still warming up`,
          initError === null
        );
      }
      try {
        const computed = await computeEmbedding(normalizedText, prefix);
        lastHealth = {
          status: "healthy",
          details: `local ONNX: ${modelId} (dim=${dimension})`,
        };
        setCachedEmbedding(cacheKey, computed);
        return computed;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        lastHealth = {
          status: "degraded",
          details: `local model ${modelId} inference failed: ${message}`,
        };
        if (error instanceof Error && error.name === "LocalOnnxEmbeddingError") {
          throw error;
        }
        throw createLocalOnnxError(
          modelId,
          "inference_failed",
          `local ONNX model ${modelId} inference failed: ${message}`,
          false
        );
      }
    })();

    inflightComputations.set(cacheKey, running);
    try {
      return await running;
    } finally {
      inflightComputations.delete(cacheKey);
    }
  }

  return {
    name: "local",
    model: modelId,
    dimension,

    embed(text: string): number[] {
      try {
        return embedSync(text, passagePrefix);
      } catch (error) {
        warnSyncUnavailable(error);
        throw error;
      }
    },

    embedQuery(text: string): number[] {
      try {
        return embedSync(text, queryPrefix);
      } catch (error) {
        warnSyncUnavailable(error);
        throw error;
      }
    },

    async prime(text: string): Promise<number[]> {
      return primeInternal(text, passagePrefix);
    },

    async primeQuery(text: string): Promise<number[]> {
      return primeInternal(text, queryPrefix);
    },

    cacheStats(): EmbeddingCacheStats {
      return {
        entries: embeddingCache.size,
        capacity: cacheCapacity,
        hits: cacheHits,
        misses: cacheMisses,
        evictions: cacheEvictions,
        inflight: inflightComputations.size,
      };
    },

    health(): EmbeddingHealth {
      return { ...lastHealth };
    },

    // Expose the init promise for callers that want to await readiness
    get ready(): Promise<void> {
      return initPromise;
    },
  };
}
