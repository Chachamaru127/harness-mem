/**
 * §S109-003 — Consume detection helper.
 *
 * Detects whether the AI agent's *next-turn* artifact (a tool_call argument
 * blob, a user-visible response, or both) echoes any of the `signals[]` we
 * shipped on the previous-turn `InjectEnvelope`.
 *
 * Design choice (D8 UX Acceptance):
 *   - Substring match is sufficient — perfect NLP / fuzzy matching is out
 *     of scope. The point of consumed_rate is "did the inject move the
 *     needle at all" not "was the inject semantically perfect".
 *   - One signal hit ⇒ consumed=true. We don't require all signals to
 *     appear; that would punish well-crafted envelopes that surface 5
 *     candidate signals when the model only acted on one.
 *
 * Out of scope:
 *   - LLM-based "did the agent reason about this" judgement
 *   - synonym / paraphrase resolution (e.g. "DB" matching "database")
 *   - cross-turn span (we only inspect the immediate next turn)
 */
import type { InjectEnvelope } from "./envelope";

export interface NextTurnArtifact {
  /**
   * Tool call records from the next turn. Shape is intentionally loose
   * because callers may pass raw MCP / Anthropic / OpenAI shapes; we
   * stringify the entire record to a JSON blob and grep against it.
   */
  tool_calls?: unknown[];
  /** Free-form user-visible response text from the agent's next turn. */
  user_text?: string;
}

export interface ConsumeDetectionResult {
  consumed: boolean;
  /**
   * Human-readable evidence string when `consumed=true`, of the form
   * `tool_call:<name>:<signal>` or `user_text:<signal>`.
   * `null` when no signal hit.
   */
  evidence: string | null;
}

/**
 * Scan `artifact` for any envelope signal. Returns the first hit.
 * Empty signals[] always returns consumed=false.
 */
export function detectConsumed(
  envelope: InjectEnvelope,
  artifact: NextTurnArtifact,
): ConsumeDetectionResult {
  const signals = envelope.structured.signals;
  if (!signals || signals.length === 0) {
    return { consumed: false, evidence: null };
  }

  // Build a lookup of (haystack-string, source-tag) so we report
  // *which* turn-side echoed the signal first.
  const haystacks: Array<{ text: string; source: string }> = [];

  if (artifact.tool_calls && Array.isArray(artifact.tool_calls)) {
    for (const tc of artifact.tool_calls) {
      const tcName = pickToolName(tc);
      const blob = safeStringify(tc);
      haystacks.push({
        text: blob,
        source: tcName ? `tool_call:${tcName}` : "tool_call",
      });
    }
  }

  if (typeof artifact.user_text === "string" && artifact.user_text.length > 0) {
    haystacks.push({ text: artifact.user_text, source: "user_text" });
  }

  if (haystacks.length === 0) {
    return { consumed: false, evidence: null };
  }

  for (const signal of signals) {
    if (!signal) continue;
    for (const h of haystacks) {
      if (h.text.includes(signal)) {
        return {
          consumed: true,
          evidence: `${h.source}:${signal}`,
        };
      }
    }
  }

  return { consumed: false, evidence: null };
}

function pickToolName(tc: unknown): string | null {
  if (!tc || typeof tc !== "object") return null;
  const r = tc as Record<string, unknown>;
  if (typeof r.name === "string") return r.name;
  // Anthropic shape: { type: "tool_use", name, input }
  if (typeof r.tool === "string") return r.tool;
  return null;
}

function safeStringify(v: unknown): string {
  try {
    if (typeof v === "string") return v;
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
