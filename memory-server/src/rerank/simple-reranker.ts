import { type RerankInput, type RerankOutputItem, type Reranker } from "./types";

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1)
    .slice(0, 64);
}

function getHalfLifeHours(): number {
  const envDays = Number(process.env.HARNESS_MEM_RECENCY_HALF_LIFE_DAYS);
  const days = Number.isFinite(envDays) && envDays > 0 ? envDays : 14;
  return 24 * days;
}

function recencyBoost(createdAt: string): number {
  const ts = Date.parse(createdAt);
  if (Number.isNaN(ts)) {
    return 0;
  }
  const ageHours = Math.max(0, Date.now() - ts) / (1000 * 60 * 60);
  return Math.exp(-ageHours / getHalfLifeHours());
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

// ---- Cross-encoder Reranker ----

/**
 * N-gram の重複度を計算する（bigram overlap）。
 * Cross-encoder の意味的類似度の近似として使用。
 */
function computeBigramOverlap(a: string, b: string): number {
  const aTok = tokenize(a);
  const bTok = tokenize(b);
  if (aTok.length === 0 || bTok.length === 0) return 0;

  // bigram を生成
  function bigrams(tokens: string[]): Set<string> {
    const bg = new Set<string>();
    for (let i = 0; i < tokens.length - 1; i++) {
      bg.add(`${tokens[i]}|${tokens[i + 1]}`);
    }
    // unigrams も含める
    for (const t of tokens) bg.add(t);
    return bg;
  }

  const aBg = bigrams(aTok);
  const bBg = bigrams(bTok);

  let overlap = 0;
  for (const gram of aBg) {
    if (bBg.has(gram)) overlap++;
  }

  // Jaccard 係数的に正規化
  const union = aBg.size + bBg.size - overlap;
  return union === 0 ? 0 : overlap / union;
}

/**
 * Cross-encoder ライクなスコア計算。
 *
 * クエリとドキュメント（タイトル+コンテンツ）の意味的一致度を
 * N-gram overlap + 位置重み付き token match で近似する。
 * 実際の ML Cross-encoder モデルの代替として使用。
 */
function computeCrossEncoderScore(query: string, item: RerankOutputItem): number {
  const q = query.toLowerCase().trim();
  const titleLower = item.title.toLowerCase();
  const contentLower = item.content.toLowerCase();
  const combined = `${titleLower} ${contentLower}`;

  const queryTokens = tokenize(q);
  if (queryTokens.length === 0) {
    return item.score * 0.5;
  }

  // 1. Token hit rate (タイトルは2倍重み)
  let titleHits = 0;
  let contentHits = 0;
  for (const token of queryTokens) {
    if (titleLower.includes(token)) titleHits++;
    if (contentLower.includes(token)) contentHits++;
  }
  const titleScore = titleHits / queryTokens.length;
  const contentScore = contentHits / queryTokens.length;

  // 2. Exact phrase match bonus
  const exactMatch = q.length >= 4 && combined.includes(q) ? 0.3 : 0;

  // 3. Bigram overlap (semantic proximity)
  const bigramScore = computeBigramOverlap(q, combined);

  // 4. Recency boost (small weight)
  const recency = recencyBoost(item.created_at) * 0.05;

  // 重み付き合算: タイトルマッチ重視、bigram で意味的類似度を捕捉
  const rawScore =
    titleScore * 0.35 +
    contentScore * 0.25 +
    exactMatch +
    bigramScore * 0.2 +
    item.score * 0.15 +
    recency;

  return Number(Math.min(1.0, rawScore).toFixed(6));
}

/**
 * Cross-encoder ライクな Reranker を生成する。
 *
 * N-gram overlap と位置重み付きトークンマッチで近似する実装。
 * 実際の ML モデル不使用で、外部依存なしに動作する。
 */
export function createCrossEncoderReranker(): Reranker {
  return {
    name: "cross-encoder-v1",
    rerank(input: RerankInput): RerankOutputItem[] {
      const enriched: RerankOutputItem[] = input.items.map((item) => ({
        ...item,
        rerank_score: 0,
      }));

      for (const item of enriched) {
        item.rerank_score = computeCrossEncoderScore(input.query, item);
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
