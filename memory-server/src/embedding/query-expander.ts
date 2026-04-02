import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AdaptiveRoute } from "./types";

export interface ExpandedQuery {
  original: string;
  expanded: string[];
  route: AdaptiveRoute | null;
}

type SynonymMap = Record<string, string[]>;
type VariantOrigin = "replaced" | "appended";

interface VariantCandidate {
  value: string;
  score: number;
  origin: VariantOrigin;
}

function loadSynonymMap(fileName: string): SynonymMap {
  const filePath = resolve(import.meta.dir, "../../../data", fileName);
  if (!existsSync(filePath)) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]))
        .map(([key, values]) => [
          normalizeText(key),
          values.filter((value): value is string => typeof value === "string").map((value) => normalizeText(value)),
        ]),
    );
  } catch {
    return {};
  }
}

const SYNONYMS_JA = loadSynonymMap("synonyms-ja.json");
const SYNONYMS_EN = loadSynonymMap("synonyms-en.json");

function normalizeText(value: string): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function tokenCount(value: string): number {
  const normalized = normalizeText(value);
  if (!normalized) {
    return 0;
  }
  return normalized.split(/\s+/).length;
}

function hasJapaneseScript(value: string): boolean {
  return /[\u3040-\u30FF\u3400-\u9FFF]/.test(value);
}

function hasLatinScript(value: string): boolean {
  return /[A-Za-z]/.test(value);
}

function collectMatches(query: string, dictionary: SynonymMap): Array<{ key: string; synonym: string }> {
  const normalizedQuery = normalizeText(query).toLowerCase();
  const matches: Array<{ key: string; synonym: string }> = [];
  for (const [rawKey, synonyms] of Object.entries(dictionary)) {
    const key = rawKey.toLowerCase();
    if (!normalizedQuery.includes(key)) {
      continue;
    }
    for (const synonym of synonyms) {
      if (!synonym || normalizedQuery.includes(synonym.toLowerCase())) {
        continue;
      }
      matches.push({ key: rawKey, synonym });
    }
  }
  return matches;
}

function scoreCandidate(
  original: string,
  candidate: string,
  route: AdaptiveRoute | null,
  origin: VariantOrigin,
): number {
  const originalHasJa = hasJapaneseScript(original);
  const originalHasEn = hasLatinScript(original);
  const candidateHasJa = hasJapaneseScript(candidate);
  const candidateHasEn = hasLatinScript(candidate);

  let score = origin === "replaced" ? 1.5 : 1;

  if (!originalHasJa && candidateHasJa) {
    score += route === "openai" ? 5 : 3;
  }
  if (!originalHasEn && candidateHasEn) {
    score += route === "ruri" ? 5 : 3;
  }
  if (candidateHasJa && candidateHasEn) {
    score += route === "ensemble" ? 4 : 2.5;
  }

  score += Math.max(0, 0.5 - tokenCount(candidate) * 0.01);
  return score;
}

function buildVariants(
  query: string,
  route: AdaptiveRoute | null,
  matches: Array<{ key: string; synonym: string }>,
  maxVariants: number,
): string[] {
  const original = normalizeText(query);
  const originalTokens = Math.max(1, tokenCount(original));
  const maxTokens = originalTokens * 3;
  const candidateMap = new Map<string, VariantCandidate>();

  for (const match of matches) {
    const replaced = normalizeText(original.replace(match.key, match.synonym));
    const appended = normalizeText(`${original} ${match.synonym}`);
    for (const [candidate, origin] of [
      [replaced, "replaced"],
      [appended, "appended"],
    ] as const) {
      if (!candidate || candidate === original || tokenCount(candidate) > maxTokens) {
        continue;
      }
      const scored: VariantCandidate = {
        value: candidate,
        origin,
        score: scoreCandidate(original, candidate, route, origin),
      };
      const existing = candidateMap.get(candidate);
      if (!existing || scored.score > existing.score) {
        candidateMap.set(candidate, scored);
      }
    }
  }

  return [...candidateMap.values()]
    .sort((lhs, rhs) => {
      if (rhs.score !== lhs.score) {
        return rhs.score - lhs.score;
      }
      if (lhs.origin !== rhs.origin) {
        return lhs.origin === "replaced" ? -1 : 1;
      }
      if (tokenCount(lhs.value) !== tokenCount(rhs.value)) {
        return tokenCount(lhs.value) - tokenCount(rhs.value);
      }
      return lhs.value.localeCompare(rhs.value);
    })
    .slice(0, maxVariants)
    .map((candidate) => candidate.value);
}

export function expandQuery(
  query: string,
  route: AdaptiveRoute | null,
  options: { maxVariants?: number } = {}
): ExpandedQuery {
  const original = normalizeText(query);
  const maxVariants = Math.max(0, Math.min(3, Math.floor(options.maxVariants ?? 3)));
  if (!original || maxVariants === 0 || route === null) {
    return { original, expanded: [], route };
  }

  const dictionaries: SynonymMap[] = [];
  if (route === "ruri") {
    dictionaries.push(SYNONYMS_JA);
  } else if (route === "openai") {
    dictionaries.push(SYNONYMS_EN);
  } else {
    dictionaries.push(SYNONYMS_JA, SYNONYMS_EN);
  }

  const matches = dictionaries.flatMap((dictionary) => collectMatches(original, dictionary));
  return {
    original,
    expanded: buildVariants(original, route, matches, maxVariants),
    route,
  };
}
