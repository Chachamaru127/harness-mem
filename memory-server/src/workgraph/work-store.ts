import type { Database } from "bun:sqlite";

export const WORK_DEPENDENCY_RELATIONS = [
  "blocks",
  "parent_child",
  "related",
  "discovered_from",
  "supersedes",
  "duplicates",
  "checkpoint",
] as const;

export type WorkDependencyRelation = (typeof WORK_DEPENDENCY_RELATIONS)[number];

export interface WorkItemInput {
  workId: string;
  title: string;
  project: string;
  description?: string;
  status?: string;
  priority?: number;
  workType?: string;
  branch?: string | null;
  assignee?: string | null;
  sourceType?: string;
  sourceRef?: string | null;
  parentWorkId?: string | null;
  sessionId?: string | null;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string | null;
  closeReason?: string | null;
  metadata?: Record<string, unknown>;
  metadataJson?: string;
}

export interface WorkItemRow {
  workId: string;
  title: string;
  description: string;
  status: string;
  priority: number;
  workType: string;
  project: string;
  branch: string | null;
  assignee: string | null;
  sourceType: string;
  sourceRef: string | null;
  parentWorkId: string | null;
  sessionId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  closeReason: string | null;
  metadata: Record<string, unknown>;
  metadataJson: string;
}

export interface WorkDependencyInput {
  fromWorkId: string;
  toWorkId: string;
  relation: WorkDependencyRelation | string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
  metadataJson?: string;
}

export interface WorkDependencyRow {
  fromWorkId: string;
  toWorkId: string;
  relation: WorkDependencyRelation;
  createdAt: string;
  metadata: Record<string, unknown>;
  metadataJson: string;
}

export interface WorkStoreOptions {
  now?: () => string;
}

export type DependencyDirection = "from" | "to" | "any";

function defaultNow(): string {
  return new Date().toISOString();
}

function requireNonEmpty(value: string, field: string): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return trimmed;
}

function metadataToJson(input: { metadata?: Record<string, unknown>; metadataJson?: string }): string {
  return input.metadataJson ?? JSON.stringify(input.metadata ?? {});
}

function parseMetadata(metadataJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(metadataJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function isWorkDependencyRelation(relation: string): relation is WorkDependencyRelation {
  return (WORK_DEPENDENCY_RELATIONS as readonly string[]).includes(relation);
}

function requireRelation(relation: string): WorkDependencyRelation {
  if (!isWorkDependencyRelation(relation)) {
    throw new Error(`invalid work dependency relation: ${relation}`);
  }
  return relation;
}

function parseWorkItem(row: Record<string, unknown>): WorkItemRow {
  const metadataJson = String(row.metadata_json ?? "{}");
  return {
    workId: String(row.work_id),
    title: String(row.title),
    description: String(row.description ?? ""),
    status: String(row.status ?? "open"),
    priority: Number(row.priority ?? 2),
    workType: String(row.work_type ?? "task"),
    project: String(row.project),
    branch: row.branch == null ? null : String(row.branch),
    assignee: row.assignee == null ? null : String(row.assignee),
    sourceType: String(row.source_type ?? "manual"),
    sourceRef: row.source_ref == null ? null : String(row.source_ref),
    parentWorkId: row.parent_work_id == null ? null : String(row.parent_work_id),
    sessionId: row.session_id == null ? null : String(row.session_id),
    createdBy: String(row.created_by ?? "system"),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    closedAt: row.closed_at == null ? null : String(row.closed_at),
    closeReason: row.close_reason == null ? null : String(row.close_reason),
    metadata: parseMetadata(metadataJson),
    metadataJson,
  };
}

function parseDependency(row: Record<string, unknown>): WorkDependencyRow {
  const relation = requireRelation(String(row.relation));
  const metadataJson = String(row.metadata_json ?? "{}");
  return {
    fromWorkId: String(row.from_work_id),
    toWorkId: String(row.to_work_id),
    relation,
    createdAt: String(row.created_at),
    metadata: parseMetadata(metadataJson),
    metadataJson,
  };
}

export class WorkStore {
  private readonly now: () => string;

  constructor(private readonly db: Database, options: WorkStoreOptions = {}) {
    this.now = options.now ?? defaultNow;
  }

  createWorkItem(input: WorkItemInput): WorkItemRow {
    return this.upsertWorkItem(input);
  }

  upsertWorkItem(input: WorkItemInput): WorkItemRow {
    const workId = requireNonEmpty(input.workId, "workId");
    const title = requireNonEmpty(input.title, "title");
    const project = requireNonEmpty(input.project, "project");
    const createdAt = input.createdAt ?? this.now();
    const updatedAt = input.updatedAt ?? createdAt;

    this.db
      .query(
        `INSERT INTO mem_work_items (
          work_id, title, description, status, priority, work_type, project,
          branch, assignee, source_type, source_ref, parent_work_id, session_id,
          created_by, created_at, updated_at, closed_at, close_reason, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(work_id) DO UPDATE SET
          title = excluded.title,
          description = excluded.description,
          status = excluded.status,
          priority = excluded.priority,
          work_type = excluded.work_type,
          project = excluded.project,
          branch = excluded.branch,
          assignee = excluded.assignee,
          source_type = excluded.source_type,
          source_ref = excluded.source_ref,
          parent_work_id = excluded.parent_work_id,
          session_id = excluded.session_id,
          created_by = excluded.created_by,
          updated_at = excluded.updated_at,
          closed_at = excluded.closed_at,
          close_reason = excluded.close_reason,
          metadata_json = excluded.metadata_json`
      )
      .run(
        workId,
        title,
        input.description ?? "",
        input.status ?? "open",
        input.priority ?? 2,
        input.workType ?? "task",
        project,
        input.branch ?? null,
        input.assignee ?? null,
        input.sourceType ?? "manual",
        input.sourceRef ?? null,
        input.parentWorkId ?? null,
        input.sessionId ?? null,
        input.createdBy ?? "system",
        createdAt,
        updatedAt,
        input.closedAt ?? null,
        input.closeReason ?? null,
        metadataToJson(input)
      );

    const row = this.getWorkItem(workId);
    if (!row) {
      throw new Error(`work item was not persisted: ${workId}`);
    }
    return row;
  }

  getWorkItem(workId: string): WorkItemRow | null {
    const row = this.db
      .query(`SELECT * FROM mem_work_items WHERE work_id = ?`)
      .get(workId) as Record<string, unknown> | null;
    return row ? parseWorkItem(row) : null;
  }

  addDependency(input: WorkDependencyInput): WorkDependencyRow {
    const fromWorkId = requireNonEmpty(input.fromWorkId, "fromWorkId");
    const toWorkId = requireNonEmpty(input.toWorkId, "toWorkId");
    const relation = requireRelation(input.relation);
    const createdAt = input.createdAt ?? this.now();

    this.db
      .query(
        `INSERT INTO mem_work_dependencies (
          from_work_id, to_work_id, relation, created_at, metadata_json
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(from_work_id, to_work_id, relation) DO NOTHING`
      )
      .run(fromWorkId, toWorkId, relation, createdAt, metadataToJson(input));

    const row = this.db
      .query(
        `SELECT * FROM mem_work_dependencies
          WHERE from_work_id = ? AND to_work_id = ? AND relation = ?`
      )
      .get(fromWorkId, toWorkId, relation) as Record<string, unknown> | null;
    if (!row) {
      throw new Error(`work dependency was not persisted: ${fromWorkId} ${relation} ${toWorkId}`);
    }
    return parseDependency(row);
  }

  listDependencies(workId?: string, direction: DependencyDirection = "from"): WorkDependencyRow[] {
    let rows: Array<Record<string, unknown>>;
    if (!workId) {
      rows = this.db
        .query(
          `SELECT * FROM mem_work_dependencies
            ORDER BY from_work_id, to_work_id, relation`
        )
        .all() as Array<Record<string, unknown>>;
    } else if (direction === "to") {
      rows = this.db
        .query(
          `SELECT * FROM mem_work_dependencies
            WHERE to_work_id = ?
            ORDER BY from_work_id, to_work_id, relation`
        )
        .all(workId) as Array<Record<string, unknown>>;
    } else if (direction === "any") {
      rows = this.db
        .query(
          `SELECT * FROM mem_work_dependencies
            WHERE from_work_id = ? OR to_work_id = ?
            ORDER BY from_work_id, to_work_id, relation`
        )
        .all(workId, workId) as Array<Record<string, unknown>>;
    } else {
      rows = this.db
        .query(
          `SELECT * FROM mem_work_dependencies
            WHERE from_work_id = ?
            ORDER BY from_work_id, to_work_id, relation`
        )
        .all(workId) as Array<Record<string, unknown>>;
    }
    return rows.map(parseDependency);
  }
}

export function createWorkStore(db: Database, options: WorkStoreOptions = {}): WorkStore {
  return new WorkStore(db, options);
}
