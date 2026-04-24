export interface ModelCatalogEntry {
  id: string;
  displayName: string;
  onnxRepo: string;
  tokenizerRepo: string;
  dimension: number;
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
    sizeBytes: 67_000_000,
    language: "en",
    queryPrefix: "Represent this sentence for searching relevant passages: ",
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
];

export function findModelById(id: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG.find((entry) => entry.id === id);
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
