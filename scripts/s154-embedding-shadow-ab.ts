/**
 * S154-402/500/501: shadow embedding A/B measurement (vector-isolated), v2.
 *
 * v2 (S154-500/501) supersedes the v1 measurement after two structural
 * findings:
 *   1. Ceiling: on the v1 fixtures the incumbent scored composite 0.96, so a
 *      perfect candidate could gain at most +0.04 — below the +0.05 switch
 *      threshold. The switch branch was mathematically unreachable. v2 uses
 *      hard-negative fixtures (bilingual-v2 / dev-workflow-v2) and asserts the
 *      baseline composite lands in [0.50, 0.85].
 *   2. Order-blindness + noise floor: v2 adds per-slice top1 / MRR (the
 *      154-152 metric set; D41 — no new metric inventions) and a paired
 *      bootstrap CI95 on the composite delta so a small-sample fluke cannot
 *      look like a switch-worthy win.
 *
 * Measurement path: provider-direct cosine recall@10 (primeBatch / primeQuery
 * on the local ONNX provider, fail-closed — no silent hash fallback). The
 * hybrid end-to-end search path is NOT the measurand: a sensitivity probe
 * showed its recall@10 is identical per-sample across multilingual-e5,
 * ruri-v3-30m and the hash fallback (FTS dominates top-10 membership), so it
 * cannot discriminate embedding models (decisions.md D30/D40).
 *
 * The v1 fixtures are still measured as a negative control
 * (`negative_control_v1`) so the v2 difficulty change is itself observable.
 *
 * Output schema "s154-402-embedding-shadow-ab.v2" is what S154-403 consumes:
 *   comparisons[] = { metric, baseline, candidate, delta }   (recall@10)
 *   order_metrics[] = { slice, metric: top1|mrr, baseline, candidate, delta }
 *   composite_delta_ci95 = paired bootstrap percentile interval
 * Aggregate numbers only — never fixture content, queries, or match bodies.
 *
 * Uninstalled candidates are recorded with a skip reason instead of numbers.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  computeCompositeEmbeddingScore,
  loadCompositeScoreWeights,
} from "../memory-server/src/embedding/adaptive-config";
import {
  createEmbeddingProviderRegistry,
  resolveEmbeddingShadowProviders,
} from "../memory-server/src/embedding/registry";
import { createLocalOnnxEmbeddingProvider } from "../memory-server/src/embedding/local-onnx";
import { ModelManager } from "../memory-server/src/embedding/model-manager";
import { findModelById } from "../memory-server/src/embedding/model-catalog";
import type { EmbeddingProvider } from "../memory-server/src/embedding/types";

const ROOT = resolve(import.meta.dir, "..");
const BILINGUAL_V2_PATH = join(ROOT, "tests/benchmarks/fixtures/bilingual-v2.json");
const DEV_WORKFLOW_V2_PATH = join(ROOT, "tests/benchmarks/fixtures/dev-workflow-v2.json");
const BILINGUAL_V1_PATH = join(ROOT, "tests/benchmarks/fixtures/bilingual-50.json");
const DEV_WORKFLOW_V1_PATH = join(ROOT, "tests/benchmarks/fixtures/dev-workflow-20.json");
const DEFAULT_ARTIFACT_DIR = join(ROOT, "docs/benchmarks/artifacts/s154-embedding-shadow-ab");
const BASELINE_MODEL_ID = "multilingual-e5";
const TOP_K = 10;
const EMBED_CHUNK = 32;
const LATENCY_PROBE_QUERIES = 24;
const BOOTSTRAP_RESAMPLES = 1000;
const BOOTSTRAP_SEED = 154_500;

/** S154-500: the baseline must keep discriminating headroom on the v2 fixtures. */
export const BASELINE_COMPOSITE_BAND = { min: 0.5, max: 0.85 } as const;

/** Patterns counted into the `ja` slice (cross-lingual with Japanese on one side). */
const JA_SLICE_PATTERNS = ["ja-content_en-query", "en-content_ja-query"] as const;
/** Patterns counted into the `mixed` slice. */
const MIXED_SLICE_PATTERNS = ["mixed-content_mixed-query"] as const;

export const SHADOW_AB_METRICS = ["mixed", "ja", "bilingual", "dev_workflow", "composite"] as const;
export type ShadowAbMetric = (typeof SHADOW_AB_METRICS)[number];
export const SHADOW_AB_ORDER_SLICES = ["mixed", "ja", "bilingual", "dev_workflow"] as const;
export type ShadowAbOrderSlice = (typeof SHADOW_AB_ORDER_SLICES)[number];

export interface ShadowAbComparison {
  metric: ShadowAbMetric;
  baseline: number;
  candidate: number;
  delta: number;
}

export interface ShadowAbOrderMetric {
  slice: ShadowAbOrderSlice;
  metric: "top1" | "mrr";
  baseline: number;
  candidate: number;
  delta: number;
}

export interface ShadowAbCi95 {
  lower: number;
  upper: number;
  width: number;
  resamples: number;
  method: "paired bootstrap over per-query recall@10 deltas (seeded, deterministic)";
}

export interface ShadowAbLatency {
  query_p50_ms: number;
  query_p95_ms: number;
  probe_queries: number;
  passage_throughput_per_s: number;
  passage_count: number;
}

export interface ShadowAbCandidateResult {
  model_id: string;
  /** "native" or an MRL truncation label like "mrl-384". */
  config: string;
  dimension: number;
  status: "measured" | "skipped";
  skip_reason: string | null;
  comparisons: ShadowAbComparison[];
  order_metrics: ShadowAbOrderMetric[];
  composite_delta_ci95: ShadowAbCi95 | null;
  latency: ShadowAbLatency | null;
}

export interface ShadowAbNegativeControlCandidate {
  model_id: string;
  config: string;
  comparisons: ShadowAbComparison[];
}

export interface ShadowAbReport {
  schema_version: "s154-402-embedding-shadow-ab.v2";
  generated_at: string;
  baseline_model: string;
  baseline_dimension: number;
  measurement_path: string;
  hybrid_sensitivity_note: string;
  fixtures: {
    bilingual_pool: number;
    bilingual_queries: number;
    dev_workflow_cases: number;
    dev_workflow_pool: number;
  };
  fixture_files: {
    bilingual: string;
    dev_workflow: string;
  };
  slice_definitions: {
    mixed: string;
    ja: string;
    bilingual: string;
    dev_workflow: string;
    composite: string;
  };
  switch_delta_threshold: number;
  ci_lower_bound_enabled: boolean;
  baseline_band: {
    min: number;
    max: number;
    composite: number;
    within: boolean;
  };
  baseline_latency: ShadowAbLatency;
  aggregate_only: true;
  candidates: ShadowAbCandidateResult[];
  negative_control_v1: {
    note: string;
    fixtures: { bilingual_cases: number; dev_workflow_cases: number };
    baseline_composite: number;
    candidates: ShadowAbNegativeControlCandidate[];
  };
  determinism: { runs: number; identical: boolean } | null;
  reproducibility: string;
}

interface PerQuerySlice {
  recall: number[];
  top1: number[];
  rr: number[];
}

interface VariantMeasurement {
  slices: {
    mixed: PerQuerySlice;
    ja: PerQuerySlice;
    bilingual: PerQuerySlice;
    dev_workflow: PerQuerySlice;
  };
  means: VariantMetrics;
  latency: ShadowAbLatency;
}

interface VariantMetrics {
  mixed: number;
  ja: number;
  bilingual: number;
  devWorkflow: number;
}

interface BilingualV2Fixture {
  schema_version: string;
  samples: Array<{ id: string; pattern: string; content: string; query: string; relevant_ids: string[] }>;
  distractors: Array<{ id: string; content: string }>;
}

interface DevWorkflowV2Fixture {
  schema_version: string;
  cases: Array<{
    id: string;
    entries: Array<{ id: string; content: string }>;
    query: string;
    relevant_ids: string[];
  }>;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : Number.NaN;
}

function percentileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[index];
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

interface RankedQueryScores {
  recall: number;
  top1: number;
  rr: number;
}

function scoreQuery(
  queryVector: number[],
  pool: Array<{ id: string; vector: number[] }>,
  relevantIds: string[],
  k: number,
): RankedQueryScores {
  if (relevantIds.length === 0) return { recall: 1, top1: 1, rr: 1 };
  const ranked = pool
    .map((entry) => ({ id: entry.id, score: cosine(queryVector, entry.vector) }))
    .sort((a, b) => b.score - a.score);
  const topIds = ranked.slice(0, k).map((entry) => entry.id);
  const hits = relevantIds.filter((id) => topIds.includes(id)).length;
  const relevantSet = new Set(relevantIds);
  let firstRank = 0;
  for (let i = 0; i < ranked.length; i += 1) {
    if (relevantSet.has(ranked[i].id)) {
      firstRank = i + 1;
      break;
    }
  }
  return {
    recall: hits / relevantIds.length,
    top1: firstRank === 1 ? 1 : 0,
    rr: firstRank > 0 ? 1 / firstRank : 0,
  };
}

/** Deterministic PRNG (mulberry32) so the bootstrap CI is reproducible. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * S154-501: paired bootstrap over per-query recall deltas. Queries are
 * resampled with replacement WITHIN each slice and the same indices are
 * applied to baseline and candidate (paired — an unpaired bootstrap would be
 * over-conservative). Returns the percentile CI95 of the composite delta.
 */
export function pairedBootstrapCompositeDeltaCi95(
  baseline: VariantMeasurement["slices"],
  candidate: VariantMeasurement["slices"],
  weights = loadCompositeScoreWeights(),
  resamples: number = BOOTSTRAP_RESAMPLES,
  seed: number = BOOTSTRAP_SEED,
): ShadowAbCi95 {
  const sliceKeys = ["mixed", "ja", "bilingual", "dev_workflow"] as const;
  for (const key of sliceKeys) {
    if (baseline[key].recall.length !== candidate[key].recall.length) {
      throw new Error(
        `[s154-501] paired bootstrap requires identical query sets per slice (${key}: ${baseline[key].recall.length} vs ${candidate[key].recall.length})`,
      );
    }
  }
  const rng = mulberry32(seed);
  const deltas: number[] = [];
  for (let b = 0; b < resamples; b += 1) {
    const resampled: Record<string, { base: number; cand: number }> = {};
    for (const key of sliceKeys) {
      const n = baseline[key].recall.length;
      let baseSum = 0;
      let candSum = 0;
      for (let i = 0; i < n; i += 1) {
        const pick = Math.floor(rng() * n);
        baseSum += baseline[key].recall[pick];
        candSum += candidate[key].recall[pick];
      }
      resampled[key] = { base: baseSum / n, cand: candSum / n };
    }
    const baseComposite = computeCompositeEmbeddingScore(
      {
        mixed: resampled.mixed.base,
        ja: resampled.ja.base,
        bilingual: resampled.bilingual.base,
        devWorkflow: resampled.dev_workflow.base,
      },
      weights,
    );
    const candComposite = computeCompositeEmbeddingScore(
      {
        mixed: resampled.mixed.cand,
        ja: resampled.ja.cand,
        bilingual: resampled.bilingual.cand,
        devWorkflow: resampled.dev_workflow.cand,
      },
      weights,
    );
    deltas.push(candComposite - baseComposite);
  }
  deltas.sort((a, b) => a - b);
  const lower = percentileSorted(deltas, 0.025);
  const upper = percentileSorted(deltas, 0.975);
  return {
    lower: round(lower),
    upper: round(upper),
    width: round(upper - lower),
    resamples,
    method: "paired bootstrap over per-query recall@10 deltas (seeded, deterministic)",
  };
}

function resolveLocalProvider(modelId: string, dimensionOverride?: number): EmbeddingProvider {
  const entry = findModelById(modelId);
  if (!entry) throw new Error(`[s154-402] model missing from catalog: ${modelId}`);

  if (dimensionOverride !== undefined && dimensionOverride !== entry.dimension) {
    // S154-505: explicit MRL configuration (e.g. qwen3 at 384). Constructed
    // directly so the registry default (native dimension) stays untouched.
    if (!entry.matryoshka) {
      throw new Error(`[s154-505] ${modelId} is not declared matryoshka; cannot measure at ${dimensionOverride}`);
    }
    const manager = new ModelManager(process.env.HARNESS_MEM_LOCAL_MODELS_DIR);
    const modelPath = manager.getModelPath(modelId);
    if (!modelPath) throw new Error(`[s154-505] ${modelId} is not installed`);
    return createLocalOnnxEmbeddingProvider({
      modelId,
      modelPath,
      dimension: dimensionOverride,
      nativeDimension: entry.nativeDimension ?? entry.dimension,
      matryoshka: entry.matryoshka,
      pooling: entry.pooling,
      appendText: entry.appendText,
      maxSeqLength: entry.maxSeqLength,
      queryPrefix: entry.queryPrefix,
      passagePrefix: entry.passagePrefix,
    });
  }

  const registry = createEmbeddingProviderRegistry({
    providerName: "local",
    dimension: entry.dimension,
    localModelId: modelId,
  } as Parameters<typeof createEmbeddingProviderRegistry>[0]);
  const provider = registry.provider;
  // Fail-closed: if the registry silently fell back (model missing / load error),
  // measuring the fallback would fabricate the A/B.
  if (provider.name !== "local" || provider.model !== modelId) {
    throw new Error(
      `[s154-402] provider resolution fell back for ${modelId}: got ${provider.name}/${provider.model} (${registry.warnings.join("; ") || "no warnings"})`,
    );
  }
  return provider;
}

async function embedBatch(
  provider: EmbeddingProvider,
  texts: string[],
  mode: "passage" | "query",
): Promise<number[][]> {
  const primeBatch = (provider as unknown as {
    primeBatch?: (texts: string[], mode: "passage" | "query") => Promise<number[][]>;
  }).primeBatch;
  if (typeof primeBatch !== "function") {
    throw new Error(`[s154-402] provider ${provider.model} does not expose primeBatch`);
  }
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_CHUNK) {
    const chunk = texts.slice(i, i + EMBED_CHUNK);
    vectors.push(...(await primeBatch.call(provider, chunk, mode)));
  }
  return vectors;
}

async function measureVariantV2(modelId: string, dimensionOverride?: number): Promise<VariantMeasurement> {
  const provider = resolveLocalProvider(modelId, dimensionOverride);

  const bilingual = JSON.parse(readFileSync(BILINGUAL_V2_PATH, "utf8")) as BilingualV2Fixture;
  const dev = JSON.parse(readFileSync(DEV_WORKFLOW_V2_PATH, "utf8")) as DevWorkflowV2Fixture;

  // Warm the model (excludes load time from the latency probe).
  await embedBatch(provider, ["__warmup__"], "query");

  // Per-query latency probe on cold cache entries, sequential.
  const probeTexts = bilingual.samples.slice(0, LATENCY_PROBE_QUERIES).map((s) => s.query);
  const probeMs: number[] = [];
  for (const text of probeTexts) {
    const started = performance.now();
    await embedBatch(provider, [text], "query");
    probeMs.push(performance.now() - started);
  }
  probeMs.sort((a, b) => a - b);

  // bilingual-v2: one shared pool (samples + distractors), scored per query.
  const poolTexts = [
    ...bilingual.samples.map((s) => ({ id: s.id, content: s.content })),
    ...bilingual.distractors.map((d) => ({ id: d.id, content: d.content })),
  ];
  const passageStarted = performance.now();
  const passageVectors = await embedBatch(provider, poolTexts.map((p) => p.content), "passage");
  const passageElapsedS = (performance.now() - passageStarted) / 1000;
  const pool = poolTexts.map((p, index) => ({ id: p.id, vector: passageVectors[index] }));

  const queryVectors = await embedBatch(provider, bilingual.samples.map((s) => s.query), "query");
  const perSample = bilingual.samples.map((sample, index) =>
    scoreQuery(queryVectors[index], pool, sample.relevant_ids, TOP_K),
  );

  const sliceOf = (patterns: readonly string[]): PerQuerySlice => {
    const picked = perSample.filter((_, index) => patterns.includes(bilingual.samples[index].pattern));
    return {
      recall: picked.map((s) => s.recall),
      top1: picked.map((s) => s.top1),
      rr: picked.map((s) => s.rr),
    };
  };

  // dev-workflow-v2: one shared pool of all case entries.
  const devEntries = dev.cases.flatMap((devCase) => devCase.entries);
  const devVectors = await embedBatch(provider, devEntries.map((entry) => entry.content), "passage");
  const devPool = devEntries.map((entry, index) => ({ id: entry.id, vector: devVectors[index] }));
  const devQueryVectors = await embedBatch(provider, dev.cases.map((devCase) => devCase.query), "query");
  const devScores = dev.cases.map((devCase, index) =>
    scoreQuery(devQueryVectors[index], devPool, devCase.relevant_ids, TOP_K),
  );

  const slices = {
    mixed: sliceOf(MIXED_SLICE_PATTERNS),
    ja: sliceOf(JA_SLICE_PATTERNS),
    bilingual: {
      recall: perSample.map((s) => s.recall),
      top1: perSample.map((s) => s.top1),
      rr: perSample.map((s) => s.rr),
    },
    dev_workflow: {
      recall: devScores.map((s) => s.recall),
      top1: devScores.map((s) => s.top1),
      rr: devScores.map((s) => s.rr),
    },
  };

  return {
    slices,
    means: {
      mixed: mean(slices.mixed.recall),
      ja: mean(slices.ja.recall),
      bilingual: mean(slices.bilingual.recall),
      devWorkflow: mean(slices.dev_workflow.recall),
    },
    latency: {
      query_p50_ms: round(percentileSorted(probeMs, 0.5)),
      query_p95_ms: round(percentileSorted(probeMs, 0.95)),
      probe_queries: probeMs.length,
      passage_throughput_per_s: round(poolTexts.length / Math.max(passageElapsedS, 1e-9)),
      passage_count: poolTexts.length,
    },
  };
}

interface BilingualV1Sample {
  id: string;
  pattern: string;
  content: string;
  query: string;
  relevant_ids: string[];
}

interface DevWorkflowV1Case {
  id: string;
  entries: Array<{ id: string; content: string }>;
  query: string;
  relevant_ids: string[];
}

/** v1 fixtures (bilingual-50 / dev-workflow-20) as the negative control. */
async function measureVariantV1(modelId: string, dimensionOverride?: number): Promise<VariantMetrics> {
  const provider = resolveLocalProvider(modelId, dimensionOverride);

  const bilingual = JSON.parse(readFileSync(BILINGUAL_V1_PATH, "utf8")) as { samples: BilingualV1Sample[] };
  const devCases = JSON.parse(readFileSync(DEV_WORKFLOW_V1_PATH, "utf8")) as DevWorkflowV1Case[];

  const samples = bilingual.samples;
  const passageVectors = await embedBatch(provider, samples.map((s) => s.content), "passage");
  const queryVectors = await embedBatch(provider, samples.map((s) => s.query), "query");
  const pool = samples.map((sample, index) => ({ id: sample.id, vector: passageVectors[index] }));
  const perSample = samples.map((sample, index) =>
    scoreQuery(queryVectors[index], pool, sample.relevant_ids, TOP_K).recall,
  );
  const sliceMean = (patterns: readonly string[]): number => {
    const scores = perSample.filter((_, index) => patterns.includes(samples[index].pattern));
    return mean(scores);
  };

  const devEntries = devCases.flatMap((devCase) => devCase.entries);
  const devVectors = await embedBatch(provider, devEntries.map((entry) => entry.content), "passage");
  const devQueryVectors = await embedBatch(provider, devCases.map((devCase) => devCase.query), "query");
  const devPool = devEntries.map((entry, index) => ({ id: entry.id, vector: devVectors[index] }));
  const devScores = devCases.map((devCase, index) =>
    scoreQuery(devQueryVectors[index], devPool, devCase.relevant_ids, TOP_K).recall,
  );

  return {
    mixed: sliceMean(MIXED_SLICE_PATTERNS),
    ja: sliceMean(JA_SLICE_PATTERNS),
    bilingual: mean(perSample),
    devWorkflow: mean(devScores),
  };
}

export function buildComparisons(baseline: VariantMetrics, candidate: VariantMetrics): ShadowAbComparison[] {
  const weights = loadCompositeScoreWeights();
  const baselineComposite = computeCompositeEmbeddingScore(baseline, weights);
  const candidateComposite = computeCompositeEmbeddingScore(candidate, weights);
  const rows: Array<[ShadowAbMetric, number, number]> = [
    ["mixed", baseline.mixed, candidate.mixed],
    ["ja", baseline.ja, candidate.ja],
    ["bilingual", baseline.bilingual, candidate.bilingual],
    ["dev_workflow", baseline.devWorkflow, candidate.devWorkflow],
    ["composite", baselineComposite, candidateComposite],
  ];
  return rows.map(([metric, base, cand]) => ({
    metric,
    baseline: round(base),
    candidate: round(cand),
    delta: round(cand - base),
  }));
}

function buildOrderMetrics(
  baseline: VariantMeasurement["slices"],
  candidate: VariantMeasurement["slices"],
): ShadowAbOrderMetric[] {
  const rows: ShadowAbOrderMetric[] = [];
  for (const slice of SHADOW_AB_ORDER_SLICES) {
    for (const metric of ["top1", "mrr"] as const) {
      const base = mean(metric === "top1" ? baseline[slice].top1 : baseline[slice].rr);
      const cand = mean(metric === "top1" ? candidate[slice].top1 : candidate[slice].rr);
      rows.push({ slice, metric, baseline: round(base), candidate: round(cand), delta: round(cand - base) });
    }
  }
  return rows;
}

interface CandidateConfig {
  model_id: string;
  config: string;
  dimension: number;
  installed: boolean;
  skip_reason?: string;
}

function expandCandidateConfigs(
  shadowCandidates: ReturnType<typeof resolveEmbeddingShadowProviders>,
): CandidateConfig[] {
  const configs: CandidateConfig[] = [];
  for (const candidate of shadowCandidates) {
    configs.push({
      model_id: candidate.model_id,
      config: "native",
      dimension: candidate.dimension,
      installed: candidate.installed,
      skip_reason: candidate.skip_reason,
    });
    // S154-505: Matryoshka candidates are additionally measured truncated to
    // the incumbent dimension (384) — byte-compatible index size if adopted.
    const entry = findModelById(candidate.model_id);
    if (entry?.matryoshka && entry.dimension > 384) {
      configs.push({
        model_id: candidate.model_id,
        config: "mrl-384",
        dimension: 384,
        installed: candidate.installed,
        skip_reason: candidate.skip_reason,
      });
    }
  }
  return configs;
}

export async function runEmbeddingShadowAb(options: {
  artifactDir?: string;
  writeArtifacts?: boolean;
  now?: Date;
  /** S154-502: explicit candidate model ids (--models). Defaults to the registry shadow set. */
  models?: string[];
  /** S154-501: repeat the measurement N times and assert identical composites (determinism check). */
  runs?: number;
} = {}): Promise<ShadowAbReport> {
  const artifactDir = resolve(options.artifactDir ?? DEFAULT_ARTIFACT_DIR);
  const writeArtifacts = options.writeArtifacts !== false;
  const now = options.now ?? new Date();
  const runs = Math.max(1, Math.floor(options.runs ?? 1));
  const weights = loadCompositeScoreWeights();

  const baselineEntry = findModelById(BASELINE_MODEL_ID);
  if (!baselineEntry) throw new Error(`baseline model missing from catalog: ${BASELINE_MODEL_ID}`);

  const bilingualFixture = JSON.parse(readFileSync(BILINGUAL_V2_PATH, "utf8")) as BilingualV2Fixture;
  const devFixture = JSON.parse(readFileSync(DEV_WORKFLOW_V2_PATH, "utf8")) as DevWorkflowV2Fixture;
  if (bilingualFixture.schema_version !== "s154-500-bilingual.v2") {
    throw new Error(`unexpected bilingual fixture schema: ${bilingualFixture.schema_version}`);
  }
  if (devFixture.schema_version !== "s154-500-dev-workflow.v2") {
    throw new Error(`unexpected dev-workflow fixture schema: ${devFixture.schema_version}`);
  }

  const v1Bilingual = JSON.parse(readFileSync(BILINGUAL_V1_PATH, "utf8")) as { samples: unknown[] };
  const v1Dev = JSON.parse(readFileSync(DEV_WORKFLOW_V1_PATH, "utf8")) as unknown[];

  const shadowCandidates = resolveEmbeddingShadowProviders({
    currentVectorModel: `local:${BASELINE_MODEL_ID}`,
    currentVectorDimension: baselineEntry.dimension,
    ...(options.models && options.models.length > 0 ? { modelIds: options.models } : {}),
  });
  const candidateConfigs = expandCandidateConfigs(shadowCandidates);

  const baselineMeasurement = await measureVariantV2(BASELINE_MODEL_ID);
  const baselineComposite = computeCompositeEmbeddingScore(baselineMeasurement.means, weights);

  // S154-500: ceiling assert — a saturated baseline silently disables the
  // switch branch; a degenerate fixture would invert the failure mode.
  const within =
    baselineComposite <= BASELINE_COMPOSITE_BAND.max && baselineComposite >= BASELINE_COMPOSITE_BAND.min;
  if (!within) {
    throw new Error(
      `[s154-500] baseline composite ${round(baselineComposite)} is outside the discriminating band [${BASELINE_COMPOSITE_BAND.min}, ${BASELINE_COMPOSITE_BAND.max}] — fixture difficulty must be retuned before any switch decision`,
    );
  }

  // S154-501: determinism check — the pipeline is shared across models, so
  // re-measuring the baseline with fresh provider instances demonstrates
  // run-to-run determinism without paying for candidate re-measurement.
  const runComposites: number[] = [baselineComposite];
  for (let extraRun = 1; extraRun < runs; extraRun += 1) {
    const repeat = await measureVariantV2(BASELINE_MODEL_ID);
    runComposites.push(computeCompositeEmbeddingScore(repeat.means, weights));
  }

  let report: ShadowAbReport | null = null;
  {
    const baselineV1 = await measureVariantV1(BASELINE_MODEL_ID);
    const v1BaselineComposite = computeCompositeEmbeddingScore(baselineV1, weights);

    const candidates: ShadowAbCandidateResult[] = [];
    const negativeControl: ShadowAbNegativeControlCandidate[] = [];

    for (const config of candidateConfigs) {
      if (!config.installed) {
        candidates.push({
          model_id: config.model_id,
          config: config.config,
          dimension: config.dimension,
          status: "skipped",
          skip_reason: config.skip_reason ?? "not_installed",
          comparisons: [],
          order_metrics: [],
          composite_delta_ci95: null,
          latency: null,
        });
        continue;
      }
      const dimensionOverride = config.config === "native" ? undefined : config.dimension;
      const candidateMeasurement = await measureVariantV2(config.model_id, dimensionOverride);
      candidates.push({
        model_id: config.model_id,
        config: config.config,
        dimension: config.dimension,
        status: "measured",
        skip_reason: null,
        comparisons: buildComparisons(baselineMeasurement.means, candidateMeasurement.means),
        order_metrics: buildOrderMetrics(baselineMeasurement.slices, candidateMeasurement.slices),
        composite_delta_ci95: pairedBootstrapCompositeDeltaCi95(
          baselineMeasurement.slices,
          candidateMeasurement.slices,
          weights,
        ),
        latency: candidateMeasurement.latency,
      });

      const candidateV1 = await measureVariantV1(config.model_id, dimensionOverride);
      negativeControl.push({
        model_id: config.model_id,
        config: config.config,
        comparisons: buildComparisons(baselineV1, candidateV1),
      });
    }

    report = {
      schema_version: "s154-402-embedding-shadow-ab.v2",
      generated_at: now.toISOString(),
      baseline_model: BASELINE_MODEL_ID,
      baseline_dimension: baselineEntry.dimension,
      measurement_path:
        "vector-isolated cosine recall@10 + top1/MRR via local ONNX provider primeBatch/primeQuery (no FTS/RRF; fail-closed on fallback)",
      hybrid_sensitivity_note:
        "hybrid end-to-end recall@10 is per-sample identical across multilingual-e5, ruri-v3-30m and the hash fallback (FTS dominates top-10 membership), so it cannot discriminate embedding models and is not used as the A/B measurand",
      fixtures: {
        bilingual_pool: bilingualFixture.samples.length + bilingualFixture.distractors.length,
        bilingual_queries: bilingualFixture.samples.length,
        dev_workflow_cases: devFixture.cases.length,
        dev_workflow_pool: devFixture.cases.reduce((acc, c) => acc + c.entries.length, 0),
      },
      fixture_files: {
        bilingual: "tests/benchmarks/fixtures/bilingual-v2.json (s154-500-bilingual.v2)",
        dev_workflow: "tests/benchmarks/fixtures/dev-workflow-v2.json (s154-500-dev-workflow.v2)",
      },
      slice_definitions: {
        mixed: "bilingual-v2 pattern mixed-content_mixed-query vector recall@10 mean (52 queries)",
        ja: "bilingual-v2 patterns ja-content_en-query + en-content_ja-query vector recall@10 mean (52 queries)",
        bilingual: "bilingual-v2 overall vector recall@10 (104 queries, 156-entry shared pool)",
        dev_workflow: "dev-workflow-v2 vector recall@10 (92 queries, 270-entry shared pool)",
        composite: "s154-400 weighted average (data/composite-score-weights.json)",
      },
      switch_delta_threshold: weights.switchDeltaThreshold,
      ci_lower_bound_enabled: weights.ciLowerBoundEnabled,
      baseline_band: {
        min: BASELINE_COMPOSITE_BAND.min,
        max: BASELINE_COMPOSITE_BAND.max,
        composite: round(baselineComposite),
        within: true,
      },
      baseline_latency: baselineMeasurement.latency,
      aggregate_only: true,
      candidates,
      negative_control_v1: {
        note:
          "v1 fixtures (ceiling-saturated: baseline composite 0.96) kept as a negative control for the v2 difficulty change; not used for the switch decision",
        fixtures: {
          bilingual_cases: v1Bilingual.samples.length,
          dev_workflow_cases: v1Dev.length,
        },
        baseline_composite: round(v1BaselineComposite),
        candidates: negativeControl,
      },
      determinism: runs > 1 ? { runs, identical: runComposites.every((c) => c === runComposites[0]) } : null,
      reproducibility:
        "bun run scripts/s154-embedding-shadow-ab.ts [--models a,b] [--runs N] (requires local ONNX models; uninstalled candidates are recorded as skipped)",
    };
  }

  if (!report) throw new Error("no measurement run completed");
  if (runs > 1 && !report.determinism?.identical) {
    throw new Error(`[s154-501] determinism check failed: baseline composites ${runComposites.join(", ")}`);
  }

  if (writeArtifacts) {
    const reportPath = join(artifactDir, "summary.json");
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  return report;
}

function parseModelsArg(argv: string[]): string[] | undefined {
  const joined = argv.find((arg) => arg.startsWith("--models="));
  if (joined) {
    return joined.slice("--models=".length).split(",").map((id) => id.trim()).filter(Boolean);
  }
  const flagIndex = argv.indexOf("--models");
  if (flagIndex >= 0 && argv[flagIndex + 1]) {
    return argv[flagIndex + 1].split(",").map((id) => id.trim()).filter(Boolean);
  }
  return undefined;
}

function parseRunsArg(argv: string[]): number | undefined {
  const joined = argv.find((arg) => arg.startsWith("--runs="));
  if (joined) return Number(joined.slice("--runs=".length));
  const flagIndex = argv.indexOf("--runs");
  if (flagIndex >= 0 && argv[flagIndex + 1]) return Number(argv[flagIndex + 1]);
  return undefined;
}

if (import.meta.main) {
  const writeArtifacts = !process.argv.includes("--no-write");
  const models = parseModelsArg(process.argv);
  const runs = parseRunsArg(process.argv);
  runEmbeddingShadowAb({ writeArtifacts, models, runs })
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    })
    .catch((err) => {
      console.error("[s154-402] fatal:", err);
      process.exit(1);
    });
}
