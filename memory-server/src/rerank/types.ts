export interface RerankInputItem {
  id: string;
  score: number;
  created_at: string;
  title: string;
  content: string;
  source_index: number;
}

export interface RerankOutputItem extends RerankInputItem {
  rerank_score: number;
}

export interface RerankInput {
  query: string;
  items: RerankInputItem[];
}

export interface Reranker {
  name: string;
  rerank(input: RerankInput): RerankOutputItem[];
}

export interface RerankerRegistryResult {
  enabled: boolean;
  reranker: Reranker | null;
  warnings: string[];
}
