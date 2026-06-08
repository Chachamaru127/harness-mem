import {
  allowsContentRecallFallback,
  inferCompetency,
  usesSubstringGrounding,
} from "../scorers/competency";
import { semanticGroundingScore } from "./ja-normalize";
import {
  groundingScore,
  mrr,
  ndcgAtK,
  recallAtK,
  resumeHitRate,
} from "../scorers/retrieval";
import type { AdapterQueryResult, BenchmarkCase, ScoredCaseResult } from "./types";

function harnessObservationIds(relevantIds: string[]): string[] {
  return relevantIds.map((id) => (id.startsWith("obs_") ? id : `obs_${id}`));
}

function contentRecallFallback(caseRow: BenchmarkCase, retrievedContents: string[]): number {
  const relevantMemories = caseRow.memories.filter((memory) => caseRow.relevant_ids.includes(memory.id));
  if (relevantMemories.length === 0) return 0;
  const hits = relevantMemories.filter((memory) => {
    const needle = memory.content.slice(0, 32).toLowerCase();
    return retrievedContents.some((content) => content.toLowerCase().includes(needle));
  }).length;
  return hits / relevantMemories.length;
}

function scoreOfficialMetric(
  caseRow: BenchmarkCase,
  retrievedContents: string[],
): ScoredCaseResult["official_metric"] {
  const spec = caseRow.official_metric;
  if (!spec) return undefined;
  if (spec.expected_answers.length === 0) {
    return {
      family: spec.family,
      name: spec.name,
      score: null,
      status: "not_applicable",
      evidence: "no expected answers available in transformed row",
    };
  }
  const corpus = retrievedContents.join("\n").toLowerCase();
  const hits = spec.expected_answers.filter((answer) => corpus.includes(answer.toLowerCase())).length;
  const score = hits / spec.expected_answers.length;
  return {
    family: spec.family,
    name: spec.name,
    score,
    status: spec.family === "llm_judge_opt_in" ? "requires_llm_judge" : "computed",
    evidence: `${hits}/${spec.expected_answers.length} expected answers found in retrieved contents`,
  };
}

export function scoreCase(
  caseRow: BenchmarkCase,
  competitorId: string,
  queryResult: AdapterQueryResult,
): ScoredCaseResult {
  const competency = inferCompetency(caseRow);
  const retrievedIds = queryResult.hits.map((hit) => hit.id);
  const retrievedContents = queryResult.hits.map((hit) => hit.content);

  if (queryResult.status !== "ok") {
    return {
      case_id: caseRow.case_id,
      layer: caseRow.layer,
      category: caseRow.category,
      competency,
      language_profile: caseRow.language_profile,
      competitor_id: competitorId,
      status: queryResult.status,
      recall_at_5: 0,
      recall_at_10: 0,
      mrr: 0,
      ndcg_at_10: 0,
      latency_ms: queryResult.latency_ms,
      skip_reason: queryResult.skip_reason ?? queryResult.error,
      retrieved_ids: [],
      source_dataset: caseRow.source_dataset,
      source_split: caseRow.source_split,
      dataset_revision: caseRow.dataset_revision,
      sample_limit: caseRow.sample_limit,
    };
  }

  const relevantIds =
    competitorId === "harness-mem" ? harnessObservationIds(caseRow.relevant_ids) : caseRow.relevant_ids;

  let recall5 = recallAtK(relevantIds, retrievedIds, 5);
  let recall10 = recallAtK(relevantIds, retrievedIds, 10);
  let rankScore = mrr(relevantIds, retrievedIds);
  let ndcg = ndcgAtK(relevantIds, retrievedIds, 10);

  if (recall10 === 0 && allowsContentRecallFallback(competency)) {
    const fallback = contentRecallFallback(caseRow, retrievedContents);
    recall5 = Math.max(recall5, fallback);
    recall10 = Math.max(recall10, fallback);
    if (fallback > 0 && rankScore === 0) rankScore = fallback;
    if (fallback > 0 && ndcg === 0) ndcg = fallback;
  }

  const result: ScoredCaseResult = {
    case_id: caseRow.case_id,
    layer: caseRow.layer,
    category: caseRow.category,
    competency,
    language_profile: caseRow.language_profile,
    competitor_id: competitorId,
    status: "ok",
    recall_at_5: recall5,
    recall_at_10: recall10,
    mrr: rankScore,
    ndcg_at_10: ndcg,
    latency_ms: queryResult.latency_ms,
    retrieved_ids: retrievedIds,
    official_metric: scoreOfficialMetric(caseRow, retrievedContents),
    source_dataset: caseRow.source_dataset,
    source_split: caseRow.source_split,
    dataset_revision: caseRow.dataset_revision,
    sample_limit: caseRow.sample_limit,
  };

  if (caseRow.expected_keywords?.length && usesSubstringGrounding(competency)) {
    const useSemantic =
      caseRow.language_profile === "ja" ||
      caseRow.language_profile === "mixed" ||
      caseRow.category.startsWith("real_");
    const substringScore = useSemantic
      ? semanticGroundingScore(retrievedContents, caseRow.expected_keywords)
      : groundingScore(retrievedContents, caseRow.expected_keywords);
    result.substring_grounding_score = substringScore;
    result.grounding_score = substringScore;
  }
  if (caseRow.resume_must_include?.length) {
    result.resume_hit_rate = resumeHitRate(retrievedContents, caseRow.resume_must_include);
  }
  if (caseRow.layer === "isolation" && caseRow.forbidden_project) {
    const forbiddenMemories = caseRow.memories.filter(
      (memory) => !caseRow.relevant_ids.includes(memory.id),
    );
    const forbiddenNeedles = forbiddenMemories.map((memory) => memory.content.slice(0, 24).toLowerCase());
    const leaked = forbiddenNeedles.some((needle) =>
      retrievedContents.some((content) => content.toLowerCase().includes(needle)),
    );
    result.isolation_pass = !leaked;
  }

  return result;
}
