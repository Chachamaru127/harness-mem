/**
 * Retrieval Router - routes queries to the best retrieval strategy
 * based on the question kind.
 *
 * Question Kinds:
 * - "profile"  : Who/what questions about entities → entity/observation retrieval
 * - "timeline" : When/sequence questions → chronological retrieval
 * - "graph"    : How-related/connection questions → link-graph traversal
 * - "vector"   : Semantic similarity → embedding-based retrieval
 * - "hybrid"   : Default / unknown → combine all strategies (current behavior)
 */

export type QuestionKind = "profile" | "timeline" | "graph" | "vector" | "hybrid";

export interface RouteDecision {
  /** Primary retrieval strategy to use. */
  kind: QuestionKind;
  /** Confidence score for the classification (0-1). */
  confidence: number;
  /** Explanation of why this kind was chosen. */
  reason: string;
  /** Weight overrides for the search scoring. */
  weights: SearchWeights;
}

export interface SearchWeights {
  lexical: number;
  vector: number;
  recency: number;
  tag_boost: number;
  importance: number;
  graph: number;
}

/** Default hybrid weights (balanced). */
const HYBRID_WEIGHTS: SearchWeights = {
  lexical: 0.3,
  vector: 0.3,
  recency: 0.15,
  tag_boost: 0.1,
  importance: 0.1,
  graph: 0.05,
};

/** Profile-focused weights: boost lexical + tag matching for entity retrieval. */
const PROFILE_WEIGHTS: SearchWeights = {
  lexical: 0.45,
  vector: 0.15,
  recency: 0.1,
  tag_boost: 0.2,
  importance: 0.05,
  graph: 0.05,
};

/** Timeline-focused weights: boost recency for chronological queries. */
const TIMELINE_WEIGHTS: SearchWeights = {
  lexical: 0.2,
  vector: 0.15,
  recency: 0.4,
  tag_boost: 0.05,
  importance: 0.15,
  graph: 0.05,
};

/** Graph-focused weights: boost graph traversal score. */
const GRAPH_WEIGHTS: SearchWeights = {
  lexical: 0.15,
  vector: 0.15,
  recency: 0.1,
  tag_boost: 0.05,
  importance: 0.1,
  graph: 0.45,
};

/** Vector-focused weights: boost semantic similarity. */
const VECTOR_WEIGHTS: SearchWeights = {
  lexical: 0.1,
  vector: 0.55,
  recency: 0.1,
  tag_boost: 0.05,
  importance: 0.15,
  graph: 0.05,
};

const WEIGHT_MAP: Record<QuestionKind, SearchWeights> = {
  profile: PROFILE_WEIGHTS,
  timeline: TIMELINE_WEIGHTS,
  graph: GRAPH_WEIGHTS,
  vector: VECTOR_WEIGHTS,
  hybrid: HYBRID_WEIGHTS,
};

// ---- Pattern-based question kind classification ----

const PROFILE_PATTERNS = [
  /^(who|what)\s+(is|are|was|were)\b/i,
  /\b(entity|person|project|tool|library|framework)\b/i,
  /\b(tell me about|describe|explain)\b/i,
  /\b(profile|identity|background)\b/i,
];

const TIMELINE_PATTERNS = [
  /^(when|what time|how long)\b/i,
  /\b(before|after|during|since|until|recently|yesterday|today|last week)\b/i,
  /\b(sequence|chronolog|history|timeline|progress|evolve)\b/i,
  /\b(latest|newest|oldest|first|last)\b/i,
];

const GRAPH_PATTERNS = [
  /\b(how.*(relate|connect|link)|relationship|depends?|affects?)\b/i,
  /\b(between|compared to|versus|vs)\b/i,
  /\b(cause|effect|impact|influence)\b/i,
  /\b(chain|path|trace|flow)\b/i,
];

/**
 * Classify a query into a question kind using pattern matching.
 *
 * Returns the most confident classification, falling back to "hybrid"
 * when no strong signal is detected.
 */
export function classifyQuestion(query: string): RouteDecision {
  const q = query.trim();
  if (!q) {
    return { kind: "hybrid", confidence: 0, reason: "empty query", weights: HYBRID_WEIGHTS };
  }

  const scores: { kind: QuestionKind; score: number; reason: string }[] = [];

  // Profile detection
  let profileScore = 0;
  for (const pattern of PROFILE_PATTERNS) {
    if (pattern.test(q)) profileScore += 0.3;
  }
  if (profileScore > 0) {
    scores.push({ kind: "profile", score: Math.min(1, profileScore), reason: "entity/profile query pattern" });
  }

  // Timeline detection
  let timelineScore = 0;
  for (const pattern of TIMELINE_PATTERNS) {
    if (pattern.test(q)) timelineScore += 0.3;
  }
  if (timelineScore > 0) {
    scores.push({ kind: "timeline", score: Math.min(1, timelineScore), reason: "temporal/sequence query pattern" });
  }

  // Graph detection
  let graphScore = 0;
  for (const pattern of GRAPH_PATTERNS) {
    if (pattern.test(q)) graphScore += 0.3;
  }
  if (graphScore > 0) {
    scores.push({ kind: "graph", score: Math.min(1, graphScore), reason: "relationship/graph query pattern" });
  }

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  const best = scores[0];
  if (best && best.score >= 0.3) {
    return {
      kind: best.kind,
      confidence: best.score,
      reason: best.reason,
      weights: WEIGHT_MAP[best.kind],
    };
  }

  // Default to hybrid for general semantic queries
  return {
    kind: "hybrid",
    confidence: 0.5,
    reason: "no strong pattern match, using hybrid retrieval",
    weights: HYBRID_WEIGHTS,
  };
}

/**
 * Get search weights for a given question kind.
 * If kind is provided explicitly (e.g., from API), use it directly.
 * Otherwise, classify from the query text.
 */
export function routeQuery(query: string, explicitKind?: QuestionKind): RouteDecision {
  if (explicitKind && WEIGHT_MAP[explicitKind]) {
    return {
      kind: explicitKind,
      confidence: 1.0,
      reason: "explicit kind provided",
      weights: WEIGHT_MAP[explicitKind],
    };
  }
  return classifyQuestion(query);
}

export { WEIGHT_MAP, HYBRID_WEIGHTS };
