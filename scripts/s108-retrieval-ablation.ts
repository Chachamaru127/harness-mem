import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";

type Difficulty = "easy" | "medium" | "hard";
type QueryFamily =
  | "file"
  | "branch"
  | "pr"
  | "issue"
  | "migration"
  | "deploy"
  | "failing_test"
  | "release"
  | "setup"
  | "doctor"
  | "companion";

type VariantId =
  | "lexical"
  | "code_token"
  | "query_expansion"
  | "recency"
  | "entity"
  | "graph"
  | "vector_full_baseline"
  | "fact_chain";

type VariantStatus = "available" | "not_available";
type MissReason =
  | "none"
  | "retrieval_miss"
  | "ranking_miss"
  | "query_tokenization_gap"
  | "stale_fact_win"
  | "unsupported_signal";

interface DevWorkflowEntry {
  id: string;
  content: string;
  timestamp: string;
}

interface DevWorkflowCase {
  id: string;
  description: string;
  difficulty: Difficulty;
  entries: DevWorkflowEntry[];
  query: string;
  expected_answer: string;
  relevant_ids: string[];
  query_family?: QueryFamily;
  category?: QueryFamily;
}

interface CorpusEntry {
  id: string;
  raw_id: string;
  case_id: string;
  family: QueryFamily;
  content: string;
  timestamp: string;
  timestamp_ms: number;
  simple_tokens: string[];
  code_tokens: string[];
  entities: string[];
}

interface VariantDefinition {
  id: VariantId;
  label: string;
  status: VariantStatus;
  unavailable_reason?: string;
  toggles: {
    lexical: boolean;
    vector: boolean;
    code_token: boolean;
    query_expansion: boolean;
    recency: boolean;
    entity: boolean;
    graph: boolean;
    fact_chain: boolean;
  };
}

interface ScoredCandidate {
  id: string;
  score: number;
  signals: Record<string, number>;
  timestamp_ms: number;
}

interface CaseResult {
  case_id: string;
  family: QueryFamily;
  query: string;
  expected_ids: string[];
  retrieved_ids: string[];
  recall_at_10: number;
  mrr: number;
  latency_ms: number;
  miss_reason: MissReason;
}

interface FamilyMetrics {
  cases: number;
  recall_at_10: number;
  mrr: number;
  p95_ms: number;
  top_miss_reason: MissReason | null;
}

interface VariantSummary {
  id: VariantId;
  label: string;
  status: VariantStatus;
  unavailable_reason?: string;
  toggles: VariantDefinition["toggles"];
  metrics: {
    overall: FamilyMetrics;
    by_family: Partial<Record<QueryFamily, FamilyMetrics>>;
  } | null;
}

interface RunOptions {
  fixturePath?: string;
  artifactDir?: string;
  smoke?: boolean;
  maxCases?: number;
  families?: QueryFamily[];
  writeArtifacts?: boolean;
  now?: Date;
}

interface AblationResult {
  schema_version: "s108-retrieval-ablation.v1";
  generated_at: string;
  task_id: "S108-003";
  dataset: {
    name: "dev-workflow-60";
    path: string;
    sha256: string;
    total_cases: number;
    evaluated_cases: number;
    smoke_subset: boolean;
    families: QueryFamily[];
  };
  variants: VariantSummary[];
  summary: {
    best_available_variant: VariantId | null;
    unavailable_variants: Array<{ id: VariantId; reason: string }>;
  };
  artifacts: {
    summary_json: string | null;
    case_results_json: string | null;
    summary_md: string | null;
  };
}

const ROOT_DIR = resolve(import.meta.dir, "..");
const DEFAULT_FIXTURE = join(ROOT_DIR, "tests/benchmarks/fixtures/dev-workflow-60.json");
const DEFAULT_ARTIFACT_DIR = join(
  ROOT_DIR,
  "docs/benchmarks/artifacts/s108-retrieval-ablation-2026-05-07",
);

const REQUIRED_FAMILIES: QueryFamily[] = [
  "file",
  "branch",
  "pr",
  "issue",
  "migration",
  "deploy",
  "failing_test",
  "release",
  "setup",
  "doctor",
  "companion",
];

const BASE_FAMILIES: Record<string, QueryFamily> = {
  "dw-001": "file",
  "dw-002": "failing_test",
  "dw-003": "failing_test",
  "dw-004": "migration",
  "dw-005": "setup",
  "dw-006": "failing_test",
  "dw-007": "setup",
  "dw-008": "issue",
  "dw-009": "release",
  "dw-010": "failing_test",
  "dw-011": "file",
  "dw-012": "setup",
  "dw-013": "issue",
  "dw-014": "pr",
  "dw-015": "setup",
  "dw-016": "migration",
  "dw-017": "release",
  "dw-018": "pr",
  "dw-019": "failing_test",
  "dw-020": "issue",
};

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "did",
  "do",
  "for",
  "from",
  "has",
  "have",
  "how",
  "i",
  "in",
  "is",
  "it",
  "me",
  "of",
  "on",
  "or",
  "the",
  "to",
  "was",
  "we",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
]);

const QUERY_EXPANSIONS: Array<{ pattern: RegExp; additions: string[] }> = [
  { pattern: /\bpr\b|pull request/i, additions: ["pull", "request", "review", "merged"] },
  { pattern: /\bci\b|test|failing/i, additions: ["runner", "workflow", "failure", "passed"] },
  { pattern: /deploy|staging|production/i, additions: ["release", "promote", "rollback"] },
  { pattern: /doctor|health|diagnostic/i, additions: ["check", "status", "config", "path"] },
  { pattern: /setup|install|configuration/i, additions: ["config", "env", "bootstrap"] },
  { pattern: /branch/i, additions: ["codex", "opened", "started"] },
  { pattern: /issue|bug/i, additions: ["bug", "fix", "blocker", "regression"] },
  { pattern: /migration|schema/i, additions: ["column", "backfill", "database"] },
  { pattern: /release|version/i, additions: ["tag", "changelog", "publish"] },
  { pattern: /companion/i, additions: ["claude", "codex", "contract", "managed"] },
  { pattern: /file|inspect|edit/i, additions: ["src", "scripts", "docs", "test"] },
];

const VARIANTS: VariantDefinition[] = [
  {
    id: "lexical",
    label: "Lexical token overlap",
    status: "available",
    toggles: {
      lexical: true,
      vector: false,
      code_token: false,
      query_expansion: false,
      recency: false,
      entity: false,
      graph: false,
      fact_chain: false,
    },
  },
  {
    id: "code_token",
    label: "Code-aware tokenization",
    status: "available",
    toggles: {
      lexical: true,
      vector: false,
      code_token: true,
      query_expansion: false,
      recency: false,
      entity: false,
      graph: false,
      fact_chain: false,
    },
  },
  {
    id: "query_expansion",
    label: "Code tokens + query expansion",
    status: "available",
    toggles: {
      lexical: true,
      vector: false,
      code_token: true,
      query_expansion: true,
      recency: false,
      entity: false,
      graph: false,
      fact_chain: false,
    },
  },
  {
    id: "recency",
    label: "Query expansion + recency",
    status: "available",
    toggles: {
      lexical: true,
      vector: false,
      code_token: true,
      query_expansion: true,
      recency: true,
      entity: false,
      graph: false,
      fact_chain: false,
    },
  },
  {
    id: "entity",
    label: "Recency + entity overlap",
    status: "available",
    toggles: {
      lexical: true,
      vector: false,
      code_token: true,
      query_expansion: true,
      recency: true,
      entity: true,
      graph: false,
      fact_chain: false,
    },
  },
  {
    id: "graph",
    label: "Entity graph propagation",
    status: "available",
    toggles: {
      lexical: true,
      vector: false,
      code_token: true,
      query_expansion: true,
      recency: true,
      entity: true,
      graph: true,
      fact_chain: false,
    },
  },
  {
    id: "vector_full_baseline",
    label: "Vector/full baseline proxy",
    status: "available",
    toggles: {
      lexical: true,
      vector: true,
      code_token: true,
      query_expansion: true,
      recency: true,
      entity: true,
      graph: true,
      fact_chain: false,
    },
  },
  {
    id: "fact_chain",
    label: "Fact-chain temporal persistence",
    status: "not_available",
    unavailable_reason:
      "dev-workflow-60 does not carry fact-chain annotations, and S108-003 intentionally does not edit temporal persistence schema/core files",
    toggles: {
      lexical: false,
      vector: false,
      code_token: false,
      query_expansion: false,
      recency: false,
      entity: false,
      graph: false,
      fact_chain: true,
    },
  },
];

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function rel(path: string): string {
  const resolved = resolve(path);
  return resolved.startsWith(`${ROOT_DIR}/`) ? relative(ROOT_DIR, resolved) : resolved;
}

function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index] ?? 0;
}

function normalizeForTokens(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_./:@#-]+/g, " ")
    .toLowerCase();
}

function dedupe(tokens: string[]): string[] {
  return [...new Set(tokens.filter((token) => token && !STOPWORDS.has(token)))];
}

function simpleTokens(value: string): string[] {
  return dedupe(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1 || /^\d$/.test(token)),
  );
}

function codeTokens(value: string): string[] {
  const raw = normalizeForTokens(value)
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 || /^\d$/.test(token));
  const joined = value.toLowerCase();
  const extras: string[] = [];
  for (const match of joined.matchAll(/\bpr\s*#?\s*(\d+)\b/g)) {
    extras.push("pr", `pr${match[1]}`, match[1] || "");
  }
  for (const match of joined.matchAll(/\bissue\s*#?\s*(\d+)\b/g)) {
    extras.push("issue", `issue${match[1]}`, match[1] || "");
  }
  for (const match of joined.matchAll(/[a-z0-9_.-]+\/[a-z0-9_./-]+\.[a-z0-9]+/g)) {
    extras.push(match[0], ...match[0].split(/[/.]/g));
  }
  for (const match of joined.matchAll(/\bcodex\/[a-z0-9_.-]+/g)) {
    extras.push(match[0], ...match[0].split(/[/-]/g));
  }
  for (const match of joined.matchAll(/\b[A-Z][A-Z0-9_]{2,}\b/g)) {
    extras.push(match[0].toLowerCase());
  }
  return dedupe([...raw, ...extras]);
}

function expandQueryTokens(tokens: string[], query: string): string[] {
  const additions: string[] = [];
  for (const rule of QUERY_EXPANSIONS) {
    if (rule.pattern.test(query)) {
      additions.push(...rule.additions);
    }
  }
  return dedupe([...tokens, ...additions]);
}

function extractEntities(value: string): string[] {
  const entities: string[] = [];
  const lower = value.toLowerCase();
  for (const match of lower.matchAll(/[a-z0-9_.-]+\/[a-z0-9_./-]+\.[a-z0-9]+/g)) {
    entities.push(`path:${match[0]}`);
  }
  for (const match of lower.matchAll(/\bcodex\/[a-z0-9_.-]+/g)) {
    entities.push(`branch:${match[0]}`);
  }
  for (const match of lower.matchAll(/\bpr\s*#?\s*(\d+)\b/g)) {
    entities.push(`pr:${match[1]}`);
  }
  for (const match of lower.matchAll(/\bissue\s*#?\s*(\d+)\b/g)) {
    entities.push(`issue:${match[1]}`);
  }
  for (const match of value.matchAll(/\b[A-Z][A-Z0-9_]{2,}\b/g)) {
    entities.push(`env:${match[0].toLowerCase()}`);
  }
  for (const match of lower.matchAll(/\b[a-z0-9_.-]+\.(?:ts|tsx|js|json|md|yml|yaml|py|sh|sql)\b/g)) {
    entities.push(`file:${match[0]}`);
  }
  return dedupe(entities);
}

function familyForCase(dwCase: DevWorkflowCase): QueryFamily {
  return dwCase.query_family ?? dwCase.category ?? BASE_FAMILIES[dwCase.id] ?? "file";
}

function selectCases(
  cases: DevWorkflowCase[],
  options: Pick<RunOptions, "smoke" | "maxCases" | "families">,
): DevWorkflowCase[] {
  let selected = cases;
  if (options.families && options.families.length > 0) {
    const familySet = new Set(options.families);
    selected = selected.filter((dwCase) => familySet.has(familyForCase(dwCase)));
  }
  if (options.smoke) {
    const seen = new Set<QueryFamily>();
    selected = selected.filter((dwCase) => {
      const family = familyForCase(dwCase);
      if (seen.has(family)) return false;
      seen.add(family);
      return true;
    });
  }
  if (typeof options.maxCases === "number" && options.maxCases > 0) {
    selected = selected.slice(0, options.maxCases);
  }
  return selected;
}

function buildCorpus(cases: DevWorkflowCase[]): CorpusEntry[] {
  return cases.flatMap((dwCase) => {
    const family = familyForCase(dwCase);
    return dwCase.entries.map((entry) => ({
      id: `obs_${entry.id}`,
      raw_id: entry.id,
      case_id: dwCase.id,
      family,
      content: entry.content,
      timestamp: entry.timestamp,
      timestamp_ms: Date.parse(entry.timestamp),
      simple_tokens: simpleTokens(entry.content),
      code_tokens: codeTokens(entry.content),
      entities: extractEntities(entry.content),
    }));
  });
}

function buildIdf(corpus: CorpusEntry[], mode: "simple" | "code"): Map<string, number> {
  const df = new Map<string, number>();
  for (const entry of corpus) {
    const tokens = mode === "simple" ? entry.simple_tokens : entry.code_tokens;
    for (const token of new Set(tokens)) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }
  const total = Math.max(1, corpus.length);
  const idf = new Map<string, number>();
  for (const [token, count] of df.entries()) {
    idf.set(token, Math.log(1 + total / (1 + count)));
  }
  return idf;
}

function overlapScore(queryTokens: string[], docTokens: string[], idf: Map<string, number>): number {
  if (queryTokens.length === 0 || docTokens.length === 0) return 0;
  const docCounts = new Map<string, number>();
  for (const token of docTokens) {
    docCounts.set(token, (docCounts.get(token) ?? 0) + 1);
  }
  let score = 0;
  let denominator = 0;
  for (const token of queryTokens) {
    const weight = idf.get(token) ?? 1;
    denominator += weight;
    const count = docCounts.get(token) ?? 0;
    if (count > 0) {
      score += weight * (1 + Math.log(count));
    }
  }
  return denominator === 0 ? 0 : Math.min(1, score / denominator);
}

function vectorize(tokens: string[]): Map<string, number> {
  const vector = new Map<string, number>();
  for (const token of tokens) {
    vector.set(token, (vector.get(token) ?? 0) + 1);
    if (token.length >= 5) {
      for (let i = 0; i <= token.length - 3; i += 1) {
        const gram = `g:${token.slice(i, i + 3)}`;
        vector.set(gram, (vector.get(gram) ?? 0) + 0.2);
      }
    }
  }
  return vector;
}

function cosine(left: Map<string, number>, right: Map<string, number>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const value of left.values()) leftNorm += value * value;
  for (const value of right.values()) rightNorm += value * value;
  for (const [key, value] of left.entries()) {
    dot += value * (right.get(key) ?? 0);
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

function recencyFor(entry: CorpusEntry, corpus: CorpusEntry[]): number {
  const latest = Math.max(...corpus.map((candidate) => candidate.timestamp_ms));
  if (!Number.isFinite(entry.timestamp_ms) || !Number.isFinite(latest)) return 0;
  const ageDays = Math.max(0, (latest - entry.timestamp_ms) / (24 * 60 * 60 * 1000));
  return Math.exp(-ageDays / 30);
}

function entityScore(queryEntities: string[], docEntities: string[]): number {
  if (queryEntities.length === 0 || docEntities.length === 0) return 0;
  const docSet = new Set(docEntities);
  const hits = queryEntities.filter((entity) => docSet.has(entity)).length;
  return hits / queryEntities.length;
}

function buildEntityIndex(corpus: CorpusEntry[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const entry of corpus) {
    for (const entity of entry.entities) {
      const ids = index.get(entity) ?? new Set<string>();
      ids.add(entry.id);
      index.set(entity, ids);
    }
  }
  return index;
}

function graphScores(
  baseCandidates: ScoredCandidate[],
  corpusById: Map<string, CorpusEntry>,
  entityIndex: Map<string, Set<string>>,
): Map<string, number> {
  const scores = new Map<string, number>();
  const seeds = baseCandidates.slice(0, 5);
  for (const seed of seeds) {
    const seedEntry = corpusById.get(seed.id);
    if (!seedEntry) continue;
    for (const entity of seedEntry.entities) {
      const linked = entityIndex.get(entity);
      if (!linked) continue;
      for (const id of linked) {
        if (id === seed.id) continue;
        const existing = scores.get(id) ?? 0;
        scores.set(id, Math.max(existing, seed.score * 0.5));
      }
    }
  }
  return scores;
}

function rankCase(
  dwCase: DevWorkflowCase,
  variant: VariantDefinition,
  corpus: CorpusEntry[],
  indexes: {
    simpleIdf: Map<string, number>;
    codeIdf: Map<string, number>;
    entityIndex: Map<string, Set<string>>;
    corpusById: Map<string, CorpusEntry>;
  },
): ScoredCandidate[] {
  const mode = variant.toggles.code_token ? "code" : "simple";
  const baseQueryTokens = mode === "code" ? codeTokens(dwCase.query) : simpleTokens(dwCase.query);
  const queryTokens = variant.toggles.query_expansion
    ? expandQueryTokens(baseQueryTokens, dwCase.query)
    : baseQueryTokens;
  const idf = mode === "code" ? indexes.codeIdf : indexes.simpleIdf;
  const queryVector = vectorize(queryTokens);
  const queryEntities = extractEntities(dwCase.query);

  const prelim = corpus.map((entry) => {
    const docTokens = mode === "code" ? entry.code_tokens : entry.simple_tokens;
    const lexical = variant.toggles.lexical ? overlapScore(queryTokens, docTokens, idf) : 0;
    const vector = variant.toggles.vector ? cosine(queryVector, vectorize(entry.code_tokens)) : 0;
    const recency = variant.toggles.recency ? recencyFor(entry, corpus) : 0;
    const entity = variant.toggles.entity ? entityScore(queryEntities, entry.entities) : 0;
    const score =
      (variant.toggles.vector ? 0.32 : 0.76) * lexical +
      (variant.toggles.vector ? 0.34 * vector : 0) +
      (variant.toggles.recency ? 0.08 * recency : 0) +
      (variant.toggles.entity ? 0.18 * entity : 0);
    return {
      id: entry.id,
      score,
      signals: { lexical, vector, recency, entity, graph: 0 },
      timestamp_ms: entry.timestamp_ms,
    };
  });

  if (variant.toggles.graph) {
    const graph = graphScores(
      prelim.sort((a, b) => b.score - a.score || b.timestamp_ms - a.timestamp_ms || a.id.localeCompare(b.id)),
      indexes.corpusById,
      indexes.entityIndex,
    );
    for (const candidate of prelim) {
      const graphScore = graph.get(candidate.id) ?? 0;
      candidate.signals.graph = graphScore;
      candidate.score += 0.08 * graphScore;
    }
  }

  return prelim.sort((a, b) => b.score - a.score || b.timestamp_ms - a.timestamp_ms || a.id.localeCompare(b.id));
}

function recallAt10(retrievedIds: string[], expectedIds: string[]): number {
  if (expectedIds.length === 0) return 1;
  const top = new Set(retrievedIds.slice(0, 10));
  const hits = expectedIds.filter((id) => top.has(id)).length;
  return hits / expectedIds.length;
}

function mrr(retrievedIds: string[], expectedIds: string[]): number {
  const expected = new Set(expectedIds);
  const index = retrievedIds.findIndex((id) => expected.has(id));
  return index === -1 ? 0 : 1 / (index + 1);
}

function classifyMiss(
  dwCase: DevWorkflowCase,
  ranked: ScoredCandidate[],
  expectedIds: string[],
  recall: number,
): MissReason {
  if (recall >= 1) return "none";
  const top10 = ranked.slice(0, 10).map((candidate) => candidate.id);
  const anyHit = expectedIds.some((id) => top10.includes(id));
  const expectedCandidates = ranked.filter((candidate) => expectedIds.includes(candidate.id));
  const expectedPositive = expectedCandidates.some((candidate) => candidate.score > 0);
  if (!expectedPositive) return "retrieval_miss";
  if (!anyHit && /\b[A-Za-z0-9_.-]+\/|#\d+|[A-Z][A-Z0-9_]{2,}|[a-z]+[A-Z]/.test(dwCase.query)) {
    return "query_tokenization_gap";
  }
  const top = ranked[0];
  const newestExpected = Math.max(...expectedCandidates.map((candidate) => candidate.timestamp_ms));
  if (top && !expectedIds.includes(top.id) && top.timestamp_ms > newestExpected) {
    return "stale_fact_win";
  }
  return "ranking_miss";
}

function summarizeCaseResults(results: CaseResult[]): FamilyMetrics {
  const missCounts = new Map<MissReason, number>();
  for (const result of results) {
    if (result.miss_reason !== "none") {
      missCounts.set(result.miss_reason, (missCounts.get(result.miss_reason) ?? 0) + 1);
    }
  }
  const topMiss = [...missCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return {
    cases: results.length,
    recall_at_10: round(mean(results.map((result) => result.recall_at_10))),
    mrr: round(mean(results.map((result) => result.mrr))),
    p95_ms: round(p95(results.map((result) => result.latency_ms))),
    top_miss_reason: topMiss?.[0] ?? null,
  };
}

function evaluateVariant(
  variant: VariantDefinition,
  cases: DevWorkflowCase[],
  corpus: CorpusEntry[],
): { summary: VariantSummary; cases: CaseResult[] } {
  if (variant.status === "not_available") {
    return {
      summary: {
        id: variant.id,
        label: variant.label,
        status: variant.status,
        unavailable_reason: variant.unavailable_reason,
        toggles: variant.toggles,
        metrics: null,
      },
      cases: [],
    };
  }

  const indexes = {
    simpleIdf: buildIdf(corpus, "simple"),
    codeIdf: buildIdf(corpus, "code"),
    entityIndex: buildEntityIndex(corpus),
    corpusById: new Map(corpus.map((entry) => [entry.id, entry])),
  };
  const caseResults: CaseResult[] = [];

  for (const dwCase of cases) {
    const startedAt = performance.now();
    const ranked = rankCase(dwCase, variant, corpus, indexes);
    const latency = performance.now() - startedAt;
    const retrievedIds = ranked.slice(0, 10).map((candidate) => candidate.id);
    const expectedIds = dwCase.relevant_ids.map((id) => `obs_${id}`);
    const recall = recallAt10(retrievedIds, expectedIds);
    caseResults.push({
      case_id: dwCase.id,
      family: familyForCase(dwCase),
      query: dwCase.query,
      expected_ids: expectedIds,
      retrieved_ids: retrievedIds,
      recall_at_10: round(recall),
      mrr: round(mrr(ranked.map((candidate) => candidate.id), expectedIds)),
      latency_ms: round(latency, 6),
      miss_reason: classifyMiss(dwCase, ranked, expectedIds, recall),
    });
  }

  const byFamily: Partial<Record<QueryFamily, FamilyMetrics>> = {};
  for (const family of REQUIRED_FAMILIES) {
    const familyResults = caseResults.filter((result) => result.family === family);
    if (familyResults.length > 0) {
      byFamily[family] = summarizeCaseResults(familyResults);
    }
  }

  return {
    summary: {
      id: variant.id,
      label: variant.label,
      status: variant.status,
      toggles: variant.toggles,
      metrics: {
        overall: summarizeCaseResults(caseResults),
        by_family: byFamily,
      },
    },
    cases: caseResults,
  };
}

function renderSummaryMarkdown(result: AblationResult): string {
  const lines = [
    "# S108 Retrieval Ablation",
    "",
    `Generated: ${result.generated_at}`,
    `Fixture: ${result.dataset.path}`,
    `Cases: ${result.dataset.evaluated_cases}${result.dataset.smoke_subset ? " (smoke)" : ""}`,
    "",
    "| variant | status | recall@10 | MRR | p95 ms | top miss reason |",
    "|---|---:|---:|---:|---:|---|",
  ];
  for (const variant of result.variants) {
    const metrics = variant.metrics?.overall;
    lines.push(
      [
        variant.id,
        variant.status,
        metrics ? metrics.recall_at_10.toFixed(4) : "-",
        metrics ? metrics.mrr.toFixed(4) : "-",
        metrics ? metrics.p95_ms.toFixed(4) : "-",
        metrics?.top_miss_reason ?? variant.unavailable_reason ?? "-",
      ].join(" | ").replace(/^/, "| ").replace(/$/g, " |"),
    );
  }
  lines.push("");
  lines.push("## Per-Family Metrics");
  for (const variant of result.variants.filter((entry) => entry.metrics)) {
    lines.push("");
    lines.push(`### ${variant.id}`);
    lines.push("| family | cases | recall@10 | MRR | p95 ms | top miss reason |");
    lines.push("|---|---:|---:|---:|---:|---|");
    for (const family of result.dataset.families) {
      const metrics = variant.metrics?.by_family[family];
      if (!metrics) continue;
      lines.push(
        `| ${family} | ${metrics.cases} | ${metrics.recall_at_10.toFixed(4)} | ${metrics.mrr.toFixed(4)} | ${metrics.p95_ms.toFixed(4)} | ${metrics.top_miss_reason ?? "-"} |`,
      );
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function runRetrievalAblation(options: RunOptions = {}): {
  result: AblationResult;
  caseResults: Record<string, CaseResult[]>;
} {
  const fixturePath = resolve(options.fixturePath ?? DEFAULT_FIXTURE);
  const artifactDir = resolve(options.artifactDir ?? DEFAULT_ARTIFACT_DIR);
  const allCases = readJson<DevWorkflowCase[]>(fixturePath);
  const cases = selectCases(allCases, options);
  const corpus = buildCorpus(cases);
  const variants = VARIANTS.map((variant) => evaluateVariant(variant, cases, corpus));
  const summaries = variants.map((entry) => entry.summary);
  const available = summaries.filter((entry) => entry.status === "available" && entry.metrics);
  const best = available.sort((a, b) => {
    const left = a.metrics?.overall.recall_at_10 ?? 0;
    const right = b.metrics?.overall.recall_at_10 ?? 0;
    if (right !== left) return right - left;
    return (b.metrics?.overall.mrr ?? 0) - (a.metrics?.overall.mrr ?? 0);
  })[0];

  const artifactPaths = options.writeArtifacts === false
    ? { summary_json: null, case_results_json: null, summary_md: null }
    : {
        summary_json: join(artifactDir, "summary.json"),
        case_results_json: join(artifactDir, "case-results.json"),
        summary_md: join(artifactDir, "summary.md"),
      };

  const result: AblationResult = {
    schema_version: "s108-retrieval-ablation.v1",
    generated_at: (options.now ?? new Date()).toISOString(),
    task_id: "S108-003",
    dataset: {
      name: "dev-workflow-60",
      path: rel(fixturePath),
      sha256: sha256File(fixturePath),
      total_cases: allCases.length,
      evaluated_cases: cases.length,
      smoke_subset: Boolean(options.smoke),
      families: [...new Set(cases.map(familyForCase))].sort() as QueryFamily[],
    },
    variants: summaries,
    summary: {
      best_available_variant: best?.id ?? null,
      unavailable_variants: summaries
        .filter((entry) => entry.status === "not_available")
        .map((entry) => ({ id: entry.id, reason: entry.unavailable_reason ?? "not available" })),
    },
    artifacts: {
      summary_json: artifactPaths.summary_json ? rel(artifactPaths.summary_json) : null,
      case_results_json: artifactPaths.case_results_json ? rel(artifactPaths.case_results_json) : null,
      summary_md: artifactPaths.summary_md ? rel(artifactPaths.summary_md) : null,
    },
  };

  const caseResults = Object.fromEntries(variants.map((entry) => [entry.summary.id, entry.cases]));

  if (options.writeArtifacts !== false) {
    writeJson(artifactPaths.summary_json!, result);
    writeJson(artifactPaths.case_results_json!, {
      schema_version: "s108-retrieval-ablation-cases.v1",
      generated_at: result.generated_at,
      dataset: result.dataset,
      variants: caseResults,
    });
    mkdirSync(dirname(artifactPaths.summary_md!), { recursive: true });
    writeFileSync(artifactPaths.summary_md!, renderSummaryMarkdown(result));
  }

  return { result, caseResults };
}

function parseArgs(argv: string[]): RunOptions {
  const options: RunOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--fixture" && argv[i + 1]) {
      options.fixturePath = argv[++i];
    } else if (token === "--artifact-dir" && argv[i + 1]) {
      options.artifactDir = argv[++i];
    } else if (token === "--smoke" || token === "--ci-smoke") {
      options.smoke = true;
    } else if (token === "--max-cases" && argv[i + 1]) {
      options.maxCases = Number(argv[++i]);
    } else if (token === "--families" && argv[i + 1]) {
      options.families = argv[++i]
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry): entry is QueryFamily => REQUIRED_FAMILIES.includes(entry as QueryFamily));
    } else if (token === "--no-write") {
      options.writeArtifacts = false;
    } else if (token === "--help" || token === "-h") {
      process.stdout.write(
        [
          "Usage: scripts/s108-retrieval-ablation.sh [--smoke] [--artifact-dir DIR]",
          "",
          "Options:",
          "  --fixture PATH       Fixture JSON path (default: tests/benchmarks/fixtures/dev-workflow-60.json)",
          "  --artifact-dir DIR   Artifact output dir",
          "  --smoke              One case per query family for CI smoke",
          "  --max-cases N        Evaluate first N selected cases",
          "  --families LIST      Comma-separated query families",
          "  --no-write           Emit JSON without writing artifacts",
          "",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${token}`);
    }
  }
  return options;
}

if (import.meta.main) {
  try {
    const { result } = runRetrievalAblation(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[s108-retrieval-ablation] ${message}\n`);
    process.exit(1);
  }
}

export type {
  AblationResult,
  CaseResult,
  DevWorkflowCase,
  FamilyMetrics,
  QueryFamily,
  RunOptions,
  VariantSummary,
};
