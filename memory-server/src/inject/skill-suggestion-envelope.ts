/**
 * §S109-002 (c) — skill_suggestion → InjectEnvelope bridge.
 *
 * Takes the `SkillSuggestion` produced by
 * `SessionManager.detectSkillFromSession(...)` (5+ steps + completion signal)
 * and persists it as an `InjectEnvelope` (kind="suggest",
 * action_hint="consider_before_decide") via `InjectTraceStore`.
 *
 * Design choice (mirrors sub-cycle b — contradiction-envelope.ts):
 *   - **side-effect persistence only**: the finalize_session response shape
 *     is unchanged; envelopes are written to `inject_traces` so downstream
 *     surfaces (S109-003) can read them.
 *   - **best-effort try/catch** at the call site (in session-manager.ts) so a
 *     persist failure cannot break finalize_session itself.
 *
 * Out of scope for this module:
 *   - SessionStart / UserPromptSubmit envelopes (sub-cycle d)
 *   - reading inject_traces back into a response (S109-003)
 *   - mutating skill_suggestion shape or detection logic
 */
import type { Database } from "bun:sqlite";
import {
  createInjectEnvelope,
  validateProseContainsSignals,
  type InjectEnvelope,
} from "./envelope";
import { InjectTraceStore } from "./trace-store";
import type { SkillSuggestion } from "../core/types";

/**
 * Default confidence when no upstream score is available. The detector is
 * heuristic (length + completion-keyword), not LLM-graded, so we anchor on
 * a moderate value rather than 1.0.
 */
const DEFAULT_CONFIDENCE = 0.6;

/** Max number of step obs_ids included as signals (after the title token). */
const MAX_STEP_SIGNALS = 4;

/**
 * Build an envelope from a SkillSuggestion.
 *
 * `signals[]` is composed of:
 *   1. the suggestion title (load-bearing — distinctive, rendered in prose)
 *   2. the source_session_id (so consumers can correlate)
 *   3. up to MAX_STEP_SIGNALS step obs_ids from the early/late steps
 *
 * Prose interpolates every signal verbatim so
 * `validateProseContainsSignals` returns ok=true.
 */
export function buildSkillSuggestionEnvelope(
  suggestion: SkillSuggestion,
): InjectEnvelope {
  const signals = collectSignals(suggestion);

  const prose = buildProse(suggestion, signals);

  const env = createInjectEnvelope({
    kind: "suggest",
    signals,
    action_hint: "consider_before_decide",
    confidence: DEFAULT_CONFIDENCE,
    prose,
  });

  // Defensive: should be unreachable given buildProse interpolates every
  // signal verbatim, but cheap insurance against future edits.
  const v = validateProseContainsSignals(env);
  if (!v.ok) {
    throw new Error(
      `skill_suggestion envelope prose missing signals: ${v.missing.join(", ")}`,
    );
  }
  return env;
}

/**
 * Persist a single envelope for the given suggestion. Returns the envelope
 * actually written, or null when `suggestion` is null/undefined (the typical
 * case when finalize_session ran on a short / non-completion session).
 *
 * Caller is expected to wrap in try/catch — see comment at top.
 */
export function recordSkillSuggestionEnvelope(
  db: Database,
  suggestion: SkillSuggestion | null | undefined,
  sessionId: string,
): InjectEnvelope | null {
  if (!suggestion) return null;
  const store = new InjectTraceStore(db);
  const env = buildSkillSuggestionEnvelope(suggestion);
  store.recordTrace(env, sessionId);
  return env;
}

// ── internals ─────────────────────────────────────────────────────────────

function collectSignals(suggestion: SkillSuggestion): string[] {
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

  push(suggestion.title);
  push(suggestion.source_session_id);

  // Pick step obs_ids: first, last, and a few in between for distinctiveness.
  const steps = Array.isArray(suggestion.steps) ? suggestion.steps : [];
  const picks: string[] = [];
  if (steps.length > 0) picks.push(steps[0]?.obs_id ?? "");
  if (steps.length > 1) picks.push(steps[steps.length - 1]?.obs_id ?? "");
  // Fill with middle steps until cap is reached.
  for (let i = 1; i < steps.length - 1 && picks.length < MAX_STEP_SIGNALS; i++) {
    picks.push(steps[i]?.obs_id ?? "");
  }
  for (const id of picks) push(id);

  // Always guarantee at least one signal — title is required by detector,
  // but defend against an empty title slipping through.
  if (out.length === 0) push(`skill_${suggestion.source_session_id ?? "unknown"}`);

  return out;
}

function buildProse(suggestion: SkillSuggestion, signals: string[]): string {
  // Verbatim interpolation of every signal guarantees prose grounding.
  const tokenList = signals.join(" / ");
  const stepCount = Array.isArray(suggestion.steps) ? suggestion.steps.length : 0;
  return (
    `セッション ${suggestion.source_session_id ?? ""} で「${suggestion.title}」と要約できる ` +
    `${stepCount} ステップの再利用可能なパターンが観察されました。` +
    `関連シグナル: ${tokenList}。次に類似タスクを着手する前に、このパターンを skill 化することを検討してください。`
  );
}
