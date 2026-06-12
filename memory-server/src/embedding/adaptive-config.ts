import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DATA_DIR = resolve(import.meta.dir, "../../../data");
const THRESHOLDS_PATH = resolve(DATA_DIR, "adaptive-thresholds.json");
const ENSEMBLE_WEIGHTS_PATH = resolve(DATA_DIR, "ensemble-weights.json");
const COMPOSITE_SCORE_WEIGHTS_PATH = resolve(DATA_DIR, "composite-score-weights.json");

export interface AdaptiveThresholdDefaults {
  jaThreshold: number;
  codeThreshold: number;
  source?: string;
  updatedAt?: string;
  notes?: string;
}

export interface EnsembleWeightConfig {
  minJapaneseWeight: number;
  maxJapaneseWeight: number;
  defaultJapaneseWeight: number;
  jaRatioScale: number;
  jaRatioBias: number;
  source?: string;
  updatedAt?: string;
  notes?: string;
}

/**
 * S154-400: weights for the new-vs-legacy embedding switch decision (154-403).
 * The four metrics are developer-domain retrieval recall slices; switchDeltaThreshold
 * is the minimum composite gain required to flip the default embedding version.
 */
export interface CompositeScoreWeights {
  mixedWeight: number;
  jaWeight: number;
  bilingualWeight: number;
  devWorkflowWeight: number;
  switchDeltaThreshold: number;
  /**
   * S154-501: when true, the switch decision requires
   * delta >= max(switchDeltaThreshold, paired-bootstrap CI95 width) so a
   * noise-driven delta can never trigger a ~14GB re-index. Tightening only —
   * the 0.05 floor never loosens. Default off until the D29 amendment is
   * accepted (human judgment); the measurement artifact records the CI either way.
   */
  ciLowerBoundEnabled: boolean;
  source?: string;
  updatedAt?: string;
  notes?: string;
}

const DEFAULT_THRESHOLDS: AdaptiveThresholdDefaults = {
  jaThreshold: 0.85,
  codeThreshold: 0.5,
  source: "built-in-defaults",
};

const DEFAULT_ENSEMBLE_WEIGHTS: EnsembleWeightConfig = {
  minJapaneseWeight: 0.3,
  maxJapaneseWeight: 0.9,
  defaultJapaneseWeight: 0.5,
  jaRatioScale: 1,
  jaRatioBias: 0,
  source: "built-in-defaults",
};

const DEFAULT_COMPOSITE_SCORE_WEIGHTS: CompositeScoreWeights = {
  mixedWeight: 0.25,
  jaWeight: 0.25,
  bilingualWeight: 0.25,
  devWorkflowWeight: 0.25,
  switchDeltaThreshold: 0.05,
  ciLowerBoundEnabled: false,
  source: "built-in-defaults",
};

let cachedThresholds: AdaptiveThresholdDefaults | null = null;
let cachedWeights: EnsembleWeightConfig | null = null;
let cachedCompositeScoreWeights: CompositeScoreWeights | null = null;

function clampRatio(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, numeric));
}

function readJsonObject(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function getAdaptiveThresholdConfigPath(): string {
  return THRESHOLDS_PATH;
}

export function getEnsembleWeightConfigPath(): string {
  return ENSEMBLE_WEIGHTS_PATH;
}
export function getCompositeScoreWeightsPath(): string {
  return COMPOSITE_SCORE_WEIGHTS_PATH;
}

/** S154-400: load the embedding-switch composite weights (data file overrides defaults). */
export function loadCompositeScoreWeights(): CompositeScoreWeights {
  if (cachedCompositeScoreWeights) {
    return cachedCompositeScoreWeights;
  }
  const raw = readJsonObject(COMPOSITE_SCORE_WEIGHTS_PATH);
  const threshold = Number(raw?.switchDeltaThreshold);
  cachedCompositeScoreWeights = {
    mixedWeight: clampRatio(raw?.mixedWeight, DEFAULT_COMPOSITE_SCORE_WEIGHTS.mixedWeight),
    jaWeight: clampRatio(raw?.jaWeight, DEFAULT_COMPOSITE_SCORE_WEIGHTS.jaWeight),
    bilingualWeight: clampRatio(raw?.bilingualWeight, DEFAULT_COMPOSITE_SCORE_WEIGHTS.bilingualWeight),
    devWorkflowWeight: clampRatio(
      raw?.devWorkflowWeight,
      DEFAULT_COMPOSITE_SCORE_WEIGHTS.devWorkflowWeight,
    ),
    switchDeltaThreshold: Number.isFinite(threshold)
      ? Math.max(0, threshold)
      : DEFAULT_COMPOSITE_SCORE_WEIGHTS.switchDeltaThreshold,
    ciLowerBoundEnabled: raw?.ci_lower_bound_enabled === true,
    source: typeof raw?.source === "string" ? raw.source : DEFAULT_COMPOSITE_SCORE_WEIGHTS.source,
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : undefined,
    notes: typeof raw?.notes === "string" ? raw.notes : undefined,
  };
  return cachedCompositeScoreWeights;
}

/**
 * S154-400: weighted average of the four developer-domain recall metrics, each
 * clamped to [0,1] and normalized by total weight. A non-finite metric propagates
 * as NaN (so a missing slice surfaces instead of being silently substituted);
 * callers (154-403) must supply finite values measured by 154-402.
 */
export function computeCompositeEmbeddingScore(
  metrics: { mixed: number; ja: number; bilingual: number; devWorkflow: number },
  config: CompositeScoreWeights = loadCompositeScoreWeights(),
): number {
  const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
  const terms: Array<[number, number]> = [
    [clamp01(metrics.mixed), config.mixedWeight],
    [clamp01(metrics.ja), config.jaWeight],
    [clamp01(metrics.bilingual), config.bilingualWeight],
    [clamp01(metrics.devWorkflow), config.devWorkflowWeight],
  ];
  const weightedSum = terms.reduce((sum, [value, weight]) => sum + value * weight, 0);
  const totalWeight = terms.reduce((sum, [, weight]) => sum + weight, 0);
  return totalWeight > 0 ? weightedSum / totalWeight : 0.5;
}

export function loadAdaptiveThresholdDefaults(): AdaptiveThresholdDefaults {
  if (cachedThresholds) {
    return cachedThresholds;
  }
  const raw = readJsonObject(THRESHOLDS_PATH);
  cachedThresholds = {
    jaThreshold: clampRatio(raw?.jaThreshold, DEFAULT_THRESHOLDS.jaThreshold),
    codeThreshold: clampRatio(raw?.codeThreshold, DEFAULT_THRESHOLDS.codeThreshold),
    source: typeof raw?.source === "string" ? raw.source : DEFAULT_THRESHOLDS.source,
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : undefined,
    notes: typeof raw?.notes === "string" ? raw.notes : undefined,
  };
  return cachedThresholds;
}

export function loadEnsembleWeightConfig(): EnsembleWeightConfig {
  if (cachedWeights) {
    return cachedWeights;
  }
  const raw = readJsonObject(ENSEMBLE_WEIGHTS_PATH);
  const minJapaneseWeight = clampRatio(
    raw?.minJapaneseWeight,
    DEFAULT_ENSEMBLE_WEIGHTS.minJapaneseWeight,
  );
  const maxJapaneseWeight = clampRatio(
    raw?.maxJapaneseWeight,
    DEFAULT_ENSEMBLE_WEIGHTS.maxJapaneseWeight,
  );
  cachedWeights = {
    minJapaneseWeight: Math.min(minJapaneseWeight, maxJapaneseWeight),
    maxJapaneseWeight: Math.max(minJapaneseWeight, maxJapaneseWeight),
    defaultJapaneseWeight: clampRatio(
      raw?.defaultJapaneseWeight,
      DEFAULT_ENSEMBLE_WEIGHTS.defaultJapaneseWeight,
    ),
    jaRatioScale:
      typeof raw?.jaRatioScale === "number" && Number.isFinite(raw.jaRatioScale)
        ? raw.jaRatioScale
        : DEFAULT_ENSEMBLE_WEIGHTS.jaRatioScale,
    jaRatioBias:
      typeof raw?.jaRatioBias === "number" && Number.isFinite(raw.jaRatioBias)
        ? raw.jaRatioBias
        : DEFAULT_ENSEMBLE_WEIGHTS.jaRatioBias,
    source: typeof raw?.source === "string" ? raw.source : DEFAULT_ENSEMBLE_WEIGHTS.source,
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : undefined,
    notes: typeof raw?.notes === "string" ? raw.notes : undefined,
  };
  return cachedWeights;
}

export function computeJapaneseEnsembleWeight(
  jaRatio: number | null | undefined,
  config: EnsembleWeightConfig = loadEnsembleWeightConfig(),
): number {
  const normalizedRatio =
    typeof jaRatio === "number" && Number.isFinite(jaRatio)
      ? clampRatio(jaRatio, config.defaultJapaneseWeight)
      : config.defaultJapaneseWeight;
  const candidate = normalizedRatio * config.jaRatioScale + config.jaRatioBias;
  return Math.max(
    config.minJapaneseWeight,
    Math.min(config.maxJapaneseWeight, candidate),
  );
}

export function resetAdaptiveConfigCacheForTests(): void {
  cachedThresholds = null;
  cachedWeights = null;
  cachedCompositeScoreWeights = null;
}
