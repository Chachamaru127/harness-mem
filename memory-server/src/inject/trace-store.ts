/**
 * §S109-002 (a) — inject_traces SQLite repository
 *
 * Persists InjectEnvelope firings so that a downstream batch can compute
 * `consumed_rate` (did the next turn echo any of the signals?) and
 * `effective_rate` (did the user accept the warning?).
 *
 * Scope of this module:
 *   - additive `CREATE TABLE IF NOT EXISTS` migration (idempotent)
 *   - minimal record / read / mark-consumed primitives
 *
 * Out of scope (see S109-003 / sub-cycle b/c/d):
 *   - LLM-driven consumption detection
 *   - rewriting existing inject sites (contradiction_scan / SessionStart / ...)
 *     to flow through the envelope.
 */

import type { Database } from "bun:sqlite";
import type { InjectEnvelope, InjectKind } from "./envelope";

export interface InjectTraceRow {
  trace_id: string;
  kind: InjectKind;
  session_id: string;
  fired_at: number;
  signals_json: string;
  signals: string[];
  action_hint: string;
  confidence: number;
  prose: string;
  consumed: 0 | 1;
  consumed_at: number | null;
  consumed_evidence: string | null;
  effective: 0 | 1 | null;
  effective_evidence: string | null;
}

interface RawInjectTraceRow {
  trace_id: string;
  kind: string;
  session_id: string;
  fired_at: number;
  signals_json: string;
  action_hint: string;
  confidence: number;
  prose: string;
  consumed: number;
  consumed_at: number | null;
  consumed_evidence: string | null;
  effective: number | null;
  effective_evidence: string | null;
}

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS inject_traces (
    trace_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    session_id TEXT NOT NULL,
    fired_at INTEGER NOT NULL,
    signals_json TEXT NOT NULL,
    action_hint TEXT NOT NULL,
    confidence REAL NOT NULL,
    prose TEXT NOT NULL,
    consumed INTEGER NOT NULL DEFAULT 0,
    consumed_at INTEGER,
    consumed_evidence TEXT,
    effective INTEGER,
    effective_evidence TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_inject_traces_session_fired
    ON inject_traces(session_id, fired_at);
`;

export function ensureInjectTracesSchema(db: Database): void {
  db.exec(CREATE_TABLE_SQL);
}

function inflateRow(row: RawInjectTraceRow): InjectTraceRow {
  let signals: string[] = [];
  try {
    const parsed = JSON.parse(row.signals_json);
    if (Array.isArray(parsed)) {
      signals = parsed.filter((v): v is string => typeof v === "string");
    }
  } catch {
    signals = [];
  }
  return {
    trace_id: row.trace_id,
    kind: row.kind as InjectKind,
    session_id: row.session_id,
    fired_at: row.fired_at,
    signals_json: row.signals_json,
    signals,
    action_hint: row.action_hint,
    confidence: row.confidence,
    prose: row.prose,
    consumed: row.consumed === 1 ? 1 : 0,
    consumed_at: row.consumed_at,
    consumed_evidence: row.consumed_evidence,
    effective:
      row.effective === null || row.effective === undefined
        ? null
        : row.effective === 1
          ? 1
          : 0,
    effective_evidence: row.effective_evidence,
  };
}

export class InjectTraceStore {
  constructor(private readonly db: Database) {
    ensureInjectTracesSchema(db);
  }

  recordTrace(
    envelope: InjectEnvelope,
    sessionId: string,
    firedAt?: number,
  ): void {
    const ts = firedAt ?? Date.now();
    this.db
      .query(
        `
        INSERT INTO inject_traces
          (trace_id, kind, session_id, fired_at, signals_json,
           action_hint, confidence, prose, consumed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
      `,
      )
      .run(
        envelope.structured.trace_id,
        envelope.structured.kind,
        sessionId,
        ts,
        JSON.stringify(envelope.structured.signals),
        envelope.structured.action_hint,
        envelope.structured.confidence,
        envelope.prose,
      );
  }

  getTraceById(traceId: string): InjectTraceRow | null {
    const row = this.db
      .query<RawInjectTraceRow, [string]>(
        `SELECT trace_id, kind, session_id, fired_at, signals_json,
                action_hint, confidence, prose, consumed,
                consumed_at, consumed_evidence, effective, effective_evidence
         FROM inject_traces
         WHERE trace_id = ?`,
      )
      .get(traceId);
    return row ? inflateRow(row) : null;
  }

  getTracesBySession(sessionId: string): InjectTraceRow[] {
    const rows = this.db
      .query<RawInjectTraceRow, [string]>(
        `SELECT trace_id, kind, session_id, fired_at, signals_json,
                action_hint, confidence, prose, consumed,
                consumed_at, consumed_evidence, effective, effective_evidence
         FROM inject_traces
         WHERE session_id = ?
         ORDER BY fired_at ASC, trace_id ASC`,
      )
      .all(sessionId);
    return rows.map(inflateRow);
  }

  markConsumed(traceId: string, evidence: string, consumedAt?: number): void {
    const ts = consumedAt ?? Date.now();
    this.db
      .query(
        `UPDATE inject_traces
         SET consumed = 1, consumed_at = ?, consumed_evidence = ?
         WHERE trace_id = ?`,
      )
      .run(ts, evidence, traceId);
  }
}
