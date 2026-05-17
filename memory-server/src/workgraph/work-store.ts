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

export interface WorkEventInput {
  eventId: string;
  workId: string;
  eventType: string;
  actor: string;
  sessionId?: string | null;
  createdAt?: string;
  payload?: Record<string, unknown>;
  payloadJson?: string;
}

export interface WorkEventRow {
  eventId: string;
  workId: string;
  eventType: string;
  actor: string;
  sessionId: string | null;
  createdAt: string;
  payload: Record<string, unknown>;
  payloadJson: string;
}

export type WorkLinkTargetType =
  | "observation"
  | "session"
  | "event"
  | "file"
  | "github_issue"
  | "plan_task"
  | "lease"
  | "signal";

export interface WorkLinkInput {
  workId: string;
  targetType: WorkLinkTargetType | string;
  targetId: string;
  relation?: string;
  createdAt?: string;
}

export interface WorkLinkRow {
  workId: string;
  targetType: string;
  targetId: string;
  relation: string;
  createdAt: string;
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

function payloadToJson(input: { payload?: Record<string, unknown>; payloadJson?: string }): string {
  return input.payloadJson ?? JSON.stringify(input.payload ?? {});
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

function parseEvent(row: Record<string, unknown>): WorkEventRow {
  const payloadJson = String(row.payload_json ?? "{}");
  return {
    eventId: String(row.event_id),
    workId: String(row.work_id),
    eventType: String(row.event_type),
    actor: String(row.actor),
    sessionId: row.session_id == null ? null : String(row.session_id),
    createdAt: String(row.created_at),
    payload: parseMetadata(payloadJson),
    payloadJson,
  };
}

function parseLink(row: Record<string, unknown>): WorkLinkRow {
  return {
    workId: String(row.work_id),
    targetType: String(row.target_type),
    targetId: String(row.target_id),
    relation: String(row.relation ?? "evidence"),
    createdAt: String(row.created_at),
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

  listWorkItems(project?: string): WorkItemRow[] {
    const rows = project
      ? this.db
          .query(
            `SELECT * FROM mem_work_items
              WHERE project = ?
              ORDER BY work_id`
          )
          .all(project)
      : this.db
          .query(
            `SELECT * FROM mem_work_items
              ORDER BY work_id`
          )
          .all();
    return (rows as Array<Record<string, unknown>>).map(parseWorkItem);
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

  recordEvent(input: WorkEventInput): WorkEventRow {
    const eventId = requireNonEmpty(input.eventId, "eventId");
    const workId = requireNonEmpty(input.workId, "workId");
    const eventType = requireNonEmpty(input.eventType, "eventType");
    const actor = requireNonEmpty(input.actor, "actor");
    const createdAt = input.createdAt ?? this.now();

    this.db
      .query(
        `INSERT INTO mem_work_events (
          event_id, work_id, event_type, actor, session_id, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(event_id) DO UPDATE SET
          work_id = excluded.work_id,
          event_type = excluded.event_type,
          actor = excluded.actor,
          session_id = excluded.session_id,
          payload_json = excluded.payload_json,
          created_at = excluded.created_at`
      )
      .run(eventId, workId, eventType, actor, input.sessionId ?? null, payloadToJson(input), createdAt);

    const row = this.db
      .query(`SELECT * FROM mem_work_events WHERE event_id = ?`)
      .get(eventId) as Record<string, unknown> | null;
    if (!row) {
      throw new Error(`work event was not persisted: ${eventId}`);
    }
    return parseEvent(row);
  }

  listEvents(workId: string): WorkEventRow[] {
    const rows = this.db
      .query(
        `SELECT * FROM mem_work_events
          WHERE work_id = ?
          ORDER BY created_at, event_id`
      )
      .all(workId) as Array<Record<string, unknown>>;
    return rows.map(parseEvent);
  }

  addLink(input: WorkLinkInput): WorkLinkRow {
    const workId = requireNonEmpty(input.workId, "workId");
    const targetType = requireNonEmpty(input.targetType, "targetType");
    const targetId = requireNonEmpty(input.targetId, "targetId");
    const relation = requireNonEmpty(input.relation ?? "evidence", "relation");
    const createdAt = input.createdAt ?? this.now();

    this.db
      .query(
        `INSERT INTO mem_work_links (
          work_id, target_type, target_id, relation, created_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(work_id, target_type, target_id, relation) DO NOTHING`
      )
      .run(workId, targetType, targetId, relation, createdAt);

    const row = this.db
      .query(
        `SELECT * FROM mem_work_links
          WHERE work_id = ? AND target_type = ? AND target_id = ? AND relation = ?`
      )
      .get(workId, targetType, targetId, relation) as Record<string, unknown> | null;
    if (!row) {
      throw new Error(`work link was not persisted: ${workId} ${targetType}:${targetId}`);
    }
    return parseLink(row);
  }

  listLinks(workId: string): WorkLinkRow[] {
    const rows = this.db
      .query(
        `SELECT * FROM mem_work_links
          WHERE work_id = ?
          ORDER BY target_type, target_id, relation`
      )
      .all(workId) as Array<Record<string, unknown>>;
    return rows.map(parseLink);
  }

  listLinksByTarget(targetType: string, targetId: string): WorkLinkRow[] {
    const rows = this.db
      .query(
        `SELECT * FROM mem_work_links
          WHERE target_type = ? AND target_id = ?
          ORDER BY work_id, relation`
      )
      .all(targetType, targetId) as Array<Record<string, unknown>>;
    return rows.map(parseLink);
  }
}

export function createWorkStore(db: Database, options: WorkStoreOptions = {}): WorkStore {
  return new WorkStore(db, options);
}
