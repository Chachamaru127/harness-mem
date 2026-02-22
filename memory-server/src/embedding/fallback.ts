import { type EmbeddingProvider, type EmbeddingHealth } from "./types";

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1)
    .slice(0, 4096);
}

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeVector(vector: number[]): number[] {
  let norm = 0;
  for (const value of vector) {
    norm += value * value;
  }
  norm = Math.sqrt(norm);
  if (norm === 0) {
    return vector;
  }
  for (let i = 0; i < vector.length; i += 1) {
    vector[i] = vector[i] / norm;
  }
  return vector;
}

function embedFallbackText(text: string, dimension: number): number[] {
  const vector = new Array<number>(dimension).fill(0);
  const tokens = tokenize(text);
  if (tokens.length === 0) {
    return vector;
  }

  const ngrams: string[] = [...tokens];
  if (dimension >= 128) {
    for (let i = 0; i < tokens.length - 1; i += 1) {
      ngrams.push(`${tokens[i]}_${tokens[i + 1]}`);
    }
  }

  for (const gram of ngrams) {
    const h1 = hashToken(gram);
    const h2 = hashToken(`${gram}\u0001`);
    vector[h1 % dimension] += (h1 & 1) === 0 ? 1 : -1;
    vector[h2 % dimension] += (h2 & 1) === 0 ? 1 : -1;
  }

  return normalizeVector(vector);
}

interface FallbackProviderOptions {
  dimension: number;
  model?: string;
}

export function createFallbackEmbeddingProvider(options: FallbackProviderOptions): EmbeddingProvider {
  const dimension = Math.max(8, Math.floor(options.dimension));
  const model = (options.model || "local-hash-v3").trim() || "local-hash-v3";
  const health: EmbeddingHealth = {
    status: "healthy",
    details: "local hash embedding",
  };

  return {
    name: "fallback",
    model,
    dimension,
    embed(text: string): number[] {
      return embedFallbackText(text || "", dimension);
    },
    health(): EmbeddingHealth {
      return { ...health };
    },
  };
}
