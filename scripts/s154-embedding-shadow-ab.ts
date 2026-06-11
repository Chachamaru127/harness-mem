/**
 * S154-402: shadow embedding A/B measurement (vector-isolated).
 *
 * Measures the incumbent embedding model (multilingual-e5 / 384dim) against each
 * installed shadow candidate (S154-401: ruri-v3-30m / bge-m3) under identical
 * conditions on the bilingual-50 and dev-workflow-20 fixtures.
 *
 * Measurement path: provider-direct cosine recall@10 (primeBatch / primeQuery on
 * the local ONNX provider, fail-closed — no silent hash fallback). The hybrid
 * end-to-end search path is NOT the measurand: a sensitivity probe showed its
 * recall@10 is identical per-sample across multilingual-e5, ruri-v3-30m and the
 * hash fallback (FTS dominates top-10 membership on these fixtures), so it
 * cannot discriminate embedding models. An embedding switch only changes the
 * vector path, so the vector path is what gets compared (same path-isolation
 * principle as decisions.md D30).
 *
 * Output is the fixed comparison schema that S154-403 consumes:
 *   comparisons[] = { metric, baseline, candidate, delta }
 * for metrics mixed / ja / bilingual / dev_workflow plus the S154-400 composite.
 * The artifact carries aggregate numbers only — never fixture content, queries,
 * or match bodies (pinned by the contract test).
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
import { findModelById } from "../memory-server/src/embedding/model-catalog";
import type { EmbeddingProvider } from "../memory-server/src/embedding/types";

const ROOT = resolve(import.meta.dir, "..");
const BILINGUAL_50_PATH = join(ROOT, "tests/benchmarks/fixtures/bilingual-50.json");
const DEV_WORKFLOW_20_PATH = join(ROOT, "tests/benchmarks/fixtures/dev-workflow-20.json");
const DEFAULT_ARTIFACT_DIR = join(ROOT, "docs/benchmarks/artifacts/s154-embedding-shadow-ab");
const BASELINE_MODEL_ID = "multilingual-e5";
const TOP_K = 10;

/** Patterns counted into the `ja` slice (cross-lingual with Japanese on one side). */
const JA_SLICE_PATTERNS = ["ja-content_en-query", "en-content_ja-query"] as const;
/** Patterns counted into the `mixed` slice. */
const MIXED_SLICE_PATTERNS = ["mixed-content_mixed-query"] as const;

export const SHADOW_AB_METRICS = ["mixed", "ja", "bilingual", "dev_workflow", "composite"] as const;
export type ShadowAbMetric = (typeof SHADOW_AB_METRICS)[number];

export interface ShadowAbComparison {
  metric: ShadowAbMetric;
  baseline: number;
  candidate: number;
  delta: number;
}

export interface ShadowAbCandidateResult {
  model_id: string;
  dimension: number;
  status: "measured" | "skipped";
  skip_reason: string | null;
  comparisons: ShadowAbComparison[];
}

export interface ShadowAbReport {
  schema_version: "s154-402-embedding-shadow-ab.v1";
  generated_at: string;
  baseline_model: string;
  baseline_dimension: number;
  measurement_path: string;
  hybrid_sensitivity_note: string;
  fixtures: {
    bilingual_cases: number;
    dev_workflow_cases: number;
  };
  slice_definitions: {
    mixed: string;
    ja: string;
    bilingual: string;
    dev_workflow: string;
    composite: string;
  };
  switch_delta_threshold: number;
  aggregate_only: true;
  candidates: ShadowAbCandidateResult[];
  reproducibility: string;
}

interface VariantMetrics {
  mixed: number;
  ja: number;
  bilingual: number;
  devWorkflow: number;
}

interface BilingualSample {
  id: string;
  pattern: string;
  content: string;
  query: string;
  relevant_ids: string[];
}

interface DevWorkflowCase {
  id: string;
  entries: Array<{ id: string; content: string }>;
  query: string;
  relevant_ids: string[];
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
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

function recallAtK(
  queryVector: number[],
  pool: Array<{ id: string; vector: number[] }>,
  relevantIds: string[],
  k: number,
): number {
  if (relevantIds.length === 0) return 1;
  const ranked = pool
    .map((entry) => ({ id: entry.id, score: cosine(queryVector, entry.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((entry) => entry.id);
  const hits = relevantIds.filter((id) => ranked.includes(id)).length;
  return hits / relevantIds.length;
}

function resolveLocalProvider(modelId: string, dimension: number): EmbeddingProvider {
  const registry = createEmbeddingProviderRegistry({
    providerName: "local",
    dimension,
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
  return primeBatch.call(provider, texts, mode);
}

async function measureVariant(modelId: string, dimension: number): Promise<VariantMetrics> {
  const provider = resolveLocalProvider(modelId, dimension);

  const bilingual = JSON.parse(readFileSync(BILINGUAL_50_PATH, "utf8")) as {
    samples: BilingualSample[];
  };
  const devCases = JSON.parse(readFileSync(DEV_WORKFLOW_20_PATH, "utf8")) as DevWorkflowCase[];

  // bilingual-50: one shared pool of 50 passages, recall@10 per query.
  const samples = bilingual.samples;
  const passageVectors = await embedBatch(provider, samples.map((s) => s.content), "passage");
  const queryVectors = await embedBatch(provider, samples.map((s) => s.query), "query");
  const pool = samples.map((sample, index) => ({ id: sample.id, vector: passageVectors[index] }));

  const perSample = samples.map((sample, index) =>
    recallAtK(queryVectors[index], pool, sample.relevant_ids, TOP_K),
  );
  const sliceMean = (patterns: readonly string[]): number => {
    const scores = perSample.filter((_, index) => patterns.includes(samples[index].pattern));
    return scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : Number.NaN;
  };

  // dev-workflow-20: one shared pool of all case entries, recall@10 per case query.
  const devEntries = devCases.flatMap((devCase) => devCase.entries);
  const devVectors = await embedBatch(provider, devEntries.map((entry) => entry.content), "passage");
  const devQueryVectors = await embedBatch(provider, devCases.map((devCase) => devCase.query), "query");
  const devPool = devEntries.map((entry, index) => ({ id: entry.id, vector: devVectors[index] }));
  const devScores = devCases.map((devCase, index) =>
    recallAtK(devQueryVectors[index], devPool, devCase.relevant_ids, TOP_K),
  );

  return {
    mixed: sliceMean(MIXED_SLICE_PATTERNS),
    ja: sliceMean(JA_SLICE_PATTERNS),
    bilingual: perSample.reduce((a, b) => a + b, 0) / perSample.length,
    devWorkflow: devScores.reduce((a, b) => a + b, 0) / devScores.length,
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

export async function runEmbeddingShadowAb(options: {
  artifactDir?: string;
  writeArtifacts?: boolean;
  now?: Date;
} = {}): Promise<ShadowAbReport> {
  const artifactDir = resolve(options.artifactDir ?? DEFAULT_ARTIFACT_DIR);
  const writeArtifacts = options.writeArtifacts !== false;
  const now = options.now ?? new Date();
  const weights = loadCompositeScoreWeights();

  const baselineEntry = findModelById(BASELINE_MODEL_ID);
  if (!baselineEntry) throw new Error(`baseline model missing from catalog: ${BASELINE_MODEL_ID}`);

  const bilingualFixture = JSON.parse(readFileSync(BILINGUAL_50_PATH, "utf8")) as {
    samples: unknown[];
  };
  const devFixture = JSON.parse(readFileSync(DEV_WORKFLOW_20_PATH, "utf8")) as unknown[];

  const shadowCandidates = resolveEmbeddingShadowProviders({
    currentVectorModel: `local:${BASELINE_MODEL_ID}`,
  });

  let baselineMetrics: VariantMetrics | null = null;
  const candidates: ShadowAbCandidateResult[] = [];

  for (const candidate of shadowCandidates) {
    if (!candidate.installed) {
      candidates.push({
        model_id: candidate.model_id,
        dimension: candidate.dimension,
        status: "skipped",
        skip_reason: candidate.skip_reason ?? "not_installed",
        comparisons: [],
      });
      continue;
    }
    if (baselineMetrics === null) {
      baselineMetrics = await measureVariant(BASELINE_MODEL_ID, baselineEntry.dimension);
    }
    const candidateMetrics = await measureVariant(candidate.model_id, candidate.dimension);
    candidates.push({
      model_id: candidate.model_id,
      dimension: candidate.dimension,
      status: "measured",
      skip_reason: null,
      comparisons: buildComparisons(baselineMetrics, candidateMetrics),
    });
  }

  const report: ShadowAbReport = {
    schema_version: "s154-402-embedding-shadow-ab.v1",
    generated_at: now.toISOString(),
    baseline_model: BASELINE_MODEL_ID,
    baseline_dimension: baselineEntry.dimension,
    measurement_path:
      "vector-isolated cosine recall@10 via local ONNX provider primeBatch/primeQuery (no FTS/RRF; fail-closed on fallback)",
    hybrid_sensitivity_note:
      "hybrid end-to-end recall@10 on these fixtures is per-sample identical across multilingual-e5, ruri-v3-30m and the hash fallback (FTS dominates top-10 membership), so it cannot discriminate embedding models and is not used as the A/B measurand",
    fixtures: {
      bilingual_cases: bilingualFixture.samples.length,
      dev_workflow_cases: devFixture.length,
    },
    slice_definitions: {
      mixed: "bilingual-50 pattern mixed-content_mixed-query vector recall@10 mean",
      ja: "bilingual-50 patterns ja-content_en-query + en-content_ja-query vector recall@10 mean",
      bilingual: "bilingual-50 overall vector recall@10",
      dev_workflow: "dev-workflow-20 vector recall@10 (shared 60-entry pool)",
      composite: "s154-400 weighted average (data/composite-score-weights.json)",
    },
    switch_delta_threshold: weights.switchDeltaThreshold,
    aggregate_only: true,
    candidates,
    reproducibility:
      "bun run scripts/s154-embedding-shadow-ab.ts (requires local ONNX models; uninstalled candidates are recorded as skipped)",
  };

  if (writeArtifacts) {
    const reportPath = join(artifactDir, "summary.json");
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  return report;
}

if (import.meta.main) {
  const writeArtifacts = !process.argv.includes("--no-write");
  runEmbeddingShadowAb({ writeArtifacts })
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    })
    .catch((err) => {
      console.error("[s154-402] fatal:", err);
      process.exit(1);
    });
}
