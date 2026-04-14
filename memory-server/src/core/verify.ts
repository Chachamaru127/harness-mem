/**
 * S81-C03: observation citation-trace / provenance verify.
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
  /**
   * S81-B02 round 9 P2: admin-only override to inspect archived rows.
   * Orthogonal to include_private so a caller who wants private notes
   * does NOT automatically bypass auto-forget.
   */
  include_archived?: boolean;
  /**
   * TEAM-005 / Codex round 3 P1: tenant access filters. If provided,
   * the verify walk is only permitted when the observation row's
   * `user_id` matches or its `team_id` matches. Cross-tenant lookups
   * return the same `observation not found` shape as a truly missing
   * row (no metadata leak).
   */
  user_id?: string;
  team_id?: string;
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
  user_id: string | null;
  team_id: string | null;
  archived_at: string | null;
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
  // S81-C03 (Codex round 4 P2): align with existing visibility filter in
  // core-utils.ts which treats `sensitive` equivalent to `private`.
  // Without this the verify endpoint could leak metadata of rows that
  // the normal search APIs already hide.
  return tags.some((t) => {
    const lowered = t.toLowerCase();
    return lowered === "private" || lowered === "secret" || lowered === "sensitive";
  });
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
        SELECT id, event_id, platform, project, session_id, title, created_at,
               privacy_tags_json, user_id, team_id, archived_at
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

  // S81-C03 (Codex round 9 P2): hide archived observations from verify
  // by default. Gated on `include_archived` (not `include_private`) so
  // callers that only want their private notes do NOT also bypass
  // auto-forget.
  if (!request.include_archived && obsRow.archived_at !== null) {
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

  // TEAM-005 / Codex round 3 P1: tenant check. When the caller has a
  // scoped identity (user_id and/or team_id), the observation must
  // belong to the same user OR same team. Return the same "not found"
  // shape as a truly missing row to avoid leaking existence.
  if (typeof request.user_id === "string" && request.user_id !== "") {
    const matchesUser = obsRow.user_id === request.user_id;
    const matchesTeam =
      typeof request.team_id === "string" &&
      request.team_id !== "" &&
      obsRow.team_id === request.team_id;
    if (!matchesUser && !matchesTeam) {
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
  }

  if (!request.include_private) {
    const tags = parseArrayJson(obsRow.privacy_tags_json);
    if (isPrivate(tags)) {
      // S81-C03 (Codex round 15 P2): return the same redacted shape as
      // the "observation not found" / archived / cross-tenant paths so
      // a caller who knows the observation_id cannot use verify as a
      // metadata oracle for private notes. Previously session_id,
      // project, platform, and created_at leaked through here.
      return {
        ok: false,
        observation: {
          observation_id: obsRow.id,
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
