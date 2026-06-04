import { tokenOverlapScore } from "../ja-normalize";
import type { OpenRouterBudget } from "../openrouter-budget";
import { scanTextForPii } from "../pii-scan";
import { hasLlmLeakage } from "./llm-leakage";
import type { CandidateCase, FilterStats } from "./types";

function hasShortcutLeak(caseRow: CandidateCase): boolean {
  const q = caseRow.query.toLowerCase();
  for (const kw of caseRow.expected_keywords ?? []) {
    if (kw.length < 3) continue;
    if (q.includes(kw.toLowerCase())) return true;
  }
  return false;
}

function isAnswerable(caseRow: CandidateCase): boolean {
  const relevant = caseRow.memories.filter((m) => caseRow.relevant_ids.includes(m.id));
  if (relevant.length === 0) return false;
  const combined = relevant.map((m) => m.content).join(" ");
  for (const kw of caseRow.expected_keywords ?? []) {
    if (
      combined.toLowerCase().includes(kw.toLowerCase()) ||
      tokenOverlapScore(combined, kw) >= 0.4
    ) {
      return true;
    }
  }
  return (caseRow.expected_keywords?.length ?? 0) === 0;
}

function isDuplicate(a: CandidateCase, b: CandidateCase): boolean {
  if (a.competency !== b.competency) return false;
  return a.query === b.query;
}

/** Leakage: if query alone contains full expected answer tokens, reject. */
export function hasLeakage(caseRow: CandidateCase): boolean {
  return hasShortcutLeak(caseRow);
}

export interface FilterOptions {
  /** Simulated leakage check without LLM (query contains answer). */
  skipLeakage?: boolean;
  budget?: OpenRouterBudget;
  leakageTrials?: number;
}

export async function filterCandidatesAsync(
  candidates: CandidateCase[],
  options: FilterOptions = {},
): Promise<{ passed: CandidateCase[]; stats: FilterStats }> {
  const stats: FilterStats = {
    input: candidates.length,
    passed: 0,
    rejected_leakage: 0,
    rejected_shortcut: 0,
    rejected_dedup: 0,
    rejected_answerability: 0,
    rejected_pii: 0,
  };
  const passed: CandidateCase[] = [];
  const leakageN = options.leakageTrials ?? 3;

  for (const candidate of candidates) {
    const serialized = JSON.stringify(candidate);
    if (scanTextForPii(serialized).length > 0) {
      stats.rejected_pii += 1;
      candidate.filter_passed = false;
      candidate.filter_reason = "pii_leak";
      continue;
    }
    if (!options.skipLeakage && (await hasLlmLeakage(candidate, options.budget, leakageN))) {
      stats.rejected_leakage += 1;
      candidate.filter_passed = false;
      candidate.filter_reason = "leakage";
      continue;
    }
    if (hasShortcutLeak(candidate)) {
      stats.rejected_shortcut += 1;
      candidate.filter_passed = false;
      candidate.filter_reason = "shortcut";
      continue;
    }
    if (!isAnswerable(candidate)) {
      stats.rejected_answerability += 1;
      candidate.filter_passed = false;
      candidate.filter_reason = "not_answerable";
      continue;
    }
    if (passed.some((p) => isDuplicate(p, candidate))) {
      stats.rejected_dedup += 1;
      candidate.filter_passed = false;
      candidate.filter_reason = "duplicate";
      continue;
    }
    candidate.filter_passed = true;
    passed.push(candidate);
    stats.passed += 1;
  }
  return { passed, stats };
}

export function filterCandidates(
  candidates: CandidateCase[],
  options: FilterOptions = {},
): { passed: CandidateCase[]; stats: FilterStats } {
  const stats: FilterStats = {
    input: candidates.length,
    passed: 0,
    rejected_leakage: 0,
    rejected_shortcut: 0,
    rejected_dedup: 0,
    rejected_answerability: 0,
    rejected_pii: 0,
  };
  const passed: CandidateCase[] = [];

  for (const candidate of candidates) {
    const serialized = JSON.stringify(candidate);
    if (scanTextForPii(serialized).length > 0) {
      stats.rejected_pii += 1;
      candidate.filter_passed = false;
      candidate.filter_reason = "pii_leak";
      continue;
    }
    if (!options.skipLeakage && hasLeakage(candidate)) {
      stats.rejected_leakage += 1;
      candidate.filter_passed = false;
      candidate.filter_reason = "leakage";
      continue;
    }
    if (hasShortcutLeak(candidate)) {
      stats.rejected_shortcut += 1;
      candidate.filter_passed = false;
      candidate.filter_reason = "shortcut";
      continue;
    }
    if (!isAnswerable(candidate)) {
      stats.rejected_answerability += 1;
      candidate.filter_passed = false;
      candidate.filter_reason = "not_answerable";
      continue;
    }
    if (passed.some((p) => isDuplicate(p, candidate))) {
      stats.rejected_dedup += 1;
      candidate.filter_passed = false;
      candidate.filter_reason = "duplicate";
      continue;
    }
    candidate.filter_passed = true;
    passed.push(candidate);
    stats.passed += 1;
  }
  return { passed, stats };
}
