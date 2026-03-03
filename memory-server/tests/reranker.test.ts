/**
 * V5-002: Cross-Encoder Reranker 統合テスト
 *
 * IReranker インターフェース準拠 / プロバイダー切り替え / フォールバックを検証する。
 */

import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import type { IReranker, RerankerInput } from "../src/rerank/types";
import { createReranker } from "../src/rerank/registry";
import { createCohereReranker } from "../src/rerank/cohere-reranker";
import { createHfReranker } from "../src/rerank/hf-reranker";
import { createStReranker } from "../src/rerank/st-reranker";

// サンプル入力データ
const sampleItems: RerankerInput[] = [
  { id: 0, title: "TypeScript basics", content: "TypeScript is a typed superset of JavaScript", score: 0.6 },
  { id: 1, title: "Python guide", content: "Python is a dynamic language used for data science", score: 0.5 },
  { id: 2, title: "TypeScript advanced types", content: "Conditional types and mapped types in TypeScript", score: 0.55 },
];

// --- IReranker インターフェース準拠テスト ---

describe("IReranker interface compliance", () => {
  test("simple fallback reranker satisfies IReranker interface", async () => {
    const { reranker } = createReranker({ provider: "simple" });

    expect(typeof reranker.name).toBe("string");
    expect(typeof reranker.rerank).toBe("function");

    const results = await reranker.rerank("TypeScript", sampleItems);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);

    for (const r of results) {
      expect(typeof r.id).toBe("number");
      expect(typeof r.score).toBe("number");
      expect(typeof r.rerank_score).toBe("number");
    }
  });

  test("simple reranker returns results for all items", async () => {
    const { reranker } = createReranker({ provider: "simple" });
    const results = await reranker.rerank("TypeScript", sampleItems);
    expect(results.length).toBe(sampleItems.length);
  });

  test("simple reranker topK option limits results", async () => {
    const { reranker } = createReranker({ provider: "simple" });
    const results = await reranker.rerank("TypeScript", sampleItems, { topK: 2 });
    expect(results.length).toBe(2);
  });

  test("simple reranker handles empty items", async () => {
    const { reranker } = createReranker({ provider: "simple" });
    const results = await reranker.rerank("query", []);
    expect(results).toEqual([]);
  });
});

// --- simple-v1 フォールバックテスト ---

describe("simple-v1 fallback", () => {
  test("createReranker with simple provider returns simple reranker", () => {
    const { reranker, warnings } = createReranker({ provider: "simple" });
    expect(reranker.name).toBe("simple-v1");
    expect(warnings).toEqual([]);
  });

  test("cohere without apiKey falls back to simple with warning", () => {
    const { reranker, warnings } = createReranker({ provider: "cohere", apiKey: "" });
    expect(reranker.name).toBe("simple-v1");
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("COHERE_API_KEY");
  });

  test("huggingface without apiKey falls back to simple with warning", () => {
    const { reranker, warnings } = createReranker({ provider: "huggingface", apiKey: "" });
    expect(reranker.name).toBe("simple-v1");
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("HF_TOKEN");
  });
});

// --- Cohere Reranker テスト (API モック) ---

describe("Cohere reranker", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mock(async (_url: string | URL | Request, _options?: RequestInit) => {
      // Cohere API は relevance_score 降順でソート済みの results を返す
      const results = [
        { index: 0, relevance_score: 0.95 },
        { index: 2, relevance_score: 0.85 },
        { index: 1, relevance_score: 0.3 },
      ];
      return new Response(JSON.stringify({ results }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("createCohereReranker returns IReranker with correct name", () => {
    const reranker = createCohereReranker("test-api-key");
    expect(reranker.name).toBe("cohere/rerank-v3.5");
  });

  test("createCohereReranker with custom model", () => {
    const reranker = createCohereReranker("test-api-key", "rerank-english-v2.0");
    expect(reranker.name).toBe("cohere/rerank-english-v2.0");
  });

  test("cohere reranker calls API and returns ranked results", async () => {
    const reranker = createCohereReranker("test-api-key");
    const results = await reranker.rerank("TypeScript", sampleItems);

    expect(results.length).toBe(3);
    expect(results[0]!.rerank_score).toBe(0.95);
    expect(results[1]!.rerank_score).toBe(0.85);
    expect(results[2]!.rerank_score).toBe(0.3);
  });

  test("cohere reranker throws on API error", async () => {
    globalThis.fetch = mock(async () =>
      new Response("Unauthorized", { status: 401 })
    ) as typeof fetch;

    const reranker = createCohereReranker("bad-key");
    await expect(reranker.rerank("query", sampleItems)).rejects.toThrow("401");
  });
});

// --- HuggingFace Reranker テスト (API モック) ---

describe("HuggingFace reranker", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mock(async (_url: string | URL | Request, options?: RequestInit) => {
      const body = JSON.parse((options?.body as string) ?? "{}");
      const inputs: Array<unknown> = body.inputs ?? [];
      // HF cross-encoder: 各 input に対して [{ label: "1", score }, { label: "0", score }] を返す
      const response = inputs.map((_: unknown, i: number) => [
        { label: "1", score: i === 0 ? 0.9 : i === 2 ? 0.8 : 0.2 },
        { label: "0", score: i === 0 ? 0.1 : i === 2 ? 0.2 : 0.8 },
      ]);
      return new Response(JSON.stringify(response), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("createHfReranker returns IReranker with correct name", () => {
    const reranker = createHfReranker("test-token");
    expect(reranker.name).toBe("huggingface/cross-encoder/ms-marco-MiniLM-L-6-v2");
  });

  test("hf reranker calls API and returns ranked results", async () => {
    const reranker = createHfReranker("test-token");
    const results = await reranker.rerank("TypeScript", sampleItems);

    expect(results.length).toBe(3);
    // 最高スコア順にソートされている
    expect(results[0]!.rerank_score).toBe(0.9);
    expect(results[1]!.rerank_score).toBe(0.8);
  });

  test("hf reranker respects topK option", async () => {
    const reranker = createHfReranker("test-token");
    const results = await reranker.rerank("TypeScript", sampleItems, { topK: 2 });
    expect(results.length).toBe(2);
  });

  test("hf reranker throws on API error", async () => {
    globalThis.fetch = mock(async () =>
      new Response("Service Unavailable", { status: 503 })
    ) as typeof fetch;

    const reranker = createHfReranker("test-token");
    await expect(reranker.rerank("query", sampleItems)).rejects.toThrow("503");
  });
});

// --- Sentence-Transformers Reranker テスト (API モック) ---

describe("Sentence-Transformers reranker", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mock(async (_url: string | URL | Request, _options?: RequestInit) => {
      const response: { results: Array<{ index: number; score: number }> } = {
        results: [
          { index: 0, score: 0.92 },
          { index: 2, score: 0.78 },
          { index: 1, score: 0.25 },
        ],
      };
      return new Response(JSON.stringify(response), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("createStReranker returns IReranker with correct name", () => {
    const reranker = createStReranker("http://localhost:8765/rerank");
    expect(reranker.name).toBe("sentence-transformers/local");
  });

  test("st reranker calls local endpoint and returns ranked results", async () => {
    const reranker = createStReranker("http://localhost:8765/rerank");
    const results = await reranker.rerank("TypeScript", sampleItems);

    expect(results.length).toBe(3);
    expect(results[0]!.rerank_score).toBe(0.92);
    expect(results[1]!.rerank_score).toBe(0.78);
    expect(results[2]!.rerank_score).toBe(0.25);
  });

  test("st reranker handles empty items", async () => {
    const reranker = createStReranker("http://localhost:8765/rerank");
    const results = await reranker.rerank("query", []);
    expect(results).toEqual([]);
    // fetch は呼ばれない
    expect((globalThis.fetch as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });

  test("st reranker throws on server error", async () => {
    globalThis.fetch = mock(async () =>
      new Response("Internal Server Error", { status: 500 })
    ) as typeof fetch;

    const reranker = createStReranker("http://localhost:8765/rerank");
    await expect(reranker.rerank("query", sampleItems)).rejects.toThrow("500");
  });
});

// --- Registry プロバイダー切り替えテスト ---

describe("createReranker registry switching", () => {
  test("provider 'simple' returns simple adapter", () => {
    const { reranker, warnings } = createReranker({ provider: "simple" });
    expect(reranker.name).toBe("simple-v1");
    expect(warnings).toEqual([]);
  });

  test("provider 'sentence-transformers' returns ST reranker", () => {
    const { reranker, warnings } = createReranker({
      provider: "sentence-transformers",
      endpoint: "http://localhost:8765/rerank",
    });
    expect(reranker.name).toBe("sentence-transformers/local");
    expect(warnings).toEqual([]);
  });

  test("provider 'cohere' with apiKey returns cohere reranker", () => {
    const { reranker, warnings } = createReranker({ provider: "cohere", apiKey: "test-key" });
    expect(reranker.name).toContain("cohere/");
    expect(warnings).toEqual([]);
  });

  test("provider 'huggingface' with apiKey returns hf reranker", () => {
    const { reranker, warnings } = createReranker({ provider: "huggingface", apiKey: "test-token" });
    expect(reranker.name).toContain("huggingface/");
    expect(warnings).toEqual([]);
  });
});

// --- topK パラメータテスト ---

describe("topK parameter", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mock(async (_url: string | URL | Request, options?: RequestInit) => {
      const body = JSON.parse((options?.body as string) ?? "{}");
      // Cohere レスポンス
      const n = body.top_n ?? (body.documents?.length ?? 0);
      const results = Array.from({ length: n }, (_: unknown, i: number) => ({
        index: i,
        relevance_score: 1 - i * 0.1,
      }));
      return new Response(JSON.stringify({ results }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("cohere reranker passes topK to API", async () => {
    const reranker = createCohereReranker("test-key");
    const results = await reranker.rerank("query", sampleItems, { topK: 2 });
    expect(results.length).toBe(2);
  });
});
