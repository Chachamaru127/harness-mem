export type BenchmarkLayer =
  | "public_compatible"
  | "ja_coding"
  | "mixed_coding"
  | "isolation"
  | "resume";

export type LanguageProfile = "ja" | "en" | "mixed";

/** Primary ingest platform for real-data cases (§153 optional metadata). */
export type SourcePlatform = "claude" | "codex" | "cursor" | "mixed" | "unknown";

/** MemoryAgentBench four-capability vocabulary (Spec.md §139). */
export type Competency = "AR" | "TTL" | "LRU" | "CR";

export interface MemoryEntry {
  id: string;
  content: string;
  timestamp?: string;
  workspace_id?: string;
  metadata?: Record<string, string>;
}

export interface BenchmarkCase {
  case_id: string;
  layer: BenchmarkLayer;
  category: string;
  competency?: Competency;
  language_profile: LanguageProfile;
  project: string;
  workspace_id?: string;
  forbidden_project?: string;
  memories: MemoryEntry[];
  query: string;
  relevant_ids: string[];
  expected_keywords?: string[];
  resume_must_include?: string[];
  source_platform?: SourcePlatform;
  source_dataset?: string;
  source_split?: string;
  dataset_revision?: string;
  sample_limit?: number;
  official_metric?: OfficialMetricSpec;
}

export interface OfficialMetricSpec {
  family: "substring_exact_match" | "exact_match" | "llm_judge_opt_in";
  name: string;
  expected_answers: string[];
  source_url?: string;
}

export interface RetrievalHit {
  id: string;
  rank: number;
  content: string;
  score?: number;
}

export interface AdapterRunContext {
  run_id: string;
  competitor_id: string;
  project_prefix: string;
}

export type AdapterStatus = "ok" | "skipped_missing_credentials" | "error";

export interface AdapterQueryResult {
  status: AdapterStatus;
  hits: RetrievalHit[];
  latency_ms: number;
  tokens_estimate?: number;
  skip_reason?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface ScoredCaseResult {
  case_id: string;
  layer: BenchmarkLayer;
  category: string;
  competency?: Competency;
  language_profile: LanguageProfile;
  competitor_id: string;
  status: AdapterStatus;
  recall_at_5: number;
  recall_at_10: number;
  mrr: number;
  ndcg_at_10: number;
  isolation_pass?: boolean;
  resume_hit_rate?: number;
  /** Substring match against expected_keywords (AR/CR baseline tier). */
  substring_grounding_score?: number;
  /** @deprecated Use substring_grounding_score; kept for backward-compatible reports. */
  grounding_score?: number;
  /** LLM judge grounding for TTL/LRU hard cases (OpenRouter, budget-capped). */
  llm_grounding_score?: number;
  llm_judge_model?: string;
  latency_ms: number;
  skip_reason?: string;
  retrieved_ids: string[];
  official_metric?: OfficialMetricResult;
  source_dataset?: string;
  source_split?: string;
  dataset_revision?: string;
  sample_limit?: number;
  /** S154-301: per-case deep-freshness ground truth (from memory metadata). */
  freshness_truth?: FreshnessGroundTruth;
}

/** S154-301: per-case temporal ground truth for the deep-freshness scorers. */
export interface FreshnessGroundTruth {
  /** memory ids that have been superseded — must NOT appear in retrieved results. */
  superseded_ids?: string[];
  /** old-tense memory ids (e.g. "planned" before "done") — must be excluded. */
  stale_tense_ids?: string[];
  /** memory id -> ISO time the value was invalidated/superseded. */
  invalidated_at?: Record<string, string>;
  /** memory id -> ISO time the system was first observed to stop returning it
   *  (populated by 154-303 longitudinal runs; absent in a static snapshot). */
  stale_cleared_at?: Record<string, string>;
}

export interface OfficialMetricResult {
  family: OfficialMetricSpec["family"];
  name: string;
  score: number | null;
  status: "computed" | "not_applicable" | "requires_llm_judge";
  evidence: string;
}

export interface LayerSummary {
  layer: BenchmarkLayer;
  case_count: number;
  ran_count: number;
  skipped_count: number;
  recall_at_10_mean: number;
  mrr_mean: number;
  ndcg_at_10_mean: number;
  latency_p50_ms: number;
  latency_p95_ms: number;
  ja_recall_at_10?: number;
  mixed_recall_at_10?: number;
  /** S154-301 deep-freshness diagnostics (null when no eligible ground-truth cases). */
  tense_rewrite_accuracy?: number;
  supersession_precision?: number;
  freshness_delay_ms?: number;
}

export interface CompetitorSummary {
  competitor_id: string;
  measurement: "reproduced" | "published";
  status: "completed" | "partial" | "skipped";
  layers: LayerSummary[];
  japanese_mixed_score?: number;
  published_recall_at_10?: number | null;
  published_source?: string;
  published_note?: string;
}

export interface OpenRouterBudgetSummary {
  cap_usd: number;
  spent_usd: number;
  remaining_usd: number;
  request_count: number;
  enabled: boolean;
}

export interface BenchmarkSummary {
  schema_version: "internal-memory-summary-v1";
  generated_at: string;
  run_id: string;
  git_sha?: string;
  dataset_ids: string[];
  dataset_manifest?: BenchmarkDatasetManifest;
  competitors: CompetitorSummary[];
  openrouter_budget?: OpenRouterBudgetSummary;
  env_files_loaded?: string[];
  claim_safety: string[];
}

export interface BenchmarkDatasetManifest {
  dataset: "default" | "memoryagentbench" | "codingmemory";
  dataset_id?: string;
  source_url?: string;
  revision?: string;
  splits?: string[];
  sample_limit?: number;
  row_limit?: number;
  gate_mode?: "smoke" | "medium" | "full" | "public";
  upstream_row_count?: number;
  memory_chunk_count?: number;
  transform_version?: string;
  cache_dir?: string;
  downloaded_at?: string;
  embedding_profile?: "production_onnx" | "hash_fallback";
  language_profile?: Record<string, number>;
  competency?: Record<string, number>;
  source_platform?: Record<string, number>;
  hf_revision?: string;
}
