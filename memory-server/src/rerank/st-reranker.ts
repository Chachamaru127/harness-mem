import type { IReranker, RerankerInput, RerankerResult } from "./types";

const DEFAULT_ST_ENDPOINT = "http://localhost:8765/rerank";

interface StRerankResponse {
  results: Array<{
    index: number;
    score: number;
  }>;
}

export function createStReranker(endpoint?: string): IReranker {
  const resolvedEndpoint = endpoint ?? process.env.SENTENCE_TRANSFORMERS_ENDPOINT ?? DEFAULT_ST_ENDPOINT;

  return {
    name: "sentence-transformers/local",

    async rerank(
      query: string,
      items: RerankerInput[],
      options?: { topK?: number }
    ): Promise<RerankerResult[]> {
      if (items.length === 0) return [];

      const documents = items.map((item) => `${item.title}\n${item.content}`.trim());

      const body = {
        query,
        documents,
        top_k: options?.topK ?? items.length,
      };

      const response = await fetch(resolvedEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Sentence-Transformers rerank error: ${response.status} ${text}`);
      }

      const data = (await response.json()) as StRerankResponse;

      const results: RerankerResult[] = data.results.map((r) => ({
        id: items[r.index]!.id,
        score: items[r.index]!.score,
        rerank_score: r.score,
      }));

      return results;
    },
  };
}
