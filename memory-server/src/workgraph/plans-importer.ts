import { parsePlansDryRun, type ParsedPlansTask, type PlansParserDiagnostic, type PlansParserOptions } from "./plans-parser";
import type { WorkDependencyInput, WorkItemInput } from "./work-store";

export type PlansImportDiagnosticCode =
  | PlansParserDiagnostic["code"]
  | "duplicate_work_item"
  | "invalid_dependency_source_ref"
  | "missing_dependency_work_item";

export interface PlansImportOptions extends PlansParserOptions {
  project: string;
  createdBy?: string;
  expectedWorkItemCount?: number;
}

export interface PlansImportDiagnostic {
  code: PlansImportDiagnosticCode;
  severity: "warning";
  message: string;
  line?: number;
  raw?: string;
  taskId?: string;
  sourceRef?: string;
}

export type PlansImportDiffEntry =
  | {
      kind: "work_item";
      action: "upsert";
      workId: string;
      sourceRef: string;
      status: string;
      title: string;
    }
  | {
      kind: "dependency";
      action: "ensure";
      fromWorkId: string;
      toWorkId: string;
      relation: "blocks";
    };

export interface PlansImportMetrics {
  plans_import_fidelity: number;
  importedWorkItems: number;
  expectedWorkItems: number;
}

export interface PlansImportDryRunResult {
  workItems: WorkItemInput[];
  dependencies: WorkDependencyInput[];
  diff: PlansImportDiffEntry[];
  diagnostics: PlansImportDiagnostic[];
  metrics: PlansImportMetrics;
  parser: {
    tasks: number;
    skipped: number;
    diagnostics: number;
  };
  writes: 0;
}

export function importPlansToWorkGraphDryRun(markdown: string, options: PlansImportOptions): PlansImportDryRunResult {
  const parserOptions: PlansParserOptions = {
    ...(options.source ? { source: options.source } : {}),
    ...(options.includeArchivedSections !== undefined ? { includeArchivedSections: options.includeArchivedSections } : {}),
  };
  const parseResult = parsePlansDryRun(markdown, parserOptions);
  const diagnostics = parseResult.diagnostics.map(toImportDiagnostic);
  const seenWorkIds = new Set<string>();
  const workItems: WorkItemInput[] = [];

  for (const task of parseResult.tasks) {
    if (seenWorkIds.has(task.id)) {
      diagnostics.push({
        code: "duplicate_work_item",
        severity: "warning",
        line: task.metadata.row_line,
        message: `Duplicate Plans task id skipped: ${task.id}`,
        taskId: task.id,
        sourceRef: task.source_ref,
      });
      continue;
    }

    seenWorkIds.add(task.id);
    workItems.push(mapPlansTaskToWorkItem(task, options));
  }

  const importedWorkIds = new Set(workItems.map((item) => item.workId));
  const dependencies = mapPlansTaskDependencies(parseResult.tasks, diagnostics, importedWorkIds);
  const diff = buildDiff(workItems, dependencies);
  const expectedWorkItems = options.expectedWorkItemCount ?? parseResult.tasks.length;

  return {
    workItems,
    dependencies,
    diff,
    diagnostics,
    metrics: {
      plans_import_fidelity: calculateFidelity(workItems.length, expectedWorkItems),
      importedWorkItems: workItems.length,
      expectedWorkItems,
    },
    parser: {
      tasks: parseResult.tasks.length,
      skipped: parseResult.skipped.length,
      diagnostics: parseResult.diagnostics.length,
    },
    writes: 0,
  };
}

export function mapPlansTaskToWorkItem(task: ParsedPlansTask, options: PlansImportOptions): WorkItemInput {
  return {
    workId: task.id,
    title: task.title,
    project: options.project,
    description: task.description,
    status: task.status,
    workType: "task",
    sourceType: "plans",
    sourceRef: task.source_ref,
    createdBy: options.createdBy ?? "plans-importer",
    closeReason: task.status === "closed" ? "plans_status_closed" : null,
    metadata: {
      plans: {
        id: task.id,
        sourceRef: task.source_ref,
        rawStatus: task.raw_status,
        dod: task.dod,
        dependsOn: task.depends_on,
        parallel: task.metadata.parallel,
        section: task.metadata.section,
        rowLine: task.metadata.row_line,
        rawTask: task.metadata.raw_task,
        rawContent: task.metadata.raw_content,
        source: task.metadata.source,
      },
    },
  };
}

export function plansSourceRefToWorkId(sourceRef: string): string | null {
  const match = sourceRef.match(/^plans:(.+)$/);
  return match?.[1]?.trim() || null;
}

function mapPlansTaskDependencies(
  tasks: ParsedPlansTask[],
  diagnostics: PlansImportDiagnostic[],
  importedWorkIds: Set<string>
): WorkDependencyInput[] {
  const dependencies: WorkDependencyInput[] = [];
  const seen = new Set<string>();

  for (const task of tasks) {
    for (const dependencySourceRef of task.depends_on) {
      const fromWorkId = plansSourceRefToWorkId(dependencySourceRef);
      if (!fromWorkId) {
        diagnostics.push({
          code: "invalid_dependency_source_ref",
          severity: "warning",
          line: task.metadata.row_line,
          message: `Dependency source ref is not a Plans ref: ${dependencySourceRef}`,
          taskId: task.id,
          sourceRef: dependencySourceRef,
        });
        continue;
      }

      if (!importedWorkIds.has(fromWorkId)) {
        diagnostics.push({
          code: "missing_dependency_work_item",
          severity: "warning",
          line: task.metadata.row_line,
          message: `Dependency is not part of this dry-run import batch: ${dependencySourceRef}`,
          taskId: task.id,
          sourceRef: dependencySourceRef,
        });
      }

      const key = `${fromWorkId}\0${task.id}\0blocks`;
      if (seen.has(key)) continue;
      seen.add(key);

      dependencies.push({
        fromWorkId,
        toWorkId: task.id,
        relation: "blocks",
        metadata: {
          plans: {
            fromSourceRef: dependencySourceRef,
            toSourceRef: task.source_ref,
            toTaskId: task.id,
          },
        },
      });
    }
  }

  return dependencies;
}

function buildDiff(workItems: WorkItemInput[], dependencies: WorkDependencyInput[]): PlansImportDiffEntry[] {
  return [
    ...workItems.map((item) => ({
      kind: "work_item" as const,
      action: "upsert" as const,
      workId: item.workId,
      sourceRef: item.sourceRef ?? "",
      status: item.status ?? "open",
      title: item.title,
    })),
    ...dependencies.map((dependency) => ({
      kind: "dependency" as const,
      action: "ensure" as const,
      fromWorkId: dependency.fromWorkId,
      toWorkId: dependency.toWorkId,
      relation: "blocks" as const,
    })),
  ];
}

function calculateFidelity(importedWorkItems: number, expectedWorkItems: number): number {
  if (expectedWorkItems <= 0) return 1;
  return importedWorkItems / expectedWorkItems;
}

function toImportDiagnostic(diagnostic: PlansParserDiagnostic): PlansImportDiagnostic {
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    line: diagnostic.line,
    message: diagnostic.message,
    raw: diagnostic.raw,
  };
}
