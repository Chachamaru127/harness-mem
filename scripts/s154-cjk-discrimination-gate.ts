#!/usr/bin/env bun
/**
 * S154-152: CJK orthographic discrimination A/B gate.
 *
 * Runs tests/benchmarks/fixtures/cjk-discrimination.json twice in-process:
 *   - baseline: HARNESS_MEM_DISABLE_CJK_NORMALIZE=1 (lexical/dual toggles unset)
 *   - candidate: CJK normalization enabled (disable flag unset)
 *
 * Uses ID-only recall / top1 / MRR metrics against harness-mem search with FTS path
 * asserted (limit >= 26, vector_search=false, graph_weight=0, no safe_mode).
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { HarnessMemCore, type Config, type EventEnvelope } from "../memory-server/src/core/harness-mem-core";
import { decideAbGeneric, type AbDecision, type MetricDeltaRow } from "./s154-coding-memory-ab-gate";

export const CJK_GATE_METRICS = ["recall", "top1", "mrr"] as const;
export type CjkGateMetric = (typeof CJK_GATE_METRICS)[number];
export type CjkMetricsByName = Record<CjkGateMetric, number>;

const SLICES = ["nfkc_fixable", "non_nfkc_orthographic", "mixed_en_ja"] as const;
export type CjkSlice = (typeof SLICES)[number];

const SEARCH_LIMIT = 26;

interface FixtureEntry {
  id: string;
  role: "target" | "distractor";
  tags: string[];
  content: string;
}

interface FixtureCase {
  id: string;
  slice: CjkSlice;
  normalization_kind: string;
  target_improver: string;
  query: string;
  target_id: string;
  entries: FixtureEntry[];
}

interface FixtureDocument {
  schema_version: string;
  description: string;
  cases: FixtureCase[];
}

export interface CaseResult {
  case_id: string;
  slice: CjkSlice;
  expected_observation_id: string;
  retrieved_ids: string[];
  recall: boolean;
  top1: boolean;
  mrr: number;
  latency_ms: number;
}

export interface VariantResult {
  label: "baseline" | "candidate";
  env: Record<string, string | null>;
  per_case: CaseResult[];
  per_slice: Record<CjkSlice, CjkMetricsByName>;
  fts_path_asserted: boolean;
  search_request: {
    limit: number;
    vector_search: boolean;
    graph_weight: number;
    expand_links: boolean;
    include_private: boolean;
    strict_project: boolean;
    safe_mode?: boolean;
  };
}

export interface SliceDecision {
  slice: CjkSlice;
  metrics: MetricDeltaRow<CjkGateMetric>[];
  decision: AbDecision;
  decision_reason: string;
}

export interface CjkDiscriminationGateResult {
  schema_version: "s154-cjk-discrimination.v1";
  generated_at: string;
  task_id: "S154-152";
  fixture: {
    path: string;
    count: number;
  };
  min_delta: number;
  regression_delta: number;
  variants: {
    baseline: VariantResult;
    candidate: VariantResult;
  };
  per_case: Array<CaseResult & { variant: "baseline" | "candidate" }>;
  per_slice: Record<CjkSlice, { baseline: CjkMetricsByName; candidate: CjkMetricsByName }>;
  deltas: Record<CjkSlice, MetricDeltaRow<CjkGateMetric>[]>;
  decision: {
    nfkc_fixable: AbDecision;
    non_nfkc_orthographic: AbDecision;
    mixed_en_ja: AbDecision;
    overall: AbDecision;
    reasons: Record<CjkSlice, string>;
  };
  fts_path_asserted: boolean;
  overall_passed: boolean;
  artifacts: {
    summary_json: string | null;
  };
}

const ROOT_DIR = resolve(import.meta.dir, "..");
const DEFAULT_FIXTURE = join(ROOT_DIR, "tests/benchmarks/fixtures/cjk-discrimination.json");
const DEFAULT_ARTIFACT_DIR = join(ROOT_DIR, "docs/benchmarks/artifacts/s154-cjk-discrimination");

const BASELINE_ENV: Record<string, string | null> = {
  HARNESS_MEM_DISABLE_CJK_NORMALIZE: "1",
  HARNESS_MEM_LEXICAL_BOOST: null,
  HARNESS_MEM_DUAL_QUERY: null,
};

const CANDIDATE_ENV: Record<string, string | null> = {
  HARNESS_MEM_DISABLE_CJK_NORMALIZE: null,
  HARNESS_MEM_LEXICAL_BOOST: null,
  HARNESS_MEM_DUAL_QUERY: null,
};

export interface GateOptions {
  artifactDir?: string;
  fixturePath?: string;
  writeArtifacts?: boolean;
  minDelta?: number;
  regressionDelta?: number;
  candidateEnv?: Record<string, string | null>;
  requireImproved?: boolean;
  now?: Date;
}

function rel(path: string): string {
  return relative(ROOT_DIR, path).replace(/\\/g, "/");
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
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

function observationIdForEntry(testCase: FixtureCase, entryId: string): string {
  return `obs_${testCase.id}-${entryId}`;
}

function eventForCase(testCase: FixtureCase, entry: FixtureEntry, project: string, index: number): EventEnvelope {
  const ts = new Date(Date.UTC(2026, 0, 1, 0, index, 0)).toISOString();
  return {
    event_id: `${testCase.id}-${entry.id}`,
    platform: "claude",
    project,
    session_id: `s154-cjk-discrimination-${testCase.id}`,
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

export function aggregateSliceMetrics(caseResults: CaseResult[]): CjkMetricsByName {
  if (caseResults.length === 0) {
    return { recall: 0, top1: 0, mrr: 0 };
  }
  return {
    recall: round(average(caseResults.map((entry) => (entry.recall ? 1 : 0)))),
    top1: round(average(caseResults.map((entry) => (entry.top1 ? 1 : 0)))),
    mrr: round(average(caseResults.map((entry) => entry.mrr))),
  };
}

export function assertFtsPath(
  searchRequest: VariantResult["search_request"],
  ftsEnabled: boolean,
): boolean {
  return (
    searchRequest.safe_mode !== true
    && searchRequest.limit >= 26
    && searchRequest.vector_search === false
    && searchRequest.graph_weight === 0
    && searchRequest.expand_links === false
    && searchRequest.strict_project === true
    && ftsEnabled === true
  );
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
): Promise<VariantResult> {
  const restoreEnv = applyEnv(env);
  const tmpDir = mkdtempSync(join(tmpdir(), `harness-mem-s154-cjk-${label}-`));
  const core = new HarnessMemCore(createConfig(tmpDir));
  const searchRequest = {
    limit: SEARCH_LIMIT,
    vector_search: false as const,
    graph_weight: 0,
    expand_links: false as const,
    include_private: true as const,
    strict_project: true as const,
  };

  const perCase: CaseResult[] = [];

  try {
    for (const testCase of cases) {
      const project = `s154-cjk-discrimination-${testCase.id}`;
      for (const [index, entry] of testCase.entries.entries()) {
        core.recordEvent(eventForCase(testCase, entry, project, index));
      }
    }

    for (const testCase of cases) {
      const project = `s154-cjk-discrimination-${testCase.id}`;
      const expectedId = observationIdForEntry(testCase, testCase.target_id);
      const startedAt = performance.now();
      const response = core.search({
        query: testCase.query,
        project,
        ...searchRequest,
      });
      const latencyMs = performance.now() - startedAt;
      const items = response.items as Array<Record<string, unknown>>;
      const retrievedIds = items.map((item) => String(item.id ?? ""));
      const meta = (response.meta ?? {}) as Record<string, unknown>;
      const ftsEnabled = meta.fts_enabled === true;

      if (testCase.id === cases[0]?.id) {
        const ftsPathOk = assertFtsPath(searchRequest, ftsEnabled);
        if (!ftsPathOk) {
          throw new Error(
            `[s154-152] FTS path assertion failed for ${label}: safe_mode=${String(searchRequest.safe_mode)} limit=${searchRequest.limit} vector_search=${searchRequest.vector_search} graph_weight=${searchRequest.graph_weight} expand_links=${searchRequest.expand_links} strict_project=${searchRequest.strict_project} fts_enabled=${String(meta.fts_enabled)}`,
          );
        }
      }

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

    const ftsPathSample = core.search({
      query: cases[0]?.query ?? "",
      project: cases[0] ? `s154-cjk-discrimination-${cases[0].id}` : "s154-cjk-discrimination-probe",
      ...searchRequest,
    });
    const ftsEnabled = (ftsPathSample.meta as Record<string, unknown>).fts_enabled === true;

    const perSlice = Object.fromEntries(
      SLICES.map((slice) => [
        slice,
        aggregateSliceMetrics(perCase.filter((entry) => entry.slice === slice)),
      ]),
    ) as Record<CjkSlice, CjkMetricsByName>;

    return {
      label,
      env,
      per_case: perCase,
      per_slice: perSlice,
      fts_path_asserted: assertFtsPath(searchRequest, ftsEnabled),
      search_request: searchRequest,
    };
  } finally {
    core.shutdown(`s154-cjk-discrimination-${label}`);
    rmSync(tmpDir, { recursive: true, force: true });
    restoreEnv();
  }
}

export function evaluateOverallPassed(
  baseline: VariantResult,
  candidate: VariantResult,
  sliceDecisions: Record<CjkSlice, SliceDecision>,
  options: { requireImproved?: boolean } = {},
): boolean {
  if (options.requireImproved) {
    const noRegression = Object.values(sliceDecisions).every((entry) => entry.decision !== "regressed");
    const anyImproved = Object.values(sliceDecisions).some((entry) => entry.decision === "improved");
    return (
      noRegression
      && anyImproved
      && baseline.fts_path_asserted
      && candidate.fts_path_asserted
      && baseline.search_request.vector_search === false
      && candidate.search_request.vector_search === false
    );
  }

  const nfkcBaseline = baseline.per_slice.nfkc_fixable;
  const baselineZero = nfkcBaseline.recall === 0 && nfkcBaseline.top1 === 0 && nfkcBaseline.mrr === 0;
  const nonNfkcNeutral = Object.entries(sliceDecisions)
    .filter(([slice]) => slice !== "nfkc_fixable")
    .every(([, entry]) => entry.decision === "neutral");
  return (
    baselineZero
    && sliceDecisions.nfkc_fixable.decision === "improved"
    && nonNfkcNeutral
    && baseline.fts_path_asserted
    && candidate.fts_path_asserted
    && baseline.search_request.vector_search === false
    && candidate.search_request.vector_search === false
  );
}

export async function runCjkDiscriminationGate(
  options: GateOptions = {},
): Promise<CjkDiscriminationGateResult> {
  const fixturePath = options.fixturePath ?? DEFAULT_FIXTURE;
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as FixtureDocument;
  const cases = fixture.cases;
  const minDelta = options.minDelta ?? 0.02;
  const regressionDelta = options.regressionDelta ?? minDelta;
  const candidateEnv = options.candidateEnv
    ? { ...BASELINE_ENV, ...options.candidateEnv }
    : CANDIDATE_ENV;

  const baseline = await runVariant("baseline", cases, BASELINE_ENV);
  const candidate = await runVariant("candidate", cases, candidateEnv);

  const perSlice = Object.fromEntries(
    SLICES.map((slice) => [
      slice,
      {
        baseline: baseline.per_slice[slice],
        candidate: candidate.per_slice[slice],
      },
    ]),
  ) as Record<CjkSlice, { baseline: CjkMetricsByName; candidate: CjkMetricsByName }>;

  const deltas = Object.fromEntries(
    SLICES.map((slice) => {
      const { metrics } = decideAbGeneric(
        baseline.per_slice[slice],
        candidate.per_slice[slice],
        [...CJK_GATE_METRICS],
        minDelta,
        regressionDelta,
      );
      return [slice, metrics];
    }),
  ) as Record<CjkSlice, MetricDeltaRow<CjkGateMetric>[]>;

  const sliceDecisions = Object.fromEntries(
    SLICES.map((slice) => {
      const outcome = decideAbGeneric(
        baseline.per_slice[slice],
        candidate.per_slice[slice],
        [...CJK_GATE_METRICS],
        minDelta,
        regressionDelta,
      );
      const entry: SliceDecision = {
        slice,
        metrics: outcome.metrics,
        decision: outcome.decision,
        decision_reason: outcome.reason,
      };
      return [slice, entry];
    }),
  ) as Record<CjkSlice, SliceDecision>;

  const decisionValues = Object.values(sliceDecisions).map((entry) => entry.decision);
  const overallDecision: AbDecision = decisionValues.includes("regressed")
    ? "regressed"
    : decisionValues.includes("improved")
      ? "improved"
      : "neutral";

  const ftsPathAsserted = baseline.fts_path_asserted && candidate.fts_path_asserted;
  const overallPassed = evaluateOverallPassed(baseline, candidate, sliceDecisions, {
    requireImproved: options.requireImproved,
  });

  const artifactDir = options.artifactDir ?? DEFAULT_ARTIFACT_DIR;
  const summaryJsonPath = join(artifactDir, "summary.json");

  const result: CjkDiscriminationGateResult = {
    schema_version: "s154-cjk-discrimination.v1",
    generated_at: (options.now ?? new Date()).toISOString(),
    task_id: "S154-152",
    fixture: {
      path: rel(fixturePath),
      count: cases.length,
    },
    min_delta: minDelta,
    regression_delta: regressionDelta,
    variants: { baseline, candidate },
    per_case: [
      ...baseline.per_case.map((entry) => ({ ...entry, variant: "baseline" as const })),
      ...candidate.per_case.map((entry) => ({ ...entry, variant: "candidate" as const })),
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

function parseArgs(argv: string[]): GateOptions {
  const options: GateOptions = {};
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
    } else if (token === "--candidate-env" && argv[i + 1]) {
      const assignment = argv[++i];
      const eq = assignment.indexOf("=");
      if (eq <= 0) {
        throw new Error(`--candidate-env expects NAME=VALUE, got: ${assignment}`);
      }
      const name = assignment.slice(0, eq).trim();
      const value = assignment.slice(eq + 1);
      if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
        throw new Error(`invalid env name for --candidate-env: ${name}`);
      }
      options.candidateEnv = {
        ...(options.candidateEnv ?? {}),
        [name]: value.length === 0 ? null : value,
      };
    } else if (token === "--require-improved") {
      options.requireImproved = true;
    } else if (token === "--no-write") {
      options.writeArtifacts = false;
    } else if (token === "--help" || token === "-h") {
      process.stdout.write(
        "Usage: bun run scripts/s154-cjk-discrimination-gate.ts [--artifact-dir DIR] [--fixture PATH] [--candidate-env NAME=VALUE] [--require-improved] [--min-delta N] [--regression-delta N] [--no-write]\n",
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${token}`);
    }
  }
  return options;
}

if (import.meta.main) {
  runCjkDiscriminationGate(parseArgs(process.argv.slice(2)))
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exitCode = result.overall_passed ? 0 : 1;
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[s154-cjk-discrimination-gate] ${message}\n`);
      process.exitCode = 2;
    });
}
