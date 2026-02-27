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

/** 矛盾ファクトの superseded_by 更新要求 */
export interface FactSupersededDecision {
  fact_id: string;
  superseded_by: string;
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
  const activeTokenSets: Set<string>[] = [];

  for (const candidate of sorted) {
    let mergedInto: ConsolidationFact | null = null;
    let bestSimilarity = 0;
    const candidateTokens = tokenize(`${candidate.fact_key} ${candidate.fact_value}`);

    for (let idx = 0; idx < active.length; idx++) {
      const existing = active[idx];
      if (existing.project !== candidate.project || existing.fact_type !== candidate.fact_type) {
        continue;
      }
      const similarity = jaccard(candidateTokens, activeTokenSets[idx]);
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
    activeTokenSets.push(candidateTokens);
  }

  return merges;
}

/**
 * LLM 差分抽出で検出された矛盾ファクトに superseded_by を設定する決定を返す。
 *
 * @param newFactId - 新しく挿入されたファクトの fact_id
 * @param oldFactIds - 新ファクトによって上書きされる旧 fact_id 一覧
 */
export function buildSupersededDecisions(
  newFactId: string,
  oldFactIds: string[]
): FactSupersededDecision[] {
  return oldFactIds
    .filter((id) => id && id !== newFactId)
    .map((id) => ({
      fact_id: id,
      superseded_by: newFactId,
    }));
}
