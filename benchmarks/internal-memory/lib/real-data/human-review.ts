import type { CandidateCase, HumanReviewLog, HumanReviewRecord } from "./types";
import type { Competency } from "../types";

const FULL_REVIEW_COMPETENCIES = new Set<Competency>(["CR", "TTL"]);

export interface HumanReviewOptions {
  spotCheckRate?: number;
  reviewer?: string;
  autoAcceptFiltered?: boolean;
}

/** Apply human review policy: CR/TTL full review; AR/LRU spot-check. Pilot auto-accepts filtered+judge-passed. */
export function applyHumanReview(
  candidates: CandidateCase[],
  options: HumanReviewOptions = {},
): { accepted: CandidateCase[]; log: HumanReviewLog } {
  const spotRate = options.spotCheckRate ?? 0.28;
  const reviewer = options.reviewer ?? "pilot-auto-review";
  const records: HumanReviewRecord[] = [];
  const accepted: CandidateCase[] = [];

  for (let i = 0; i < candidates.length; i += 1) {
    const c = candidates[i];
    const competency = c.competency ?? "AR";
    const needsFull = FULL_REVIEW_COMPETENCIES.has(competency);
    const inSpot = needsFull || i % Math.round(1 / spotRate) === 0;

    let decision: HumanReviewRecord["decision"] = "accept";
    if (!c.filter_passed) {
      decision = "reject";
    } else if (c.judge_scores && c.judge_scores.pii_clean < 1) {
      decision = "reject";
    } else if (options.autoAcceptFiltered !== false) {
      decision = "accept";
    }

    if (inSpot) {
      records.push({
        case_id: c.case_id,
        competency,
        decision,
        reviewer,
        notes: needsFull ? "full-review competency" : "spot-check sample",
      });
    }

    if (decision === "accept") accepted.push(c);
  }

  const log: HumanReviewLog = {
    reviewed_at: new Date().toISOString(),
    total_candidates: candidates.length,
    reviewed_count: records.length,
    accepted: accepted.length,
    rejected: candidates.length - accepted.length,
    records,
  };
  return { accepted, log };
}
