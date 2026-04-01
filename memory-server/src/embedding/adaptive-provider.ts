import { analyzeText, decideRoute } from "./query-analyzer";
import type {
  AdaptiveRoute,
  EmbeddingHealth,
  EmbeddingProvider,
  QueryAnalysis,
} from "./types";

interface AdaptiveEmbeddingProviderOptions {
  japaneseProvider: EmbeddingProvider;
  generalProvider: EmbeddingProvider;
  dimension: number;
  jaThreshold?: number;
  codeThreshold?: number;
  modelLabel?: string;
}

export interface AdaptiveEmbeddingProvider extends EmbeddingProvider {
  embedSecondary(text: string): number[] | null;
  analyze(text: string): QueryAnalysis;
  routeFor(text: string): AdaptiveRoute;
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

export function createAdaptiveEmbeddingProvider(
  options: AdaptiveEmbeddingProviderOptions
): AdaptiveEmbeddingProvider {
  const japaneseProvider = options.japaneseProvider;
  const generalProvider = options.generalProvider;
  const dimension = Math.max(8, Math.floor(options.dimension));
  const modelLabel =
    options.modelLabel ||
    `${japaneseProvider.model}+${generalProvider.model}`;
  const readyPromises = [japaneseProvider.ready, generalProvider.ready].filter(
    (value): value is Promise<void> => value instanceof Promise
  );
  const ready = readyPromises.length > 0 ? Promise.all(readyPromises).then(() => undefined) : undefined;

  const resolveRoute = (text: string): { analysis: QueryAnalysis; route: AdaptiveRoute } => {
    const analysis = analyzeText(text);
    const route = decideRoute(analysis, {
      jaThreshold: options.jaThreshold,
      codeThreshold: options.codeThreshold,
    });
    return { analysis, route };
  };

  const embedPrimary = (text: string, route: AdaptiveRoute): number[] => {
    if (route === "openai") {
      if (typeof generalProvider.embedQuery === "function") {
        return normalizeVector(generalProvider.embedQuery(text), dimension);
      }
      return normalizeVector(generalProvider.embed(text), dimension);
    }
    if (typeof japaneseProvider.embedQuery === "function") {
      return normalizeVector(japaneseProvider.embedQuery(text), dimension);
    }
    return normalizeVector(japaneseProvider.embed(text), dimension);
  };

  const primeForRoute = async (text: string, route: AdaptiveRoute, preferQuery: boolean): Promise<number[]> => {
    const normalizedText = text || "";
    const japanesePrime = async (): Promise<number[]> => {
      if (preferQuery && typeof japaneseProvider.primeQuery === "function") {
        return normalizeVector(await japaneseProvider.primeQuery(normalizedText), dimension);
      }
      if (typeof japaneseProvider.prime === "function") {
        return normalizeVector(await japaneseProvider.prime(normalizedText), dimension);
      }
      return normalizeVector(
        preferQuery && typeof japaneseProvider.embedQuery === "function"
          ? japaneseProvider.embedQuery(normalizedText)
          : japaneseProvider.embed(normalizedText),
        dimension
      );
    };
    const generalPrime = async (): Promise<number[]> => {
      if (preferQuery && typeof generalProvider.primeQuery === "function") {
        return normalizeVector(await generalProvider.primeQuery(normalizedText), dimension);
      }
      if (typeof generalProvider.prime === "function") {
        return normalizeVector(await generalProvider.prime(normalizedText), dimension);
      }
      return normalizeVector(
        preferQuery && typeof generalProvider.embedQuery === "function"
          ? generalProvider.embedQuery(normalizedText)
          : generalProvider.embed(normalizedText),
        dimension
      );
    };

    if (route === "openai") {
      return generalPrime();
    }
    if (route === "ensemble") {
      await Promise.all([japanesePrime(), generalPrime()]);
    }
    return japanesePrime();
  };

  return {
    name: "adaptive",
    model: modelLabel,
    dimension,
    usesLocalModels: Boolean(japaneseProvider.usesLocalModels || generalProvider.usesLocalModels),
    ready,
    embed(text: string): number[] {
      const { route } = resolveRoute(text || "");
      return embedPrimary(text || "", route);
    },
    embedQuery(text: string): number[] {
      const { route } = resolveRoute(text || "");
      return embedPrimary(text || "", route);
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
      if (typeof generalProvider.embedQuery === "function") {
        return normalizeVector(generalProvider.embedQuery(text || ""), dimension);
      }
      return normalizeVector(generalProvider.embed(text || ""), dimension);
    },
    analyze(text: string): QueryAnalysis {
      return resolveRoute(text || "").analysis;
    },
    routeFor(text: string): AdaptiveRoute {
      return resolveRoute(text || "").route;
    },
    health(): EmbeddingHealth {
      return chooseWorstHealth(japaneseProvider.health(), generalProvider.health());
    },
  };
}
