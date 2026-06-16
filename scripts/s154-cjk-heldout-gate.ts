#!/usr/bin/env bun
/**
 * S154-C: CJK held-out generalization measurement gate.
 *
 * Measures whether NFKC normalization + lexical boost + dual query improvements
 * generalize to UNSEEN Japanese vocabulary (held-out, disjoint from training dict).
 *
 * Runs tests/benchmarks/fixtures/cjk-heldout-generalization.json twice in-process:
 *   - baseline: all CJK improvements OFF (HARNESS_MEM_DISABLE_CJK_NORMALIZE=1, no lexical/dual)
 *   - candidate: all CJK improvements ON (101a+101b+102)
 *
 * Verdict:
 *   - "improved": candidate delta > 0 in held-out (generalizes)
 *   - "overfit": delta ≈ 0 or negative (dictionary-dependent only)
 *
 * This is measurement-only; does NOT change search behavior or add new flags.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { HarnessMemCore, type Config, type EventEnvelope } from "../memory-server/src/core/harness-mem-core";
import { decideAbGeneric, type AbDecision, type MetricDeltaRow } from "./s154-coding-memory-ab-gate";

export const HELDOUT_GATE_METRICS = ["recall", "top1", "mrr"] as const;
export type HeldoutGateMetric = (typeof HELDOUT_GATE_METRICS)[number];
export type HeldoutMetricsByName = Record<HeldoutGateMetric, number>;

const SLICES = ["nfkc_fixable", "non_nfkc_orthographic", "mixed_en_ja"] as const;
export type HeldoutSlice = (typeof SLICES)[number];

const SEARCH_LIMIT = 26;

// The vocabulary registered in CJK_LEXICAL_READING_RULES (hiragana reading patterns)
// Used only for documentation/logging; disjointness is asserted by the test file.
const LEXICAL_DICT_PATTERNS = [
  "きおく", "さくいん", "けんさく", "あっしゅく", "なおす",
  "ほうしん", "せっけい", "きょうかい", "ひょう",
];

// The vocabulary registered in CJK_DUAL_QUERY_RULES (kanji/mixed patterns)
const DUAL_DICT_PATTERNS = [
  "再ランク", "さいらんく", "再順位", "候補", "融合", "合成",
  "係数", "重み", "二重クエリ", "二重検索", "二重取得",
  "正規化", "英語強調", "英語", "関数名", "コードトークン", "保持",
];

interface FixtureEntry {
  id: string;
  role: "target" | "distractor";
  tags: string[];
  content: string;
}

interface FixtureCase {
  id: string;
  slice: HeldoutSlice;
  normalization_kind: string;
  query: string;
  target_id: string;
  entries: FixtureEntry[];
}

interface FixtureDocument {
  schema_version: string;
  description: string;
  cases: FixtureCase[];
}

export interface HeldoutCaseResult {
  case_id: string;
  slice: HeldoutSlice;
  expected_observation_id: string;
  retrieved_ids: string[];
  recall: boolean;
  top1: boolean;
  mrr: number;
  latency_ms: number;
}

export interface HeldoutVariantResult {
  label: "baseline" | "candidate";
  env: Record<string, string | null>;
  per_case: HeldoutCaseResult[];
  per_slice: Record<HeldoutSlice, HeldoutMetricsByName>;
  fts_path_asserted: boolean;
  search_request: {
    limit: number;
    vector_search: boolean;
    graph_weight: number;
    expand_links: boolean;
    include_private: boolean;
    strict_project: boolean;
  };
}

export interface HeldoutSliceDecision {
  slice: HeldoutSlice;
  metrics: MetricDeltaRow<HeldoutGateMetric>[];
  decision: AbDecision;
  decision_reason: string;
}

export type GeneralizationVerdict = "improved" | "overfit";

export interface CjkHeldoutGateResult {
  schema_version: "s154-cjk-heldout-generalization.v1";
  generated_at: string;
  task_id: "S154-C";
  fixture: {
    path: string;
    count: number;
    vocabulary_disjoint_from_dict: boolean;
    lexical_dict_patterns: string[];
    dual_dict_patterns: string[];
  };
  min_delta: number;
  regression_delta: number;
  variants: {
    baseline: HeldoutVariantResult;
    candidate: HeldoutVariantResult;
  };
  per_case: Array<HeldoutCaseResult & { variant: "baseline" | "candidate" }>;
  per_slice: Record<HeldoutSlice, { baseline: HeldoutMetricsByName; candidate: HeldoutMetricsByName }>;
  deltas: Record<HeldoutSlice, MetricDeltaRow<HeldoutGateMetric>[]>;
  decision: {
    nfkc_fixable: AbDecision;
    non_nfkc_orthographic: AbDecision;
    mixed_en_ja: AbDecision;
    overall: AbDecision;
    reasons: Record<HeldoutSlice, string>;
  };
  generalization_verdict: GeneralizationVerdict;
  generalization_note: string;
  fts_path_asserted: boolean;
  overall_passed: boolean;
  artifacts: {
    summary_json: string | null;
  };
}

const ROOT_DIR = resolve(import.meta.dir, "..");
const DEFAULT_FIXTURE = join(ROOT_DIR, "tests/benchmarks/fixtures/cjk-heldout-generalization.json");
const DEFAULT_ARTIFACT_DIR = join(ROOT_DIR, "docs/benchmarks/artifacts/s154-granite-backfill");

// Baseline: all CJK improvements OFF
const BASELINE_ENV: Record<string, string | null> = {
  HARNESS_MEM_DISABLE_CJK_NORMALIZE: "1",
  HARNESS_MEM_LEXICAL_BOOST: null,
  HARNESS_MEM_DUAL_QUERY: null,
};

// Candidate: all CJK improvements ON (101a NFKC + 101b lexical boost + 102 dual query)
const CANDIDATE_ENV: Record<string, string | null> = {
  HARNESS_MEM_DISABLE_CJK_NORMALIZE: null,
  HARNESS_MEM_LEXICAL_BOOST: "1",
  HARNESS_MEM_DUAL_QUERY: "1",
};

export interface HeldoutGateOptions {
  artifactDir?: string;
  fixturePath?: string;
  writeArtifacts?: boolean;
  minDelta?: number;
  regressionDelta?: number;
  now?: Date;
}

function rel(path: string): string {
  return relative(ROOT_DIR, path).replace(/\\/g, "/");
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}

function createConfig(dir: string): Config {
  return {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 0,
    vectorDimension: 64,
    captureEnabled: true,
    retrievalEnabled: true,
    injectionEnabled: true,
    codexHistoryEnabled: false,
    codexProjectRoot: process.cwd(),
    codexSessionsRoot: process.cwd(),
    codexIngestIntervalMs: 5000,
    codexBackfillHours: 24,
    opencodeIngestEnabled: false,
    cursorIngestEnabled: false,
    antigravityIngestEnabled: false,
    backgroundWorkersEnabled: false,
  };
}

function observationIdForEntry(caseId: string, entryId: string): string {
  return `obs_${caseId}-${entryId}`;
}

function eventForCase(
  testCase: FixtureCase,
  entry: FixtureEntry,
  project: string,
  index: number,
): EventEnvelope {
  const ts = new Date(Date.UTC(2026, 0, 1, 0, index, 0)).toISOString();
  return {
    event_id: `${testCase.id}-${entry.id}`,
    platform: "claude",
    project,
    session_id: `s154-cjk-heldout-${testCase.id}`,
    event_type: "user_prompt",
    ts,
    event_time: ts,
    observed_at: ts,
    payload: { content: entry.content },
    tags: entry.tags,
    privacy_tags: [],
  };
}

export function reciprocalRank(retrievedIds: string[], expectedId: string): number {
  const index = retrievedIds.indexOf(expectedId);
  return index >= 0 ? 1 / (index + 1) : 0;
}

export function aggregateSliceMetrics(caseResults: HeldoutCaseResult[]): HeldoutMetricsByName {
  if (caseResults.length === 0) {
    return { recall: 0, top1: 0, mrr: 0 };
  }
  return {
    recall: round(average(caseResults.map((e) => (e.recall ? 1 : 0)))),
    top1: round(average(caseResults.map((e) => (e.top1 ? 1 : 0)))),
    mrr: round(average(caseResults.map((e) => e.mrr))),
  };
}

function applyEnv(env: Record<string, string | null>): () => void {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    saved.set(key, process.env[key]);
    if (value === null) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    for (const [key, previous] of saved) {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  };
}

async function runVariant(
  label: "baseline" | "candidate",
  cases: FixtureCase[],
  env: Record<string, string | null>,
): Promise<HeldoutVariantResult> {
  const restoreEnv = applyEnv(env);
  const tmpDir = mkdtempSync(join(tmpdir(), `harness-mem-s154-heldout-${label}-`));
  const core = new HarnessMemCore(createConfig(tmpDir));
  const searchRequest = {
    limit: SEARCH_LIMIT,
    vector_search: false as const,
    graph_weight: 0,
    expand_links: false as const,
    include_private: true as const,
    strict_project: true as const,
  };

  const perCase: HeldoutCaseResult[] = [];

  try {
    // Ingest all entries for each case
    for (const testCase of cases) {
      const project = `s154-cjk-heldout-${testCase.id}`;
      for (const [index, entry] of testCase.entries.entries()) {
        core.recordEvent(eventForCase(testCase, entry, project, index));
      }
    }

    // Search for each case using real core.search
    for (const testCase of cases) {
      const project = `s154-cjk-heldout-${testCase.id}`;
      const expectedId = observationIdForEntry(testCase.id, testCase.target_id);
      const startedAt = performance.now();
      // Real core.search call — this is not reading from fixture values
      const response = core.search({
        query: testCase.query,
        project,
        ...searchRequest,
      });
      const latencyMs = performance.now() - startedAt;
      const items = response.items as Array<Record<string, unknown>>;
      const retrievedIds = items.map((item) => String(item.id ?? ""));

      perCase.push({
        case_id: testCase.id,
        slice: testCase.slice,
        expected_observation_id: expectedId,
        retrieved_ids: retrievedIds,
        recall: retrievedIds.includes(expectedId),
        top1: retrievedIds[0] === expectedId,
        mrr: round(reciprocalRank(retrievedIds, expectedId)),
        latency_ms: round(latencyMs),
      });
    }

    // FTS path assertion: check fts_enabled in response meta
    const ftsProbe = core.search({
      query: cases[0]?.query ?? "",
      project: cases[0] ? `s154-cjk-heldout-${cases[0].id}` : "s154-cjk-heldout-probe",
      ...searchRequest,
    });
    const ftsMeta = (ftsProbe.meta ?? {}) as Record<string, unknown>;
    const ftsEnabled = ftsMeta.fts_enabled === true;

    const perSlice = Object.fromEntries(
      SLICES.map((slice) => [
        slice,
        aggregateSliceMetrics(perCase.filter((e) => e.slice === slice)),
      ]),
    ) as Record<HeldoutSlice, HeldoutMetricsByName>;

    return {
      label,
      env,
      per_case: perCase,
      per_slice: perSlice,
      fts_path_asserted: ftsEnabled && searchRequest.vector_search === false,
      search_request: searchRequest,
    };
  } finally {
    core.shutdown(`s154-cjk-heldout-${label}`);
    rmSync(tmpDir, { recursive: true, force: true });
    restoreEnv();
  }
}

function computeGeneralizationVerdict(
  sliceDecisions: Record<HeldoutSlice, HeldoutSliceDecision>,
  overallDecision: AbDecision,
): { verdict: GeneralizationVerdict; note: string } {
  const anyImproved = Object.values(sliceDecisions).some((s) => s.decision === "improved");
  const anyRegressed = Object.values(sliceDecisions).some((s) => s.decision === "regressed");

  if (anyImproved && !anyRegressed) {
    return {
      verdict: "improved",
      note:
        "Held-out delta positive: CJK improvements generalize beyond training dictionary. " +
        "NFKC normalization provides structural generalization even for unseen vocabulary.",
    };
  }

  if (anyRegressed) {
    return {
      verdict: "overfit",
      note:
        "Held-out shows regression: candidate performs worse than baseline on unseen vocabulary. " +
        "Likely over-tuning to discrimination fixture vocabulary.",
    };
  }

  // neutral overall
  if (overallDecision === "neutral") {
    return {
      verdict: "overfit",
      note:
        "Held-out delta ≈ 0: improvements do not generalize to unseen Japanese vocabulary. " +
        "The lexical boost dictionary (CJK_LEXICAL_READING_RULES) and dual-query rules " +
        "(CJK_DUAL_QUERY_RULES) are co-designed with the discrimination fixture and do not " +
        "provide measurable benefit on novel queries. NFKC normalization alone may provide " +
        "partial structural benefit for halfwidth-katakana cases.",
    };
  }

  return {
    verdict: "improved",
    note: `Overall decision: ${overallDecision}. Partial generalization detected.`,
  };
}

export async function runCjkHeldoutGate(
  options: HeldoutGateOptions = {},
): Promise<CjkHeldoutGateResult> {
  const fixturePath = options.fixturePath ?? DEFAULT_FIXTURE;
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as FixtureDocument;
  const cases = fixture.cases;
  const minDelta = options.minDelta ?? 0.02;
  const regressionDelta = options.regressionDelta ?? minDelta;

  const baseline = await runVariant("baseline", cases, BASELINE_ENV);
  const candidate = await runVariant("candidate", cases, CANDIDATE_ENV);

  const perSlice = Object.fromEntries(
    SLICES.map((slice) => [
      slice,
      {
        baseline: baseline.per_slice[slice],
        candidate: candidate.per_slice[slice],
      },
    ]),
  ) as Record<HeldoutSlice, { baseline: HeldoutMetricsByName; candidate: HeldoutMetricsByName }>;

  const deltas = Object.fromEntries(
    SLICES.map((slice) => {
      const { metrics } = decideAbGeneric(
        baseline.per_slice[slice],
        candidate.per_slice[slice],
        [...HELDOUT_GATE_METRICS],
        minDelta,
        regressionDelta,
      );
      return [slice, metrics];
    }),
  ) as Record<HeldoutSlice, MetricDeltaRow<HeldoutGateMetric>[]>;

  const sliceDecisions = Object.fromEntries(
    SLICES.map((slice) => {
      const outcome = decideAbGeneric(
        baseline.per_slice[slice],
        candidate.per_slice[slice],
        [...HELDOUT_GATE_METRICS],
        minDelta,
        regressionDelta,
      );
      const entry: HeldoutSliceDecision = {
        slice,
        metrics: outcome.metrics,
        decision: outcome.decision,
        decision_reason: outcome.reason,
      };
      return [slice, entry];
    }),
  ) as Record<HeldoutSlice, HeldoutSliceDecision>;

  const decisionValues = Object.values(sliceDecisions).map((e) => e.decision);
  const overallDecision: AbDecision = decisionValues.includes("regressed")
    ? "regressed"
    : decisionValues.includes("improved")
      ? "improved"
      : "neutral";

  const { verdict, note } = computeGeneralizationVerdict(sliceDecisions, overallDecision);

  const ftsPathAsserted = baseline.fts_path_asserted && candidate.fts_path_asserted;
  // Gate "passes" only if no regression on held-out (neutral or improved are acceptable)
  // overfit (neutral) is an honest result, not a failure — gate passes
  // regression means the improvement actually hurts unseen vocab — gate fails
  const overallPassed = overallDecision !== "regressed" && ftsPathAsserted;

  const artifactDir = options.artifactDir ?? DEFAULT_ARTIFACT_DIR;
  const summaryJsonPath = join(artifactDir, "cjk-heldout-summary.json");

  const result: CjkHeldoutGateResult = {
    schema_version: "s154-cjk-heldout-generalization.v1",
    generated_at: (options.now ?? new Date()).toISOString(),
    task_id: "S154-C",
    fixture: {
      path: rel(fixturePath),
      count: cases.length,
      vocabulary_disjoint_from_dict: true,
      lexical_dict_patterns: LEXICAL_DICT_PATTERNS,
      dual_dict_patterns: DUAL_DICT_PATTERNS,
    },
    min_delta: minDelta,
    regression_delta: regressionDelta,
    variants: { baseline, candidate },
    per_case: [
      ...baseline.per_case.map((e) => ({ ...e, variant: "baseline" as const })),
      ...candidate.per_case.map((e) => ({ ...e, variant: "candidate" as const })),
    ],
    per_slice: perSlice,
    deltas,
    decision: {
      nfkc_fixable: sliceDecisions.nfkc_fixable.decision,
      non_nfkc_orthographic: sliceDecisions.non_nfkc_orthographic.decision,
      mixed_en_ja: sliceDecisions.mixed_en_ja.decision,
      overall: overallDecision,
      reasons: {
        nfkc_fixable: sliceDecisions.nfkc_fixable.decision_reason,
        non_nfkc_orthographic: sliceDecisions.non_nfkc_orthographic.decision_reason,
        mixed_en_ja: sliceDecisions.mixed_en_ja.decision_reason,
      },
    },
    generalization_verdict: verdict,
    generalization_note: note,
    fts_path_asserted: ftsPathAsserted,
    overall_passed: overallPassed,
    artifacts: {
      summary_json: options.writeArtifacts === false ? null : rel(summaryJsonPath),
    },
  };

  if (options.writeArtifacts !== false) {
    mkdirSync(dirname(summaryJsonPath), { recursive: true });
    writeFileSync(summaryJsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }

  return result;
}

function parseArgs(argv: string[]): HeldoutGateOptions {
  const options: HeldoutGateOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--artifact-dir" && argv[i + 1]) {
      options.artifactDir = resolve(argv[++i]);
    } else if (token === "--fixture" && argv[i + 1]) {
      options.fixturePath = resolve(argv[++i]);
    } else if (token === "--min-delta" && argv[i + 1]) {
      options.minDelta = Number(argv[++i]);
    } else if (token === "--regression-delta" && argv[i + 1]) {
      options.regressionDelta = Number(argv[++i]);
    } else if (token === "--no-write") {
      options.writeArtifacts = false;
    } else if (token === "--help" || token === "-h") {
      process.stdout.write(
        "Usage: bun run scripts/s154-cjk-heldout-gate.ts [--artifact-dir DIR] [--fixture PATH] [--min-delta N] [--regression-delta N] [--no-write]\n",
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${token}`);
    }
  }
  return options;
}

if (import.meta.main) {
  runCjkHeldoutGate(parseArgs(process.argv.slice(2)))
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exitCode = result.overall_passed ? 0 : 1;
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[s154-cjk-heldout-gate] ${message}\n`);
      process.exitCode = 2;
    });
}
