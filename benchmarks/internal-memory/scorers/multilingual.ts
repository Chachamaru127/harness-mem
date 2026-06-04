import type { LanguageProfile, ScoredCaseResult } from "../lib/types";

export function japaneseMixedScore(results: ScoredCaseResult[]): number | undefined {
  const eligible = results.filter(
    (row) =>
      row.status === "ok" &&
      (row.language_profile === "ja" || row.language_profile === "mixed"),
  );
  if (eligible.length === 0) return undefined;
  const total = eligible.reduce((sum, row) => sum + row.recall_at_10, 0);
  return total / eligible.length;
}

export function meanRecallForProfile(
  results: ScoredCaseResult[],
  profile: LanguageProfile,
): number | undefined {
  const eligible = results.filter((row) => row.status === "ok" && row.language_profile === profile);
  if (eligible.length === 0) return undefined;
  return eligible.reduce((sum, row) => sum + row.recall_at_10, 0) / eligible.length;
}
