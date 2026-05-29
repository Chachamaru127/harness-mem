export function recallAtK(relevantIds: string[], retrievedIds: string[], k: number): number {
  if (relevantIds.length === 0) return 0;
  const top = new Set(retrievedIds.slice(0, k));
  const hits = relevantIds.filter((id) => top.has(id)).length;
  return hits / relevantIds.length;
}

export function mrr(relevantIds: string[], retrievedIds: string[]): number {
  for (let i = 0; i < retrievedIds.length; i += 1) {
    if (relevantIds.includes(retrievedIds[i])) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

export function ndcgAtK(relevantIds: string[], retrievedIds: string[], k: number): number {
  const top = retrievedIds.slice(0, k);
  let dcg = 0;
  for (let i = 0; i < top.length; i += 1) {
    if (relevantIds.includes(top[i])) {
      dcg += 1 / Math.log2(i + 2);
    }
  }
  let ideal = 0;
  for (let i = 0; i < Math.min(relevantIds.length, k); i += 1) {
    ideal += 1 / Math.log2(i + 2);
  }
  if (ideal === 0) return 0;
  return dcg / ideal;
}

export function groundingScore(hitsContent: string[], keywords: string[]): number {
  if (keywords.length === 0) return 1;
  const blob = hitsContent.join("\n").toLowerCase();
  const matched = keywords.filter((kw) => blob.includes(kw.toLowerCase())).length;
  return matched / keywords.length;
}

export function resumeHitRate(hitsContent: string[], mustInclude: string[]): number {
  if (mustInclude.length === 0) return 1;
  const blob = hitsContent.join("\n").toLowerCase();
  const matched = mustInclude.filter((term) => blob.includes(term.toLowerCase())).length;
  return matched / mustInclude.length;
}
