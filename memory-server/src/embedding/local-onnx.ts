import type { EmbeddingProvider, EmbeddingHealth, EmbeddingCacheStats } from "./types";
import type { ModelPooling } from "./model-catalog";

// Lazy import to avoid loading Transformers.js at startup when not needed
type TransformersModule = typeof import("@huggingface/transformers");
type AutoTokenizerInstance = Awaited<ReturnType<TransformersModule["AutoTokenizer"]["from_pretrained"]>>;
type AutoModelInstance = Awaited<ReturnType<TransformersModule["AutoModel"]["from_pretrained"]>>;

export interface LocalOnnxOptions {
  modelId: string;
  modelPath: string;
  /** Output vector dimension (what callers receive). */
  dimension: number;
  /**
   * Hidden size the ONNX graph must produce. Defaults to `dimension`.
   * A runtime mismatch throws (S154-503) instead of silently truncating or
   * zero-padding — that would measure a different model than declared.
   */
  nativeDimension?: number;
  /** Allow Matryoshka truncation (dimension < nativeDimension) with re-normalize. */
  matryoshka?: boolean;
  /** Token pooling strategy (default "mean"). */
  pooling?: ModelPooling;
  /** Literal text appended after prefix+content (e.g. Qwen3 trailing <|endoftext|>). */
  appendText?: string;
  /** Tokenizer truncation cap (max_length). */
  maxSeqLength?: number;
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

// Attention-mask aware token picking: works for both left- and right-padded
// batches (S154-503). A naive "row 0" / "last row" pick would read pad-token
// hidden states whenever batched inputs have different lengths.
/** @internal exported for unit tests */
export function pickTokenIndex(attentionMask: number[], which: "first" | "last"): number {
  if (which === "first") {
    for (let i = 0; i < attentionMask.length; i++) {
      if (attentionMask[i] === 1) return i;
    }
    return 0;
  }
  for (let i = attentionMask.length - 1; i >= 0; i--) {
    if (attentionMask[i] === 1) return i;
  }
  return attentionMask.length - 1;
}

/** @internal exported for unit tests */
export function poolTokens(embeddings: number[][], attentionMask: number[], pooling: ModelPooling): number[] {
  if (pooling === "last_token") {
    return embeddings[pickTokenIndex(attentionMask, "last")];
  }
  if (pooling === "cls") {
    return embeddings[pickTokenIndex(attentionMask, "first")];
  }
  return meanPooling(embeddings, attentionMask);
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

export interface VectorProjection {
  modelId: string;
  dimension: number;
  nativeDimension: number;
  matryoshka: boolean;
}

// S154-503: fail-closed dimension handling. The previous fitDimension()
// silently truncated/zero-padded any mismatch, so a wrong catalog dimension
// would still "measure" — just not the declared model. Only an explicit
// Matryoshka declaration may truncate, and the result is re-normalized.
/** @internal exported for unit tests */
export function projectVector(pooled: number[], projection: VectorProjection): number[] {
  if (pooled.length !== projection.nativeDimension) {
    throw createLocalOnnxError(
      projection.modelId,
      "inference_failed",
      `local ONNX model ${projection.modelId} produced hidden size ${pooled.length}, expected nativeDimension ${projection.nativeDimension} (catalog mismatch — refusing silent truncate/pad)`,
      false
    );
  }
  const normalized = l2Normalize(pooled);
  if (projection.dimension === projection.nativeDimension) {
    return normalized;
  }
  if (projection.matryoshka && projection.dimension < projection.nativeDimension) {
    return l2Normalize(normalized.slice(0, projection.dimension));
  }
  throw createLocalOnnxError(
    projection.modelId,
    "inference_failed",
    `local ONNX model ${projection.modelId} cannot project nativeDimension ${projection.nativeDimension} to ${projection.dimension}: not declared matryoshka in the catalog`,
    false
  );
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

/** @internal exported for unit tests */
export function extractBatchVectors(
  output: unknown,
  attentionMask: number[],
  attentionDims: number[],
  projection: VectorProjection,
  pooling: ModelPooling
): number[][] | null {
  const tensor = output as { data?: Float32Array | number[]; dims?: number[] } | null;
  if (!tensor || !tensor.data || !tensor.dims) {
    return null;
  }

  if (tensor.dims.length === 2) {
    const hiddenStates = extractHiddenStates(output);
    return hiddenStates
      ? [projectVector(poolTokens(hiddenStates, attentionMask, pooling), projection)]
      : null;
  }

  if (tensor.dims.length !== 3) {
    return null;
  }

  const batchSize = tensor.dims[0];
  const seqLen = tensor.dims[1];
  const hiddenSize = tensor.dims[2];
  if (!batchSize || !seqLen || !hiddenSize) {
    return null;
  }

  const maskSeqLen = attentionDims.length >= 2 ? attentionDims[1] : seqLen;
  const data = tensor.data;
  const vectors: number[][] = [];

  for (let batch = 0; batch < batchSize; batch++) {
    const rowMask: number[] = new Array<number>(seqLen);
    for (let token = 0; token < seqLen; token++) {
      rowMask[token] = attentionMask[batch * maskSeqLen + token] ?? 0;
    }
    const rows: number[][] = new Array(seqLen);
    for (let token = 0; token < seqLen; token++) {
      const base = (batch * seqLen + token) * hiddenSize;
      const row: number[] = new Array<number>(hiddenSize);
      for (let dim = 0; dim < hiddenSize; dim++) {
        row[dim] = data[base + dim];
      }
      rows[token] = row;
    }
    vectors.push(projectVector(poolTokens(rows, rowMask, pooling), projection));
  }

  return vectors;
}

export function createLocalOnnxEmbeddingProvider(options: LocalOnnxOptions): EmbeddingProvider {
  const { modelId, modelPath, dimension } = options;
  const queryPrefix = options.queryPrefix ?? "";
  const passagePrefix = options.passagePrefix ?? "";
  const pooling: ModelPooling = options.pooling ?? "mean";
  const appendSuffix = options.appendText ?? "";
  const maxSeqLength = options.maxSeqLength;
  const projection: VectorProjection = {
    modelId,
    dimension,
    nativeDimension: options.nativeDimension ?? dimension,
    matryoshka: options.matryoshka === true,
  };
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
  let initPromise: Promise<void> | null = null;
  let lastHealth: EmbeddingHealth = {
    status: "healthy",
    details: `local model ${modelId}: lazy initialization pending`,
  };

  function failSyncEmbed(
    text: string,
    prefix: string,
    code: LocalOnnxErrorCode,
    details: string,
    retryable: boolean
  ): never {
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

  function ensureInitialized(): Promise<void> {
    if (!initPromise) {
      lastHealth = {
        status: "degraded",
        details: `local model ${modelId}: initializing...`,
      };
      initPromise = (async () => {
        try {
          // Dynamic import to avoid bundling issues at startup
          const transformers: TransformersModule = await import("@huggingface/transformers");
          const { AutoTokenizer, AutoModel, env } = transformers;

          // Force local-only mode: do not fetch from HuggingFace Hub at inference time
          env.localModelPath = modelPath;
          env.allowRemoteModels = false;
          env.useBrowserCache = false;
          // §154-720: transformers.js v4 で新設された filesystem cache (Node/Bun 環境)
          // を OFF。ON だとローカル ~/.cache 等に過去 run のベクターが残り、parity
          // 計測時に古い snapshot を読んで drift 偽陰性になるリスクがある。
          // (TransformersEnvironment.useFSCache, v4 新設プロパティ)
          (env as { useFSCache?: boolean }).useFSCache = false;

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
    }
    return initPromise;
  }

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

    failSyncEmbed(
      normalizedText,
      prefix,
      "prime_required",
      `local ONNX model ${modelId} requires async prime before sync embed (mode=${prefix === queryPrefix ? "query" : "passage"}, chars=${normalizedText.length})`,
      true
    );
  }

  async function computeEmbeddingsBatch(texts: string[], prefix: string): Promise<number[][]> {
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

    const normalizedTexts = texts.map((text) => text || "");
    const prefixedTexts = normalizedTexts.map((text) => prefix + text + appendSuffix);

    const encoded = (tokenizer as unknown as {
      (text: string | string[], opts: { padding: boolean; truncation: boolean; max_length?: number; return_tensors: string }): {
        input_ids: { data: number[] | BigInt64Array; dims: number[] };
        attention_mask: { data: number[] | BigInt64Array; dims: number[] };
      };
    })(prefixedTexts.length === 1 ? prefixedTexts[0] : prefixedTexts, {
      padding: true,
      truncation: true,
      ...(maxSeqLength ? { max_length: maxSeqLength } : {}),
      return_tensors: "pt",
    });

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
    const vectors = extractBatchVectors(hiddenStateTensor, attentionMask, encoded.attention_mask.dims, projection, pooling);
    if (vectors && vectors.length === normalizedTexts.length) {
      return vectors;
    }
    const tensor = hiddenStateTensor as { dims?: number[] } | null;
    if (normalizedTexts.length > 1 && tensor?.dims?.length === 2) {
      const sequential: number[][] = [];
      for (const text of normalizedTexts) {
        const [vector] = await computeEmbeddingsBatch([text], prefix);
        sequential.push(vector);
      }
      return sequential;
    }
    if (!vectors || vectors.length !== normalizedTexts.length) {
      throw createLocalOnnxError(
        modelId,
        "inference_failed",
        `local ONNX model ${modelId} returned invalid hidden states (keys: ${Object.keys(outputObj).join(", ")})`,
        false
      );
    }
    return vectors;
  }

  async function computeEmbedding(text: string, prefix: string): Promise<number[]> {
    const [embedding] = await computeEmbeddingsBatch([text], prefix);
    return embedding;
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
      await ensureInitialized();
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

  async function primeBatchInternal(texts: string[], prefix: string): Promise<number[][]> {
    const normalizedTexts = texts.map((text) => text || "");
    const results: Array<number[] | null> = new Array(normalizedTexts.length).fill(null);
    const missingByKey = new Map<string, { text: string; indexes: number[] }>();

    normalizedTexts.forEach((text, index) => {
      const cacheKey = `${prefix}${text}`;
      const cached = getCachedEmbedding(cacheKey);
      if (cached) {
        results[index] = cached;
        return;
      }
      const bucket = missingByKey.get(cacheKey) ?? { text, indexes: [] };
      bucket.indexes.push(index);
      missingByKey.set(cacheKey, bucket);
    });

    const missing = [...missingByKey.entries()];
    if (missing.length > 0) {
      await ensureInitialized();
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
        const computed = await computeEmbeddingsBatch(missing.map(([, item]) => item.text), prefix);
        missing.forEach(([cacheKey, item], offset) => {
          const vector = computed[offset];
          setCachedEmbedding(cacheKey, vector);
          for (const index of item.indexes) {
            results[index] = vector;
          }
        });
        lastHealth = {
          status: "healthy",
          details: `local ONNX: ${modelId} (dim=${dimension})`,
        };
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
    }

    return results.map((value) => value ?? new Array<number>(dimension).fill(0));
  }

  return {
    name: "local",
    model: modelId,
    dimension,
    usesLocalModels: true,

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

    async primeBatch(texts: string[], mode: "passage" | "query" = "passage"): Promise<number[][]> {
      return primeBatchInternal(texts, mode === "query" ? queryPrefix : passagePrefix);
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
      return initPromise ?? Promise.resolve();
    },
  };
}
