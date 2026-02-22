import { describe, expect, test } from "bun:test";
import { createSimpleReranker } from "../../src/rerank/simple-reranker";

const sampleItems = [
  {
    id: "obs-1",
    score: 0.45,
    created_at: "2026-02-19T00:00:00.000Z",
    title: "build log",
    content: "fixed parser regression",
  },
  {
    id: "obs-2",
    score: 0.45,
    created_at: "2026-02-20T00:00:00.000Z",
    title: "parser decision",
    content: "adopted parser strategy",
  },
];

describe("simple reranker", () => {
  test("keeps stable ordering when signals are identical", () => {
    const reranker = createSimpleReranker();
    const items = [
      {
        id: "obs-a",
        score: 0.5,
        created_at: "2026-02-19T00:00:00.000Z",
        title: "same",
        content: "same",
      },
      {
        id: "obs-b",
        score: 0.5,
        created_at: "2026-02-19T00:00:00.000Z",
        title: "same",
        content: "same",
      },
    ];

    const ranked = reranker.rerank({ query: "same", items });
    expect(ranked.map((item) => item.id)).toEqual(["obs-a", "obs-b"]);
  });

  test("boosts exact-title and query-token matches", () => {
    const reranker = createSimpleReranker();
    const ranked = reranker.rerank({ query: "parser decision", items: sampleItems });

    expect(ranked[0]?.id).toBe("obs-2");
    expect(ranked[0]?.rerank_score).toBeGreaterThan(ranked[1]?.rerank_score || 0);
  });
});
