export interface ModelCatalogEntry {
  id: string;
  displayName: string;
  onnxRepo: string;
  tokenizerRepo: string;
  dimension: number;
  sizeBytes: number;
  language: string;
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
