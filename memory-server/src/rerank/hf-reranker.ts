import type { IReranker, RerankerInput, RerankerResult } from "./types";

const DEFAULT_HF_MODEL = "cross-encoder/ms-marco-MiniLM-L-6-v2";
const HF_INFERENCE_URL = "https://api-inference.huggingface.co/models";

export function createHfReranker(apiKey: string, model?: string): IReranker {
  const resolvedModel = model ?? DEFAULT_HF_MODEL;
  const endpoint = `${HF_INFERENCE_URL}/${resolvedModel}`;

  return {
    name: `huggingface/${resolvedModel}`,

    async rerank(
      query: string,
      items: RerankerInput[],
      options?: { topK?: number }
    ): Promise<RerankerResult[]> {
      if (items.length === 0) return [];

      // HuggingFace Inference API for cross-encoder: text-classification
      // Each item is sent as { text: query, text_pair: document }
      const inputs = items.map((item) => ({
        text: query,
        text_pair: `${item.title}\n${item.content}`.trim(),
      }));

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ inputs }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`HuggingFace rerank API error: ${response.status} ${text}`);
      }

      // HF cross-encoder returns array of [{ label, score }] per input
      const data = (await response.json()) as Array<Array<{ label: string; score: number }>>;

      const results: RerankerResult[] = items.map((item, i) => {
        const predictions = data[i] ?? [];
        // Cross-encoder score: take the highest score (usually label "1" for relevant)
        const rerankScore = predictions.reduce((best, p) => Math.max(best, p.score), 0);
        return {
          id: item.id,
          score: item.score,
          rerank_score: rerankScore,
        };
      });

      const topK = options?.topK ?? results.length;
      return results.sort((a, b) => b.rerank_score - a.rerank_score).slice(0, topK);
    },
  };
}
