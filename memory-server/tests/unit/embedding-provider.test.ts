import { describe, expect, test } from "bun:test";
import { createEmbeddingProviderRegistry } from "../../src/embedding/registry";
import { createFallbackEmbeddingProvider } from "../../src/embedding/fallback";

function resetEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe("embedding providers", () => {
  test("fallback provider emits deterministic vectors", () => {
    const provider = createFallbackEmbeddingProvider({ dimension: 64 });
    const first = provider.embed("release checklist");
    const second = provider.embed("release checklist");

    expect(first.length).toBe(64);
    expect(second.length).toBe(64);
    expect(first).toEqual(second);
  });

  test("registry falls back on invalid provider name", () => {
    const prev = process.env.HARNESS_MEM_EMBEDDING_PROVIDER;
    process.env.HARNESS_MEM_EMBEDDING_PROVIDER = "unknown-provider";

    try {
      const registry = createEmbeddingProviderRegistry({
        providerName: process.env.HARNESS_MEM_EMBEDDING_PROVIDER,
        dimension: 64,
      });
      expect(registry.provider.name).toBe("fallback");
      expect(registry.warnings.length).toBeGreaterThan(0);
    } finally {
      resetEnv("HARNESS_MEM_EMBEDDING_PROVIDER", prev);
    }
  });

  test("openai provider degrades to fallback when api key is missing", () => {
    const prevProvider = process.env.HARNESS_MEM_EMBEDDING_PROVIDER;
    const prevKey = process.env.HARNESS_MEM_OPENAI_API_KEY;
    process.env.HARNESS_MEM_EMBEDDING_PROVIDER = "openai";
    delete process.env.HARNESS_MEM_OPENAI_API_KEY;

    try {
      const registry = createEmbeddingProviderRegistry({
        providerName: "openai",
        dimension: 64,
      });
      const vector = registry.provider.embed("provider health");
      expect(vector.length).toBe(64);
      expect(registry.provider.health().status).toBe("degraded");
      expect(registry.provider.health().details).toContain("HARNESS_MEM_OPENAI_API_KEY");
    } finally {
      resetEnv("HARNESS_MEM_EMBEDDING_PROVIDER", prevProvider);
      resetEnv("HARNESS_MEM_OPENAI_API_KEY", prevKey);
    }
  });
});
