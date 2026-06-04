import type { BenchmarkCase, Competency } from "../types";
import type { CorpusRound } from "../export-corpus";

export interface CandidateCase extends BenchmarkCase {
  source_round_ids: string[];
  generation_model?: string;
  filter_passed?: boolean;
  filter_reason?: string;
  judge_scores?: JudgeDimensionScores;
}

export interface JudgeDimensionScores {
  faithfulness: number;
  answerability: number;
  difficulty: number;
  language_consistency: number;
  pii_clean: number;
  reasons?: Record<string, string>;
}

export interface FilterStats {
  input: number;
  passed: number;
  rejected_leakage: number;
  rejected_shortcut: number;
  rejected_dedup: number;
  rejected_answerability: number;
  rejected_pii: number;
}

export interface HumanReviewRecord {
  case_id: string;
  competency: Competency;
  decision: "accept" | "reject" | "revise";
  reviewer: string;
  notes?: string;
}

export interface HumanReviewLog {
  reviewed_at: string;
  total_candidates: number;
  reviewed_count: number;
  accepted: number;
  rejected: number;
  records: HumanReviewRecord[];
}

export interface PipelineManifest {
  schema_version: "real-data-pipeline-v1" | "real-data-pipeline-v2";
  generated_at: string;
  corpus_rounds: number;
  candidates_generated: number;
  filter_stats: FilterStats;
  judge_model?: string;
  generator_model?: string;
  golden_agreement_rate?: number;
  openrouter_spent_usd?: number;
  openrouter_budget_cap_usd?: number;
  target_per_competency?: number;
  dataset_version?: string;
  review_queue_stats?: { total: number; cr_ttl_full: number; ar_lru_spot: number };
  competency_counts?: Record<string, number>;
}

export type { CorpusRound };
