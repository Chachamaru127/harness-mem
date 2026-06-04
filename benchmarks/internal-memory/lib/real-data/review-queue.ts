import type { Competency } from "../types";
import type { CandidateCase } from "./types";

export interface ReviewQueueEntry {
  case_id: string;
  competency: Competency;
  query: string;
  review_reason: "full-review-competency" | "spot-check";
  judge_scores?: {
    faithfulness: number;
    answerability: number;
    difficulty: number;
  };
  filter_passed?: boolean;
}

export interface ReviewQueueStats {
  total: number;
  cr_ttl_full: number;
  ar_lru_spot: number;
}

const FULL_REVIEW = new Set<Competency>(["CR", "TTL"]);

/** Build non-blocking human review queue: CR/TTL all, AR/LRU ~28% spot-check. */
export function buildReviewQueue(
  candidates: CandidateCase[],
  spotCheckRate = 0.28,
): { entries: ReviewQueueEntry[]; stats: ReviewQueueStats } {
  const entries: ReviewQueueEntry[] = [];
  let crTtlFull = 0;
  let arLruSpot = 0;
  const spotInterval = Math.max(1, Math.round(1 / spotCheckRate));

  for (let i = 0; i < candidates.length; i += 1) {
    const c = candidates[i];
    const competency = c.competency ?? "AR";
    const needsFull = FULL_REVIEW.has(competency);
    const inSpot = needsFull || i % spotInterval === 0;
    if (!inSpot) continue;

    entries.push({
      case_id: c.case_id,
      competency,
      query: c.query,
      review_reason: needsFull ? "full-review-competency" : "spot-check",
      judge_scores: c.judge_scores
        ? {
            faithfulness: c.judge_scores.faithfulness,
            answerability: c.judge_scores.answerability,
            difficulty: c.judge_scores.difficulty,
          }
        : undefined,
      filter_passed: c.filter_passed,
    });
    if (needsFull) crTtlFull += 1;
    else arLruSpot += 1;
  }

  return {
    entries,
    stats: { total: entries.length, cr_ttl_full: crTtlFull, ar_lru_spot: arLruSpot },
  };
}
