#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { configureDatabase, initSchema } from "../db/schema";
import { importPlansToWorkGraphDryRun } from "./plans-importer";
import { evaluateWorkReadiness, type ReadyLease } from "./ready";
import { createWorkStore, type WorkDependencyInput, type WorkItemInput, type WorkItemRow } from "./work-store";

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

type WorkSubcommand = "import-plans" | "ready" | "export-plans" | "help";

function main(argv: string[]): number {
  const subcommand = normalizeSubcommand(argv[0]);
  if (subcommand === "help") {
    printUsage();
    return 0;
  }

  const options = parseOptions(argv.slice(1));
  const markdown = readFileSync(options.plansPath, "utf8");
  const imported = importPlansToWorkGraphDryRun(markdown, {
    project: options.project,
    source: options.plansPath,
    includeArchivedSections: options.includeArchivedSections,
  });

  if (subcommand === "import-plans") {
    const writeResult = options.write ? writeImport(options.dbPath ?? defaultDbPath(), imported.workItems, imported.dependencies) : null;
    const payload = {
      ok: true,
      command: "work.import-plans",
      mode: options.write ? "write" : "dry-run",
      project: options.project,
      plans_path: options.plansPath,
      writes: writeResult?.writes ?? imported.writes,
      work_items: imported.workItems.length,
      dependencies: imported.dependencies.length,
      written_work_items: writeResult?.workItems ?? 0,
      written_dependencies: writeResult?.dependencies ?? 0,
      diagnostics: imported.diagnostics,
      metrics: imported.metrics,
      duplicate_work_rate: writeResult?.duplicateWorkRate ?? 0,
      parser: imported.parser,
      diff: imported.diff,
    };
    printResult(payload, options.json, formatImportText(payload));
    return 0;
  }

  if (subcommand === "export-plans") {
    const payload = exportPlans(options.dbPath ?? defaultDbPath(), options.project);
    printResult(payload, options.json, payload.markdown);
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
  if (raw === "import-plans" || raw === "ready" || raw === "export-plans") return raw;
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

function writeImport(
  dbPath: string,
  workItems: WorkItemInput[],
  dependencies: WorkDependencyInput[]
): { writes: number; workItems: number; dependencies: number; duplicateWorkRate: number } {
  const db = new Database(dbPath);
  try {
    configureDatabase(db);
    initSchema(db);
    const store = createWorkStore(db);
    const importedWorkIds = new Set(workItems.map((item) => item.workId));
    for (const item of workItems) {
      store.upsertWorkItem(item);
    }

    let writtenDependencies = 0;
    for (const dependency of dependencies) {
      if (!importedWorkIds.has(dependency.fromWorkId) || !importedWorkIds.has(dependency.toWorkId)) {
        continue;
      }
      store.addDependency(dependency);
      writtenDependencies += 1;
    }

    const storedWorkItems = store.listWorkItems(workItems[0]?.project).filter((item) => importedWorkIds.has(item.workId));
    const duplicateWorkRate = ratio(Math.max(0, workItems.length - storedWorkItems.length), Math.max(1, workItems.length));
    return {
      writes: workItems.length + writtenDependencies,
      workItems: workItems.length,
      dependencies: writtenDependencies,
      duplicateWorkRate,
    };
  } finally {
    db.close();
  }
}

function exportPlans(dbPath: string, project: string): { ok: true; command: string; project: string; writes: 0; markdown: string } {
  const db = new Database(dbPath, { readonly: true });
  try {
    configureDatabase(db);
    const store = createWorkStore(db);
    const workItems = store.listWorkItems(project);
    const dependencies = store.listDependencies();
    return {
      ok: true,
      command: "work.export-plans",
      project,
      writes: 0,
      markdown: formatGeneratedPlans(workItems, dependencies),
    };
  } finally {
    db.close();
  }
}

function formatGeneratedPlans(workItems: WorkItemRow[], dependencies: WorkDependencyInput[]): string {
  const blockersByWorkId = new Map<string, string[]>();
  for (const dependency of dependencies) {
    if (dependency.relation !== "blocks") continue;
    const blockers = blockersByWorkId.get(dependency.toWorkId) ?? [];
    blockers.push(dependency.fromWorkId);
    blockersByWorkId.set(dependency.toWorkId, blockers);
  }

  const lines = [
    "# Plans.generated.md",
    "",
    "_Generated by harness-mem WorkGraph. Plans.md remains the source of truth._",
    "",
    "| Task | Title | Status | Depends | Source |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const item of workItems) {
    lines.push(
      `| ${escapeCell(item.workId)} | ${escapeCell(item.title)} | ${escapeCell(item.status)} | ${escapeCell((blockersByWorkId.get(item.workId) ?? []).join(", ") || "-")} | ${escapeCell(item.sourceRef ?? "-")} |`
    );
  }
  return `${lines.join("\n")}\n`;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
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
  writes: number;
  metrics: { plans_import_fidelity: number };
  duplicate_work_rate: number;
  diagnostics: unknown[];
}): string {
  return [
    "work import-plans dry-run",
    `work_items: ${payload.work_items}`,
    `dependencies: ${payload.dependencies}`,
    `writes: ${payload.writes}`,
    `plans_import_fidelity: ${payload.metrics.plans_import_fidelity.toFixed(3)}`,
    `duplicate_work_rate: ${payload.duplicate_work_rate.toFixed(3)}`,
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
  harness-mem work export-plans --project <path> [--json]
`);
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

try {
  process.exit(main(process.argv.slice(2)));
} catch (error) {
  console.error(`[harness-mem][work][error] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
