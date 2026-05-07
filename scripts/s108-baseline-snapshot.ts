import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { BenchmarkRunner } from "../memory-server/src/benchmark/runner";
import {
  collectTemporalAnchorReferenceTexts,
  resolveBenchEmbeddingProfile,
  type BenchEmbeddingProfile,
} from "../memory-server/src/benchmark/run-ci";
import { HarnessMemCore, type Config } from "../memory-server/src/core/harness-mem-core";
import { findModelById } from "../memory-server/src/embedding/model-catalog";
import { buildJapaneseReleaseReport } from "../tests/benchmarks/japanese-release-report";
import { buildLocomoFailureBacklog } from "../tests/benchmarks/locomo-failure-backlog";
import { runLocomoBenchmark, type LocomoBenchmarkResult } from "../tests/benchmarks/run-locomo-benchmark";

type TaxonomyReason =
  | "retrieval_miss"
  | "ranking_miss"
  | "temporal_anchor_miss"
  | "stale_fact_win"
  | "answer_synthesis_miss";

interface CliOptions {
  artifactDir: string;
}

interface CacheStatsSummary {
  available: boolean;
  before: Record<string, number>;
  after: Record<string, number>;
  delta: Record<string, number>;
}

interface DevWorkflowEntry {
  id: string;
  content: string;
  timestamp: string;
}

interface DevWorkflowCase {
  id: string;
  description: string;
  difficulty: string;
  entries: DevWorkflowEntry[];
  query: string;
  expected_answer: string;
  relevant_ids: string[];
}

interface TemporalEntry {
  id: string;
  content: string;
  timestamp: string;
}

interface TemporalCase {
  id: string;
  description: string;
  entries: TemporalEntry[];
  query: string;
  expected_order: string[];
  domain?: string;
}

interface SearchCaseResult {
  benchmark: "dev_workflow" | "temporal";
  case_id: string;
  description: string;
  query: string;
  expected_ids: string[];
  retrieved_ids: string[];
  score: number;
  secondary_scores?: Record<string, number>;
  taxonomy_reason?: TaxonomyReason;
  note: string;
}

interface JapaneseFailureResult {
  benchmark: "japanese_temporal";
  case_id: string;
  sample_id: string;
  question_id: string;
  slice: string;
  question: string;
  answer: string;
  prediction: string;
  f1: number;
  em: number;
  selected_evidence_ids: string[];
  taxonomy_reason: TaxonomyReason;
  note: string;
}

interface SnapshotSummary {
  schema_version: "s108-baseline-snapshot-v1";
  generated_at: string;
  task_id: "S108-001";
  artifact_dir: string;
  scope: {
    classification: "Local task / Cross-Read";
    owner_repo: "harness-mem";
    mutates_state_contract: false;
    mutates_runtime_state: false;
    impacted_repos: string[];
  };
  runner_contract: {
    dev_workflow: string;
    temporal: string;
    japanese_temporal: string;
  };
  fixtures: Record<string, { path: string; sha256: string }>;
  embedding: {
    mode: string;
    provider: string;
    model: string;
    vector_dimension: number;
    onnx_gate: boolean;
    prime_enabled: boolean;
  };
  metrics: {
    dev_workflow: {
      recall_at_10: number;
      cases: number;
      bootstrap_ci_95: ReturnType<BenchmarkRunner["bootstrapCI"]>;
      expected_anchor: number;
      within_known_drift: boolean;
    };
    temporal: {
      order_score: number;
      weighted_tau: number;
      ndcg_at_5: number;
      cases: number;
      bootstrap_ci_95: ReturnType<BenchmarkRunner["bootstrapCI"]>;
      expected_anchor: number;
      within_known_drift: boolean;
      domain_breakdown: Record<string, { tau: number; n: number }>;
    };
    japanese_temporal: {
      dataset_qa_count: number;
      overall_f1: number;
      temporal_f1: number;
      relative_temporal_f1: number;
      current_vs_previous_f1: number;
      yes_no_f1: number;
      zero_f1_count: number;
    };
  };
  taxonomy_summary: {
    by_reason: Record<TaxonomyReason, number>;
    by_benchmark: Record<string, Record<TaxonomyReason, number>>;
  };
  source_files: Record<string, string>;
  state_migration_preflight: {
    applicable: false;
    reason: string;
    invariants_not_touched: string[];
    rollback: string;
    observation_points: string[];
  };
}

const ROOT_DIR = resolve(import.meta.dir, "..");
const DEV_WORKFLOW_FIXTURE = join(ROOT_DIR, "tests/benchmarks/fixtures/dev-workflow-20.json");
const TEMPORAL_FIXTURE = join(ROOT_DIR, "tests/benchmarks/fixtures/temporal-100-v2.json");
const JAPANESE_FIXTURE = join(ROOT_DIR, "tests/benchmarks/fixtures/japanese-release-pack-96.json");

function parseArgs(argv: string[]): CliOptions {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  let artifactDir = join(ROOT_DIR, "docs/benchmarks/artifacts", `s108-baseline-${stamp}`);

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--artifact-dir" && i + 1 < argv.length) {
      artifactDir = argv[i + 1] || artifactDir;
      i += 1;
    }
  }

  return { artifactDir: resolve(artifactDir) };
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function sha256File(path: string): string {
  const raw = readFileSync(path);
  return createHash("sha256").update(raw).digest("hex");
}

export function rel(path: string): string {
  if (path === ROOT_DIR) return ".";
  return path.startsWith(`${ROOT_DIR}/`) ? path.slice(ROOT_DIR.length + 1) : path;
}

export function relativizeArtifactValue<T>(value: T): T {
  if (typeof value === "string") {
    return rel(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => relativizeArtifactValue(entry)) as T;
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        relativizeArtifactValue(entry),
      ])
    ) as T;
  }
  return value;
}

function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function escapeMd(value: unknown): string {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "/")
    .trim();
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsAnswer(text: string, answer: string): boolean {
  const normalizedText = normalizeText(text);
  const normalizedAnswer = normalizeText(answer);
  if (!normalizedAnswer) return false;
  if (normalizedText.includes(normalizedAnswer)) return true;
  const answerTokens = normalizedAnswer.split(" ").filter((token) => token.length > 1);
  if (answerTokens.length === 0) return false;
  const hits = answerTokens.filter((token) => normalizedText.includes(token)).length;
  return hits / answerTokens.length >= 0.75;
}

function isTemporalQuery(query: string): boolean {
  return /\b(after|before|when|latest|current|previous|first|last|still|no longer|right after|now)\b|今|以前|直後|前|後|最新|最初/.test(
    query.toLowerCase()
  );
}

function emptyTaxonomyCounts(): Record<TaxonomyReason, number> {
  return {
    retrieval_miss: 0,
    ranking_miss: 0,
    temporal_anchor_miss: 0,
    stale_fact_win: 0,
    answer_synthesis_miss: 0,
  };
}

function incrementTaxonomy(
  target: Record<TaxonomyReason, number>,
  reason: TaxonomyReason | undefined
): void {
  if (reason) {
    target[reason] = (target[reason] || 0) + 1;
  }
}

function applyBenchEnv(profile: BenchEmbeddingProfile): void {
  process.env.HARNESS_MEM_DECAY_DISABLED = "1";
  process.env.HARNESS_MEM_RERANKER_ENABLED = "1";
  process.env.HARNESS_BENCH_EMBEDDING_MODE = profile.mode;
  process.env.HARNESS_MEM_EMBEDDING_PROVIDER = profile.provider;
  process.env.HARNESS_MEM_EMBEDDING_MODEL = profile.model;
  if (profile.adaptive) {
    process.env.HARNESS_MEM_ADAPTIVE_JA_THRESHOLD = String(profile.adaptive.jaThreshold);
    process.env.HARNESS_MEM_ADAPTIVE_CODE_THRESHOLD = String(profile.adaptive.codeThreshold);
  } else {
    delete process.env.HARNESS_MEM_ADAPTIVE_JA_THRESHOLD;
    delete process.env.HARNESS_MEM_ADAPTIVE_CODE_THRESHOLD;
  }
}

function createCore(profile: BenchEmbeddingProfile): { core: HarnessMemCore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "s108-bench-"));
  const config: Config = {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 0,
    vectorDimension: profile.vectorDimension,
    embeddingProvider: profile.provider,
    adaptiveJaThreshold: profile.adaptive?.jaThreshold,
    adaptiveCodeThreshold: profile.adaptive?.codeThreshold,
    captureEnabled: true,
    retrievalEnabled: true,
    injectionEnabled: true,
    codexHistoryEnabled: false,
    codexProjectRoot: ROOT_DIR,
    codexSessionsRoot: ROOT_DIR,
    codexIngestIntervalMs: 5000,
    codexBackfillHours: 24,
    opencodeIngestEnabled: false,
    cursorIngestEnabled: false,
    antigravityIngestEnabled: false,
  };
  const core = new HarnessMemCore(config);
  verifyEmbeddingGate(core, profile);
  return { core, dir };
}

function verifyEmbeddingGate(core: HarnessMemCore, profile: BenchEmbeddingProfile): void {
  if (!profile.gateEnabled) return;
  const health = core.health();
  const item = toRecord(health.items?.[0]);
  const features = toRecord(item.features);
  const runtime = {
    provider: String(features.embedding_provider || item.embedding_provider || ""),
    model: String(features.embedding_model || ""),
  };
  const failures: string[] = [];
  if (runtime.provider !== profile.provider) {
    failures.push(`provider=${String(runtime.provider || "unknown")} expected=${profile.provider}`);
  }
  if (profile.mode === "onnx") {
    if (runtime.model !== profile.model) {
      failures.push(`model=${String(runtime.model || "unknown")} expected=${profile.model}`);
    }
    const catalog = findModelById(profile.model);
    if (!catalog) {
      failures.push(`unknown model=${profile.model}`);
    } else if (catalog.dimension !== profile.vectorDimension) {
      failures.push(`vector_dimension=${profile.vectorDimension} expected=${catalog.dimension}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`embedding gate failed: ${failures.join(", ")}`);
  }
}

async function ensureEmbeddingReady(core: HarnessMemCore, label: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastDetails = "embedding readiness timeout";

  while (Date.now() < deadline) {
    const readiness = core.readiness();
    const item = toRecord(readiness.items?.[0]);
    if (item.ready === true) return;
    lastDetails = String(
      item.embedding_provider_details ||
        item.embedding_readiness_state ||
        item.status ||
        lastDetails
    );
    if (item.embedding_readiness_state === "failed") {
      throw new Error(`[${label}] embedding readiness failed: ${lastDetails}`);
    }
    try {
      await core.primeEmbedding("__s108_bench_ready__", "passage");
      await core.primeEmbedding("__s108_bench_ready__", "query");
    } catch {
      // Poll again until ready or timeout.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }

  throw new Error(`[${label}] embedding readiness timeout: ${lastDetails}`);
}

async function maybePrimeEmbedding(
  core: HarnessMemCore,
  texts: string[],
  mode: "passage" | "query",
  profile: BenchEmbeddingProfile
): Promise<void> {
  if (!profile.primeEnabled) return;
  const unique = [...new Set(texts.map((text) => text.trim()).filter(Boolean))];
  for (const text of unique) {
    await core.primeEmbedding(text, mode);
  }
}

async function recordBenchEvent(
  core: HarnessMemCore,
  event: {
    event_id: string;
    platform: string;
    project: string;
    session_id: string;
    event_type: string;
    ts: string;
    payload: Record<string, unknown>;
    tags: string[];
    privacy_tags: string[];
  }
): Promise<void> {
  const result = await core.recordEventQueued(event, { allowQueue: false });
  if (result === "queue_full") {
    throw new Error(`benchmark write queue unexpectedly full for ${event.event_id}`);
  }
  if (!result.ok) {
    throw new Error(`benchmark event write failed for ${event.event_id}: ${result.error || "unknown"}`);
  }
}

async function runPreparedSearch(
  core: HarnessMemCore,
  request: Parameters<HarnessMemCore["search"]>[0]
): Promise<Record<string, unknown>[]> {
  const result = await core.searchPrepared(request);
  const record = toRecord(result);
  if (record.ok === false) {
    throw new Error(String(record.error || "unknown search error"));
  }
  return Array.isArray(record.items) ? (record.items as Record<string, unknown>[]) : [];
}

function flattenNumericStats(input: Record<string, unknown>, prefix = ""): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(input)) {
    const qualified = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "number" && Number.isFinite(value)) {
      out[qualified] = value;
      continue;
    }
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      Object.assign(out, flattenNumericStats(value as Record<string, unknown>, qualified));
    }
  }
  return out;
}

function readCacheStats(core: HarnessMemCore): Record<string, unknown> | null {
  try {
    const runtime = toRecord(core.getEmbeddingRuntimeInfo());
    const stats = toRecord(runtime.cacheStats);
    return Object.keys(stats).length > 0 ? stats : null;
  } catch {
    return null;
  }
}

function summarizeCacheStats(beforeRaw: Record<string, unknown> | null, afterRaw: Record<string, unknown> | null): CacheStatsSummary {
  const before = beforeRaw ? flattenNumericStats(beforeRaw) : {};
  const after = afterRaw ? flattenNumericStats(afterRaw) : {};
  const delta: Record<string, number> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    delta[key] = (after[key] ?? 0) - (before[key] ?? 0);
  }
  return { available: beforeRaw !== null || afterRaw !== null, before, after, delta };
}

function classifySearchFailure(
  benchmark: "dev_workflow" | "temporal",
  query: string,
  expectedIds: string[],
  retrievedIds: string[],
  score: number
): { reason?: TaxonomyReason; note: string } {
  if (score >= 1) return { note: "all expected evidence was retrieved in the expected condition" };
  const hits = expectedIds.filter((id) => retrievedIds.includes(id));
  if (hits.length === 0) {
    return {
      reason: "retrieval_miss",
      note: "no expected observation appeared in the top 10 result set",
    };
  }
  if (benchmark === "temporal" || isTemporalQuery(query)) {
    return {
      reason: "temporal_anchor_miss",
      note: "expected evidence was present, but ordering or temporal anchoring did not match the fixture",
    };
  }
  return {
    reason: "ranking_miss",
    note: "some expected evidence appeared in top 10, but recall or top-rank placement was incomplete",
  };
}

async function runDevWorkflowDetailed(profile: BenchEmbeddingProfile): Promise<{
  metric: number;
  ci: ReturnType<BenchmarkRunner["bootstrapCI"]>;
  cases: SearchCaseResult[];
  cacheStats: CacheStatsSummary;
}> {
  const { core, dir } = createCore(profile);
  const runner = new BenchmarkRunner(core as unknown as ConstructorParameters<typeof BenchmarkRunner>[0]);
  try {
    const cases = readJson<DevWorkflowCase[]>(DEV_WORKFLOW_FIXTURE);
    const project = "ci-dev-workflow";
    const cacheBefore = readCacheStats(core);
    await ensureEmbeddingReady(core, "s108-dev-workflow");
    await maybePrimeEmbedding(core, cases.flatMap((dwCase) => dwCase.entries.map((entry) => entry.content)), "passage", profile);

    for (const dwCase of cases) {
      for (const entry of dwCase.entries) {
        await recordBenchEvent(core, {
          event_id: entry.id,
          platform: "claude",
          project,
          session_id: `dw-session-${dwCase.id}`,
          event_type: "user_prompt",
          ts: entry.timestamp,
          payload: { content: entry.content },
          tags: [],
          privacy_tags: [],
        });
      }
    }

    await maybePrimeEmbedding(core, cases.map((dwCase) => dwCase.query), "query", profile);

    const perCaseScores: number[] = [];
    const results: SearchCaseResult[] = [];
    for (const dwCase of cases) {
      const items = await runPreparedSearch(core, {
        query: dwCase.query,
        project,
        include_private: true,
        limit: 10,
      });
      const retrievedIds = items.map((item) => String(item.id || ""));
      const expectedIds = dwCase.relevant_ids.map((id) => `obs_${id}`);
      const recall = runner.calculateRecallAtK(retrievedIds, expectedIds, 10);
      perCaseScores.push(recall);
      const classification = classifySearchFailure("dev_workflow", dwCase.query, expectedIds, retrievedIds, recall);
      results.push({
        benchmark: "dev_workflow",
        case_id: dwCase.id,
        description: dwCase.description,
        query: dwCase.query,
        expected_ids: expectedIds,
        retrieved_ids: retrievedIds.slice(0, 10),
        score: recall,
        taxonomy_reason: classification.reason,
        note: classification.note,
      });
    }

    const metric = perCaseScores.reduce((sum, value) => sum + value, 0) / perCaseScores.length;
    return {
      metric,
      ci: runner.bootstrapCI(perCaseScores),
      cases: results,
      cacheStats: summarizeCacheStats(cacheBefore, readCacheStats(core)),
    };
  } finally {
    core.shutdown("s108-dev-workflow");
    rmSync(dir, { recursive: true, force: true });
  }
}

async function runTemporalDetailed(profile: BenchEmbeddingProfile): Promise<{
  orderScore: number;
  weightedTau: number;
  ndcgAt5: number;
  ci: ReturnType<BenchmarkRunner["bootstrapCI"]>;
  cases: SearchCaseResult[];
  domainBreakdown: Record<string, { tau: number; n: number }>;
  cacheStats: CacheStatsSummary;
}> {
  const { core, dir } = createCore(profile);
  const runner = new BenchmarkRunner(core as unknown as ConstructorParameters<typeof BenchmarkRunner>[0]);
  try {
    const cases = readJson<TemporalCase[]>(TEMPORAL_FIXTURE);
    const project = "ci-temporal";
    const cacheBefore = readCacheStats(core);
    await ensureEmbeddingReady(core, "s108-temporal");

    for (const tCase of cases) {
      const caseProject = `${project}-${tCase.id}`;
      await maybePrimeEmbedding(core, tCase.entries.map((entry) => entry.content), "passage", profile);
      await maybePrimeEmbedding(core, [tCase.query, ...collectTemporalAnchorReferenceTexts(tCase.query)], "query", profile);
      for (const entry of tCase.entries) {
        await recordBenchEvent(core, {
          event_id: entry.id,
          platform: "claude",
          project: caseProject,
          session_id: `temporal-session-${tCase.id}`,
          event_type: "user_prompt",
          ts: entry.timestamp,
          payload: { content: entry.content },
          tags: [],
          privacy_tags: [],
        });
      }
    }

    const orderScores: number[] = [];
    const weightedTauScores: number[] = [];
    const ndcgScores: number[] = [];
    const domainScores: Record<string, number[]> = {};
    const results: SearchCaseResult[] = [];

    for (const tCase of cases) {
      const caseProject = `${project}-${tCase.id}`;
      await maybePrimeEmbedding(core, [tCase.query, ...collectTemporalAnchorReferenceTexts(tCase.query)], "query", profile);
      const items = await runPreparedSearch(core, {
        query: tCase.query,
        project: caseProject,
        include_private: true,
        limit: 10,
        question_kind: "timeline",
      });
      const retrievedIds = items.map((item) => String(item.id || ""));
      const expectedIds = tCase.expected_order.map((id) => `obs_${id}`);
      const orderScore = runner.calculateTemporalOrderScore(retrievedIds, expectedIds, 10);
      const weightedTau = runner.calculateWeightedKendallTau(retrievedIds, expectedIds, 10);
      const ndcgAt5 = runner.calculateNDCGAtK(retrievedIds, expectedIds, 5);
      orderScores.push(orderScore);
      weightedTauScores.push(weightedTau);
      ndcgScores.push(ndcgAt5);
      if (tCase.domain) {
        domainScores[tCase.domain] = [...(domainScores[tCase.domain] || []), weightedTau];
      }
      const classification = classifySearchFailure("temporal", tCase.query, expectedIds, retrievedIds, orderScore);
      results.push({
        benchmark: "temporal",
        case_id: tCase.id,
        description: tCase.description,
        query: tCase.query,
        expected_ids: expectedIds,
        retrieved_ids: retrievedIds.slice(0, 10),
        score: orderScore,
        secondary_scores: { weighted_tau: weightedTau, ndcg_at_5: ndcgAt5 },
        taxonomy_reason: classification.reason,
        note: classification.note,
      });
    }

    const domainBreakdown = Object.fromEntries(
      Object.entries(domainScores).map(([domain, values]) => [
        domain,
        { tau: values.reduce((sum, value) => sum + value, 0) / values.length, n: values.length },
      ])
    );
    return {
      orderScore: orderScores.reduce((sum, value) => sum + value, 0) / orderScores.length,
      weightedTau: weightedTauScores.reduce((sum, value) => sum + value, 0) / weightedTauScores.length,
      ndcgAt5: ndcgScores.reduce((sum, value) => sum + value, 0) / ndcgScores.length,
      ci: runner.bootstrapCI(weightedTauScores),
      cases: results,
      domainBreakdown,
      cacheStats: summarizeCacheStats(cacheBefore, readCacheStats(core)),
    };
  } finally {
    core.shutdown("s108-temporal");
    rmSync(dir, { recursive: true, force: true });
  }
}

interface JapaneseMeta {
  sample_id: string;
  question_id: string;
  slice: string;
  cross_lingual: boolean;
}

function buildJapaneseMeta(datasetPath: string): {
  byKey: Map<string, JapaneseMeta>;
  previousAnswersBySample: Map<string, string[]>;
} {
  const samples = readJson<Array<{ sample_id: string; qa?: Array<{ question_id: string; answer: string; slice?: string; cross_lingual?: boolean }> }>>(datasetPath);
  const byKey = new Map<string, JapaneseMeta>();
  const previousAnswersBySample = new Map<string, string[]>();
  for (const sample of samples) {
    for (const qa of sample.qa || []) {
      const slice = String(qa.slice || "unlabeled");
      byKey.set(`${sample.sample_id}::${qa.question_id}`, {
        sample_id: sample.sample_id,
        question_id: qa.question_id,
        slice,
        cross_lingual: qa.cross_lingual === true,
      });
      if (slice === "current_vs_previous") {
        previousAnswersBySample.set(sample.sample_id, [
          ...(previousAnswersBySample.get(sample.sample_id) || []),
          qa.answer,
        ]);
      }
    }
  }
  return { byKey, previousAnswersBySample };
}

function selectedCandidateText(record: Record<string, unknown>): string {
  const answerTrace = toRecord(record.answer_trace);
  const extraction = toRecord(answerTrace.extraction);
  const candidates = Array.isArray(extraction.selected_candidates)
    ? (extraction.selected_candidates as Record<string, unknown>[])
    : [];
  return candidates.map((candidate) => String(candidate.sentence || "")).join(" ");
}

function isStaleFactWin(record: Record<string, unknown>, meta: JapaneseMeta | undefined, previousAnswers: string[]): boolean {
  if (!meta) return false;
  const prediction = String(record.prediction || "");
  const answer = String(record.answer || "");
  const slice = meta.slice;
  if (answer.toLowerCase() === "no") {
    const normalized = normalizeText(prediction);
    const saysNo = /\bno\b|いいえ|ではない|使っていません|ありません/.test(normalized);
    const saysYes = /\byes\b|はい|使っています|です|している/.test(normalized);
    if (saysYes && !saysNo) return true;
  }
  if (slice !== "current" && slice !== "yes_no" && slice !== "long_turn") return false;
  return previousAnswers.some((previous) => containsAnswer(prediction, previous) && !containsAnswer(prediction, answer));
}

function classifyJapaneseFailure(record: Record<string, unknown>, meta: JapaneseMeta | undefined, previousAnswers: string[]): {
  reason: TaxonomyReason;
  note: string;
} {
  const slice = meta?.slice || "unlabeled";
  const question = String(record.question || "");
  const answer = String(record.answer || "");
  const prediction = String(record.prediction || "");
  const selectedEvidence = Array.isArray(record.selected_evidence_ids) ? record.selected_evidence_ids : [];
  const candidateText = selectedCandidateText(record);
  const answerInCandidates = containsAnswer(candidateText, answer);

  if (isStaleFactWin(record, meta, previousAnswers)) {
    return {
      reason: "stale_fact_win",
      note: "a current or yes/no question appears to prefer a superseded value",
    };
  }
  if (["temporal", "relative_temporal", "current_vs_previous", "yes_no"].includes(slice) || isTemporalQuery(question)) {
    if (!answerInCandidates) {
      return {
        reason: "temporal_anchor_miss",
        note: "the failure sits in a temporal/current-vs-previous slice and the selected candidates do not clearly contain the target answer",
      };
    }
  }
  if (selectedEvidence.length === 0) {
    return {
      reason: "retrieval_miss",
      note: "answer generation had no selected evidence ids",
    };
  }
  if (answerInCandidates && !containsAnswer(prediction, answer)) {
    return {
      reason: "answer_synthesis_miss",
      note: "the target answer appears in selected candidates, but the final answer did not preserve it",
    };
  }
  if (!answerInCandidates) {
    return {
      reason: "ranking_miss",
      note: "selected evidence exists, but the selected candidates do not clearly contain the target answer",
    };
  }
  return {
    reason: "answer_synthesis_miss",
    note: "evidence appears available, but answer normalization or compression remained imperfect",
  };
}

async function runJapaneseDetailed(profile: BenchEmbeddingProfile, artifactDir: string): Promise<{
  result: LocomoBenchmarkResult;
  sliceReport: ReturnType<typeof buildJapaneseReleaseReport>;
  rawFailureBacklog: ReturnType<typeof buildLocomoFailureBacklog>;
  failures: JapaneseFailureResult[];
  paths: Record<string, string>;
}> {
  const resultPath = join(artifactDir, "japanese-release-pack-96.result.json");
  const slicePath = join(artifactDir, "japanese-release-pack-96.slice-report.json");
  const rawBacklogPath = join(artifactDir, "japanese-release-pack-96.raw-failure-backlog.json");

  const result = await runLocomoBenchmark({
    system: "harness-mem",
    datasetPath: JAPANESE_FIXTURE,
    outputPath: resultPath,
    embeddingMode: profile.mode,
    embeddingModel: profile.model,
    vectorDimension: profile.vectorDimension,
    onnxGate: profile.gateEnabled,
    primeEmbedding: profile.primeEnabled,
  });
  writeFileSync(resultPath, `${JSON.stringify(relativizeArtifactValue(result), null, 2)}\n`, "utf8");

  const sliceReport = buildJapaneseReleaseReport(JAPANESE_FIXTURE, resultPath);
  writeFileSync(slicePath, `${JSON.stringify(relativizeArtifactValue(sliceReport), null, 2)}\n`, "utf8");

  const rawFailureBacklog = buildLocomoFailureBacklog({ resultPath, limit: 100 });
  writeFileSync(
    rawBacklogPath,
    `${JSON.stringify(relativizeArtifactValue(rawFailureBacklog), null, 2)}\n`,
    "utf8"
  );

  const meta = buildJapaneseMeta(JAPANESE_FIXTURE);
  const failures = result.records
    .filter((record) => record.em === 0 || record.f1 < 1)
    .map((record) => {
      const key = `${record.sample_id}::${record.question_id}`;
      const recordMeta = meta.byKey.get(key);
      const classification = classifyJapaneseFailure(
        record as unknown as Record<string, unknown>,
        recordMeta,
        meta.previousAnswersBySample.get(record.sample_id) || []
      );
      return {
        benchmark: "japanese_temporal" as const,
        case_id: key,
        sample_id: record.sample_id,
        question_id: record.question_id,
        slice: recordMeta?.slice || "unlabeled",
        question: record.question,
        answer: record.answer,
        prediction: record.prediction,
        f1: record.f1,
        em: record.em,
        selected_evidence_ids: record.selected_evidence_ids || [],
        taxonomy_reason: classification.reason,
        note: classification.note,
      };
    });

  return {
    result,
    sliceReport,
    rawFailureBacklog,
    failures,
    paths: {
      result: resultPath,
      slice_report: slicePath,
      raw_failure_backlog: rawBacklogPath,
    },
  };
}

function buildTaxonomySummary(
  devCases: SearchCaseResult[],
  temporalCases: SearchCaseResult[],
  japaneseFailures: JapaneseFailureResult[]
): SnapshotSummary["taxonomy_summary"] {
  const byReason = emptyTaxonomyCounts();
  const byBenchmark: Record<string, Record<TaxonomyReason, number>> = {
    dev_workflow: emptyTaxonomyCounts(),
    temporal: emptyTaxonomyCounts(),
    japanese_temporal: emptyTaxonomyCounts(),
  };

  for (const item of devCases.filter((entry) => entry.taxonomy_reason)) {
    incrementTaxonomy(byReason, item.taxonomy_reason);
    incrementTaxonomy(byBenchmark.dev_workflow, item.taxonomy_reason);
  }
  for (const item of temporalCases.filter((entry) => entry.taxonomy_reason)) {
    incrementTaxonomy(byReason, item.taxonomy_reason);
    incrementTaxonomy(byBenchmark.temporal, item.taxonomy_reason);
  }
  for (const item of japaneseFailures) {
    incrementTaxonomy(byReason, item.taxonomy_reason);
    incrementTaxonomy(byBenchmark.japanese_temporal, item.taxonomy_reason);
  }

  return { by_reason: byReason, by_benchmark: byBenchmark };
}

function metricFromSlice(sliceReport: ReturnType<typeof buildJapaneseReleaseReport>, slice: string): number {
  return sliceReport.summary.by_slice[slice]?.f1_avg ?? 0;
}

function buildFailureMarkdown(
  snapshot: SnapshotSummary,
  devCases: SearchCaseResult[],
  temporalCases: SearchCaseResult[],
  japaneseFailures: JapaneseFailureResult[]
): string {
  const lines: string[] = [];
  const searchFailures = [...devCases, ...temporalCases].filter((entry) => entry.taxonomy_reason);
  const allFailures = [
    ...searchFailures.map((entry) => ({
      benchmark: entry.benchmark,
      case_id: entry.case_id,
      score: entry.score,
      reason: entry.taxonomy_reason || "retrieval_miss",
      query: entry.query,
      expected: entry.expected_ids.join(", "),
      observed: entry.retrieved_ids.slice(0, 5).join(", "),
      note: entry.note,
    })),
    ...japaneseFailures.map((entry) => ({
      benchmark: entry.benchmark,
      case_id: entry.case_id,
      score: entry.f1,
      reason: entry.taxonomy_reason,
      query: entry.question,
      expected: entry.answer,
      observed: entry.prediction,
      note: entry.note,
    })),
  ].sort((left, right) => {
    const scoreDelta = left.score - right.score;
    if (scoreDelta !== 0) return scoreDelta;
    return String(left.reason).localeCompare(String(right.reason));
  });

  lines.push("# S108 Baseline Failure Backlog");
  lines.push("");
  lines.push(`- generated_at: ${snapshot.generated_at}`);
  lines.push("- task_id: S108-001");
  lines.push(`- baseline_json: ${rel(join(snapshot.artifact_dir, "baseline.json"))}`);
  lines.push(`- scope: ${snapshot.scope.classification}; owner=${snapshot.scope.owner_repo}; state migration=not applicable`);
  lines.push("");
  lines.push("## Metrics");
  lines.push("");
  lines.push("| Benchmark | Metric | Value | Anchor | Reproduced |");
  lines.push("| --- | --- | ---: | ---: | --- |");
  lines.push(
    `| dev_workflow | recall@10 | ${snapshot.metrics.dev_workflow.recall_at_10.toFixed(4)} | ${snapshot.metrics.dev_workflow.expected_anchor.toFixed(2)} | ${snapshot.metrics.dev_workflow.within_known_drift ? "yes" : "no"} |`
  );
  lines.push(
    `| temporal | order_score | ${snapshot.metrics.temporal.order_score.toFixed(4)} | ${snapshot.metrics.temporal.expected_anchor.toFixed(2)} | ${snapshot.metrics.temporal.within_known_drift ? "yes" : "no"} |`
  );
  lines.push(
    `| japanese_temporal | temporal_slice_f1 | ${snapshot.metrics.japanese_temporal.temporal_f1.toFixed(4)} | n/a | snapshot |`
  );
  lines.push("");
  lines.push("## Taxonomy");
  lines.push("");
  lines.push("| Reason | Count | Meaning |");
  lines.push("| --- | ---: | --- |");
  lines.push(`| retrieval_miss | ${snapshot.taxonomy_summary.by_reason.retrieval_miss} | expected evidence did not enter top results |`);
  lines.push(`| ranking_miss | ${snapshot.taxonomy_summary.by_reason.ranking_miss} | evidence existed but was too low or partial |`);
  lines.push(`| temporal_anchor_miss | ${snapshot.taxonomy_summary.by_reason.temporal_anchor_miss} | time/current/previous anchor was not resolved well enough |`);
  lines.push(`| stale_fact_win | ${snapshot.taxonomy_summary.by_reason.stale_fact_win} | superseded value beat the current answer |`);
  lines.push(`| answer_synthesis_miss | ${snapshot.taxonomy_summary.by_reason.answer_synthesis_miss} | evidence was available but final wording lost the answer |`);
  lines.push("");
  lines.push("## Top Failures");
  lines.push("");
  lines.push("| Benchmark | Case | Score/F1 | Reason | Query | Expected | Observed top/prediction | Note |");
  lines.push("| --- | --- | ---: | --- | --- | --- | --- | --- |");
  for (const failure of allFailures.slice(0, 80)) {
    lines.push(
      `| ${escapeMd(failure.benchmark)} | ${escapeMd(failure.case_id)} | ${round(failure.score, 3).toFixed(3)} | ${escapeMd(failure.reason)} | ${escapeMd(failure.query)} | ${escapeMd(failure.expected)} | ${escapeMd(failure.observed)} | ${escapeMd(failure.note)} |`
    );
  }
  lines.push("");
  lines.push("## Follow-up Read");
  lines.push("");
  lines.push("- S108-002 should expand developer-workflow families where retrieval_miss and ranking_miss dominate.");
  lines.push("- S108-006 should split temporal fixtures into current / previous / after / before / still / no-longer slices.");
  lines.push("- S108-007 should define temporal anchor persistence only after this baseline is stable.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  mkdirSync(options.artifactDir, { recursive: true });
  const profile = resolveBenchEmbeddingProfile();
  applyBenchEnv(profile);

  const dev = await runDevWorkflowDetailed(profile);
  const temporal = await runTemporalDetailed(profile);
  const japanese = await runJapaneseDetailed(profile, options.artifactDir);

  const snapshot: SnapshotSummary = {
    schema_version: "s108-baseline-snapshot-v1",
    generated_at: new Date().toISOString(),
    task_id: "S108-001",
    artifact_dir: rel(options.artifactDir),
    scope: {
      classification: "Local task / Cross-Read",
      owner_repo: "harness-mem",
      mutates_state_contract: false,
      mutates_runtime_state: false,
      impacted_repos: ["harness-mem"],
    },
    runner_contract: {
      dev_workflow: "Same fixture and search request shape as memory-server/src/benchmark/run-ci.ts dev-workflow-20.",
      temporal: "Same temporal-100-v2 fixture, search request shape, and BenchmarkRunner temporal metrics as run-ci.ts.",
      japanese_temporal: "tests/benchmarks/run-locomo-benchmark.ts plus japanese-release-report and locomo-failure-backlog.",
    },
    fixtures: {
      dev_workflow_20: { path: rel(DEV_WORKFLOW_FIXTURE), sha256: sha256File(DEV_WORKFLOW_FIXTURE) },
      temporal_100_v2: { path: rel(TEMPORAL_FIXTURE), sha256: sha256File(TEMPORAL_FIXTURE) },
      japanese_release_pack_96: { path: rel(JAPANESE_FIXTURE), sha256: sha256File(JAPANESE_FIXTURE) },
    },
    embedding: {
      mode: profile.mode,
      provider: profile.provider,
      model: profile.model,
      vector_dimension: profile.vectorDimension,
      onnx_gate: profile.gateEnabled,
      prime_enabled: profile.primeEnabled,
    },
    metrics: {
      dev_workflow: {
        recall_at_10: dev.metric,
        cases: dev.cases.length,
        bootstrap_ci_95: dev.ci,
        expected_anchor: 0.59,
        within_known_drift: Math.abs(dev.metric - 0.59) <= 0.08,
      },
      temporal: {
        order_score: temporal.orderScore,
        weighted_tau: temporal.weightedTau,
        ndcg_at_5: temporal.ndcgAt5,
        cases: temporal.cases.length,
        bootstrap_ci_95: temporal.ci,
        expected_anchor: 0.65,
        within_known_drift: Math.abs(temporal.orderScore - 0.65) <= 0.06,
        domain_breakdown: temporal.domainBreakdown,
      },
      japanese_temporal: {
        dataset_qa_count: japanese.result.dataset.qa_count,
        overall_f1: japanese.sliceReport.summary.overall.f1_avg,
        temporal_f1: metricFromSlice(japanese.sliceReport, "temporal"),
        relative_temporal_f1: metricFromSlice(japanese.sliceReport, "relative_temporal"),
        current_vs_previous_f1: metricFromSlice(japanese.sliceReport, "current_vs_previous"),
        yes_no_f1: metricFromSlice(japanese.sliceReport, "yes_no"),
        zero_f1_count: japanese.sliceReport.summary.overall.zero_f1_count,
      },
    },
    taxonomy_summary: buildTaxonomySummary(dev.cases, temporal.cases, japanese.failures),
    source_files: {
      dev_workflow_cases: "dev-workflow-cases.json",
      temporal_cases: "temporal-cases.json",
      japanese_failures: "japanese-failures.json",
      japanese_result: rel(japanese.paths.result),
      japanese_slice_report: rel(japanese.paths.slice_report),
      japanese_raw_failure_backlog: rel(japanese.paths.raw_failure_backlog),
    },
    state_migration_preflight: {
      applicable: false,
      reason: "S108-001 only writes benchmark artifacts under docs/benchmarks/artifacts and does not change state schema, session resume format, search index format, or runner startup state.",
      invariants_not_touched: [
        "session resume read/write contract",
        "search index schema and stored vectors",
        "runner startup and background loop state",
        "cross-repo sibling state ownership",
      ],
      rollback: "Delete this artifact directory and revert the Plans.md S108-001 status hunk.",
      observation_points: [
        "benchmark start",
        "fixture hashes",
        "per-benchmark metric counts",
        "taxonomy counts",
        "post-run artifact paths",
      ],
    },
  };

  const baselinePath = join(options.artifactDir, "baseline.json");
  const devCasesPath = join(options.artifactDir, "dev-workflow-cases.json");
  const temporalCasesPath = join(options.artifactDir, "temporal-cases.json");
  const japaneseFailuresPath = join(options.artifactDir, "japanese-failures.json");
  const backlogJsonPath = join(options.artifactDir, "failure-backlog.json");
  const backlogMdPath = join(options.artifactDir, "failure-backlog.md");
  const preflightPath = join(options.artifactDir, "state-migration-preflight.md");

  writeFileSync(baselinePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  writeFileSync(devCasesPath, `${JSON.stringify(dev.cases, null, 2)}\n`, "utf8");
  writeFileSync(temporalCasesPath, `${JSON.stringify(temporal.cases, null, 2)}\n`, "utf8");
  writeFileSync(japaneseFailuresPath, `${JSON.stringify(japanese.failures, null, 2)}\n`, "utf8");
  writeFileSync(
    backlogJsonPath,
    `${JSON.stringify(
      {
        schema_version: "s108-failure-backlog-v1",
        generated_at: snapshot.generated_at,
        taxonomy_summary: snapshot.taxonomy_summary,
        failures: {
          dev_workflow: dev.cases.filter((entry) => entry.taxonomy_reason),
          temporal: temporal.cases.filter((entry) => entry.taxonomy_reason),
          japanese_temporal: japanese.failures,
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  writeFileSync(backlogMdPath, buildFailureMarkdown(snapshot, dev.cases, temporal.cases, japanese.failures), "utf8");
  writeFileSync(
    preflightPath,
    [
      "# S108 State Migration Preflight",
      "",
      "- applicable: false",
      `- reason: ${snapshot.state_migration_preflight.reason}`,
      "- rollback: delete this artifact directory and revert only the S108-001 status hunk in Plans.md",
      "",
      "## Invariants Not Touched",
      "",
      ...snapshot.state_migration_preflight.invariants_not_touched.map((item) => `- ${item}`),
      "",
    ].join("\n"),
    "utf8"
  );

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        baseline: rel(baselinePath),
        failure_backlog: rel(backlogMdPath),
        dev_workflow_recall_at_10: round(dev.metric),
        temporal_order_score: round(temporal.orderScore),
        japanese_temporal_f1: round(snapshot.metrics.japanese_temporal.temporal_f1),
      },
      null,
      2
    ) + "\n"
  );
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
