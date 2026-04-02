import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DATA_DIR = resolve(import.meta.dir, "../../../data");
const THRESHOLDS_PATH = resolve(DATA_DIR, "adaptive-thresholds.json");
const ENSEMBLE_WEIGHTS_PATH = resolve(DATA_DIR, "ensemble-weights.json");

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

let cachedThresholds: AdaptiveThresholdDefaults | null = null;
let cachedWeights: EnsembleWeightConfig | null = null;

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
}
