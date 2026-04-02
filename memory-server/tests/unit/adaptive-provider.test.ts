import { describe, expect, test } from "bun:test";
import { createAdaptiveEmbeddingProvider } from "../../src/embedding/adaptive-provider";
import type { EmbeddingHealth, EmbeddingProvider } from "../../src/embedding/types";

function padToEight(values: number[]): number[] {
  return [...values, ...new Array(Math.max(0, 8 - values.length)).fill(0)];
}

function makeStubProvider(
  name: EmbeddingProvider["name"],
  model: string,
  options: {
    vector: number[];
    queryVector?: number[];
    health: () => EmbeddingHealth;
    throwSync?: () => boolean;
  }
): EmbeddingProvider {
  return {
    name,
    model,
    dimension: options.vector.length,
    embed(text: string): number[] {
      if (options.throwSync?.()) {
        throw new Error(`${model} failed for ${text}`);
      }
      return [...options.vector];
    },
    embedQuery(text: string): number[] {
      if (options.throwSync?.()) {
        throw new Error(`${model} failed for ${text}`);
      }
      return [...(options.queryVector ?? options.vector)];
    },
    async prime(text: string): Promise<number[]> {
      return this.embed(text);
    },
    async primeQuery(text: string): Promise<number[]> {
      return this.embedQuery?.(text) ?? this.embed(text);
    },
    health(): EmbeddingHealth {
      return options.health();
    },
  };
}

describe("adaptive provider fallback", () => {
  test("Pro general provider が落ちたら free fallback に切り替わり、再試行後に復帰する", () => {
    let currentTime = 0;
    let generalHealthy = true;
    const logs: string[] = [];

    const japaneseProvider = makeStubProvider("local", "ruri-v3-30m", {
      vector: [1, 0, 0],
      health: () => ({ status: "healthy", details: "ruri ok" }),
    });
    const proGeneralProvider = makeStubProvider("pro-api", "pro-embed-v1", {
      vector: [0, 1, 0],
      health: () => ({
        status: generalHealthy ? "healthy" : "degraded",
        details: generalHealthy ? "pro ok" : "pro down",
      }),
      throwSync: () => !generalHealthy,
    });
    const freeGeneralProvider = makeStubProvider("local", "gte-small", {
      vector: [0, 0, 1],
      health: () => ({ status: "healthy", details: "gte ok" }),
    });

    const provider = createAdaptiveEmbeddingProvider({
      japaneseProvider,
      generalProvider: proGeneralProvider,
      generalFallbackProvider: freeGeneralProvider,
      dimension: 3,
      now: () => currentTime,
      logger: (message) => logs.push(message),
    });

    const openQuery = "deploy rollback plan";
    expect(provider.embedQuery(openQuery)).toEqual(padToEight([0, 1, 0]));
    expect(provider.primaryModelFor(openQuery)).toContain("pro-embed-v1");

    generalHealthy = false;
    expect(provider.embedQuery(openQuery)).toEqual(padToEight([0, 0, 1]));
    expect(provider.primaryModelFor(openQuery)).toContain("gte-small");

    currentTime = 9_000;
    expect(provider.embedQuery(openQuery)).toEqual(padToEight([0, 0, 1]));

    currentTime = 10_000;
    generalHealthy = true;
    expect(provider.embedQuery(openQuery)).toEqual(padToEight([0, 1, 0]));
    expect(provider.primaryModelFor(openQuery)).toContain("pro-embed-v1");
    expect(logs.some((line) => line.includes("falling back"))).toBe(true);
    expect(logs.some((line) => line.includes("recovered"))).toBe(true);
  });

  test("ensemble の secondary model label も fallback 先へ切り替わる", () => {
    let currentTime = 0;
    let generalHealthy = false;

    const provider = createAdaptiveEmbeddingProvider({
      japaneseProvider: makeStubProvider("local", "ruri-v3-30m", {
        vector: [1, 0, 0],
        health: () => ({ status: "healthy", details: "ruri ok" }),
      }),
      generalProvider: makeStubProvider("pro-api", "pro-embed-v1", {
        vector: [0, 1, 0],
        health: () => ({ status: generalHealthy ? "healthy" : "degraded", details: "pro down" }),
        throwSync: () => !generalHealthy,
      }),
      generalFallbackProvider: makeStubProvider("local", "gte-small", {
        vector: [0, 0, 1],
        health: () => ({ status: "healthy", details: "gte ok" }),
      }),
      dimension: 3,
      now: () => currentTime,
      logger: () => undefined,
    });

    const mixedQuery = "本番 deploy 手順を確認したい";
    expect(provider.embedSecondary(mixedQuery)).toEqual(padToEight([0, 0, 1]));
    expect(provider.secondaryModelFor(mixedQuery)).toContain("gte-small");
  });
});
