/**
 * §S109-002 (d) — UserPromptSubmit recall → InjectEnvelope bridge.
 *
 * Takes the list of observations injected by `search(...)` in response to
 * a user prompt (the recall path triggered when the user asks
 * "思い出して" / "前回" / etc., or when contextual recall fires
 * automatically) and persists it as an `InjectEnvelope`
 * (kind="recall_chain" by default, "risk_warn" when the caller decides
 * the recalled context is a risk signal) via `InjectTraceStore`.
 *
 * Design choice (mirrors sub-cycles b — contradiction-envelope.ts and
 * c — skill-suggestion-envelope.ts):
 *   - **side-effect persistence only**: the search response shape is
 *     unchanged; envelopes are written to `inject_traces` so downstream
 *     surfaces (S109-003) can read them.
 *   - **best-effort try/catch** at the call site so a persist failure
 *     cannot break the user-prompt response.
 *
 * Idempotency: UserPromptSubmit fires once per turn with a fresh prompt,
 * so unlike SessionStart we do **not** dedupe — each turn deserves its
 * own trace row even if the same observations recur.
 *
 * Out of scope for this module:
 *   - mutating the search / contextual-recall response shape
 *   - reading inject_traces back into a response (S109-003)
 *   - deciding *which* observations count as recall vs risk (caller
 *     supplies the kind explicitly when it has a signal)
 */
import type { Database } from "bun:sqlite";
import {
  createInjectEnvelope,
  validateProseContainsSignals,
  type InjectEnvelope,
  type InjectKind,
} from "./envelope";
import { InjectTraceStore } from "./trace-store";

/**
 * Default confidence when no upstream score is available. Recall is
 * heuristic (lexical/vector hybrid + recency), not LLM-graded, so we
 * anchor on a moderate value rather than 1.0.
 */
const DEFAULT_CONFIDENCE = 0.65;

/** Max number of obs_ids included as id-signals (after the first). */
const MAX_ID_SIGNALS = 4;
/** Max number of distinguishing word tokens included after the ids. */
const MAX_WORD_TOKENS = 3;

/**
 * Minimal shape we consume from a recall result item. We only need an id
 * and (optionally) a title or content snippet to lift distinguishing
 * tokens. The actual search response items have many more fields; we
 * intentionally accept the loose shape so this bridge is decoupled from
 * the search response schema.
 */
export interface RecalledObservation {
  id?: string | null;
  title?: string | null;
  content?: string | null;
}

export type UserPromptRecallKind = Extract<
  InjectKind,
  "recall_chain" | "risk_warn"
>;

const VALID_KINDS = new Set<UserPromptRecallKind>([
  "recall_chain",
  "risk_warn",
]);

/**
 * Build an envelope from a list of recalled observations.
 *
 * `signals[]` is composed of (in order, deduped):
 *   1. the first observation id (load-bearing — first hit, highest rank)
 *   2. up to MAX_ID_SIGNALS additional observation ids
 *   3. up to MAX_WORD_TOKENS distinguishing word tokens lifted from the
 *      first hit's title/content (so prose grounding stays meaningful
 *      even when ids are opaque)
 *
 * Returns `null` when there are no observations — there is nothing to
 * record (and the persist call also no-ops in that case).
 */
export function buildUserPromptRecallEnvelope(
  observations: RecalledObservation[] | null | undefined,
  kind: UserPromptRecallKind = "recall_chain",
): InjectEnvelope | null {
  if (!observations || observations.length === 0) return null;
  if (!VALID_KINDS.has(kind)) {
    throw new Error(`unsupported user-prompt recall kind: ${kind as string}`);
  }

  const signals = collectSignals(observations);
  if (signals.length === 0) return null;

  const actionHint =
    kind === "risk_warn" ? "warn_user_before_act" : "read_before_edit";
  const prose = buildProse(observations, signals, kind);

  const env = createInjectEnvelope({
    kind,
    signals,
    action_hint: actionHint,
    confidence: DEFAULT_CONFIDENCE,
    prose,
  });

  // Defensive: should be unreachable given buildProse interpolates every
  // signal verbatim, but cheap insurance against future edits (matches
  // sub-cycle b/c).
  const v = validateProseContainsSignals(env);
  if (!v.ok) {
    throw new Error(
      `user_prompt_recall envelope prose missing signals: ${v.missing.join(", ")}`,
    );
  }
  return env;
}

/**
 * Persist a single envelope for the given recall result.
 *
 * Returns the envelope actually written, or null when there are no
 * observations to record. Caller is expected to wrap in try/catch — see
 * top-of-file comment.
 */
export function recordUserPromptRecallEnvelope(
  db: Database,
  observations: RecalledObservation[] | null | undefined,
  sessionId: string,
  kind: UserPromptRecallKind = "recall_chain",
  now?: number,
): InjectEnvelope | null {
  if (!sessionId) return null;
  const env = buildUserPromptRecallEnvelope(observations, kind);
  if (!env) return null;
  const store = new InjectTraceStore(db);
  store.recordTrace(env, sessionId, now);
  return env;
}

// ── internals ─────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with",
  "is", "are", "was", "were", "be", "by", "at", "as", "it", "this", "that",
  "these", "those", "from", "but",
]);

const WORD_SPLIT = /[\s,.;:!?()\[\]{}"'`<>=/\\+*\-]+/u;

function collectSignals(observations: RecalledObservation[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | undefined | null) => {
    if (!raw) return;
    const v = String(raw).trim();
    if (!v) return;
    if (seen.has(v)) return;
    seen.add(v);
    out.push(v);
  };

  // 1. ids in rank order, capped.
  let idCount = 0;
  for (const obs of observations) {
    if (!obs?.id) continue;
    push(obs.id);
    idCount++;
    if (idCount >= MAX_ID_SIGNALS + 1) break; // first + MAX additional
  }

  // 2. distinguishing tokens from the top hit's title/content. Skip when
  //    the title is itself a stopword-y blob.
  const top = observations[0];
  if (top) {
    const sources = [top.title ?? "", top.content ?? ""];
    let added = 0;
    for (const src of sources) {
      if (!src) continue;
      for (const raw of String(src).split(WORD_SPLIT)) {
        const t = raw.trim();
        if (t.length < 3) continue;
        const lower = t.toLowerCase();
        if (STOPWORDS.has(lower)) continue;
        if (seen.has(t)) continue;
        push(t);
        added++;
        if (added >= MAX_WORD_TOKENS) break;
      }
      if (added >= MAX_WORD_TOKENS) break;
    }
  }

  return out;
}

function buildProse(
  observations: RecalledObservation[],
  signals: string[],
  kind: UserPromptRecallKind,
): string {
  // Verbatim interpolation of every signal guarantees prose grounding.
  const tokenList = signals.join(" / ");
  const count = observations.length;
  const lead =
    kind === "risk_warn"
      ? `現在のプロンプトに関連する過去のリスクが検知されました。`
      : `現在のプロンプトに関連する過去のコンテキスト ${count} 件を想起しました。`;
  const tail =
    kind === "risk_warn"
      ? `行動する前にユーザーに確認してください。`
      : `編集や応答に取りかかる前に、これらの観察を読み直してください。`;
  return (
    `${lead} 起点観察 ${signals[0] ?? ""}。` +
    `関連シグナル: ${tokenList}。${tail}`
  );
}
