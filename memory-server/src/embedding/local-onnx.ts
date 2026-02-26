import type { EmbeddingProvider, EmbeddingHealth } from "./types";

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

// Extract a 2D number[][] from Transformers.js tensor output (last_hidden_state)
function extractHiddenStates(output: unknown): number[][] | null {
  // Transformers.js Tensor has .data (Float32Array) and .dims
  const tensor = output as { data?: Float32Array | number[]; dims?: number[] } | null;
  if (!tensor || !tensor.data || !tensor.dims) {
    return null;
  }
  const [, seqLen, hiddenSize] = tensor.dims;
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

  let tokenizer: AutoTokenizerInstance | null = null;
  let model: AutoModelInstance | null = null;
  let initError: string | null = null;
  let warnedOnce = false;
  let lastHealth: EmbeddingHealth = {
    status: "degraded",
    details: `local model ${modelId}: initializing...`,
  };

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

  // KNOWN LIMITATION: Transformers.js model inference (model.__call__) is async
  // (returns a Promise). The sync embed() interface cannot await it directly.
  // We cache the last inference result from the async path (embedAsync).
  // If cachedResult is available and matches this text, use it; otherwise fall back.
  // This means the FIRST call for any new text always returns fallback/zeros;
  // subsequent calls for the same text will return the real ONNX embedding.
  // The single-entry cache is intentional to keep memory bounded, but it means
  // alternating query/passage texts will always miss. A future improvement would
  // be to expose an async embedQueryAsync() on the EmbeddingProvider interface.
  function embedSync(text: string, prefix: string): number[] {
    if (initError !== null || tokenizer === null || model === null) {
      // Fallback: if a fallback provider is given use it, otherwise return zeros
      if (options.fallback) {
        return options.fallback.embed(text);
      }
      return new Array<number>(dimension).fill(0);
    }

    // KNOWN LIMITATION: Transformers.js model inference (model.__call__) is async
    // (returns a Promise). The sync embed() interface cannot await it directly.
    // We cache the last inference result from the async path (embedAsync).
    // If cachedResult is available and matches this text, use it; otherwise fall back.
    if (cachedEmbedding && cachedEmbeddingKey === prefix + (text || "")) {
      return cachedEmbedding;
    }

    // Trigger async inference for next call (fire-and-forget)
    void embedAsync(text, prefix);

    // Fall back for this call
    if (options.fallback) {
      return options.fallback.embed(text);
    }
    return new Array<number>(dimension).fill(0);
  }

  // Async inference path: computes embedding and caches the result
  let cachedEmbeddingKey: string | null = null;
  let cachedEmbedding: number[] | null = null;

  async function embedAsync(text: string, prefix: string): Promise<number[]> {
    if (initError !== null || tokenizer === null || model === null) {
      return new Array<number>(dimension).fill(0);
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

    const hiddenStates = extractHiddenStates(output.last_hidden_state);
    if (!hiddenStates) {
      if (options.fallback) {
        return options.fallback.embed(text);
      }
      return new Array<number>(dimension).fill(0);
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

    // Cache for sync access on next embed() call
    cachedEmbeddingKey = prefixedText;
    cachedEmbedding = result;
    return result;
  }

  return {
    name: "local",
    model: modelId,
    dimension,

    embed(text: string): number[] {
      if (tokenizer === null || model === null) {
        if (!warnedOnce) {
          warnedOnce = true;
          if (!initError) {
            process.stderr.write(
              `[harness-mem][warn] local model ${modelId} not yet ready; using fallback\n`
            );
          } else {
            process.stderr.write(
              `[harness-mem][warn] local model ${modelId} failed: ${initError}; using fallback\n`
            );
          }
        }
        if (options.fallback) {
          return options.fallback.embed(text);
        }
        return new Array<number>(dimension).fill(0);
      }
      return embedSync(text, passagePrefix);
    },

    embedQuery(text: string): number[] {
      if (tokenizer === null || model === null) {
        if (options.fallback) {
          return options.fallback.embed(text);
        }
        return new Array<number>(dimension).fill(0);
      }
      return embedSync(text, queryPrefix);
    },

    health(): EmbeddingHealth {
      return { ...lastHealth };
    },

    // Expose the init promise for callers that want to await readiness
    get ready(): Promise<void> {
      return initPromise;
    },
  } as EmbeddingProvider & { embedQuery(text: string): number[]; ready: Promise<void> };
}
