/**
 * §78-E03: Progressive disclosure for harness_mem_search
 *
 * Applies detail_level transformation to search result items:
 *   "index"   (L0 equiv): { id, title, score }
 *   "context" (L1 equiv): { id, title, snippet, score, meta } — default
 *   "full"              : { id, title, content, raw_text, score, scores, meta }
 *
 * Also computes meta.token_estimate = JSON.stringify(items).length / 4.
 */

export type SearchDetailLevel = "index" | "context" | "full";

const SNIPPET_MAX_CHARS = 120;

/** Estimate token count using the standard ~4 chars/token heuristic. */
export function estimateTokens(items: unknown[]): number {
  return Math.ceil(JSON.stringify(items).length / 4);
}

/**
 * Extract top-level score from an item.
 * Items may carry score at `item.score` (a number) or inside `item.scores.final`.
 */
function extractScore(item: Record<string, unknown>): number {
  if (typeof item.score === "number") return item.score;
  const scores = item.scores;
  if (scores && typeof scores === "object" && !Array.isArray(scores)) {
    const final = (scores as Record<string, unknown>).final;
    if (typeof final === "number") return final;
  }
  return 0;
}

/** Build the meta fields for context-level items (non-content metadata). */
function extractMeta(item: Record<string, unknown>): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  for (const key of [
    "session_id",
    "project",
    "platform",
    "created_at",
    "updated_at",
    "tags",
    "memory_type",
    "observation_type",
    "branch",
    "expires_at",
    "event_time",
    "observed_at",
    "valid_from",
    "valid_to",
    "supersedes",
    "invalidated_at",
    "temporal_state",
    "temporal_anchor",
    "temporal_anchor_kind",
    "evidence_id",
    "source",
  ] as const) {
    if (key in item && item[key] !== undefined && item[key] !== null) {
      meta[key] = item[key];
    }
  }
  return meta;
}

/**
 * Transform a single search result item according to the requested detail_level.
 */
export function transformSearchItem(
  item: Record<string, unknown>,
  level: SearchDetailLevel
): Record<string, unknown> {
  const id = item.id ?? null;
  const title = typeof item.title === "string" ? item.title : "";
  const score = extractScore(item);

  if (level === "index") {
    return { id, title, score };
  }

  const content = typeof item.content === "string" ? item.content : "";

  if (level === "context") {
    const snippet = content.slice(0, SNIPPET_MAX_CHARS);
    return {
      id,
      title,
      snippet,
      score,
      meta: extractMeta(item),
    };
  }

  // "full"
  return {
    id,
    title,
    content,
    raw_text: item.raw_text ?? null,
    score,
    scores: item.scores ?? {},
    meta: extractMeta(item),
  };
}

/**
 * Apply progressive disclosure to all search result items and annotate meta.
 *
 * Returns a new items array (original response.items is not mutated).
 * Adds `token_estimate` to the returned meta object.
 *
 * @param items  - Original items array from the API response
 * @param meta   - Original meta object from the API response
 * @param level  - Desired detail level (default: "context")
 */
export function applyDetailLevel(
  items: unknown[],
  meta: Record<string, unknown>,
  level: SearchDetailLevel = "context"
): { items: Record<string, unknown>[]; meta: Record<string, unknown> } {
  const transformed = (items as Record<string, unknown>[]).map((item) =>
    transformSearchItem(item, level)
  );
  const tokenEstimate = estimateTokens(transformed);
  return {
    items: transformed,
    meta: {
      ...meta,
      token_estimate: tokenEstimate,
      detail_level: level,
    },
  };
}
