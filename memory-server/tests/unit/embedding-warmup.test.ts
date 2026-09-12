import { describe, expect, test } from "bun:test";
import { HarnessMemCore } from "../../src/core/harness-mem-core";
import { createAdaptiveEmbeddingProvider } from "../../src/embedding/adaptive-provider";
import type { EmbeddingProvider } from "../../src/embedding/types";

function lazyProvider(model: string, fail = false): EmbeddingProvider {
  let initialized = false;
  const prime = async () => {
    if (fail) throw new Error("failed to initialize test model");
    initialized = true;
    return [1, 0, 0, 0, 0, 0, 0, 0];
  };
  return {
    name: "local", model, dimension: 8, usesLocalModels: true,
    prime, primeQuery: prime,
    embed: () => new Array(8).fill(0),
    health: () => ({
      status: "healthy",
      details: initialized ? `${model}: loaded` : `${model}: lazy initialization pending`,
    }),
  };
}

// Exercise embedding methods without opening a database or starting ingest timers.
function embeddingCore(provider: EmbeddingProvider): HarnessMemCore {
  return Object.assign(Object.create(HarnessMemCore.prototype), { embeddingProvider: provider });
}

describe("embedding startup warmup", () => {
  for (const mode of ["passage", "query"] as const) {
    for (const seed of ["worker warmup", "日本語で検索する"]) {
      test(`${mode} warmup initializes both adaptive routes from ${seed}`, async () => {
        const core = embeddingCore(createAdaptiveEmbeddingProvider({
          japaneseProvider: lazyProvider("ruri"),
          generalProvider: lazyProvider("e5"),
          dimension: 8,
        }));
        await core.primeEmbedding("worker warmup", mode);
        expect(core.getEmbeddingRuntimeInfo().readiness.ready).toBe(false);
        await core.warmEmbedding(seed, mode);
        expect(core.getEmbeddingRuntimeInfo().readiness.ready).toBe(true);
      });
    }
  }

  test("failed Japanese initialization stays unready and rejects warmup", async () => {
    const core = embeddingCore(createAdaptiveEmbeddingProvider({
      japaneseProvider: lazyProvider("ruri", true),
      generalProvider: lazyProvider("e5"),
      dimension: 8,
    }));
    await expect(core.warmEmbedding("worker warmup", "query")).rejects.toThrow("failed to initialize");
    expect(core.getEmbeddingRuntimeInfo().readiness.ready).toBe(false);
  });

  for (const jaThreshold of [0, 0.85, 1]) {
    test(`cold Japanese startup warms both routes at threshold ${jaThreshold}`, async () => {
      const core = embeddingCore(createAdaptiveEmbeddingProvider({
        japaneseProvider: lazyProvider("ruri"),
        generalProvider: lazyProvider("e5"),
        dimension: 8,
        jaThreshold,
      }));
      expect(core.getEmbeddingRuntimeInfo().readiness.ready).toBe(false);
      await core.warmEmbedding("日本語で検索する", "passage");
      expect(core.getEmbeddingRuntimeInfo().readiness.ready).toBe(true);
    });
  }

  test("single provider only receives the caller's seed", async () => {
    const inputs: string[] = [];
    const provider = lazyProvider("single");
    const prime = provider.prime!;
    provider.prime = async (text) => { inputs.push(text); return prime(text); };
    const core = embeddingCore(provider);
    await core.warmEmbedding("custom warmup", "passage");
    expect(inputs).toEqual(["custom warmup"]);
    expect(core.getEmbeddingRuntimeInfo().readiness.ready).toBe(true);
  });
});
