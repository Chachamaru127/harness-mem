/**
 * §S109-003 — inject_traces observability aggregator.
 *
 * Reads `inject_traces` for a given session and produces the JSON shape
 * documented in `.claude/memory/decisions.md` D8 UX Acceptance:
 *   - per-trace summary (delivered/consumed/effective)
 *   - session-level rates
 *   - hooks_health (alive | stale_Xd | unwired) per kind
 *   - pending_contradictions (top unconsumed contradiction pairs)
 *   - suggested_action when any hook is stale or unwired
 *
 * Out of scope:
 *   - effective_rate (filled by the weekly counterfactual batch in S109-005)
 *   - LLM-based judgement (consume detection is keyword grep — see
 *     consume-detector.ts)
 *   - mutating inject_traces (read-only).
 */
import type { Database } from "bun:sqlite";
import { ensureInjectTracesSchema } from "./trace-store";
import type { InjectKind } from "./envelope";

/**
 * Default cutoff for hooks_health "stale" classification. A kind that has
 * fired *at least once ever* but not within this window is reported as
 * `stale_<N>d` where N = floor((now - last_fired_at) / 1 day).
 */
export const DEFAULT_HOOKS_STALE_CUTOFF_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

/** kinds we track health for. recall_chain ↔ user_prompt_submit etc. */
const TRACKED_HOOKS = ["session_start", "user_prompt_submit", "stop"] as const;

export type TrackedHook = (typeof TRACKED_HOOKS)[number];

/**
 * Map InjectKind → which hook surface it's emitted from.
 * - recall_chain : UserPromptSubmit (per turn) + SessionStart (resume)
 * - contradiction: Stop (consolidation_run runs at session-stop time)
 * - suggest      : Stop (skill_suggestion is built when finalize runs)
 * - risk_warn    : UserPromptSubmit (when contextual recall flags risk)
 *
 * For hooks_health we conservatively map the *primary* hook — i.e. the
 * one whose absence would mean "the inject path is dead". That's:
 *   recall_chain  → user_prompt_submit
 *   risk_warn     → user_prompt_submit
 *   contradiction → stop
 *   suggest       → stop
 *
 * session_start "alive" requires at least one recall_chain trace whose
 * trace_id starts with `inj_` AND whose action_hint is "read_before_edit"
 * (the default for SessionStart bridge); but since we don't persist hook
 * source separately, we approximate: session_start is alive if *any*
 * recall_chain has fired recently. (S109-005 may refine.)
 */
const KIND_TO_HOOK: Record<InjectKind, TrackedHook> = {
  recall_chain: "user_prompt_submit",
  risk_warn: "user_prompt_submit",
  contradiction: "stop",
  suggest: "stop",
};

export interface ObservabilityInjectItem {
  trace_id: string;
  kind: InjectKind;
  delivered_at: number;
  signals: string[];
  action_hint: string;
  consumed: boolean;
  consumed_evidence: string | null;
  effective: boolean | null;
  outcome_tag: string | null;
}

export interface ObservabilitySummary {
  delivered_count: number;
  consumed_count: number;
  consumed_rate: number | null;
  effective_rate: number | null;
}

export interface HooksHealth {
  session_start: string;
  user_prompt_submit: string;
  stop: string;
}

export interface PendingContradictionTop {
  a: string;
  b: string;
  jaccard: number;
}

export interface PendingContradictions {
  count: number;
  top_pairs: PendingContradictionTop[];
}

export interface InjectObservability {
  session_id: string;
  injects_in_session: ObservabilityInjectItem[];
  summary: ObservabilitySummary;
  hooks_health: HooksHealth;
  pending_contradictions: PendingContradictions;
  suggested_action: string | null;
}

export interface AggregateOptions {
  /** Inclusive lower bound on fired_at (ms). */
  sinceMs?: number;
  /** Inclusive upper bound on fired_at (ms). */
  untilMs?: number;
  /** Override "now" for deterministic tests. Defaults to Date.now(). */
  nowMs?: number;
  /** Override stale cutoff for hooks_health. */
  staleCutoffMs?: number;
}

interface RawTraceRow {
  trace_id: string;
  kind: string;
  session_id: string;
  fired_at: number;
  signals_json: string;
  action_hint: string;
  confidence: number;
  consumed: number;
  consumed_evidence: string | null;
  effective: number | null;
}

interface RawHookRow {
  kind: string;
  last_fired_at: number;
}

function parseSignals(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) {
      return parsed.filter((v): v is string => typeof v === "string");
    }
  } catch {
    /* noop */
  }
  return [];
}

/**
 * Aggregate inject observability for a single session.
 *
 * The session table is *not* required to exist — this aggregator works
 * directly on `inject_traces` so it can be called from admin tools even
 * when the session has been finalized.
 */
export function aggregateInjectObservability(
  db: Database,
  sessionId: string,
  opts: AggregateOptions = {},
): InjectObservability {
  ensureInjectTracesSchema(db);

  const now = opts.nowMs ?? Date.now();
  const staleCutoff = opts.staleCutoffMs ?? DEFAULT_HOOKS_STALE_CUTOFF_MS;

  // Build per-session trace list, optionally bounded by since/until.
  const params: (string | number)[] = [sessionId];
  let where = "session_id = ?";
  if (typeof opts.sinceMs === "number") {
    where += " AND fired_at >= ?";
    params.push(opts.sinceMs);
  }
  if (typeof opts.untilMs === "number") {
    where += " AND fired_at <= ?";
    params.push(opts.untilMs);
  }

  const traces = db
    .query<RawTraceRow, (string | number)[]>(
      `SELECT trace_id, kind, session_id, fired_at, signals_json,
              action_hint, confidence, consumed, consumed_evidence, effective
       FROM inject_traces
       WHERE ${where}
       ORDER BY fired_at ASC, trace_id ASC`,
    )
    .all(...params);

  const items: ObservabilityInjectItem[] = traces.map((row) => ({
    trace_id: row.trace_id,
    kind: row.kind as InjectKind,
    delivered_at: row.fired_at,
    signals: parseSignals(row.signals_json),
    action_hint: row.action_hint,
    consumed: row.consumed === 1,
    consumed_evidence: row.consumed_evidence,
    effective:
      row.effective === null || row.effective === undefined
        ? null
        : row.effective === 1,
    outcome_tag: null, // S109-005 will fill
  }));

  const delivered = items.length;
  const consumed = items.filter((it) => it.consumed).length;
  const summary: ObservabilitySummary = {
    delivered_count: delivered,
    consumed_count: consumed,
    consumed_rate: delivered === 0 ? null : consumed / delivered,
    effective_rate: null,
  };

  // hooks_health is computed *globally* (not per-session) — stale means
  // the hook surface itself is unwired, which is a system-wide concern.
  const hooksHealth = computeHooksHealth(db, now, staleCutoff);

  const pending = computePendingContradictions(db);

  const suggested = pickSuggestedAction(hooksHealth);

  return {
    session_id: sessionId,
    injects_in_session: items,
    summary,
    hooks_health: hooksHealth,
    pending_contradictions: pending,
    suggested_action: suggested,
  };
}

function computeHooksHealth(
  db: Database,
  nowMs: number,
  staleCutoffMs: number,
): HooksHealth {
  const rows = db
    .query<RawHookRow, []>(
      `SELECT kind, MAX(fired_at) AS last_fired_at
       FROM inject_traces
       GROUP BY kind`,
    )
    .all();

  // Build kind -> last_fired_at map.
  const lastByKind = new Map<string, number>();
  for (const r of rows) {
    lastByKind.set(r.kind, Number(r.last_fired_at));
  }

  // Reduce kind-level firings to hook-level (multiple kinds may map to
  // the same hook — keep the most recent).
  const lastByHook = new Map<TrackedHook, number>();
  for (const [kind, lastFiredAt] of lastByKind) {
    const hook = KIND_TO_HOOK[kind as InjectKind];
    if (!hook) continue;
    const prev = lastByHook.get(hook);
    if (prev === undefined || lastFiredAt > prev) {
      lastByHook.set(hook, lastFiredAt);
    }
  }

  // session_start approximation: alive if any recall_chain has fired
  // recently. KIND_TO_HOOK has no direct InjectKind for session_start,
  // so we bridge through recall_chain (its dominant emitter).
  const rcLast = lastByKind.get("recall_chain");
  if (rcLast !== undefined) {
    const prev = lastByHook.get("session_start");
    if (prev === undefined || rcLast > prev) {
      lastByHook.set("session_start", rcLast);
    }
  }

  const result: HooksHealth = {
    session_start: classifyHook(lastByHook.get("session_start"), nowMs, staleCutoffMs),
    user_prompt_submit: classifyHook(
      lastByHook.get("user_prompt_submit"),
      nowMs,
      staleCutoffMs,
    ),
    stop: classifyHook(lastByHook.get("stop"), nowMs, staleCutoffMs),
  };

  return result;
}

function classifyHook(
  lastFiredAt: number | undefined,
  nowMs: number,
  staleCutoffMs: number,
): string {
  if (lastFiredAt === undefined || lastFiredAt === null) return "unwired";
  const ageMs = nowMs - lastFiredAt;
  if (ageMs < 0 || ageMs <= staleCutoffMs) return "alive";
  const days = Math.max(1, Math.floor(ageMs / (24 * 60 * 60 * 1000)));
  return `stale_${days}d`;
}

interface PendingPairRow {
  trace_id: string;
  signals_json: string;
  confidence: number;
}

function computePendingContradictions(db: Database): PendingContradictions {
  const countRow = db
    .query<{ c: number }, []>(
      `SELECT COUNT(*) AS c FROM inject_traces
       WHERE kind = 'contradiction' AND consumed = 0`,
    )
    .get();
  const count = Number(countRow?.c ?? 0);

  const rows = db
    .query<PendingPairRow, []>(
      `SELECT trace_id, signals_json, confidence
       FROM inject_traces
       WHERE kind = 'contradiction' AND consumed = 0
       ORDER BY fired_at DESC, trace_id DESC
       LIMIT 3`,
    )
    .all();

  const top_pairs: PendingContradictionTop[] = rows.map((r) => {
    const sig = parseSignals(r.signals_json);
    return {
      a: sig[0] ?? "",
      b: sig[1] ?? "",
      jaccard: typeof r.confidence === "number" ? r.confidence : 0,
    };
  });

  return { count, top_pairs };
}

function pickSuggestedAction(health: HooksHealth): string | null {
  for (const h of TRACKED_HOOKS) {
    const v = health[h];
    if (v === "unwired" || (typeof v === "string" && v.startsWith("stale_"))) {
      return "harness-mem doctor --fix";
    }
  }
  return null;
}
