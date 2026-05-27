#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { runRecallRuntimeGate, type RecallRuntimeGateManifest } from "./s128-recall-runtime-gate";

interface CommandCheck {
  label: string;
  command: string[];
  exit_code: number;
  duration_ms: number;
  log_path: string;
  passed: boolean;
  parsed?: Record<string, unknown>;
}

interface LiveRecallCheck {
  label: "live_recall_explain";
  command: string[];
  exit_code: number;
  log_path: string;
  passed: boolean;
  item_count: number;
  degraded: boolean | null;
  degraded_reason: string | null;
}

interface ReadinessPack {
  schema_version: "s128-enforce-readiness.v1";
  task_id: "S128-021";
  generated_at: string;
  artifact_dir: string;
  gate_runs: Array<{
    run: number;
    artifact: string;
    status: RecallRuntimeGateManifest["summary"]["status"];
    warnings: string[];
    recall_p95_ms: number;
    fallback_rate: number;
    adr_precision: number;
    passed: boolean;
  }>;
  live_recall: LiveRecallCheck;
  command_checks: CommandCheck[];
  overall_passed: boolean;
  recommendation: "ready_for_s128_release_enforce" | "keep_warn_until_followup";
}

interface Options {
  artifactDir?: string;
  runs?: number;
  chaosRounds?: number;
  project?: string;
  query?: string;
  now?: Date;
}

const ROOT_DIR = resolve(import.meta.dir, "..");
const DEFAULT_ARTIFACT_DIR = join(ROOT_DIR, "docs/benchmarks/artifacts/s128-enforce-readiness-2026-05-27");

function rel(path: string): string {
  return relative(ROOT_DIR, path).replace(/\\/g, "/");
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
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

  const parsed: Record<string, unknown> = {};
  if (label === "memory_durability_migration") {
    const match = output.match(/Migration Recall@10:\s*([0-9.]+)\s*\((\d+)\/(\d+)\)/);
    if (match) {
      parsed.recall_at_10 = Number(match[1]);
      parsed.hits = Number(match[2]);
      parsed.total = Number(match[3]);
    }
  }
  if (label === "chaos_smoke") {
    const match = output.match(/\[chaos\] PASSED rounds=(\d+)/);
    if (match) parsed.rounds = Number(match[1]);
  }

  return {
    label,
    command,
    exit_code: result.exitCode ?? 1,
    duration_ms: round(performance.now() - started),
    log_path: rel(logPath),
    passed: (result.exitCode ?? 1) === 0,
    parsed: Object.keys(parsed).length > 0 ? parsed : undefined,
  };
}

function runLiveRecall(project: string, query: string, artifactDir: string): LiveRecallCheck {
  const command = [
    "scripts/harness-mem",
    "recall",
    "explain",
    "--query",
    query,
    "--project",
    project,
    "--limit",
    "3",
  ];
  const logPath = join(artifactDir, "live_recall_explain.json");
  const result = Bun.spawnSync({
    cmd: command,
    cwd: ROOT_DIR,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();
  writeFileSync(logPath, stdout || stderr, "utf8");

  let itemCount = 0;
  let degraded: boolean | null = null;
  let degradedReason: string | null = null;
  try {
    const parsed = JSON.parse(stdout) as {
      ok?: boolean;
      items?: unknown[];
      meta?: { recall_degraded?: boolean; recall_degraded_reason?: string };
    };
    itemCount = Array.isArray(parsed.items) ? parsed.items.length : 0;
    degraded = typeof parsed.meta?.recall_degraded === "boolean" ? parsed.meta.recall_degraded : null;
    degradedReason = typeof parsed.meta?.recall_degraded_reason === "string" ? parsed.meta.recall_degraded_reason : null;
  } catch {
    itemCount = 0;
  }

  return {
    label: "live_recall_explain",
    command,
    exit_code: result.exitCode ?? 1,
    log_path: rel(logPath),
    passed: (result.exitCode ?? 1) === 0 && itemCount > 0,
    item_count: itemCount,
    degraded,
    degraded_reason: degradedReason,
  };
}

export async function runS128EnforceReadinessPack(options: Options = {}): Promise<ReadinessPack> {
  const artifactDir = resolve(options.artifactDir ?? DEFAULT_ARTIFACT_DIR);
  const runs = Math.max(1, Math.floor(options.runs ?? 3));
  const chaosRounds = Math.max(1, Math.floor(options.chaosRounds ?? 2));
  const project = options.project ?? "harness-mem";
  const query = options.query ?? "Recall Runtime Architecture";
  const now = options.now ?? new Date();
  mkdirSync(artifactDir, { recursive: true });

  const gateRuns: ReadinessPack["gate_runs"] = [];
  for (let i = 1; i <= runs; i += 1) {
    const manifest = await runRecallRuntimeGate({
      mode: "enforce",
      project: `s128-readiness-${i}`,
      now: () => now.toISOString(),
    });
    const artifact = join(artifactDir, `recall-runtime-enforce-${i}.json`);
    writeFileSync(artifact, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    gateRuns.push({
      run: i,
      artifact: rel(artifact),
      status: manifest.summary.status,
      warnings: manifest.summary.warnings,
      recall_p95_ms: manifest.metrics.recall_p95.value,
      fallback_rate: manifest.metrics.fallback_rate.value,
      adr_precision: manifest.metrics.adr_precision.value,
      passed: manifest.summary.status === "pass",
    });
  }

  const liveRecall = runLiveRecall(project, query, artifactDir);
  const commandChecks = [
    runCommand(
      "memory_durability_migration",
      [
        "bash",
        "scripts/run-bun-test-safe.sh",
        "tests/benchmarks/memory-durability.test.ts",
        "-t",
        "Long-term Recall@10: migration",
      ],
      artifactDir,
    ),
    runCommand("chaos_smoke", ["bash", "tests/test-memory-daemon-chaos.sh", String(chaosRounds)], artifactDir),
    runCommand(
      "release_workflow_contract",
      ["bun", "test", "scripts/s128-recall-runtime-gate.test.ts", "tests/release-workflow-contract.test.ts"],
      artifactDir,
    ),
  ];

  const overallPassed =
    gateRuns.every((run) => run.passed) &&
    liveRecall.passed &&
    commandChecks.every((check) => check.passed);

  const pack: ReadinessPack = {
    schema_version: "s128-enforce-readiness.v1",
    task_id: "S128-021",
    generated_at: now.toISOString(),
    artifact_dir: rel(artifactDir),
    gate_runs: gateRuns,
    live_recall: liveRecall,
    command_checks: commandChecks,
    overall_passed: overallPassed,
    recommendation: overallPassed ? "ready_for_s128_release_enforce" : "keep_warn_until_followup",
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
      options.runs = Number(argv[++i]);
    } else if (token === "--chaos-rounds" && argv[i + 1]) {
      options.chaosRounds = Number(argv[++i]);
    } else if (token === "--project" && argv[i + 1]) {
      options.project = argv[++i];
    } else if (token === "--query" && argv[i + 1]) {
      options.query = argv[++i];
    } else if (token === "--json") {
      options.json = true;
    } else if (token === "--help" || token === "-h") {
      process.stdout.write("Usage: bun scripts/s128-enforce-readiness-pack.ts [--artifact-dir DIR] [--runs 3] [--chaos-rounds 2] [--project harness-mem] [--query TEXT] [--json]\n");
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
    const pack = await runS128EnforceReadinessPack(options);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(pack, null, 2)}\n`);
    } else {
      process.stdout.write(
        `[s128-021] status=${pack.overall_passed ? "pass" : "fail"} ` +
          `recommendation=${pack.recommendation} artifact=${pack.artifact_dir}/summary.json\n`,
      );
    }
    if (!pack.overall_passed) process.exit(1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[s128-021] ${message}\n`);
    process.exit(1);
  }
}

export type { CommandCheck, LiveRecallCheck, ReadinessPack };
