/**
 * claude-model-pricing.ts
 *
 * Claude API モデルの公開価格テーブル。
 * トークン使用量からコストを算出する。
 *
 * 価格は USD per 1M tokens (2026-03 時点)。
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelPricing {
  /** Price per 1M input tokens (USD) */
  inputPer1M: number;
  /** Price per 1M output tokens (USD) */
  outputPer1M: number;
  /** Price per 1M cache write tokens (USD) */
  cacheWritePer1M: number;
  /** Price per 1M cache read tokens (USD) */
  cacheReadPer1M: number;
}

export interface CostBreakdown {
  input_cost: number;
  output_cost: number;
  cache_write_cost: number;
  cache_read_cost: number;
  total_cost: number;
  model: string;
  currency: "USD";
}

// ---------------------------------------------------------------------------
// Pricing Table
// ---------------------------------------------------------------------------

const MODEL_PRICING: Record<string, ModelPricing> = {
  // Opus 4 / 4.6
  "claude-opus-4-20250514": { inputPer1M: 15, outputPer1M: 75, cacheWritePer1M: 18.75, cacheReadPer1M: 1.5 },
  "claude-opus-4-6": { inputPer1M: 15, outputPer1M: 75, cacheWritePer1M: 18.75, cacheReadPer1M: 1.5 },

  // Sonnet 4 / 4.6
  "claude-sonnet-4-20250514": { inputPer1M: 3, outputPer1M: 15, cacheWritePer1M: 3.75, cacheReadPer1M: 0.3 },
  "claude-sonnet-4-6": { inputPer1M: 3, outputPer1M: 15, cacheWritePer1M: 3.75, cacheReadPer1M: 0.3 },

  // Haiku 3.5 / 4.5
  "claude-haiku-4-5-20251001": { inputPer1M: 0.80, outputPer1M: 4, cacheWritePer1M: 1, cacheReadPer1M: 0.08 },
  "claude-3-5-haiku-20241022": { inputPer1M: 0.80, outputPer1M: 4, cacheWritePer1M: 1, cacheReadPer1M: 0.08 },

  // Sonnet 3.5 / 3.6
  "claude-3-5-sonnet-20241022": { inputPer1M: 3, outputPer1M: 15, cacheWritePer1M: 3.75, cacheReadPer1M: 0.3 },
  "claude-3-5-sonnet-20240620": { inputPer1M: 3, outputPer1M: 15, cacheWritePer1M: 3.75, cacheReadPer1M: 0.3 },

  // Opus 3
  "claude-3-opus-20240229": { inputPer1M: 15, outputPer1M: 75, cacheWritePer1M: 18.75, cacheReadPer1M: 1.5 },
};

/**
 * Resolve a model name to its pricing. Falls back to Sonnet pricing if unknown.
 */
export function getModelPricing(model: string): ModelPricing {
  // Exact match
  if (MODEL_PRICING[model]) {
    return MODEL_PRICING[model];
  }

  // Prefix match (handles version suffixes)
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key) || key.startsWith(model)) {
      return pricing;
    }
  }

  // Pattern-based fallback
  if (model.includes("opus")) {
    return { inputPer1M: 15, outputPer1M: 75, cacheWritePer1M: 18.75, cacheReadPer1M: 1.5 };
  }
  if (model.includes("haiku")) {
    return { inputPer1M: 0.80, outputPer1M: 4, cacheWritePer1M: 1, cacheReadPer1M: 0.08 };
  }

  // Default to Sonnet pricing
  return { inputPer1M: 3, outputPer1M: 15, cacheWritePer1M: 3.75, cacheReadPer1M: 0.3 };
}

/**
 * Calculate cost from token usage and model name.
 */
export function calculateCost(params: {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}): CostBreakdown {
  const pricing = getModelPricing(params.model);

  const input_cost = (params.input_tokens / 1_000_000) * pricing.inputPer1M;
  const output_cost = (params.output_tokens / 1_000_000) * pricing.outputPer1M;
  const cache_write_cost = ((params.cache_creation_input_tokens || 0) / 1_000_000) * pricing.cacheWritePer1M;
  const cache_read_cost = ((params.cache_read_input_tokens || 0) / 1_000_000) * pricing.cacheReadPer1M;

  return {
    input_cost,
    output_cost,
    cache_write_cost,
    cache_read_cost,
    total_cost: input_cost + output_cost + cache_write_cost + cache_read_cost,
    model: params.model,
    currency: "USD",
  };
}

/**
 * Return all known model names.
 */
export function listKnownModels(): string[] {
  return Object.keys(MODEL_PRICING);
}
