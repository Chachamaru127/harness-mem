/** Lightweight Japanese token normalization (no external deps). */
export function normalizeJaTokens(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return [];
  const tokens: string[] = [];
  for (const part of normalized.split(/\s+/)) {
    if (/^[\u3040-\u30ff\u4e00-\u9faf]+$/u.test(part)) {
      for (const ch of part) tokens.push(ch);
    } else {
      tokens.push(part);
    }
  }
  return tokens;
}

export function tokenOverlapScore(a: string, b: string): number {
  const ta = new Set(normalizeJaTokens(a));
  const tb = new Set(normalizeJaTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let hit = 0;
  for (const t of ta) {
    if (tb.has(t)) hit += 1;
  }
  return hit / Math.max(ta.size, tb.size);
}

export function semanticGroundingScore(
  retrievedContents: string[],
  expectedKeywords: string[],
): number {
  if (expectedKeywords.length === 0 || retrievedContents.length === 0) return 0;
  const haystack = retrievedContents.join(" ");
  let hit = 0;
  for (const kw of expectedKeywords) {
    const score = tokenOverlapScore(haystack, kw);
    if (score >= 0.5 || haystack.toLowerCase().includes(kw.toLowerCase())) {
      hit += 1;
    }
  }
  return hit / expectedKeywords.length;
}
