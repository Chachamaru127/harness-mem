/**
 * §S109-002 (b) — contradiction_scan → InjectEnvelope bridge.
 *
 * Takes the result of `detectContradictions(...)` and, for each confirmed
 * contradiction pair, builds an `InjectEnvelope` (kind="contradiction",
 * action_hint="warn_user_before_act") and persists it via `InjectTraceStore`.
 *
 * Design choice (Worker sub-cycle b): **side-effect persistence only**.
 * The consolidation_run response shape is *not* changed — envelopes are
 * written to `inject_traces` so downstream surfaces (S109-003) can read
 * them. Rationale: non-breaking, keeps the existing contract test suite
 * green, and matches sub-cycle (a)'s implicit contract (the table was
 * introduced precisely so b/c/d could persist into it).
 *
 * Out of scope for this module:
 *   - LLM adjudication (already done upstream by `detectContradictions`)
 *   - skill_suggestion / SessionStart / UserPromptSubmit envelopes
 *   - reading inject_traces back into a response (S109-003)
 */
import type { Database } from "bun:sqlite";
import {
  createInjectEnvelope,
  validateProseContainsSignals,
  type InjectEnvelope,
} from "./envelope";
import { InjectTraceStore } from "./trace-store";
import type {
  ContradictionDetectorResult,
  ContradictionPair,
} from "../consolidation/contradiction-detector";

/**
 * Default session id used when contradiction_scan is invoked outside of a
 * user-attached session (the typical case: cron / admin consolidation_run).
 */
export const SYSTEM_CONSOLIDATION_SESSION_ID = "system_consolidation";

/**
 * Build the envelope for a single contradiction pair.
 *
 * `signals[]` always includes the two observation_ids (load-bearing for
 * later grep-based consumed_rate detection) plus up to 3 distinguishing
 * tokens lifted from each side, so prose grounding stays meaningful even
 * when the IDs are opaque.
 */
export function buildContradictionEnvelope(
  pair: ContradictionPair,
): InjectEnvelope {
  const tokens = pickDistinguishingTokens(pair, 3);
  const signals = uniqueOrdered([pair.older_id, pair.newer_id, ...tokens]);

  // Confidence: prefer the LLM verdict if present, else fall back to the
  // Jaccard score that gated the candidate.
  const confidence =
    typeof pair.verdict?.confidence === "number"
      ? pair.verdict.confidence
      : pair.jaccard;

  // Prose must contain *every* signal verbatim (validateProseContainsSignals
  // is asserted in tests). We build it deterministically by interpolating
  // each signal directly into the sentence.
  const prose = buildProse(signals, pair.jaccard);

  const env = createInjectEnvelope({
    kind: "contradiction",
    signals,
    action_hint: "warn_user_before_act",
    confidence,
    prose,
  });

  // Defensive: never persist an envelope whose prose fails the contract.
  // This should be unreachable given buildProse's structure but it is
  // cheap insurance against future edits.
  const v = validateProseContainsSignals(env);
  if (!v.ok) {
    throw new Error(
      `contradiction envelope prose missing signals: ${v.missing.join(", ")}`,
    );
  }
  return env;
}

/**
 * Persist envelopes for every confirmed contradiction in the result.
 * Returns the list of envelopes actually written (useful for tests and
 * for surfaces that want to echo them back without re-reading the table).
 *
 * No-op (returns []) when `result.contradictions` is empty.
 */
export function recordContradictionEnvelopes(
  db: Database,
  result: ContradictionDetectorResult,
  sessionId: string = SYSTEM_CONSOLIDATION_SESSION_ID,
): InjectEnvelope[] {
  if (!result.contradictions.length) return [];
  const store = new InjectTraceStore(db);
  const out: InjectEnvelope[] = [];
  for (const pair of result.contradictions) {
    const env = buildContradictionEnvelope(pair);
    store.recordTrace(env, sessionId);
    out.push(env);
  }
  return out;
}

// ── internals ─────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with",
  "is", "are", "was", "were", "be", "by", "at", "as", "it", "this", "that",
  "these", "those", "from", "but",
]);

const WORD_SPLIT = /[\s,.;:!?()\[\]{}"'`<>=/\\+*\-]+/u;

function pickDistinguishingTokens(
  pair: ContradictionPair,
  max: number,
): string[] {
  // The detector does not pass through raw content here, so we derive
  // tokens from `concept` (always present) and `verdict.reason` (often
  // present from the LLM). This keeps signals[] stable even when the
  // adjudicator skipped reason. We never panic if both are empty —
  // the observation_ids alone are still a valid signal set.
  const sources = [pair.concept ?? "", pair.verdict?.reason ?? ""];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const src of sources) {
    for (const raw of src.split(WORD_SPLIT)) {
      const t = raw.trim();
      if (t.length < 3) continue;
      const lower = t.toLowerCase();
      if (STOPWORDS.has(lower)) continue;
      if (seen.has(lower)) continue;
      seen.add(lower);
      out.push(t);
      if (out.length >= max) return out;
    }
  }
  return out;
}

function uniqueOrdered(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function buildProse(signals: string[], jaccard: number): string {
  // Interpolating every signal verbatim guarantees
  // validateProseContainsSignals returns ok=true.
  const tokenList = signals.join(" / ");
  const score = jaccard.toFixed(2);
  return (
    `観察 ${signals[0] ?? ""} と観察 ${signals[1] ?? ""} は矛盾しています ` +
    `(Jaccard=${score})。関連シグナル: ${tokenList}。新しい方の観察を優先してください。`
  );
}
