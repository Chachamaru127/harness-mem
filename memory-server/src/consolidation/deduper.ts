export interface ConsolidationFact {
  fact_id: string;
  project: string;
  session_id: string;
  fact_type: string;
  fact_key: string;
  fact_value: string;
  created_at: string;
}

export interface FactMergeDecision {
  from_fact_id: string;
  into_fact_id: string;
  similarity: number;
}

function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1)
    .slice(0, 64);
  return new Set(tokens);
}

function jaccard(lhs: Set<string>, rhs: Set<string>): number {
  if (lhs.size === 0 || rhs.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of lhs) {
    if (rhs.has(token)) {
      intersection += 1;
    }
  }
  const union = lhs.size + rhs.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function dedupeFacts(facts: ConsolidationFact[], threshold = 0.3): FactMergeDecision[] {
  const sorted = [...facts].sort((lhs, rhs) =>
    String(lhs.created_at || "").localeCompare(String(rhs.created_at || "")) || lhs.fact_id.localeCompare(rhs.fact_id)
  );

  const merges: FactMergeDecision[] = [];
  const active: ConsolidationFact[] = [];

  for (const candidate of sorted) {
    let mergedInto: ConsolidationFact | null = null;
    let bestSimilarity = 0;
    const candidateTokens = tokenize(`${candidate.fact_key} ${candidate.fact_value}`);

    for (const existing of active) {
      if (existing.project !== candidate.project || existing.fact_type !== candidate.fact_type) {
        continue;
      }
      const similarity = jaccard(candidateTokens, tokenize(`${existing.fact_key} ${existing.fact_value}`));
      if (similarity >= threshold && similarity > bestSimilarity) {
        bestSimilarity = similarity;
        mergedInto = existing;
      }
    }

    if (mergedInto) {
      merges.push({
        from_fact_id: candidate.fact_id,
        into_fact_id: mergedInto.fact_id,
        similarity: Number(bestSimilarity.toFixed(6)),
      });
      continue;
    }

    active.push(candidate);
  }

  return merges;
}
