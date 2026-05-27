#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { runWorkGraphReleaseGateSmoke, type WorkGraphReleaseGateResult } from "../memory-server/src/benchmark/workgraph-release-gate";
import { importPlansToWorkGraphDryRun, type PlansImportDryRunResult } from "../memory-server/src/workgraph/plans-importer";

interface CommandCheck {
  label: string;
  command: string[];
  exit_code: number;
  duration_ms: number;
  log_path: string;
  passed: boolean;
}

interface RealPlansCheck {
  path: string;
  writes: 0;
  imported_work_items: number;
  expected_work_items: number;
  dependencies: number;
  diff_entries: number;
  plans_import_fidelity: number;
  diagnostics_count: number;
  diagnostics_by_code: Record<string, number>;
  required_task_ids_present: string[];
  passed: boolean;
}

interface ReadinessPack {
  schema_version: "s125-workgraph-enforce-readiness.v1";
  task_id: "S125-016";
  generated_at: string;
  artifact_dir: string;
  gate_runs: Array<{
    run: number;
    artifact: string;
    mode: WorkGraphReleaseGateResult["mode"];
    tier: WorkGraphReleaseGateResult["tier"];
    passed: boolean;
    failed_metrics: string[];
    metrics: WorkGraphReleaseGateResult["metrics"];
  }>;
  real_plans_dry_run: RealPlansCheck;
  command_checks: CommandCheck[];
  overall_passed: boolean;
  recommendation: "ready_for_workgraph_release_enforce" | "keep_warn_until_followup";
}

interface Options {
  artifactDir?: string;
  runs?: number;
  plansPath?: string;
  project?: string;
  skipContract?: boolean;
  now?: Date;
}

const ROOT_DIR = resolve(import.meta.dir, "..");
const DEFAULT_ARTIFACT_DIR = join(ROOT_DIR, "docs/benchmarks/artifacts/s125-workgraph-enforce-readiness-2026-05-27");
const FIDELITY_FLOOR = 0.98;
const REQUIRED_TASK_IDS = ["S125-016", "S108-017"];

function normalizeRuns(value: number | undefined): number {
  if (value === undefined) return 3;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new Error("--runs must be a positive integer");
  }
  return value;
}

function rel(path: string): string {
  return relative(ROOT_DIR, path).replace(/\\/g, "/");
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function diagnosticsByCode(result: PlansImportDryRunResult): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const diagnostic of result.diagnostics) {
    counts[diagnostic.code] = (counts[diagnostic.code] ?? 0) + 1;
  }
  return counts;
}

function runCommand(label: string, command: string[], artifactDir: string): CommandCheck {
  const logPath = join(artifactDir, `${label}.log`);
  const started = performance.now();
  const result = Bun.spawnSync({
    cmd: command,
    cwd: ROOT_DIR,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();
  const output = [stdout, stderr].filter(Boolean).join("\n");
  writeFileSync(logPath, output, "utf8");
  return {
    label,
    command,
    exit_code: result.exitCode ?? 1,
    duration_ms: round(performance.now() - started),
    log_path: rel(logPath),
    passed: (result.exitCode ?? 1) === 0,
  };
}

function runRealPlansDryRun(plansPath: string, project: string): RealPlansCheck {
  const markdown = readFileSync(plansPath, "utf8");
  const result = importPlansToWorkGraphDryRun(markdown, {
    project,
    source: "Plans.md",
  });
  const workIds = new Set(result.workItems.map((item) => item.workId));
  const requiredTaskIdsPresent = REQUIRED_TASK_IDS.filter((id) => workIds.has(id));
  const fidelity = round(result.metrics.plans_import_fidelity);
  const passed =
    result.writes === 0 &&
    result.workItems.length > 0 &&
    fidelity >= FIDELITY_FLOOR &&
    requiredTaskIdsPresent.length === REQUIRED_TASK_IDS.length;

  return {
    path: rel(plansPath),
    writes: result.writes,
    imported_work_items: result.metrics.importedWorkItems,
    expected_work_items: result.metrics.expectedWorkItems,
    dependencies: result.dependencies.length,
    diff_entries: result.diff.length,
    plans_import_fidelity: fidelity,
    diagnostics_count: result.diagnostics.length,
    diagnostics_by_code: diagnosticsByCode(result),
    required_task_ids_present: requiredTaskIdsPresent,
    passed,
  };
}

export async function runS125WorkGraphEnforceReadinessPack(options: Options = {}): Promise<ReadinessPack> {
  const artifactDir = resolve(options.artifactDir ?? DEFAULT_ARTIFACT_DIR);
  const runs = normalizeRuns(options.runs);
  const plansPath = resolve(options.plansPath ?? join(ROOT_DIR, "Plans.md"));
  const project = options.project ?? ROOT_DIR;
  const now = options.now ?? new Date();
  mkdirSync(artifactDir, { recursive: true });

  const gateRuns: ReadinessPack["gate_runs"] = [];
  for (let i = 1; i <= runs; i += 1) {
    const result = runWorkGraphReleaseGateSmoke("enforce");
    const artifact = join(artifactDir, `workgraph-enforce-${i}.json`);
    writeFileSync(artifact, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    gateRuns.push({
      run: i,
      artifact: rel(artifact),
      mode: result.mode,
      tier: result.tier,
      passed: result.passed,
      failed_metrics: result.failed_metrics,
      metrics: result.metrics,
    });
  }

  const realPlansDryRun = runRealPlansDryRun(plansPath, project);
  const commandChecks = options.skipContract
    ? []
    : [
        runCommand(
          "release_workflow_contract",
          ["bun", "test", "tests/release-workflow-contract.test.ts", "tests/workgraph-release-gate-script.test.ts"],
          artifactDir,
        ),
      ];

  const overallPassed =
    gateRuns.every((run) => run.passed) &&
    realPlansDryRun.passed &&
    commandChecks.every((check) => check.passed);

  const pack: ReadinessPack = {
    schema_version: "s125-workgraph-enforce-readiness.v1",
    task_id: "S125-016",
    generated_at: now.toISOString(),
    artifact_dir: rel(artifactDir),
    gate_runs: gateRuns,
    real_plans_dry_run: realPlansDryRun,
    command_checks: commandChecks,
    overall_passed: overallPassed,
    recommendation: overallPassed ? "ready_for_workgraph_release_enforce" : "keep_warn_until_followup",
  };

  writeFileSync(join(artifactDir, "summary.json"), `${JSON.stringify(pack, null, 2)}\n`, "utf8");
  return pack;
}

function parseArgs(argv: string[]): Options & { json?: boolean } {
  const options: Options & { json?: boolean } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--artifact-dir" && argv[i + 1]) {
      options.artifactDir = argv[++i];
    } else if (token === "--runs" && argv[i + 1]) {
      const parsed = Number(argv[++i]);
      options.runs = normalizeRuns(parsed);
    } else if (token === "--plans" && argv[i + 1]) {
      options.plansPath = argv[++i];
    } else if (token === "--project" && argv[i + 1]) {
      options.project = argv[++i];
    } else if (token === "--skip-contract") {
      options.skipContract = true;
    } else if (token === "--json") {
      options.json = true;
    } else if (token === "--help" || token === "-h") {
      process.stdout.write("Usage: bun scripts/s125-workgraph-enforce-readiness-pack.ts [--artifact-dir DIR] [--runs 3] [--plans Plans.md] [--project DIR] [--skip-contract] [--json]\n");
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${token}`);
    }
  }
  return options;
}

if (import.meta.main) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const pack = await runS125WorkGraphEnforceReadinessPack(options);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(pack, null, 2)}\n`);
    } else {
      process.stdout.write(
        `[s125-016] status=${pack.overall_passed ? "pass" : "fail"} ` +
          `recommendation=${pack.recommendation} artifact=${pack.artifact_dir}/summary.json\n`,
      );
    }
    if (!pack.overall_passed) process.exit(1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[s125-016] ${message}\n`);
    process.exit(1);
  }
}

export type { CommandCheck, ReadinessPack, RealPlansCheck };
