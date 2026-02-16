import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";

type JsonObject = Record<string, unknown>;

export interface ClaudeMemImportRequest {
  source_db_path: string;
  project?: string;
  dry_run?: boolean;
}

export interface NormalizedImportEvent {
  event_id: string;
  platform: "claude";
  project: string;
  session_id: string;
  event_type: "session_start" | "user_prompt" | "tool_use" | "checkpoint" | "session_end";
  ts: string;
  payload: JsonObject;
  tags: string[];
  privacy_tags: string[];
  dedupe_hash: string;
}

export interface ImportedSessionSummary {
  session_id: string;
  project: string;
  summary: string;
  ts: string;
  privacy_tags: string[];
}

export interface ClaudeMemImportPlan {
  source_db_path: string;
  source_tables: string[];
  observation_rows: number;
  summary_rows: number;
  sdk_session_rows: number;
  events: NormalizedImportEvent[];
  summaries: ImportedSessionSummary[];
  warnings: string[];
}

const OBS_TABLE = "observations";
const SUMMARIES_TABLE = "session_summaries";
const SDK_SESSIONS_TABLE = "sdk_sessions";
const SOURCE_TABLE_ALLOWLIST = new Set<string>([OBS_TABLE, SUMMARIES_TABLE, SDK_SESSIONS_TABLE]);

const SESSION_COLUMNS = ["session_id", "sessionId", "conversation_id", "conversationId", "thread_id", "threadId", "chat_id"];
const PROJECT_COLUMNS = ["project", "project_name", "projectName", "project_path", "projectPath", "workspace", "repo", "cwd"];
const TS_COLUMNS = ["ts", "timestamp", "created_at", "createdAt", "recorded_at", "updated_at", "ended_at"];
const TYPE_COLUMNS = ["event_type", "eventType", "type", "kind", "role"];
const CONTENT_COLUMNS = ["content", "text", "message", "body", "observation", "summary"];
const TITLE_COLUMNS = ["title", "name", "label"];
const TAG_COLUMNS = ["tags_json", "tags", "labels"];
const PRIVACY_COLUMNS = ["privacy_tags_json", "privacy_tags", "privacy", "sensitivity", "sensitivity_tags"];
const META_COLUMNS = ["payload_json", "metadata_json", "data_json", "metadata", "payload"];
const ID_COLUMNS = ["id", "observation_id", "observationId", "uuid", "ulid"];

function pickValue(row: JsonObject, candidates: string[]): unknown {
  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      return row[key];
    }
  }
  return undefined;
}

function pickString(row: JsonObject, candidates: string[]): string | undefined {
  const value = pickValue(row, candidates);
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return undefined;
}

function parseArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim().toLowerCase())
          .filter((entry) => entry.length > 0);
      }
    } catch {
      // fall through to comma-separated parsing
    }

    return trimmed
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0);
  }

  return [];
}

function parseObject(value: unknown): JsonObject {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as JsonObject;
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as JsonObject;
      }
    } catch {
      // ignore parse errors
    }
  }
  return {};
}

function normalizeEventType(rawType: string | undefined): "session_start" | "user_prompt" | "tool_use" | "checkpoint" | "session_end" {
  const normalized = (rawType || "").trim().toLowerCase();
  if (!normalized) {
    return "user_prompt";
  }
  if (normalized.includes("tool") || normalized === "assistant" || normalized === "system") {
    return "tool_use";
  }
  if (normalized.includes("check")) {
    return "checkpoint";
  }
  if (normalized.includes("start")) {
    return "session_start";
  }
  if (normalized.includes("end") || normalized.includes("summary")) {
    return "session_end";
  }
  if (normalized.includes("user") || normalized === "human") {
    return "user_prompt";
  }
  return "user_prompt";
}

function asIso(value: string | undefined, fallbackIso: string): string {
  if (!value) {
    return fallbackIso;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return fallbackIso;
  }
  return new Date(parsed).toISOString();
}

function normalizeProject(raw: string | undefined, fallbackProject: string): string {
  if (!raw) {
    return fallbackProject;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return fallbackProject;
  }
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return basename(trimmed);
  }
  return trimmed;
}

function buildHash(parts: Array<string | number | undefined>): string {
  const hash = createHash("sha256");
  hash.update(parts.map((part) => String(part ?? "")).join("|"));
  return hash.digest("hex");
}

function listTables(db: Database): Set<string> {
  const rows = db
    .query(`SELECT name FROM sqlite_master WHERE type = 'table'`)
    .all() as Array<{ name?: string }>;
  const names = new Set<string>();
  for (const row of rows) {
    if (typeof row.name === "string" && row.name.trim()) {
      names.add(row.name);
    }
  }
  return names;
}

function selectAllRows(db: Database, table: string): JsonObject[] {
  const identifier = table.trim();
  if (!SOURCE_TABLE_ALLOWLIST.has(identifier) || !/^[A-Za-z0-9_]+$/.test(identifier)) {
    throw new Error(`unsupported table identifier: ${table}`);
  }
  const rows = db.query(`SELECT * FROM "${identifier}"`).all() as unknown[];
  return rows
    .filter((row): row is JsonObject => typeof row === "object" && row !== null && !Array.isArray(row))
    .map((row) => ({ ...row }));
}

export function buildClaudeMemImportPlan(params: {
  sourceDbPath: string;
  projectOverride?: string;
  nowIso: () => string;
}): ClaudeMemImportPlan {
  const sourceDbPath = resolve(params.sourceDbPath);
  const db = new Database(sourceDbPath, { readonly: true, create: false });

  try {
    const tables = listTables(db);
    const sourceTables = [...tables].sort();
    const warnings: string[] = [];
    const events: NormalizedImportEvent[] = [];
    const summaries: ImportedSessionSummary[] = [];
    const dedupeSet = new Set<string>();
    const defaultProject = normalizeProject(params.projectOverride, "claude-mem-import");

    let observationRows = 0;
    if (tables.has(OBS_TABLE)) {
      const rows = selectAllRows(db, OBS_TABLE);
      observationRows = rows.length;
      for (const row of rows) {
        const rawSession = pickString(row, SESSION_COLUMNS) || "claude-mem-import";
        const sessionId = rawSession.replace(/\s+/g, "-");
        const project = normalizeProject(pickString(row, PROJECT_COLUMNS), defaultProject);
        const ts = asIso(pickString(row, TS_COLUMNS), params.nowIso());
        const rawType = pickString(row, TYPE_COLUMNS);
        const content =
          pickString(row, CONTENT_COLUMNS) ||
          JSON.stringify(parseObject(pickValue(row, META_COLUMNS))) ||
          JSON.stringify(row).slice(0, 4000);
        const title = pickString(row, TITLE_COLUMNS) || rawType || "imported_observation";
        const tags = parseArray(pickValue(row, TAG_COLUMNS));
        const privacyTags = parseArray(pickValue(row, PRIVACY_COLUMNS));
        const sourceId = pickString(row, ID_COLUMNS) || buildHash([sessionId, ts, title, content]).slice(0, 20);
        const sourceMeta = parseObject(pickValue(row, META_COLUMNS));
        const eventType = normalizeEventType(rawType);

        const eventId = `imp_obs_${buildHash([sourceDbPath, sourceId, eventType]).slice(0, 24)}`;
        const dedupe = buildHash([sourceDbPath, OBS_TABLE, sourceId, sessionId, eventType, ts, content.slice(0, 200)]);
        if (dedupeSet.has(dedupe)) {
          continue;
        }
        dedupeSet.add(dedupe);

        events.push({
          event_id: eventId,
          platform: "claude",
          project,
          session_id: sessionId,
          event_type: eventType,
          ts,
          payload: {
            title,
            content,
            source: "claude-mem",
            source_table: OBS_TABLE,
            source_row_id: sourceId,
            raw_type: rawType || null,
            metadata: sourceMeta,
          },
          tags,
          privacy_tags: privacyTags,
          dedupe_hash: dedupe,
        });
      }
    } else {
      warnings.push(`missing table: ${OBS_TABLE}`);
    }

    let summaryRows = 0;
    if (tables.has(SUMMARIES_TABLE)) {
      const rows = selectAllRows(db, SUMMARIES_TABLE);
      summaryRows = rows.length;
      for (const row of rows) {
        const sessionId = pickString(row, SESSION_COLUMNS) || "claude-mem-import";
        const project = normalizeProject(pickString(row, PROJECT_COLUMNS), defaultProject);
        const ts = asIso(pickString(row, TS_COLUMNS), params.nowIso());
        const summary =
          pickString(row, CONTENT_COLUMNS) ||
          pickString(row, ["summary_text", "session_summary", "summary"]) ||
          "";
        if (!summary.trim()) {
          continue;
        }
        const privacyTags = parseArray(pickValue(row, PRIVACY_COLUMNS));
        const sourceId = pickString(row, ID_COLUMNS) || buildHash([sessionId, ts, summary]).slice(0, 20);

        const dedupe = buildHash([sourceDbPath, SUMMARIES_TABLE, sourceId, sessionId, ts, summary.slice(0, 200)]);
        if (dedupeSet.has(dedupe)) {
          continue;
        }
        dedupeSet.add(dedupe);

        summaries.push({
          session_id: sessionId,
          project,
          summary,
          ts,
          privacy_tags: privacyTags,
        });

        events.push({
          event_id: `imp_sum_${buildHash([sourceDbPath, sourceId]).slice(0, 24)}`,
          platform: "claude",
          project,
          session_id: sessionId,
          event_type: "session_end",
          ts,
          payload: {
            title: "Imported session summary",
            content: summary,
            summary,
            summary_mode: "imported",
            source: "claude-mem",
            source_table: SUMMARIES_TABLE,
            source_row_id: sourceId,
          },
          tags: ["session_summary"],
          privacy_tags: privacyTags,
          dedupe_hash: dedupe,
        });
      }
    } else {
      warnings.push(`missing table: ${SUMMARIES_TABLE}`);
    }

    let sdkSessionRows = 0;
    if (tables.has(SDK_SESSIONS_TABLE)) {
      const rows = selectAllRows(db, SDK_SESSIONS_TABLE);
      sdkSessionRows = rows.length;
      for (const row of rows) {
        const sessionId = pickString(row, SESSION_COLUMNS) || pickString(row, ["id"]) || "claude-mem-import";
        const project = normalizeProject(pickString(row, PROJECT_COLUMNS), defaultProject);
        const ts = asIso(pickString(row, TS_COLUMNS) || pickString(row, ["started_at"]), params.nowIso());
        const sourceId = pickString(row, ID_COLUMNS) || buildHash([sessionId, ts]).slice(0, 20);
        const dedupe = buildHash([sourceDbPath, SDK_SESSIONS_TABLE, sourceId, sessionId, ts]);
        if (dedupeSet.has(dedupe)) {
          continue;
        }
        dedupeSet.add(dedupe);

        events.push({
          event_id: `imp_sess_${buildHash([sourceDbPath, sourceId]).slice(0, 24)}`,
          platform: "claude",
          project,
          session_id: sessionId,
          event_type: "session_start",
          ts,
          payload: {
            title: "Imported session start",
            content: `Imported sdk session ${sessionId}`,
            source: "claude-mem",
            source_table: SDK_SESSIONS_TABLE,
            source_row_id: sourceId,
          },
          tags: ["session_start"],
          privacy_tags: [],
          dedupe_hash: dedupe,
        });
      }
    } else {
      warnings.push(`missing table: ${SDK_SESSIONS_TABLE}`);
    }

    events.sort((lhs, rhs) => {
      const left = Date.parse(lhs.ts);
      const right = Date.parse(rhs.ts);
      if (left === right) {
        return lhs.event_id.localeCompare(rhs.event_id);
      }
      return left - right;
    });

    return {
      source_db_path: sourceDbPath,
      source_tables: sourceTables,
      observation_rows: observationRows,
      summary_rows: summaryRows,
      sdk_session_rows: sdkSessionRows,
      events,
      summaries,
      warnings,
    };
  } finally {
    try {
      db.close(false);
    } catch {
      // no-op
    }
  }
}
