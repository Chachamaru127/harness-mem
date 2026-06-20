export type ModelPooling = "mean" | "last_token" | "cls";
export type ModelType = "embedding" | "reranker";

export interface ModelCatalogEntry {
  id: string;
  displayName: string;
  onnxRepo: string;
  tokenizerRepo: string;
  /** Output vector dimension (what gets stored/compared). */
  dimension: number;
  /**
   * Model hidden size as produced by the ONNX graph. Defaults to `dimension`.
   * The local provider fail-closes when the runtime hidden size differs
   * (S154-503: no silent truncate/pad — that would measure a different model).
   */
  nativeDimension?: number;
  /**
   * Matryoshka (MRL) models may be truncated below nativeDimension and
   * re-normalized. Without this flag, dimension !== nativeDimension throws.
   */
  matryoshka?: boolean;
  /** Token pooling strategy. Defaults to "mean". */
  pooling?: ModelPooling;
  /**
   * Literal text appended after prefix+content before tokenization.
   * Qwen3-Embedding requires a trailing <|endoftext|> for last-token pooling
   * (the official usage appends the EOD id manually).
   */
  appendText?: string;
  /** Tokenizer truncation cap. Recorded per model so A/B input conditions are visible. */
  maxSeqLength?: number;
  /** ONNX filename under onnx/ on the repo (default "model.onnx"). */
  onnxFile?: string;
  /** Catalog entry kind (default "embedding"). Rerankers share the pull pipeline. */
  modelType?: ModelType;
  sizeBytes: number;
  language: "ja" | "en" | "multilingual";
  queryPrefix?: string;
  passagePrefix?: string;
}

export const MODEL_CATALOG: ModelCatalogEntry[] = [
  {
    id: "ruri-v3-30m",
    displayName: "Ruri V3 30M (Japanese)",
    onnxRepo: "WariHima/ruri-v3-30m-onnx",
    tokenizerRepo: "cl-nagoya/ruri-v3-30m",
    dimension: 256,
    sizeBytes: 153_000_000,
    language: "ja",
    queryPrefix: "query: ",
    passagePrefix: "passage: ",
  },
  {
    id: "ruri-v3-130m",
    displayName: "Ruri V3 130M (Japanese)",
    onnxRepo: "cl-nagoya/ruri-v3-130m",
    tokenizerRepo: "cl-nagoya/ruri-v3-130m",
    dimension: 512,
    sizeBytes: 300_000_000,
    language: "ja",
    queryPrefix: "query: ",
    passagePrefix: "passage: ",
  },
  {
    id: "ruri-v3-310m",
    displayName: "Ruri V3 310M (Japanese)",
    onnxRepo: "cl-nagoya/ruri-v3-310m",
    tokenizerRepo: "cl-nagoya/ruri-v3-310m",
    dimension: 768,
    sizeBytes: 1_200_000_000,
    language: "ja",
    queryPrefix: "query: ",
    passagePrefix: "passage: ",
  },
  {
    id: "gte-small",
    displayName: "GTE Small (English)",
    onnxRepo: "Xenova/gte-small",
    tokenizerRepo: "Xenova/gte-small",
    dimension: 384,
    sizeBytes: 67_000_000,
    language: "en",
  },
  {
    id: "e5-small-v2",
    displayName: "E5 Small v2 (English)",
    onnxRepo: "Xenova/e5-small-v2",
    tokenizerRepo: "Xenova/e5-small-v2",
    dimension: 384,
    sizeBytes: 67_000_000,
    language: "en",
    queryPrefix: "query: ",
    passagePrefix: "passage: ",
  },
  // COMP-005: 追加3モデル（計6モデル）
  {
    id: "bge-small",
    displayName: "BGE Small v1.5 (English/Chinese)",
    onnxRepo: "Xenova/bge-small-en-v1.5",
    tokenizerRepo: "Xenova/bge-small-en-v1.5",
    dimension: 384,
    // BGE family pools the CLS token (S154-503: was implicitly mean-pooled).
    pooling: "cls",
    sizeBytes: 67_000_000,
    language: "en",
    queryPrefix: "Represent this sentence for searching relevant passages: ",
  },
  {
    id: "bge-m3",
    displayName: "BGE-M3 (Multilingual)",
    onnxRepo: "Xenova/bge-m3",
    tokenizerRepo: "Xenova/bge-m3",
    dimension: 1024,
    // S154-502: BGE-M3 officially needs no instruction prefix; the previous
    // queryPrefix here was the bge-small v1.5 instruction leaking in, which
    // would bias any A/B against it. Official dense pooling is CLS.
    pooling: "cls",
    sizeBytes: 2_270_000_000,
    language: "multilingual",
  },
  {
    id: "multilingual-e5",
    displayName: "Multilingual E5 Small (100+ languages)",
    onnxRepo: "Xenova/multilingual-e5-small",
    tokenizerRepo: "Xenova/multilingual-e5-small",
    dimension: 384,
    sizeBytes: 117_000_000,
    language: "multilingual",
    queryPrefix: "query: ",
    passagePrefix: "passage: ",
  },
  {
    id: "nomic-embed",
    displayName: "Nomic Embed Text v1 (English)",
    onnxRepo: "nomic-ai/nomic-embed-text-v1",
    tokenizerRepo: "nomic-ai/nomic-embed-text-v1",
    dimension: 768,
    sizeBytes: 274_000_000,
    language: "en",
    queryPrefix: "search_query: ",
    passagePrefix: "search_document: ",
  },
  // S154-502: 2026-generation multilingual shadow candidates.
  {
    id: "qwen3-embedding-0.6b",
    displayName: "Qwen3 Embedding 0.6B (Multilingual)",
    onnxRepo: "onnx-community/Qwen3-Embedding-0.6B-ONNX",
    tokenizerRepo: "onnx-community/Qwen3-Embedding-0.6B-ONNX",
    dimension: 1024,
    nativeDimension: 1024,
    matryoshka: true,
    // Decoder-family model: official usage is last-token pooling with a
    // manually appended <|endoftext|> (config.json eos_token_id 151643).
    pooling: "last_token",
    appendText: "<|endoftext|>",
    // Cap to the incumbent e5-small window (512) so the A/B compares models
    // under identical input conditions; the model itself supports 32k.
    maxSeqLength: 512,
    // fp32 is external-data format: onnx/model.onnx (307MB) + onnx/model.onnx_data (2.09GB).
    sizeBytes: 2_400_000_000,
    language: "multilingual",
    queryPrefix:
      "Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery:",
  },
  {
    id: "granite-embedding-311m-r2",
    displayName: "Granite Embedding 311M Multilingual R2",
    onnxRepo: "ibm-granite/granite-embedding-311m-multilingual-r2",
    tokenizerRepo: "ibm-granite/granite-embedding-311m-multilingual-r2",
    dimension: 768,
    nativeDimension: 768,
    matryoshka: true,
    // 1_Pooling/config.json: pooling_mode_cls_token=true. No prompts
    // (config_sentence_transformers.json prompts are empty strings).
    pooling: "cls",
    maxSeqLength: 512,
    sizeBytes: 1_250_000_000,
    language: "multilingual",
  },
  // ---------------------------------------------------------------------------
  // S154-711: Cross-encoder reranker entries (modelType: "reranker")
  // Pull pipeline は embedding と同じ経路 (154-504 pull API) を使用する。
  // dimension/pooling は reranker には不適用だが catalog schema 上は必須のため
  // dummy 値 (1) を設定している (parseEmbeddingDefaultModelFlag は dimension > 0
  // を要求するが、reranker entry は embedding default flag 候補ではない)。
  // ---------------------------------------------------------------------------
  {
    id: "bge-reranker-v2-m3",
    displayName: "BGE Reranker v2 M3 (Multilingual, ONNX int8)",
    // Xenova の ONNX 変換版。onnx/model_quantized.onnx が int8 quantized。
    // HF tree: https://huggingface.co/Xenova/bge-reranker-v2-m3/tree/main/onnx
    // ONNX int8 実在確認: sandbox 内 egress 制限により直接確認不可。
    // Xenova/bge-reranker-v2-m3 は Xenova の標準変換パターンと同型のため
    // model_quantized.onnx の存在を期待するが、pull 時に確認すること。
    onnxRepo: "Xenova/bge-reranker-v2-m3",
    tokenizerRepo: "Xenova/bge-reranker-v2-m3",
    onnxFile: "model_quantized.onnx",
    dimension: 1,
    modelType: "reranker",
    maxSeqLength: 512,
    // BAAI/bge-reranker-v2-m3 本体は 568M パラメータ (約 1.1GB fp32)。
    // int8 quantized は約 280MB 相当。
    sizeBytes: 280_000_000,
    language: "multilingual",
  },
  // japanese-reranker-xsmall-v2 (MIT, CPU 15.3ms/pair) は sandbox 外確認が必要。
  // 確認方法: `curl https://huggingface.co/api/models/Xenova/japanese-reranker-cross-encoder-xsmall-v2/tree/main/onnx`
  // 不在の場合は本エントリを追加せず PR notes に記録する。
  // (154-711 TODO: egress 許可後に実在確認してから add)
];

export function findModelById(id: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG.find((entry) => entry.id === id);
}

export type EmbeddingDefaultModelFlag =
  | { ok: true; modelId: string; dimension: number }
  | { ok: false; reason: string };

/**
 * Parse the `embedding_default_model` flag value (`<modelId>[@<dimension>]`).
 *
 *   - bare `<modelId>` (e.g. `granite-embedding-311m-r2`) → native catalog dimension.
 *   - `<modelId>@<dimension>` (e.g. `granite-embedding-311m-r2@384`) → MRL-truncated dimension.
 *
 * Validation (any failure returns `{ ok: false }`):
 *   - modelId must exist in the model catalog.
 *   - dimension must be a positive integer ≤ the model's nativeDimension.
 *   - a dimension below nativeDimension is only allowed when the catalog entry
 *     declares `matryoshka: true` (MRL truncate + re-normalize).
 *
 * This validates flag *format* only. The registry additionally rejects a parsed
 * result whose dimension differs from the vector store's effective dimension;
 * the setter intentionally does not, because the flag may be written before the
 * backfill that changes the store dimension (the reader fail-safes on mismatch).
 *
 * Lives in model-catalog (pure, dependency-free) so both the writer
 * (config-manager setter) and the reader (registry) validate the same format
 * without an import cycle.
 */
export function parseEmbeddingDefaultModelFlag(raw: string | undefined): EmbeddingDefaultModelFlag {
  const value = (raw ?? "").trim();
  if (!value) {
    return { ok: false, reason: "empty" };
  }
  const atIndex = value.indexOf("@");
  const hasSuffix = atIndex !== -1;
  const modelId = (hasSuffix ? value.slice(0, atIndex) : value).trim();
  const dimensionPart = hasSuffix ? value.slice(atIndex + 1).trim() : "";

  const entry = findModelById(modelId);
  if (!entry) {
    return { ok: false, reason: `unknown model id "${modelId}"` };
  }
  const nativeDimension = entry.nativeDimension ?? entry.dimension;

  // No `@` → bare model resolves to native dimension. A trailing `@` with an
  // empty suffix is malformed and must be rejected (not treated as bare).
  if (!hasSuffix) {
    return { ok: true, modelId, dimension: nativeDimension };
  }
  if (dimensionPart === "") {
    return { ok: false, reason: `empty dimension after "@" in "${value}"` };
  }

  if (!/^\d+$/.test(dimensionPart)) {
    return { ok: false, reason: `non-numeric dimension "${dimensionPart}"` };
  }
  const dimension = Number(dimensionPart);
  if (dimension <= 0 || dimension > nativeDimension) {
    return { ok: false, reason: `dimension ${dimension} out of range (1..${nativeDimension})` };
  }
  if (dimension < nativeDimension && entry.matryoshka !== true) {
    return { ok: false, reason: `${modelId} is not matryoshka; cannot truncate to ${dimension}` };
  }
  return { ok: true, modelId, dimension };
}

export function formatSize(bytes: number): string {
  if (bytes >= 1_000_000_000) {
    return `${(bytes / 1_000_000_000).toFixed(1)}GB`;
  }
  if (bytes >= 1_000_000) {
    return `${(bytes / 1_000_000).toFixed(0)}MB`;
  }
  return `${(bytes / 1_000).toFixed(0)}KB`;
}
