import { analyzeText, decideRoute } from "./query-analyzer";
import type {
  AdaptiveRoute,
  EmbeddingHealth,
  EmbeddingProvider,
  QueryAnalysis,
} from "./types";

const GENERAL_PROVIDER_BACKOFF_MS = [10_000, 30_000, 60_000, 300_000] as const;

interface AdaptiveEmbeddingProviderOptions {
  japaneseProvider: EmbeddingProvider;
  generalProvider: EmbeddingProvider;
  generalFallbackProvider?: EmbeddingProvider;
  dimension: number;
  jaThreshold?: number;
  codeThreshold?: number;
  modelLabel?: string;
  now?: () => number;
  logger?: (message: string) => void;
}

interface GeneralFallbackState {
  active: boolean;
  failCount: number;
  nextRetryAt: number;
  lastReason: string;
}

export interface AdaptiveEmbeddingProvider extends EmbeddingProvider {
  embedSecondary(text: string): number[] | null;
  analyze(text: string): QueryAnalysis;
  routeFor(text: string): AdaptiveRoute;
  primaryModelFor(text: string): string;
  secondaryModelFor(text: string): string | null;
}

function normalizeVector(vector: number[], dimension: number): number[] {
  if (vector.length === dimension) {
    return vector;
  }
  if (vector.length > dimension) {
    return vector.slice(0, dimension);
  }
  return [...vector, ...new Array<number>(dimension - vector.length).fill(0)];
}

function chooseWorstHealth(lhs: EmbeddingHealth, rhs: EmbeddingHealth): EmbeddingHealth {
  if (lhs.status === "degraded" && rhs.status === "degraded") {
    return {
      status: "degraded",
      details: `${lhs.details}; ${rhs.details}`,
    };
  }
  if (lhs.status === "degraded") {
    return { ...lhs };
  }
  if (rhs.status === "degraded") {
    return { ...rhs };
  }
  return {
    status: "healthy",
    details: `${lhs.details}; ${rhs.details}`,
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getProviderHealth(provider: EmbeddingProvider): EmbeddingHealth {
  try {
    return provider.health();
  } catch (error) {
    return {
      status: "degraded",
      details: `provider health failed: ${getErrorMessage(error)}`,
    };
  }
}

export function createAdaptiveEmbeddingProvider(
  options: AdaptiveEmbeddingProviderOptions
): AdaptiveEmbeddingProvider {
  const japaneseProvider = options.japaneseProvider;
  const generalProvider = options.generalProvider;
  const generalFallbackProvider = options.generalFallbackProvider;
  const dimension = Math.max(8, Math.floor(options.dimension));
  const now = options.now ?? (() => Date.now());
  const logger = options.logger ?? ((message: string) => process.stderr.write(`${message}\n`));
  const modelLabel =
    options.modelLabel ||
    `${japaneseProvider.model}+${generalProvider.model}`;
  const readyPromises = [
    japaneseProvider.ready,
    generalProvider.ready,
    generalFallbackProvider?.ready,
  ].filter((value): value is Promise<void> => value instanceof Promise);
  const ready = readyPromises.length > 0 ? Promise.all(readyPromises).then(() => undefined) : undefined;
  const japaneseLabel = `adaptive:ruri:${japaneseProvider.name}:${japaneseProvider.model}`;
  const generalLabel = `adaptive:general:${generalProvider.name}:${generalProvider.model}`;
  const generalFallbackLabel = generalFallbackProvider
    ? `adaptive:general:${generalFallbackProvider.name}:${generalFallbackProvider.model}`
    : generalLabel;
  let generalFallbackState: GeneralFallbackState = {
    active: false,
    failCount: 0,
    nextRetryAt: 0,
    lastReason: "",
  };

  const resolveRoute = (text: string): { analysis: QueryAnalysis; route: AdaptiveRoute } => {
    const analysis = analyzeText(text);
    const route = decideRoute(analysis, {
      jaThreshold: options.jaThreshold,
      codeThreshold: options.codeThreshold,
    });
    return { analysis, route };
  };

  const useFallbackGeneral = (): boolean => {
    if (!generalFallbackProvider) {
      return false;
    }
    return generalFallbackState.active && now() < generalFallbackState.nextRetryAt;
  };

  const enterGeneralFallback = (reason: string): void => {
    if (!generalFallbackProvider) {
      return;
    }
    const nextFailCount = generalFallbackState.failCount + 1;
    const backoffIndex = Math.min(nextFailCount - 1, GENERAL_PROVIDER_BACKOFF_MS.length - 1);
    const backoffMs = GENERAL_PROVIDER_BACKOFF_MS[backoffIndex];
    const wasActive = generalFallbackState.active;
    const previousReason = generalFallbackState.lastReason;
    generalFallbackState = {
      active: true,
      failCount: nextFailCount,
      nextRetryAt: now() + backoffMs,
      lastReason: reason,
    };

    const resumeInSeconds = Math.ceil(backoffMs / 1000);
    if (!wasActive) {
      logger(
        `[harness-mem][warn] adaptive general provider degraded; falling back to free model for ${resumeInSeconds}s: ${reason}`
      );
      return;
    }

    if (previousReason !== reason) {
      logger(
        `[harness-mem][warn] adaptive general provider still degraded; keeping free fallback for ${resumeInSeconds}s: ${reason}`
      );
    }
  };

  const shouldProbeGeneral = (): boolean => {
    if (!generalFallbackProvider || !generalFallbackState.active) {
      return false;
    }
    return now() >= generalFallbackState.nextRetryAt;
  };

  const exitGeneralFallback = (): void => {
    if (!generalFallbackState.active) {
      return;
    }
    generalFallbackState = {
      active: false,
      failCount: 0,
      nextRetryAt: 0,
      lastReason: "",
    };
    logger("[harness-mem][info] adaptive general provider recovered; resuming pro route");
  };

  const embedWithProvider = (provider: EmbeddingProvider, text: string, preferQuery: boolean): number[] => {
    if (preferQuery && typeof provider.embedQuery === "function") {
      return normalizeVector(provider.embedQuery(text), dimension);
    }
    return normalizeVector(provider.embed(text), dimension);
  };

  const primeWithProvider = async (
    provider: EmbeddingProvider,
    text: string,
    preferQuery: boolean
  ): Promise<number[]> => {
    if (preferQuery && typeof provider.primeQuery === "function") {
      return normalizeVector(await provider.primeQuery(text), dimension);
    }
    if (typeof provider.prime === "function") {
      return normalizeVector(await provider.prime(text), dimension);
    }
    return embedWithProvider(provider, text, preferQuery);
  };

  const runGeneralSync = (text: string, preferQuery: boolean): number[] => {
    if (!generalFallbackState.active && generalFallbackProvider) {
      const preflightHealth = getProviderHealth(generalProvider);
      if (preflightHealth.status === "degraded") {
        enterGeneralFallback(preflightHealth.details);
        return embedWithProvider(generalFallbackProvider, text, preferQuery);
      }
    }

    if (useFallbackGeneral() && !shouldProbeGeneral()) {
      return embedWithProvider(generalFallbackProvider!, text, preferQuery);
    }

    try {
      const result = embedWithProvider(generalProvider, text, preferQuery);
      const health = getProviderHealth(generalProvider);
      if (health.status === "healthy") {
        exitGeneralFallback();
        return result;
      }
      if (!generalFallbackProvider) {
        return result;
      }
      enterGeneralFallback(health.details);
      return embedWithProvider(generalFallbackProvider, text, preferQuery);
    } catch (error) {
      if (!generalFallbackProvider) {
        throw error;
      }
      enterGeneralFallback(getErrorMessage(error));
      return embedWithProvider(generalFallbackProvider, text, preferQuery);
    }
  };

  const runGeneralAsync = async (text: string, preferQuery: boolean): Promise<number[]> => {
    if (!generalFallbackState.active && generalFallbackProvider) {
      const preflightHealth = getProviderHealth(generalProvider);
      if (preflightHealth.status === "degraded") {
        enterGeneralFallback(preflightHealth.details);
        return primeWithProvider(generalFallbackProvider, text, preferQuery);
      }
    }

    if (useFallbackGeneral() && !shouldProbeGeneral()) {
      return primeWithProvider(generalFallbackProvider!, text, preferQuery);
    }

    try {
      const result = await primeWithProvider(generalProvider, text, preferQuery);
      const health = getProviderHealth(generalProvider);
      if (health.status === "healthy") {
        exitGeneralFallback();
        return result;
      }
      if (!generalFallbackProvider) {
        return result;
      }
      enterGeneralFallback(health.details);
      return primeWithProvider(generalFallbackProvider, text, preferQuery);
    } catch (error) {
      if (!generalFallbackProvider) {
        throw error;
      }
      enterGeneralFallback(getErrorMessage(error));
      return primeWithProvider(generalFallbackProvider, text, preferQuery);
    }
  };

  const embedPrimary = (text: string, route: AdaptiveRoute, preferQuery: boolean): number[] => {
    if (route === "openai") {
      return runGeneralSync(text, preferQuery);
    }
    return embedWithProvider(japaneseProvider, text, preferQuery);
  };

  const primeForRoute = async (text: string, route: AdaptiveRoute, preferQuery: boolean): Promise<number[]> => {
    const normalizedText = text || "";
    const japanesePrime = async (): Promise<number[]> =>
      primeWithProvider(japaneseProvider, normalizedText, preferQuery);

    if (route === "openai") {
      return runGeneralAsync(normalizedText, preferQuery);
    }
    if (route === "ensemble") {
      await Promise.all([japanesePrime(), runGeneralAsync(normalizedText, preferQuery)]);
    }
    return japanesePrime();
  };

  return {
    name: "adaptive",
    model: modelLabel,
    dimension,
    usesLocalModels: Boolean(
      japaneseProvider.usesLocalModels ||
      generalProvider.usesLocalModels ||
      generalFallbackProvider?.usesLocalModels
    ),
    ready,
    embed(text: string): number[] {
      const { route } = resolveRoute(text || "");
      return embedPrimary(text || "", route, false);
    },
    embedQuery(text: string): number[] {
      const { route } = resolveRoute(text || "");
      return embedPrimary(text || "", route, true);
    },
    async prime(text: string): Promise<number[]> {
      const { route } = resolveRoute(text || "");
      return primeForRoute(text || "", route, false);
    },
    async primeQuery(text: string): Promise<number[]> {
      const { route } = resolveRoute(text || "");
      return primeForRoute(text || "", route, true);
    },
    embedSecondary(text: string): number[] | null {
      const { route } = resolveRoute(text || "");
      if (route !== "ensemble") {
        return null;
      }
      return runGeneralSync(text || "", true);
    },
    analyze(text: string): QueryAnalysis {
      return resolveRoute(text || "").analysis;
    },
    routeFor(text: string): AdaptiveRoute {
      return resolveRoute(text || "").route;
    },
    primaryModelFor(text: string): string {
      const { route } = resolveRoute(text || "");
      if (route === "openai") {
        return useFallbackGeneral() ? generalFallbackLabel : generalLabel;
      }
      return japaneseLabel;
    },
    secondaryModelFor(text: string): string | null {
      const { route } = resolveRoute(text || "");
      if (route !== "ensemble") {
        return null;
      }
      return useFallbackGeneral() ? generalFallbackLabel : generalLabel;
    },
    health(): EmbeddingHealth {
      const japaneseHealth = japaneseProvider.health();
      if (!generalFallbackProvider || !generalFallbackState.active) {
        return chooseWorstHealth(japaneseHealth, generalProvider.health());
      }

      const fallbackHealth = generalFallbackProvider.health();
      const retryInMs = Math.max(0, generalFallbackState.nextRetryAt - now());
      return {
        status: "degraded",
        details:
          `adaptive fallback active; retry in ${Math.ceil(retryInMs / 1000)}s; ` +
          `pro route: ${getProviderHealth(generalProvider).details}; ` +
          `active fallback: ${fallbackHealth.details}; ` +
          `japanese route: ${japaneseHealth.details}`,
      };
    },
  };
}
