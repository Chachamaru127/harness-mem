import type { BenchmarkCase, BenchmarkLayer, Competency } from "../lib/types";

const CATEGORY_COMPETENCY: Record<string, Competency> = {
  conflict_resolution: "CR",
  test_time_learning: "TTL",
  handoff_resume: "LRU",
  temporal_fix: "CR",
  ja_requirements: "AR",
  ja_decision: "AR",
  mixed_symbol: "AR",
  en_content_ja_query: "AR",
  project_boundary: "AR",
  english_fact: "AR",
  english_temporal: "CR",
  english_symbol: "AR",
  english_deploy: "AR",
  english_debug: "AR",
  real_ar: "AR",
  real_mixed_ar: "AR",
  real_conflict_resolution: "CR",
  real_test_time_learning: "TTL",
  real_long_range: "LRU",
};

const LAYER_COMPETENCY: Partial<Record<BenchmarkLayer, Competency>> = {
  resume: "LRU",
  public_compatible: "AR",
};

export function inferCompetency(caseRow: BenchmarkCase): Competency {
  if (caseRow.competency) return caseRow.competency;
  return CATEGORY_COMPETENCY[caseRow.category] ?? LAYER_COMPETENCY[caseRow.layer] ?? "AR";
}

/** AR/CR use substring grounding; TTL/LRU rely on LLM judge when enabled. */
export function usesSubstringGrounding(competency: Competency): boolean {
  return competency === "AR" || competency === "CR";
}

/** Hard cases should be supplemented with LLM judge grounding (Spec.md two-tier scoring). */
export function usesLlmJudge(competency: Competency): boolean {
  return competency === "TTL" || competency === "LRU";
}

/** Content-substring recall fallback favors self-seeded adapters; limit to AR only. */
export function allowsContentRecallFallback(competency: Competency): boolean {
  return competency === "AR";
}
