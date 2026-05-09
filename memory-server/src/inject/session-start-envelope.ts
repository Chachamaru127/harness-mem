/**
 * §S109-002 (d) — SessionStart artifact → InjectEnvelope bridge.
 *
 * Takes the `continuity_briefing` block produced by `resumePack(...)` (the
 * server-side SessionStart artifact) and persists it as an `InjectEnvelope`
 * (kind="recall_chain", action_hint="read_before_edit") via `InjectTraceStore`.
 *
 * Design choice (mirrors sub-cycles b — contradiction-envelope.ts and
 * c — skill-suggestion-envelope.ts):
 *   - **side-effect persistence only**: the resume_pack response shape is
 *     unchanged; envelopes are written to `inject_traces` so downstream
 *     surfaces (S109-003) can read them.
 *   - **best-effort try/catch** at the call site so a persist failure cannot
 *     break resume_pack itself.
 *
 * Idempotency: SessionStart fires repeatedly for the same session (every
 * fresh wake-up / hook reload). To avoid burying a single chain top under
 * dozens of identical traces, this module skips persistence when an
 * existing recall_chain trace for the same `(session_id, chain_top)` was
 * recorded within `IDEMPOTENCY_WINDOW_MS`. The check runs against
 * inject_traces directly via a small SELECT — trace-store.ts is *not*
 * modified.
 *
 * Out of scope for this module:
 *   - mutating resume_pack / continuity_briefing shape
 *   - reading inject_traces back into a response (S109-003)
 */
import type { Database } from "bun:sqlite";
import {
  createInjectEnvelope,
  validateProseContainsSignals,
  type InjectEnvelope,
} from "./envelope";
import { InjectTraceStore } from "./trace-store";

/**
 * Default confidence when no upstream score is available. The continuity
 * briefing is heuristically assembled (anchor selection + recency), not
 * LLM-graded, so we anchor on a moderate value rather than 1.0.
 *
 * Briefings that include both a latest_summary and a pinned continuity
 * tend to be sharper, so we nudge upward in that case (max 0.85).
 */
const BASE_CONFIDENCE = 0.7;
const MAX_CONFIDENCE = 0.85;

/** Idempotency window: skip re-persist if a matching trace fired within. */
const IDEMPOTENCY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/** Max number of cited_item_ids included as signals. */
const MAX_ANCHOR_SIGNALS = 4;

/**
 * Shape we consume from `resume_pack`'s `continuity_briefing` block. We
 * intentionally type it loosely (the exact shape lives in
 * observation-store.ts and is plain Record<string, unknown>), and pull only
 * the fields we need.
 */
export interface SessionStartArtifact {
  source_session_id?: string | null;
  cited_item_ids?: unknown;
  includes_summary?: boolean;
  includes_latest_interaction?: boolean;
  source_scope?: string | null;
  content?: string | null;
}

/**
 * Build an envelope from a SessionStart continuity briefing artifact.
 *
 * `signals[]` is composed of (in priority order, deduped):
 *   1. chain_top observation_id (= first cited_item_id) — load-bearing,
 *      used for idempotency
 *   2. source_session_id (so consumers can correlate)
 *   3. up to MAX_ANCHOR_SIGNALS - 1 additional cited_item_ids
 *
 * Returns `null` (and the persist call also no-ops) when the artifact has
 * neither a session id nor any anchor — there is nothing meaningful to
 * record.
 */
export function buildSessionStartEnvelope(
  artifact: SessionStartArtifact,
): InjectEnvelope | null {
  const signals = collectSignals(artifact);
  if (signals.length === 0) return null;

  const confidence = pickConfidence(artifact);
  const prose = buildProse(artifact, signals);

  const env = createInjectEnvelope({
    kind: "recall_chain",
    signals,
    action_hint: "read_before_edit",
    confidence,
    prose,
  });

  // Defensive: should be unreachable given buildProse interpolates every
  // signal verbatim, but cheap insurance against future edits (matches
  // sub-cycle b/c).
  const v = validateProseContainsSignals(env);
  if (!v.ok) {
    throw new Error(
      `session_start envelope prose missing signals: ${v.missing.join(", ")}`,
    );
  }
  return env;
}

/**
 * Persist a single envelope for the given artifact, with idempotency.
 *
 * Returns the envelope actually written, or null when:
 *   - artifact is null/undefined or has no usable signals
 *   - an existing recall_chain trace for the same session_id and same
 *     chain_top fired within IDEMPOTENCY_WINDOW_MS
 *
 * Caller is expected to wrap in try/catch — see top-of-file comment.
 */
export function recordSessionStartEnvelope(
  db: Database,
  artifact: SessionStartArtifact | null | undefined,
  sessionId: string,
  now?: number,
): InjectEnvelope | null {
  if (!artifact) return null;
  if (!sessionId) return null;

  const env = buildSessionStartEnvelope(artifact);
  if (!env) return null;

  const chainTop = env.structured.signals[0];
  if (chainTop && hasRecentMatchingTrace(db, sessionId, chainTop, now)) {
    return null;
  }

  const store = new InjectTraceStore(db);
  store.recordTrace(env, sessionId, now);
  return env;
}

// ── internals ─────────────────────────────────────────────────────────────

function collectSignals(artifact: SessionStartArtifact): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | undefined | null) => {
    if (!raw) return;
    const v = raw.trim();
    if (!v) return;
    if (seen.has(v)) return;
    seen.add(v);
    out.push(v);
  };

  // chain_top first — load-bearing for idempotency.
  const cited = Array.isArray(artifact.cited_item_ids)
    ? (artifact.cited_item_ids as unknown[]).filter(
        (v): v is string => typeof v === "string",
      )
    : [];
  if (cited.length > 0) push(cited[0]);

  if (artifact.source_session_id) push(artifact.source_session_id);

  for (let i = 1; i < cited.length && out.length < MAX_ANCHOR_SIGNALS; i++) {
    push(cited[i]);
  }

  return out;
}

function pickConfidence(artifact: SessionStartArtifact): number {
  let c = BASE_CONFIDENCE;
  if (artifact.includes_summary) c += 0.05;
  if (artifact.includes_latest_interaction) c += 0.05;
  if (c > MAX_CONFIDENCE) c = MAX_CONFIDENCE;
  return c;
}

function buildProse(
  artifact: SessionStartArtifact,
  signals: string[],
): string {
  // Verbatim interpolation of every signal guarantees prose grounding
  // (validateProseContainsSignals returns ok=true).
  const tokenList = signals.join(" / ");
  const scope = artifact.source_scope ? `(${artifact.source_scope}) ` : "";
  return (
    `前回の続き ${scope}: セッション ${signals[0] ?? ""} の文脈で作業中です。 ` +
    `関連シグナル: ${tokenList}。` +
    `編集に取りかかる前に、これらの観察を読み直してから進めてください。`
  );
}

interface RecentTraceRow {
  trace_id: string;
}

/**
 * Idempotency probe. Returns true when a recall_chain trace whose first
 * signal equals `chainTop` was already recorded for this session within
 * IDEMPOTENCY_WINDOW_MS. We match the first signal by JSON prefix
 * (`["<chainTop>"...`) which is exact and index-friendly enough for the
 * volumes inject_traces will see (one row per fired envelope).
 */
function hasRecentMatchingTrace(
  db: Database,
  sessionId: string,
  chainTop: string,
  now?: number,
): boolean {
  const cutoff = (now ?? Date.now()) - IDEMPOTENCY_WINDOW_MS;
  // First-signal prefix: JSON.stringify always quotes strings the same way
  // and signals[] is built deterministically with chainTop at index 0.
  const prefix = `[${JSON.stringify(chainTop)}`;
  const row = db
    .query<RecentTraceRow, [string, number, number, string]>(
      `SELECT trace_id FROM inject_traces
       WHERE session_id = ?
         AND kind = 'recall_chain'
         AND fired_at >= ?
         AND substr(signals_json, 1, ?) = ?
       LIMIT 1`,
    )
    .get(sessionId, cutoff, prefix.length, prefix);
  return row !== null;
}
