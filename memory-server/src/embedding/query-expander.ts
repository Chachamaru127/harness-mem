import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AdaptiveRoute } from "./types";

export interface ExpandedQuery {
  original: string;
  expanded: string[];
  route: AdaptiveRoute | null;
}

type SynonymMap = Record<string, string[]>;

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

function buildVariants(query: string, matches: Array<{ key: string; synonym: string }>, maxVariants: number): string[] {
  const original = normalizeText(query);
  const originalTokens = Math.max(1, tokenCount(original));
  const maxTokens = originalTokens * 3;
  const variants: string[] = [];

  for (const match of matches) {
    const replaced = normalizeText(original.replace(match.key, match.synonym));
    const appended = normalizeText(`${original} ${match.synonym}`);
    for (const candidate of [replaced, appended]) {
      if (!candidate || candidate === original || tokenCount(candidate) > maxTokens) {
        continue;
      }
      if (!variants.includes(candidate)) {
        variants.push(candidate);
      }
      if (variants.length >= maxVariants) {
        return variants;
      }
    }
  }

  return variants;
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
    expanded: buildVariants(original, matches, maxVariants),
    route,
  };
}
