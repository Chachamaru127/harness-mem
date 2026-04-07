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

// --- 非同期 IReranker インターフェース（外部プロバイダー用） ---

export interface RerankerInput {
  id: number;
  title: string;
  content: string;
  score: number;
}

export interface RerankerResult {
  id: number;
  score: number;
  rerank_score: number;
}

export interface IReranker {
  name: string;
  rerank(query: string, items: RerankerInput[], options?: { topK?: number }): Promise<RerankerResult[]>;
}

export type RerankerProvider = 'simple' | 'cohere' | 'huggingface' | 'sentence-transformers' | 'onnx-cross-encoder';

export interface RerankerConfig {
  provider: RerankerProvider;
  model?: string;
  apiKey?: string;
  endpoint?: string;
  topK?: number;
}
