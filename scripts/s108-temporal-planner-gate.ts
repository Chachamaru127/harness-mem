import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { BenchmarkRunner } from "../memory-server/src/benchmark/runner";
import { HarnessMemCore, type Config, type EventEnvelope } from "../memory-server/src/core/harness-mem-core";

type TemporalFocus =
  | "current"
  | "previous"
  | "after"
  | "before"
  | "first"
  | "latest"
  | "still"
  | "no_longer"
  | "直後"
  | "今も"
  | "以前";

interface TemporalCase {
  id: string;
  temporal_focus: TemporalFocus;
  slice: string;
  query_language: "en" | "ja";
  query: string;
  expected_answer_entry_id: string;
  expected_order: string[];
  entries: Array<{ id: string; content: string; timestamp: string }>;
}

interface GateOptions {
  artifactDir?: string;
  fixturePath?: string;
  maxCases?: number;
  writeArtifacts?: boolean;
  now?: Date;
}

interface CaseResult {
  case_id: string;
  focus: TemporalFocus;
  slice: string;
  query_language: "en" | "ja";
  expected_answer_id: string;
  retrieved_ids: string[];
  answer_top1: boolean;
  answer_hit_at_10: boolean;
  order_score: number;
  latency_ms: number;
}

interface TemporalPlannerGateResult {
  schema_version: "s108-temporal-planner.v1";
  generated_at: string;
  task_id: "S108-008";
  fixture: {
    path: string;
    total_cases: number;
    evaluated_cases: number;
  };
  metrics: {
    temporal_order_score: number;
    answer_top1_rate: number;
    answer_hit_at_10: number;
    japanese_temporal_slice: number;
    current_stale_answer_regressions: number;
  };
  gates: {
    temporal_order_score: { threshold: number; passed: boolean };
    japanese_temporal_slice: { threshold: number; passed: boolean };
    current_stale_answer_regressions: { threshold: number; passed: boolean };
  };
  overall_passed: boolean;
  artifacts: {
    summary_json: string | null;
    case_results_json: string | null;
    summary_md: string | null;
  };
}

const ROOT_DIR = resolve(import.meta.dir, "..");
const DEFAULT_FIXTURE = join(ROOT_DIR, "tests/benchmarks/fixtures/temporal-s108-expanded.json");
const DEFAULT_ARTIFACT_DIR = join(ROOT_DIR, "docs/benchmarks/artifacts/s108-temporal-planner-2026-05-07");
const TEMPORAL_ORDER_GATE = 0.70;
const JAPANESE_TEMPORAL_GATE = 0.72;

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

function eventForCase(testCase: TemporalCase, entry: TemporalCase["entries"][number], project: string): EventEnvelope {
  return {
    event_id: `${testCase.id}-${entry.id}`,
    platform: "claude",
    project,
    session_id: `s108-temporal-planner-${testCase.id}`,
    event_type: "user_prompt",
    ts: entry.timestamp,
    event_time: entry.timestamp,
    observed_at: entry.timestamp,
    payload: { content: entry.content },
    tags: [],
    privacy_tags: [],
  };
}

function expectedRankOrder(testCase: TemporalCase): string[] {
  const expectedId = `obs_${testCase.id}-${testCase.expected_answer_entry_id}`;
  const rest = testCase.expected_order
    .map((id) => `obs_${testCase.id}-${id}`)
    .filter((id) => id !== expectedId);
  if (["current", "latest", "still", "no_longer", "今も"].includes(testCase.temporal_focus)) {
    return [expectedId, ...rest.reverse()];
  }
  if (["previous", "以前", "before"].includes(testCase.temporal_focus)) {
    return [expectedId, ...rest];
  }
  return [expectedId, ...rest];
}

function hasCurrentStaleRegression(testCase: TemporalCase, topItem: Record<string, unknown> | undefined): boolean {
  if (!["current", "latest", "still", "今も"].includes(testCase.temporal_focus)) return false;
  const forbidden = (testCase as unknown as { evaluation?: { forbidden_answers?: string[] } }).evaluation?.forbidden_answers ?? [];
  if (forbidden.length === 0) return false;
  const content = String(topItem?.content ?? "").toLowerCase();
  return forbidden.some((answer) => content.includes(answer.toLowerCase()));
}

function renderSummary(result: TemporalPlannerGateResult): string {
  return [
    "# S108-008 Temporal Query Planner Gate",
    "",
    `- generated_at: ${result.generated_at}`,
    `- fixture: ${result.fixture.path}`,
    `- evaluated_cases: ${result.fixture.evaluated_cases}/${result.fixture.total_cases}`,
    `- overall_passed: ${result.overall_passed ? "yes" : "no"}`,
    "",
    "| metric | threshold | value | pass |",
    "|---|---:|---:|---|",
    `| temporal order score | ${result.gates.temporal_order_score.threshold.toFixed(2)} | ${result.metrics.temporal_order_score.toFixed(4)} | ${result.gates.temporal_order_score.passed ? "yes" : "no"} |`,
    `| Japanese temporal slice hit@10 | ${result.gates.japanese_temporal_slice.threshold.toFixed(2)} | ${result.metrics.japanese_temporal_slice.toFixed(4)} | ${result.gates.japanese_temporal_slice.passed ? "yes" : "no"} |`,
    `| current stale answer regressions | ${result.gates.current_stale_answer_regressions.threshold.toFixed(0)} | ${result.metrics.current_stale_answer_regressions.toFixed(0)} | ${result.gates.current_stale_answer_regressions.passed ? "yes" : "no"} |`,
    "",
    `- answer_top1_rate: ${result.metrics.answer_top1_rate.toFixed(4)}`,
    `- answer_hit_at_10: ${result.metrics.answer_hit_at_10.toFixed(4)}`,
    "",
  ].join("\n");
}

export async function runTemporalPlannerGate(options: GateOptions = {}): Promise<TemporalPlannerGateResult> {
  const fixturePath = options.fixturePath ?? DEFAULT_FIXTURE;
  const allCases = JSON.parse(readFileSync(fixturePath, "utf8")) as TemporalCase[];
  const cases = typeof options.maxCases === "number" && options.maxCases > 0
    ? allCases.slice(0, Math.floor(options.maxCases))
    : allCases;
  const tmpDir = mkdtempSync(join(tmpdir(), "harness-mem-s108-temporal-planner-"));
  const core = new HarnessMemCore(createConfig(tmpDir));
  const runner = new BenchmarkRunner(core as never);
  const caseResults: CaseResult[] = [];

  try {
    for (const testCase of cases) {
      const project = `s108-temporal-planner-${testCase.id}`;
      for (const entry of testCase.entries) {
        core.recordEvent(eventForCase(testCase, entry, project));
      }
    }

    for (const testCase of cases) {
      const project = `s108-temporal-planner-${testCase.id}`;
      const startedAt = performance.now();
      const result = core.search({
        query: testCase.query,
        project,
        include_private: true,
        strict_project: true,
        question_kind: "timeline",
        limit: 10,
      });
      const latencyMs = performance.now() - startedAt;
      const items = result.items as Array<Record<string, unknown>>;
      const retrievedIds = items.map((item) => String(item.id ?? ""));
      const expectedAnswerId = `obs_${testCase.id}-${testCase.expected_answer_entry_id}`;
      caseResults.push({
        case_id: testCase.id,
        focus: testCase.temporal_focus,
        slice: testCase.slice,
        query_language: testCase.query_language,
        expected_answer_id: expectedAnswerId,
        retrieved_ids: retrievedIds,
        answer_top1: retrievedIds[0] === expectedAnswerId,
        answer_hit_at_10: retrievedIds.includes(expectedAnswerId),
        order_score: runner.calculateTemporalOrderScore(retrievedIds, expectedRankOrder(testCase), 10),
        latency_ms: round(latencyMs),
      });
    }
  } finally {
    core.shutdown("s108-temporal-planner");
    rmSync(tmpDir, { recursive: true, force: true });
  }

  const japaneseTemporal = caseResults.filter((entry) => entry.query_language === "ja");
  const staleRegressions = caseResults.filter((entry) => {
    if (entry.answer_top1) return false;
    const testCase = cases.find((item) => item.id === entry.case_id);
    if (!testCase) return false;
    const topId = entry.retrieved_ids[0];
    const topEntry = testCase.entries.find((item) => `obs_${testCase.id}-${item.id}` === topId);
    return hasCurrentStaleRegression(testCase, topEntry ? { content: topEntry.content } : undefined);
  }).length;

  const artifactDir = options.artifactDir ?? DEFAULT_ARTIFACT_DIR;
  const summaryJsonPath = join(artifactDir, "summary.json");
  const caseResultsPath = join(artifactDir, "case-results.json");
  const summaryMdPath = join(artifactDir, "summary.md");
  const result: TemporalPlannerGateResult = {
    schema_version: "s108-temporal-planner.v1",
    generated_at: (options.now ?? new Date()).toISOString(),
    task_id: "S108-008",
    fixture: {
      path: rel(fixturePath),
      total_cases: allCases.length,
      evaluated_cases: cases.length,
    },
    metrics: {
      temporal_order_score: round(average(caseResults.map((entry) => entry.order_score))),
      answer_top1_rate: round(average(caseResults.map((entry) => entry.answer_top1 ? 1 : 0))),
      answer_hit_at_10: round(average(caseResults.map((entry) => entry.answer_hit_at_10 ? 1 : 0))),
      japanese_temporal_slice: round(average(japaneseTemporal.map((entry) => entry.answer_hit_at_10 ? 1 : 0))),
      current_stale_answer_regressions: staleRegressions,
    },
    gates: {
      temporal_order_score: { threshold: TEMPORAL_ORDER_GATE, passed: false },
      japanese_temporal_slice: { threshold: JAPANESE_TEMPORAL_GATE, passed: false },
      current_stale_answer_regressions: { threshold: 0, passed: staleRegressions === 0 },
    },
    overall_passed: false,
    artifacts: {
      summary_json: options.writeArtifacts === false ? null : rel(summaryJsonPath),
      case_results_json: options.writeArtifacts === false ? null : rel(caseResultsPath),
      summary_md: options.writeArtifacts === false ? null : rel(summaryMdPath),
    },
  };
  result.gates.temporal_order_score.passed = result.metrics.temporal_order_score >= TEMPORAL_ORDER_GATE;
  result.gates.japanese_temporal_slice.passed = result.metrics.japanese_temporal_slice >= JAPANESE_TEMPORAL_GATE;
  result.overall_passed = Object.values(result.gates).every((gate) => gate.passed);

  if (options.writeArtifacts !== false) {
    mkdirSync(dirname(summaryJsonPath), { recursive: true });
    writeFileSync(summaryJsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    writeFileSync(caseResultsPath, `${JSON.stringify({ schema_version: "s108-temporal-planner-cases.v1", cases: caseResults }, null, 2)}\n`, "utf8");
    writeFileSync(summaryMdPath, renderSummary(result), "utf8");
  }

  return result;
}

function parseArgs(argv: string[]): GateOptions {
  const options: GateOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--artifact-dir" && argv[i + 1]) {
      options.artifactDir = argv[++i];
    } else if (token === "--fixture" && argv[i + 1]) {
      options.fixturePath = argv[++i];
    } else if (token === "--max-cases" && argv[i + 1]) {
      options.maxCases = Number(argv[++i]);
    } else if (token === "--no-write") {
      options.writeArtifacts = false;
    } else if (token === "--help" || token === "-h") {
      process.stdout.write("Usage: scripts/s108-temporal-planner-gate.sh [--artifact-dir DIR] [--max-cases N]\n");
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${token}`);
    }
  }
  return options;
}

if (import.meta.main) {
  try {
    const result = await runTemporalPlannerGate(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.overall_passed) process.exit(1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[s108-temporal-planner-gate] ${message}\n`);
    process.exit(1);
  }
}

export type { GateOptions as TemporalPlannerGateOptions, TemporalPlannerGateResult };
