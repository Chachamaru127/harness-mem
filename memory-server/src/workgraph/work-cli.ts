#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { configureDatabase, initSchema } from "../db/schema";
import { importPlansToWorkGraphDryRun } from "./plans-importer";
import { evaluateWorkReadiness, type ReadyLease } from "./ready";
import { createWorkStore, type WorkDependencyInput, type WorkItemInput, type WorkItemRow } from "./work-store";

interface WorkCliOptions {
  project: string;
  plansPath: string;
  plansPathExplicit: boolean;
  dbPath?: string;
  dryRun: boolean;
  write: boolean;
  json: boolean;
  includeArchivedSections: boolean;
  now: string;
  allProjects: boolean;
  roots: string[];
  maxDepth: number;
}

type WorkSubcommand = "import-plans" | "ready" | "export-plans" | "sync-plans" | "help";

interface SyncCandidate {
  project: string;
  plansPath: string;
  source: "project" | "all_projects" | "root";
}

interface SyncDiagnostic {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  project?: string;
  plans_path?: string;
  work_id?: string;
  existing_project?: string;
}

function main(argv: string[]): number {
  const subcommand = normalizeSubcommand(argv[0]);
  if (subcommand === "help") {
    printUsage();
    return 0;
  }

  const options = parseOptions(argv.slice(1), subcommand);
  if (subcommand === "sync-plans") {
    const payload = syncPlans(options);
    printResult(payload, options.json, formatSyncPlansText(payload));
    return 0;
  }

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
  if (raw === "import-plans" || raw === "ready" || raw === "export-plans" || raw === "sync-plans") return raw;
  throw new Error(`unknown work subcommand: ${raw}`);
}

function parseOptions(args: string[], subcommand: WorkSubcommand): WorkCliOptions {
  let project = process.cwd();
  let plansPath = "";
  let plansPathExplicit = false;
  let dbPath: string | undefined;
  let dryRun = true;
  let write = false;
  let json = false;
  let includeArchivedSections = false;
  let now = new Date().toISOString();
  let allProjects = false;
  const roots: string[] = [];
  let maxDepth = 4;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--project":
        project = requireValue(args, ++index, "--project");
        break;
      case "--plans":
      case "--source":
        plansPath = requireValue(args, ++index, arg);
        plansPathExplicit = true;
        break;
      case "--db":
        dbPath = requireValue(args, ++index, "--db");
        break;
      case "--all-projects":
        allProjects = true;
        break;
      case "--root":
        roots.push(requireValue(args, ++index, "--root"));
        break;
      case "--max-depth":
        maxDepth = Math.max(0, Math.min(12, Number(requireValue(args, ++index, "--max-depth")) || 0));
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
        plansPathExplicit = true;
    }
  }

  const resolvedProject = resolve(project);
  const resolvedPlansPath = resolve(plansPath || join(resolvedProject, "Plans.md"));
  if (subcommand !== "sync-plans" && !existsSync(resolvedPlansPath)) {
    throw new Error(`Plans file not found: ${resolvedPlansPath}`);
  }

  return {
    project: resolvedProject,
    plansPath: resolvedPlansPath,
    plansPathExplicit,
    ...(dbPath ? { dbPath: resolve(dbPath) } : {}),
    dryRun,
    write,
    json,
    includeArchivedSections,
    now,
    allProjects,
    roots: roots.map((root) => resolve(root)),
    maxDepth,
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

function syncPlans(options: WorkCliOptions): {
  ok: true;
  command: string;
  mode: string;
  db_path: string;
  candidates: number;
  projects_synced: number;
  projects_skipped: number;
  writes: number;
  work_items: number;
  dependencies: number;
  results: Array<Record<string, unknown>>;
  diagnostics: SyncDiagnostic[];
} {
  const dbPath = options.dbPath ?? defaultDbPath();
  const diagnostics: SyncDiagnostic[] = [];
  const candidates = discoverSyncCandidates(options, dbPath, diagnostics);
  const results: Array<Record<string, unknown>> = [];
  const seenWorkProjects = new Map<string, string>();
  let writes = 0;
  let workItems = 0;
  let dependencies = 0;

  for (const candidate of candidates) {
    try {
      const markdown = readFileSync(candidate.plansPath, "utf8");
      const imported = importPlansToWorkGraphDryRun(markdown, {
        project: candidate.project,
        source: candidate.plansPath,
        includeArchivedSections: options.includeArchivedSections,
      });
      if (imported.workItems.length === 0) {
        diagnostics.push({
          code: "no_work_items",
          severity: "info",
          message: `Plans.md has no parseable active WorkGraph tasks: ${candidate.plansPath}`,
          project: candidate.project,
          plans_path: candidate.plansPath,
        });
        results.push({
          project: candidate.project,
          plans_path: candidate.plansPath,
          source: candidate.source,
          mode: options.write ? "write" : "dry-run",
          skipped: true,
          skip_reason: "no_work_items",
          writes: 0,
          work_items: 0,
          dependencies: 0,
          diagnostics: imported.diagnostics,
          metrics: imported.metrics,
        });
        continue;
      }
      const conflicts = [
        ...findInBatchWorkIdConflicts(imported.workItems, candidate.project, seenWorkProjects),
        ...findDbWorkIdConflicts(dbPath, candidate.project, imported.workItems.map((item) => item.workId)),
      ];
      if (conflicts.length > 0) {
        for (const conflict of conflicts.slice(0, 5)) {
          diagnostics.push({
            code: "work_id_project_conflict",
            severity: "warning",
            message: `work_id ${conflict.workId} already belongs to ${conflict.existingProject}; skipped ${candidate.project}`,
            project: candidate.project,
            plans_path: candidate.plansPath,
            work_id: conflict.workId,
            existing_project: conflict.existingProject,
          });
        }
        results.push({
          project: candidate.project,
          plans_path: candidate.plansPath,
          source: candidate.source,
          mode: options.write ? "write" : "dry-run",
          skipped: true,
          skip_reason: "work_id_project_conflict",
          conflicts: conflicts.length,
          work_items: imported.workItems.length,
          dependencies: imported.dependencies.length,
          diagnostics: imported.diagnostics,
        });
        continue;
      }

      const writeResult = options.write ? writeImport(dbPath, imported.workItems, imported.dependencies) : null;
      for (const item of imported.workItems) {
        seenWorkProjects.set(item.workId, candidate.project);
      }
      writes += writeResult?.writes ?? 0;
      workItems += imported.workItems.length;
      dependencies += imported.dependencies.length;
      results.push({
        project: candidate.project,
        plans_path: candidate.plansPath,
        source: candidate.source,
        mode: options.write ? "write" : "dry-run",
        skipped: false,
        writes: writeResult?.writes ?? imported.writes,
        work_items: imported.workItems.length,
        dependencies: imported.dependencies.length,
        written_work_items: writeResult?.workItems ?? 0,
        written_dependencies: writeResult?.dependencies ?? 0,
        duplicate_work_rate: writeResult?.duplicateWorkRate ?? 0,
        diagnostics: imported.diagnostics,
        metrics: imported.metrics,
      });
    } catch (error) {
      diagnostics.push({
        code: "sync_import_failed",
        severity: "error",
        message: error instanceof Error ? error.message : String(error),
        project: candidate.project,
        plans_path: candidate.plansPath,
      });
      results.push({
        project: candidate.project,
        plans_path: candidate.plansPath,
        source: candidate.source,
        mode: options.write ? "write" : "dry-run",
        skipped: true,
        skip_reason: "sync_import_failed",
      });
    }
  }

  return {
    ok: true,
    command: "work.sync-plans",
    mode: options.write ? "write" : "dry-run",
    db_path: dbPath,
    candidates: candidates.length,
    projects_synced: results.filter((result) => result.skipped !== true).length,
    projects_skipped: results.filter((result) => result.skipped === true).length,
    writes,
    work_items: workItems,
    dependencies,
    results,
    diagnostics,
  };
}

function discoverSyncCandidates(options: WorkCliOptions, dbPath: string, diagnostics: SyncDiagnostic[]): SyncCandidate[] {
  const candidates: SyncCandidate[] = [];
  const includeDefaultProject = options.plansPathExplicit || (!options.allProjects && options.roots.length === 0);
  if (includeDefaultProject) {
    addProjectCandidate(candidates, diagnostics, options.project, options.plansPath, "project");
  }
  if (options.allProjects) {
    for (const project of loadKnownProjects(dbPath, diagnostics)) {
      addProjectCandidate(candidates, diagnostics, project, "", "all_projects");
    }
  }
  for (const root of options.roots) {
    for (const candidate of findPlansCandidatesUnderRoot(root, options.maxDepth, diagnostics)) {
      candidates.push(candidate);
    }
  }
  return dedupeCandidates(candidates);
}

function addProjectCandidate(
  candidates: SyncCandidate[],
  diagnostics: SyncDiagnostic[],
  projectInput: string,
  plansPathInput: string,
  source: SyncCandidate["source"]
): void {
  const project = resolve(projectInput);
  const plansPath = plansPathInput ? resolve(plansPathInput) : join(project, "Plans.md");
  if (!existsSync(project) || !safeIsDirectory(project)) {
    diagnostics.push({
      code: "project_not_directory",
      severity: "warning",
      message: `project is not a local directory: ${projectInput}`,
      project,
      plans_path: plansPath,
    });
    return;
  }
  if (!existsSync(plansPath) || !safeIsFile(plansPath)) {
    diagnostics.push({
      code: "plans_not_found",
      severity: "info",
      message: `Plans.md not found for project: ${project}`,
      project,
      plans_path: plansPath,
    });
    return;
  }
  candidates.push({ project, plansPath, source });
}

function loadKnownProjects(dbPath: string, diagnostics: SyncDiagnostic[]): string[] {
  if (!existsSync(dbPath)) {
    diagnostics.push({
      code: "db_not_found",
      severity: "warning",
      message: `cannot discover --all-projects because DB does not exist: ${dbPath}`,
    });
    return [];
  }
  const db = new Database(dbPath, { readonly: true });
  try {
    const projects = new Set<string>();
    for (const table of ["mem_observations", "mem_sessions", "mem_work_items"]) {
      try {
        const rows = db
          .query(`SELECT DISTINCT project FROM ${table} WHERE project IS NOT NULL AND TRIM(project) <> ''`)
          .all() as Array<{ project: string }>;
        for (const row of rows) {
          if (row.project) projects.add(row.project);
        }
      } catch {
        // Older DBs may not have WorkGraph tables yet; keep discovering from the tables that exist.
      }
    }
    return [...projects].sort((lhs, rhs) => lhs.localeCompare(rhs));
  } finally {
    db.close();
  }
}

function findPlansCandidatesUnderRoot(rootInput: string, maxDepth: number, diagnostics: SyncDiagnostic[]): SyncCandidate[] {
  const root = resolve(rootInput);
  if (!existsSync(root) || !safeIsDirectory(root)) {
    diagnostics.push({
      code: "root_not_directory",
      severity: "warning",
      message: `root is not a local directory: ${rootInput}`,
      project: root,
    });
    return [];
  }

  const candidates: SyncCandidate[] = [];
  const skipNames = new Set([".git", "node_modules", ".harness-mem", ".claude", ".codex", "dist", "build", ".next", "coverage"]);
  const walk = (dir: string, depth: number): void => {
    const plansPath = join(dir, "Plans.md");
    if (existsSync(plansPath) && safeIsFile(plansPath)) {
      candidates.push({ project: dir, plansPath, source: "root" });
      return;
    }
    if (depth >= maxDepth) {
      return;
    }
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skipNames.has(entry)) continue;
      const child = join(dir, entry);
      if (safeIsDirectory(child)) {
        walk(child, depth + 1);
      }
    }
  };
  walk(root, 0);
  return candidates;
}

function dedupeCandidates(candidates: SyncCandidate[]): SyncCandidate[] {
  const seen = new Set<string>();
  const deduped: SyncCandidate[] = [];
  for (const candidate of candidates) {
    const key = resolve(candidate.plansPath);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }
  return deduped;
}

function findInBatchWorkIdConflicts(
  workItems: WorkItemInput[],
  project: string,
  seenWorkProjects: Map<string, string>
): Array<{ workId: string; existingProject: string }> {
  const conflicts: Array<{ workId: string; existingProject: string }> = [];
  for (const item of workItems) {
    const existingProject = seenWorkProjects.get(item.workId);
    if (existingProject && existingProject !== project) {
      conflicts.push({ workId: item.workId, existingProject });
    }
  }
  return conflicts;
}

function findDbWorkIdConflicts(
  dbPath: string,
  project: string,
  workIds: string[]
): Array<{ workId: string; existingProject: string }> {
  if (!existsSync(dbPath) || workIds.length === 0) {
    return [];
  }
  const db = new Database(dbPath, { readonly: true });
  try {
    const uniqueIds = [...new Set(workIds)];
    const placeholders = uniqueIds.map(() => "?").join(",");
    const rows = db
      .query(`SELECT work_id, project FROM mem_work_items WHERE work_id IN (${placeholders}) AND project <> ?`)
      .all(...uniqueIds, project) as Array<{ work_id: string; project: string }>;
    return rows.map((row) => ({ workId: row.work_id, existingProject: row.project }));
  } catch {
    return [];
  } finally {
    db.close();
  }
}

function safeIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function safeIsFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
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

function formatSyncPlansText(payload: {
  mode: string;
  candidates: number;
  projects_synced: number;
  projects_skipped: number;
  writes: number;
  work_items: number;
  dependencies: number;
  diagnostics: SyncDiagnostic[];
  results: Array<Record<string, unknown>>;
}): string {
  const lines = [
    `work sync-plans ${payload.mode}`,
    `candidates: ${payload.candidates}`,
    `projects_synced: ${payload.projects_synced}`,
    `projects_skipped: ${payload.projects_skipped}`,
    `writes: ${payload.writes}`,
    `work_items: ${payload.work_items}`,
    `dependencies: ${payload.dependencies}`,
  ];
  for (const result of payload.results.slice(0, 12)) {
    const marker = result.skipped === true ? "skip" : "ok";
    lines.push(
      `- ${marker} ${String(result.project)} (${String(result.source)}): work_items=${Number(result.work_items ?? 0)} writes=${Number(result.writes ?? 0)}`
    );
  }
  if (payload.results.length > 12) {
    lines.push(`... ${payload.results.length - 12} more projects`);
  }
  lines.push(`diagnostics: ${payload.diagnostics.length}`);
  return lines.join("\n");
}

function printUsage(): void {
  console.log(`Usage:
  harness-mem work import-plans [Plans.md] [--project <path>] [--dry-run] [--json]
  harness-mem work ready --project <path> [--plans <Plans.md>] [--json]
  harness-mem work sync-plans [--project <path>|--all-projects|--root <dir>] [--dry-run|--write] [--json]
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
