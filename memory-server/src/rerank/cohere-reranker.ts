import type { IReranker, RerankerInput, RerankerResult } from "./types";

const DEFAULT_COHERE_MODEL = "rerank-v3.5";
const COHERE_API_URL = "https://api.cohere.com/v2/rerank";

export function createCohereReranker(apiKey: string, model?: string): IReranker {
  const resolvedModel = model ?? DEFAULT_COHERE_MODEL;

  return {
    name: `cohere/${resolvedModel}`,

    async rerank(
      query: string,
      items: RerankerInput[],
      options?: { topK?: number }
    ): Promise<RerankerResult[]> {
      if (items.length === 0) return [];

      const documents = items.map((item) => `${item.title}\n${item.content}`.trim());

      const body = {
        model: resolvedModel,
        query,
        documents,
        top_n: options?.topK ?? items.length,
        return_documents: false,
      };

      const response = await fetch(COHERE_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Cohere rerank API error: ${response.status} ${text}`);
      }

      const data = (await response.json()) as {
        results: Array<{ index: number; relevance_score: number }>;
      };

      const results: RerankerResult[] = data.results.map((r) => ({
        id: items[r.index]!.id,
        score: items[r.index]!.score,
        rerank_score: r.relevance_score,
      }));

      return results;
    },
  };
}
