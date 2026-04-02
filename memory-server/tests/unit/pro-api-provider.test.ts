import { describe, expect, test } from "bun:test";
import { createProApiEmbeddingProvider } from "../../src/embedding/pro-api-provider";

function padToEight(values: number[]): number[] {
  return [...values, ...new Array(Math.max(0, 8 - values.length)).fill(0)];
}

describe("pro api embedding provider", () => {
  test("primeQuery は API を呼び、2回目以降はキャッシュを使う", async () => {
    let fetchCalls = 0;
    let syncCalls = 0;
    const provider = createProApiEmbeddingProvider({
      dimension: 3,
      apiKey: "pro-key",
      apiUrl: "https://example.test/embed",
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response(JSON.stringify({ embedding: [0.1, 0.2, 0.3] }), { status: 200 });
      },
      syncRequestImpl: () => {
        syncCalls += 1;
        return { status: 200, body: JSON.stringify({ embedding: [0.9, 0.9, 0.9] }) };
      },
    });

    const first = await provider.primeQuery?.("deploy rollback plan");
    const second = await provider.primeQuery?.("deploy rollback plan");
    const sync = provider.embedQuery?.("deploy rollback plan");

    expect(first).toEqual(padToEight([0.1, 0.2, 0.3]));
    expect(second).toEqual(padToEight([0.1, 0.2, 0.3]));
    expect(sync).toEqual(padToEight([0.1, 0.2, 0.3]));
    expect(fetchCalls).toBe(1);
    expect(syncCalls).toBe(0);
    expect(provider.cacheStats?.()).toMatchObject({
      entries: 1,
      hits: 2,
      misses: 1,
    });
  });

  test("embedQuery は sync requester を使い、結果をキャッシュする", () => {
    let syncCalls = 0;
    const provider = createProApiEmbeddingProvider({
      dimension: 4,
      apiKey: "pro-key",
      apiUrl: "https://example.test/embed",
      syncRequestImpl: () => {
        syncCalls += 1;
        return { status: 200, body: JSON.stringify({ embedding: [0.4, 0.5, 0.6] }) };
      },
    });

    const first = provider.embedQuery?.("vector search");
    const second = provider.embedQuery?.("vector search");

    expect(first).toEqual(padToEight([0.4, 0.5, 0.6, 0]));
    expect(second).toEqual(padToEight([0.4, 0.5, 0.6, 0]));
    expect(syncCalls).toBe(1);
  });

  test("primeQuery の失敗時は degraded になる", async () => {
    const provider = createProApiEmbeddingProvider({
      dimension: 3,
      apiKey: "pro-key",
      apiUrl: "https://example.test/embed",
      fetchImpl: async () => {
        throw Object.assign(new Error("timeout"), { name: "AbortError" });
      },
    });

    await expect(provider.primeQuery?.("deploy rollback plan")).rejects.toThrow("timed out");
    expect(provider.health().status).toBe("degraded");
    expect(provider.health().details).toContain("timed out");
  });
});
