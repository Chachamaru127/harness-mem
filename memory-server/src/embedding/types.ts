export type EmbeddingProviderName = "fallback" | "openai" | "ollama" | "local";

export interface EmbeddingHealth {
  status: "healthy" | "degraded";
  details: string;
}

export interface EmbeddingProvider {
  name: EmbeddingProviderName;
  model: string;
  dimension: number;
  embed(text: string): number[];
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
}

export interface EmbeddingRegistryResult {
  provider: EmbeddingProvider;
  warnings: string[];
  requestedProvider: string;
}
