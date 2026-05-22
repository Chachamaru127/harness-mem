import { createHash } from "node:crypto";
import type { Database, SQLQueryBindings } from "bun:sqlite";
import { hasPrivateVisibilityTag, nowIso, parseArrayJson, parseJsonSafe } from "../core/core-utils.js";

export type RecallProjectionMode = "dry_run" | "write";

export interface RecallProjectionRequest {
  project: string;
  limit?: number;
  includePrivate?: boolean;
  now?: () => string;
}

export interface RecallProjectionItem {
  recall_id: string;
  recall_type: "fact" | "decision" | "work_item" | "episode" | "profile";
  project: string;
  workspace: string | null;
  tenant: string | null;
  session_id: string | null;
  source_type: "observation" | "adr";
  source_id: string;
  source_ref: string;
  projection_generation: string;
  title: string | null;
  content_redacted: string;
  source_created_at: string | null;
  projected_at: string;
  valid_from: string | null;
  valid_to: string | null;
  privacy_tags_json: string;
  metadata_json: string;
}

export interface RecallProjectionPlan {
  ok: true;
  mode: RecallProjectionMode;
  project: string;
  scope_key: string;
  generation: string;
  source_watermark: string;
  candidate_count: number;
  planned_count: number;
  skipped_count: number;
  skipped_reasons: Record<string, number>;
  diagnostics: Record<string, unknown>;
  items: RecallProjectionItem[];
}

interface ObservationRow {
  id: string;
  project: string;
  session_id: string | null;
  title: string | null;
  content_redacted: string | null;
  observation_type: string | null;
  memory_type: string | null;
  tags_json: string | null;
  privacy_tags_json: string | null;
  payload_json: string | null;
  user_id: string | null;
  team_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  valid_from: string | null;
  valid_to: string | null;
}

function sha256Short(value: string, length = 16): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function normalizedLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return 500;
  return Math.max(1, Math.min(5_000, Math.floor(Number(limit))));
}

function increment(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function mapRecallType(row: ObservationRow): RecallProjectionItem["recall_type"] {
  const observationType = (row.observation_type || "").toLowerCase();
  const memoryType = (row.memory_type || "").toLowerCase();
  const tags = parseArrayJson(row.tags_json ?? "[]").map((tag) => tag.toLowerCase());
  if (observationType.includes("decision") || observationType.includes("adr") || tags.includes("adr")) return "decision";
  if (observationType.includes("session") || observationType.includes("summary")) return "episode";
  if (memoryType === "procedural" || observationType.includes("profile")) return "profile";
  return "fact";
}

function metadataFromPayload(payloadJson: string | null): Record<string, unknown> {
  const payload = parseJsonSafe(payloadJson);
  return parseJsonSafe(payload.metadata);
}

function adrSourceRef(metadata: Record<string, unknown>, fallbackId: string): string {
  const filePath = typeof metadata.filePath === "string" && metadata.filePath.trim()
    ? metadata.filePath.trim()
    : null;
  return filePath ? `adr:${filePath}` : `adr:${fallbackId}`;
}

function isAdrProjection(row: ObservationRow, metadata: Record<string, unknown>, tags: string[]): boolean {
  const metadataType = typeof metadata.type === "string" ? metadata.type.toLowerCase() : "";
  return metadataType === "adr" || tags.map((tag) => tag.toLowerCase()).includes("adr");
}

export function readRecallDataWatermark(db: Database, request: { project?: string; sessionId?: string }): string {
  const filters = ["archived_at IS NULL"];
  const params: SQLQueryBindings[] = [];
  if (request.project) {
    filters.push("project = ?");
    params.push(request.project);
  }
  if (request.sessionId) {
    filters.push("session_id = ?");
    params.push(request.sessionId);
  }
  const row = db
    .query(
      `SELECT COUNT(*) AS count, COALESCE(MAX(updated_at), MAX(created_at), '') AS watermark
       FROM mem_observations
       WHERE ${filters.join(" AND ")}`
    )
    .get(...params) as { count: number; watermark: string | null } | null;

  return `${Number(row?.count ?? 0)}:${row?.watermark ?? ""}`;
}

export function buildRecallProjectionPlan(db: Database, request: RecallProjectionRequest): RecallProjectionPlan {
  const project = request.project.trim();
  if (!project) {
    throw new Error("project is required");
  }
  const now = request.now ?? nowIso;
  const projectedAt = now();
  const limit = normalizedLimit(request.limit);
  const sourceWatermark = readRecallDataWatermark(db, { project });
  const generation = `recall_${sha256Short(`${project}:${sourceWatermark}`)}`;
  const scopeKey = `project:${sha256Short(project, 12)}`;
  const rows = db
    .query(
      `SELECT o.id, o.project, o.session_id, o.title, o.content_redacted, o.observation_type, o.memory_type,
              o.tags_json, o.privacy_tags_json, e.payload_json, o.user_id, o.team_id,
              o.created_at, o.updated_at, o.valid_from, o.valid_to
       FROM mem_observations o
       LEFT JOIN mem_events e ON e.event_id = o.event_id
       WHERE o.project = ?
         AND o.archived_at IS NULL
         AND (o.expires_at IS NULL OR o.expires_at > ?)
       ORDER BY COALESCE(o.updated_at, o.created_at) DESC, o.created_at DESC, o.id ASC
       LIMIT ?`
    )
    .all(project, projectedAt, limit) as ObservationRow[];

  const skippedReasons: Record<string, number> = {};
  const items: RecallProjectionItem[] = [];
  for (const row of rows) {
    const privacyTags = parseArrayJson(row.privacy_tags_json ?? "[]");
    if (!request.includePrivate && hasPrivateVisibilityTag(privacyTags)) {
      increment(skippedReasons, "private");
      continue;
    }
    const content = (row.content_redacted ?? "").trim();
    if (!content) {
      increment(skippedReasons, "empty_content");
      continue;
    }
    const tags = parseArrayJson(row.tags_json ?? "[]");
    const sourceMetadata = metadataFromPayload(row.payload_json);
    const isAdr = isAdrProjection(row, sourceMetadata, tags);
    const recallType = mapRecallType(row);
    const sourceType: RecallProjectionItem["source_type"] = isAdr ? "adr" : "observation";
    const sourceRef = isAdr ? adrSourceRef(sourceMetadata, row.id) : `observation:${row.id}`;
    const recallId = `rcl_${sha256Short(`${generation}:${sourceType}:${sourceRef}`, 24)}`;
    items.push({
      recall_id: recallId,
      recall_type: recallType,
      project: row.project,
      workspace: null,
      tenant: row.team_id || row.user_id || null,
      session_id: row.session_id,
      source_type: sourceType,
      source_id: row.id,
      source_ref: sourceRef,
      projection_generation: generation,
      title: row.title,
      content_redacted: content.slice(0, 2_000),
      source_created_at: row.created_at,
      projected_at: projectedAt,
      valid_from: row.valid_from,
      valid_to: row.valid_to,
      privacy_tags_json: JSON.stringify(privacyTags),
      metadata_json: JSON.stringify({
        observation_type: row.observation_type ?? "context",
        memory_type: row.memory_type ?? "semantic",
        tags,
        ...sourceMetadata,
        provenance: isAdr
          ? {
              source: typeof sourceMetadata.source === "string" ? sourceMetadata.source : sourceRef,
              file_path: typeof sourceMetadata.filePath === "string" ? sourceMetadata.filePath : null,
              source_plans_section: typeof sourceMetadata.sourcePlansSection === "string"
                ? sourceMetadata.sourcePlansSection
                : null,
              decisions_md_refs: Array.isArray(sourceMetadata.decisionsMdRefs)
                ? sourceMetadata.decisionsMdRefs
                : [],
              work_refs: Array.isArray(sourceMetadata.workRefs) ? sourceMetadata.workRefs : [],
              supersedes: Array.isArray(sourceMetadata.supersedes) ? sourceMetadata.supersedes : [],
              observation_id: row.id,
            }
          : undefined,
      }),
    });
  }

  return {
    ok: true,
    mode: "dry_run",
    project,
    scope_key: scopeKey,
    generation,
    source_watermark: sourceWatermark,
    candidate_count: rows.length,
    planned_count: items.length,
    skipped_count: Object.values(skippedReasons).reduce((sum, count) => sum + count, 0),
    skipped_reasons: skippedReasons,
    diagnostics: {
      include_private: request.includePrivate === true,
      limit,
      projection_generation: generation,
    },
    items,
  };
}

export function materializeRecallProjection(
  db: Database,
  request: RecallProjectionRequest,
): RecallProjectionPlan {
  const plan = buildRecallProjectionPlan(db, request);
  const startedAt = (request.now ?? nowIso)();
  const tx = db.transaction(() => {
    db.query(
      `INSERT OR REPLACE INTO mem_recall_projection_runs
       (generation, project, scope_key, source_watermark, status, item_count, skipped_count,
        diagnostics_json, started_at, completed_at)
       VALUES (?, ?, ?, ?, 'running', 0, ?, ?, ?, NULL)`
    ).run(
      plan.generation,
      plan.project,
      plan.scope_key,
      plan.source_watermark,
      plan.skipped_count,
      JSON.stringify(plan.diagnostics),
      startedAt,
    );
    db.query(`DELETE FROM mem_recall_items WHERE project = ?`).run(plan.project);
    const insert = db.query(
      `INSERT OR REPLACE INTO mem_recall_items
       (recall_id, recall_type, project, workspace, tenant, session_id, source_type, source_id,
        source_ref, projection_generation, title, content_redacted, source_created_at, projected_at,
        valid_from, valid_to, privacy_tags_json, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const item of plan.items) {
      insert.run(
        item.recall_id,
        item.recall_type,
        item.project,
        item.workspace,
        item.tenant,
        item.session_id,
        item.source_type,
        item.source_id,
        item.source_ref,
        item.projection_generation,
        item.title,
        item.content_redacted,
        item.source_created_at,
        item.projected_at,
        item.valid_from,
        item.valid_to,
        item.privacy_tags_json,
        item.metadata_json,
      );
    }
    db.query(
      `UPDATE mem_recall_projection_runs
       SET status = 'completed', item_count = ?, skipped_count = ?, completed_at = ?
       WHERE generation = ?`
    ).run(plan.items.length, plan.skipped_count, plan.items[0]?.projected_at ?? startedAt, plan.generation);
  });
  tx();
  return { ...plan, mode: "write" };
}

export function clearRecallProjection(db: Database, project: string): { project: string; deleted_items: number; deleted_runs: number } {
  const normalized = project.trim();
  if (!normalized) {
    throw new Error("project is required");
  }
  let deletedItems = 0;
  let deletedRuns = 0;
  const tx = db.transaction(() => {
    const itemResult = db.query(`DELETE FROM mem_recall_items WHERE project = ?`).run(normalized);
    deletedItems = Number(itemResult.changes ?? 0);
    const runResult = db.query(`DELETE FROM mem_recall_projection_runs WHERE project = ?`).run(normalized);
    deletedRuns = Number(runResult.changes ?? 0);
  });
  tx();
  return { project: normalized, deleted_items: deletedItems, deleted_runs: deletedRuns };
}
