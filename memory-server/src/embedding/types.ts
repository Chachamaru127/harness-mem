export type EmbeddingProviderName = "fallback" | "openai" | "ollama" | "local" | "adaptive" | "pro-api";

export type AdaptiveRoute = "ruri" | "openai" | "ensemble";

export type QueryType = "natural" | "code" | "mixed";

export interface QueryAnalysis {
  jaRatio: number;
  enRatio: number;
  codeRatio: number;
  length: number;
  queryType: QueryType;
}

export interface EmbeddingHealth {
  status: "healthy" | "degraded";
  details: string;
}

export interface EmbeddingCacheStats {
  entries: number;
  capacity: number;
  hits: number;
  misses: number;
  evictions: number;
  inflight: number;
}

export interface EmbeddingProvider {
  name: EmbeddingProviderName;
  model: string;
  dimension: number;
  embed(text: string): number[];
  embedQuery?(text: string): number[];
  embedSecondary?(text: string, mode?: "passage" | "query"): number[] | null;
  analyze?(text: string): QueryAnalysis;
  routeFor?(text: string): AdaptiveRoute;
  primaryModelFor?(text: string): string;
  secondaryModelFor?(text: string): string | null;
  prime?(text: string): Promise<number[]>;
  primeQuery?(text: string): Promise<number[]>;
  primeBatch?(texts: string[], mode?: "passage" | "query"): Promise<number[][]>;
  cacheStats?(): EmbeddingCacheStats;
  ready?: Promise<void>;
  usesLocalModels?: boolean;
  health(): EmbeddingHealth;
}

export interface EmbeddingRegistryOptions {
  providerName?: string;
  dimension: number;
  openaiApiKey?: string;
  openaiEmbedModel?: string;
  ollamaBaseUrl?: string;
  ollamaEmbedModel?: string;
  localModelId?: string;
  localModelsDir?: string;
  proApiKey?: string;
  proApiUrl?: string;
  /**
   * Pro=C decision: model name passed to the self-hosted Pro embedding
   * endpoint. Defaults to "granite-embedding-311m-r2" inside the provider so
   * the Pro leg stays on the same model family as the free local granite.
   */
  proApiModel?: string;
  /**
   * Codex must-fix #4 (2026-06-19): when true, the Pro provider treats
   * retention=0 as executable — no in-memory cache, no payload in errors,
   * no payload in metrics. Independent of the data-policy doc.
   */
  proApiZdrEnforced?: boolean;
  adaptiveJaThreshold?: number;
  adaptiveCodeThreshold?: number;
  /** IMP-008: 言語自動選択時のデフォルト言語 ("ja" | "en") */
  defaultLanguage?: "ja" | "en";
  /**
   * S154-510: when present and no explicit model is pinned via
   * HARNESS_MEM_EMBEDDING_MODEL, the registry consults the
   * `embedding_default_model` mem_meta flag through this handle to pick the
   * default local model/dimension. Absent → behaviour is unchanged.
   */
  db?: import("bun:sqlite").Database;
}

export interface EmbeddingRegistryResult {
  provider: EmbeddingProvider;
  warnings: string[];
  requestedProvider: string;
}
