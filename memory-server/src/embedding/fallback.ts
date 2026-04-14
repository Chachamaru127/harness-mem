import { type EmbeddingProvider, type EmbeddingHealth } from "./types";
import { createCircuitBreaker, type CircuitBreaker, type CircuitBreakerOptions } from "./circuit-breaker";

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

/**
 * S80-D01: Wraps an EmbeddingProvider with a circuit breaker so repeated
 * failures trigger a cooldown window during which calls are diverted to
 * `fallbackTo` instead of hammering the failing endpoint.
 *
 * Contract:
 *   - Closed state   → delegate directly to the wrapped provider.
 *   - Open state     → skip wrapped provider, use fallbackTo. No probe.
 *   - Half-open      → permit exactly one probe on the wrapped provider;
 *                      success closes, failure re-opens with fresh cooldown.
 *
 * When fallbackTo is undefined the breaker is passive: it still tracks
 * state for observability via `breaker.status()` but always delegates to
 * the wrapped provider (so callers can decide how to react to `shouldSkip`
 * out-of-band).
 */
export interface CircuitBreakerAwareProvider extends EmbeddingProvider {
  readonly breaker: CircuitBreaker;
}

export function withCircuitBreaker(
  wrapped: EmbeddingProvider,
  options: CircuitBreakerOptions & { fallbackTo?: EmbeddingProvider } = {}
): CircuitBreakerAwareProvider {
  const { fallbackTo, ...breakerOptions } = options;
  const breaker = createCircuitBreaker(breakerOptions);

  const callWrapped = (text: string): number[] => {
    try {
      const vector = wrapped.embed(text);
      breaker.recordSuccess();
      return vector;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      breaker.recordFailure(message);
      throw error;
    }
  };

  const embed = (text: string): number[] => {
    // Half-open first: one probe permitted.
    if (breaker.allowProbe()) {
      try {
        return callWrapped(text);
      } catch (error) {
        if (fallbackTo) {
          return fallbackTo.embed(text);
        }
        throw error;
      }
    }
    if (breaker.shouldSkip()) {
      if (fallbackTo) {
        return fallbackTo.embed(text);
      }
      // No fallback: be permissive but keep breaker state accurate.
      return callWrapped(text);
    }
    try {
      return callWrapped(text);
    } catch (error) {
      if (fallbackTo) {
        return fallbackTo.embed(text);
      }
      throw error;
    }
  };

  return {
    get breaker() {
      return breaker;
    },
    name: wrapped.name,
    model: wrapped.model,
    dimension: wrapped.dimension,
    embed,
    health(): EmbeddingHealth {
      const status = breaker.status();
      if (status.state === "open") {
        return {
          status: "degraded",
          details: `circuit open (${status.consecutiveFailures} consecutive failures)`,
        };
      }
      try {
        return wrapped.health();
      } catch {
        return { status: "degraded", details: "health check failed" };
      }
    },
  };
}
