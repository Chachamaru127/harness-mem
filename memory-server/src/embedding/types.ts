export type EmbeddingProviderName = "fallback" | "openai" | "ollama" | "local" | "adaptive";

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
  embedSecondary?(text: string): number[] | null;
  prime?(text: string): Promise<number[]>;
  primeQuery?(text: string): Promise<number[]>;
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
  adaptiveJaThreshold?: number;
  adaptiveCodeThreshold?: number;
  /** IMP-008: 言語自動選択時のデフォルト言語 ("ja" | "en") */
  defaultLanguage?: "ja" | "en";
}

export interface EmbeddingRegistryResult {
  provider: EmbeddingProvider;
  warnings: string[];
  requestedProvider: string;
}
