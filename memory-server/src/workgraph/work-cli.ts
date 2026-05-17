#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { importPlansToWorkGraphDryRun } from "./plans-importer";
import { evaluateWorkReadiness, type ReadyLease } from "./ready";

interface WorkCliOptions {
  project: string;
  plansPath: string;
  dbPath?: string;
  dryRun: boolean;
  write: boolean;
  json: boolean;
  includeArchivedSections: boolean;
  now: string;
}

type WorkSubcommand = "import-plans" | "ready" | "help";

function main(argv: string[]): number {
  const subcommand = normalizeSubcommand(argv[0]);
  if (subcommand === "help") {
    printUsage();
    return 0;
  }

  const options = parseOptions(argv.slice(1));
  if (options.write) {
    throw new Error("work import --write is not implemented yet; omit --write to run the dry-run MVP");
  }

  const markdown = readFileSync(options.plansPath, "utf8");
  const imported = importPlansToWorkGraphDryRun(markdown, {
    project: options.project,
    source: options.plansPath,
    includeArchivedSections: options.includeArchivedSections,
  });

  if (subcommand === "import-plans") {
    const payload = {
      ok: true,
      command: "work.import-plans",
      mode: "dry-run",
      project: options.project,
      plans_path: options.plansPath,
      writes: imported.writes,
      work_items: imported.workItems.length,
      dependencies: imported.dependencies.length,
      diagnostics: imported.diagnostics,
      metrics: imported.metrics,
      parser: imported.parser,
      diff: imported.diff,
    };
    printResult(payload, options.json, formatImportText(payload));
    return 0;
  }

  const activeLeases = loadActiveWorkLeases(options.dbPath ?? defaultDbPath(), options.now);
  const readiness = evaluateWorkReadiness({
    workItems: imported.workItems.map((item) => ({
      workId: item.workId,
      title: item.title,
      status: item.status ?? "open",
    })),
    dependencies: imported.dependencies,
    activeLeases,
    now: options.now,
  });
  const payload = {
    ok: true,
    command: "work.ready",
    project: options.project,
    plans_path: options.plansPath,
    ready: readiness.readyWorkIds,
    decisions: readiness.decisions,
    diagnostics: imported.diagnostics,
    metrics: imported.metrics,
    writes: imported.writes,
  };
  printResult(payload, options.json, formatReadyText(payload));
  return 0;
}

function normalizeSubcommand(raw: string | undefined): WorkSubcommand {
  if (!raw || raw === "help" || raw === "-h" || raw === "--help") return "help";
  if (raw === "import-plans" || raw === "ready") return raw;
  throw new Error(`unknown work subcommand: ${raw}`);
}

function parseOptions(args: string[]): WorkCliOptions {
  let project = process.cwd();
  let plansPath = "";
  let dbPath: string | undefined;
  let dryRun = true;
  let write = false;
  let json = false;
  let includeArchivedSections = false;
  let now = new Date().toISOString();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--project":
        project = requireValue(args, ++index, "--project");
        break;
      case "--plans":
      case "--source":
        plansPath = requireValue(args, ++index, arg);
        break;
      case "--db":
        dbPath = requireValue(args, ++index, "--db");
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--write":
        write = true;
        dryRun = false;
        break;
      case "--json":
        json = true;
        break;
      case "--include-archived":
        includeArchivedSections = true;
        break;
      case "--now":
        now = requireValue(args, ++index, "--now");
        break;
      default:
        if (arg?.startsWith("-")) {
          throw new Error(`unknown work option: ${arg}`);
        }
        if (plansPath) {
          throw new Error(`unexpected extra argument: ${arg}`);
        }
        plansPath = arg ?? "";
    }
  }

  const resolvedProject = resolve(project);
  const resolvedPlansPath = resolve(plansPath || join(resolvedProject, "Plans.md"));
  if (!existsSync(resolvedPlansPath)) {
    throw new Error(`Plans file not found: ${resolvedPlansPath}`);
  }

  return {
    project: resolvedProject,
    plansPath: resolvedPlansPath,
    ...(dbPath ? { dbPath: resolve(dbPath) } : {}),
    dryRun,
    write,
    json,
    includeArchivedSections,
    now,
  };
}

function loadActiveWorkLeases(dbPath: string, now: string): ReadyLease[] {
  if (!existsSync(dbPath)) return [];
  let db: Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    const rows = db
      .query(
        `SELECT target, agent_id, status, expires_at
          FROM mem_leases
          WHERE status = 'active'
            AND target LIKE 'work:%'
            AND expires_at > ?`
      )
      .all(now) as Array<{ target: string; agent_id?: string; status: string; expires_at: string }>;
    return rows.map((row) => ({
      target: row.target,
      ...(row.agent_id ? { agentId: row.agent_id } : {}),
      status: row.status,
      expiresAt: row.expires_at,
    }));
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

function defaultDbPath(): string {
  if (process.env.HARNESS_MEM_DB_PATH) return process.env.HARNESS_MEM_DB_PATH;
  const stateDir = process.env.HARNESS_MEM_HOME || join(process.env.HOME || process.cwd(), ".harness-mem");
  return join(stateDir, "harness-mem.db");
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function printResult(payload: unknown, json: boolean, text: string): void {
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  console.log(text);
}

function formatImportText(payload: {
  work_items: number;
  dependencies: number;
  writes: 0;
  metrics: { plans_import_fidelity: number };
  diagnostics: unknown[];
}): string {
  return [
    "work import-plans dry-run",
    `work_items: ${payload.work_items}`,
    `dependencies: ${payload.dependencies}`,
    `writes: ${payload.writes}`,
    `plans_import_fidelity: ${payload.metrics.plans_import_fidelity.toFixed(3)}`,
    `diagnostics: ${payload.diagnostics.length}`,
  ].join("\n");
}

function formatReadyText(payload: { ready: string[]; decisions: Array<{ workId: string; ready: boolean }> }): string {
  const lines = ["work ready"];
  if (payload.ready.length === 0) {
    lines.push("(none)");
  } else {
    for (const workId of payload.ready) {
      lines.push(`- ${workId}`);
    }
  }
  lines.push(`decisions: ${payload.decisions.length}`);
  return lines.join("\n");
}

function printUsage(): void {
  console.log(`Usage:
  harness-mem work import-plans [Plans.md] [--project <path>] [--dry-run] [--json]
  harness-mem work ready --project <path> [--plans <Plans.md>] [--json]
`);
}

try {
  process.exit(main(process.argv.slice(2)));
} catch (error) {
  console.error(`[harness-mem][work][error] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
