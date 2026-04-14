/**
 * S80-C03: observation citation-trace / provenance verify.
 *
 * Given an observation ID, walks the chain:
 *   observation → mem_events.event_id → payload.tool_use
 *     → provenance-extractor → {file_path, action, language, model_id}
 *
 * Returns a compact tree the caller can render as-is or feed into
 * `harness_mem_graph` BFS for multi-hop audit.
 *
 * Design choices:
 *   - Pure function of a `Database` + `observation_id` → no side effects.
 *     Tests instantiate a throwaway SQLite DB rather than the full core.
 *   - The provenance extractor is intentionally injectable so we don't
 *     couple the verify API to the bash/tool-name regex internals.
 *   - When a linked event is missing or payload is unparseable, we still
 *     return the observation so downstream callers can surface "unknown
 *     provenance" explicitly instead of erroring.
 */

import { type Database } from "bun:sqlite";
import { extractCodeProvenance } from "./provenance-extractor";
import type { CodeProvenance } from "./types";

export interface VerifyObservationRequest {
  observation_id: string;
  include_private?: boolean;
}

export interface VerifyObservationNode {
  observation_id: string;
  session_id: string | null;
  project: string | null;
  platform: string | null;
  event_id: string | null;
  created_at: string | null;
  title: string | null;
  /** `true` when the observation row itself was not found in the DB. */
  missing?: boolean;
}

export interface VerifyEventNode {
  event_id: string;
  event_type: string | null;
  ts: string | null;
  tool_name: string | null;
  /** `true` when the linked event row was not found. */
  missing?: boolean;
  /** `true` when payload JSON parsing failed. */
  payload_unparseable?: boolean;
}

export interface VerifyObservationResult {
  ok: boolean;
  observation: VerifyObservationNode;
  event: VerifyEventNode | null;
  provenance: CodeProvenance | null;
  /** Free-form reasons the walk was short-circuited, ordered. */
  notes: string[];
}

export interface VerifyObservationOptions {
  /** Allows tests to swap the extractor with a stub. */
  extractor?: (payload: Record<string, unknown>) => CodeProvenance | null;
}

interface ObservationRow {
  id: string;
  event_id: string | null;
  platform: string | null;
  project: string | null;
  session_id: string | null;
  title: string | null;
  created_at: string | null;
  privacy_tags_json: string | null;
}

interface EventRow {
  event_id: string;
  event_type: string | null;
  ts: string | null;
  payload_json: string | null;
}

function safeParsePayload(raw: string | null): Record<string, unknown> | null {
  if (raw == null || raw === "") return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function parseArrayJson(raw: string | null): string[] {
  if (raw == null || raw === "") return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function isPrivate(tags: string[]): boolean {
  return tags.some((t) => t === "private" || t === "secret");
}

export function verifyObservation(
  db: Database,
  request: VerifyObservationRequest,
  options: VerifyObservationOptions = {}
): VerifyObservationResult {
  const id = typeof request.observation_id === "string" ? request.observation_id.trim() : "";
  const notes: string[] = [];

  if (!id) {
    return {
      ok: false,
      observation: {
        observation_id: "",
        session_id: null,
        project: null,
        platform: null,
        event_id: null,
        created_at: null,
        title: null,
        missing: true,
      },
      event: null,
      provenance: null,
      notes: ["observation_id is required"],
    };
  }

  const extractor = options.extractor ?? extractCodeProvenance;

  const obsRow = db
    .query(
      `
        SELECT id, event_id, platform, project, session_id, title, created_at, privacy_tags_json
        FROM mem_observations
        WHERE id = ?
      `
    )
    .get(id) as ObservationRow | null;

  if (!obsRow) {
    return {
      ok: false,
      observation: {
        observation_id: id,
        session_id: null,
        project: null,
        platform: null,
        event_id: null,
        created_at: null,
        title: null,
        missing: true,
      },
      event: null,
      provenance: null,
      notes: ["observation not found"],
    };
  }

  if (!request.include_private) {
    const tags = parseArrayJson(obsRow.privacy_tags_json);
    if (isPrivate(tags)) {
      notes.push("observation is private; pass include_private=true to see provenance");
      return {
        ok: false,
        observation: {
          observation_id: obsRow.id,
          session_id: obsRow.session_id,
          project: obsRow.project,
          platform: obsRow.platform,
          event_id: null, // hide linkage when redacted
          created_at: obsRow.created_at,
          title: null,
        },
        event: null,
        provenance: null,
        notes,
      };
    }
  }

  const observation: VerifyObservationNode = {
    observation_id: obsRow.id,
    session_id: obsRow.session_id,
    project: obsRow.project,
    platform: obsRow.platform,
    event_id: obsRow.event_id,
    created_at: obsRow.created_at,
    title: obsRow.title,
  };

  if (!obsRow.event_id) {
    notes.push("observation has no linked event_id");
    return { ok: true, observation, event: null, provenance: null, notes };
  }

  const evtRow = db
    .query(
      `
        SELECT event_id, event_type, ts, payload_json
        FROM mem_events
        WHERE event_id = ?
      `
    )
    .get(obsRow.event_id) as EventRow | null;

  if (!evtRow) {
    notes.push("linked event row missing (cascade retention likely trimmed it)");
    return {
      ok: true,
      observation,
      event: {
        event_id: obsRow.event_id,
        event_type: null,
        ts: null,
        tool_name: null,
        missing: true,
      },
      provenance: null,
      notes,
    };
  }

  const payload = safeParsePayload(evtRow.payload_json);
  if (!payload) {
    notes.push("event payload is empty or non-object JSON");
    return {
      ok: true,
      observation,
      event: {
        event_id: evtRow.event_id,
        event_type: evtRow.event_type,
        ts: evtRow.ts,
        tool_name: null,
        payload_unparseable: true,
      },
      provenance: null,
      notes,
    };
  }

  const toolName = typeof payload.tool_name === "string" ? payload.tool_name : null;
  const eventNode: VerifyEventNode = {
    event_id: evtRow.event_id,
    event_type: evtRow.event_type,
    ts: evtRow.ts,
    tool_name: toolName,
  };

  const provenance = extractor(payload);
  if (!provenance) {
    notes.push(
      toolName
        ? `provenance-extractor did not recognise tool_name=${toolName}`
        : "event payload has no tool_name; skipping provenance extraction"
    );
  }

  return {
    ok: true,
    observation,
    event: eventNode,
    provenance,
    notes,
  };
}
