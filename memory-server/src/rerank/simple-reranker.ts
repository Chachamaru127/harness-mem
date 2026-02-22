import { type RerankInput, type RerankOutputItem, type Reranker } from "./types";

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1)
    .slice(0, 64);
}

function recencyBoost(createdAt: string): number {
  const ts = Date.parse(createdAt);
  if (Number.isNaN(ts)) {
    return 0;
  }
  const ageHours = Math.max(0, Date.now() - ts) / (1000 * 60 * 60);
  return Math.exp(-ageHours / (24 * 14));
}

function computeRerankScore(query: string, item: RerankOutputItem): number {
  const queryNorm = query.toLowerCase().trim();
  const title = item.title.toLowerCase();
  const content = item.content.toLowerCase();
  const tokens = tokenize(queryNorm);

  let tokenHits = 0;
  for (const token of tokens) {
    if (title.includes(token) || content.includes(token)) {
      tokenHits += 1;
    }
  }

  const exactTitle = queryNorm && title.includes(queryNorm) ? 1 : 0;
  const tokenScore = tokens.length === 0 ? 0 : tokenHits / tokens.length;
  const recency = recencyBoost(item.created_at);

  return Number((item.score * 0.7 + exactTitle * 0.2 + tokenScore * 0.08 + recency * 0.02).toFixed(6));
}

export function createSimpleReranker(): Reranker {
  return {
    name: "simple-v1",
    rerank(input: RerankInput): RerankOutputItem[] {
      const enriched: RerankOutputItem[] = input.items.map((item) => ({
        ...item,
        rerank_score: 0,
      }));

      for (const item of enriched) {
        item.rerank_score = computeRerankScore(input.query, item);
      }

      enriched.sort((lhs, rhs) => {
        if (rhs.rerank_score !== lhs.rerank_score) {
          return rhs.rerank_score - lhs.rerank_score;
        }
        return lhs.source_index - rhs.source_index;
      });

      return enriched;
    },
  };
}
