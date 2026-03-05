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
 *
 * Cognitive Sectors:
 * - "work"   : Work / coding / project related observations
 * - "people" : People / team / social interactions
 * - "health" : Health / sleep / exercise / diet
 * - "hobby"  : Hobbies / entertainment / personal interests
 * - "meta"   : Meta / other / uncategorized
 */

export type QuestionKind = "profile" | "timeline" | "freshness" | "graph" | "vector" | "hybrid";

/** Cognitive sector for classifying observations by life domain. */
export type CognitiveSector = "work" | "people" | "health" | "hobby" | "meta";

/**
 * FD-005: TemporalAnchor — タイムライン検索における時間的な基準点。
 *
 * - "before" : 基準点より前のエントリを検索 (direction: "desc")
 * - "after"  : 基準点より後のエントリを検索 (direction: "asc")
 * - "between": 2点間のエントリを検索 (direction: "around")
 * - "sequence": 順序付きシーケンス (direction: "asc")
 * - "at"     : 特定時点のエントリ (direction: "around")
 */
export type TemporalAnchorType = "before" | "after" | "between" | "sequence" | "at";

export interface TemporalAnchor {
  /** アンカーの種別 */
  type: TemporalAnchorType;
  /** クエリから抽出した参照テキスト (例: "the migration", "last week", "リリース") */
  referenceText: string;
  /** 検索方向: asc=新しい順, desc=古い順, around=前後 */
  direction: "asc" | "desc" | "around";
}

export interface RouteDecision {
  /** Primary retrieval strategy to use. */
  kind: QuestionKind;
  /** Confidence score for the classification (0-1). */
  confidence: number;
  /** Explanation of why this kind was chosen. */
  reason: string;
  /** Weight overrides for the search scoring. */
  weights: SearchWeights;
  /** Optional sector filter applied to this query. */
  sector?: CognitiveSector;
  /** FD-005: Temporal anchors extracted from the query (timeline/freshness queries only). */
  temporalAnchors?: TemporalAnchor[];
}

export interface SearchWeights {
  lexical: number;
  vector: number;
  recency: number;
  tag_boost: number;
  importance: number;
  graph: number;
  /** Boost applied when filtering/prioritizing by cognitive sector (0 = no boost). */
  sector_boost: number;
}

/** Default hybrid weights (balanced). */
const HYBRID_WEIGHTS: SearchWeights = {
  lexical: 0.3,
  vector: 0.3,
  recency: 0.15,
  tag_boost: 0.1,
  importance: 0.1,
  graph: 0.05,
  sector_boost: 0,
};

/** Profile-focused weights: boost lexical + tag matching for entity retrieval. */
const PROFILE_WEIGHTS: SearchWeights = {
  lexical: 0.45,
  vector: 0.15,
  recency: 0.1,
  tag_boost: 0.2,
  importance: 0.05,
  graph: 0.05,
  sector_boost: 0,
};

/** Timeline-focused weights: boost recency for chronological queries. */
const TIMELINE_WEIGHTS: SearchWeights = {
  lexical: 0.2,
  vector: 0.15,
  recency: 0.4,
  tag_boost: 0.05,
  importance: 0.15,
  graph: 0.05,
  sector_boost: 0,
};

/** Freshness-focused weights: heavily boost recency for "what is current" queries. */
const FRESHNESS_WEIGHTS: SearchWeights = {
  lexical: 0.25,
  vector: 0.20,
  recency: 0.40,
  tag_boost: 0.05,
  importance: 0.05,
  graph: 0.05,
  sector_boost: 0,
};

/** Graph-focused weights: boost graph traversal score. */
const GRAPH_WEIGHTS: SearchWeights = {
  lexical: 0.15,
  vector: 0.15,
  recency: 0.1,
  tag_boost: 0.05,
  importance: 0.1,
  graph: 0.45,
  sector_boost: 0,
};

/** Vector-focused weights: boost semantic similarity. */
const VECTOR_WEIGHTS: SearchWeights = {
  lexical: 0.1,
  vector: 0.55,
  recency: 0.1,
  tag_boost: 0.05,
  importance: 0.15,
  graph: 0.05,
  sector_boost: 0,
};

const WEIGHT_MAP: Record<QuestionKind, SearchWeights> = {
  profile: PROFILE_WEIGHTS,
  timeline: TIMELINE_WEIGHTS,
  freshness: FRESHNESS_WEIGHTS,
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

const FRESHNESS_PATTERNS = [
  /\b(current|currently|now|latest version|what version)\b/i,
  /(現在|今|最新|今の)/,
];

const TIMELINE_PATTERNS = [
  /^(when|what time|how long)\b/i,
  /\b(before|after|during|since|until|recently|yesterday|today|last week)\b/i,
  /\b(prior to|following)\b/i,
  /\b(sequence|chronolog|history|timeline|progress|evolve)\b/i,
  /\b(latest|newest|oldest|first|last)\b/i,
  // §35 SD-007: 文中の "when" も検出（"... and when was it ..." パターン）
  /\bwhen\s+(was|did|were|is|has|had)\b/i,
  // §35 SD-007: ordinal temporal — "completed first", "identified earliest" など
  /\b(completed|happened|started|finished|identified|implemented|set up|taken)\s+(first|last|earliest|latest)\b/i,
  /\b(first|last|earliest|latest)\s+(step|action|thing|task|item|change|improvement|feature)\b/i,
  /(の前|の後|以前|以降|より前|より後)/,
  // SD-006: bilingual — CJK/Katakana term directly suffixed with 後/前 (no の)
  // e.g. "デプロイ後", "API改修後", "リリース前", "migration完了後"
  /\S*[\u3040-\u9FFF\uFF00-\uFFEF]\S*[後前]/,
  // §35 SD-007: 日本語 ordinal temporal — "最初に", "最後に"
  /(最初|最後|直近|最近)/,
];

const GRAPH_PATTERNS = [
  /\b(how.*(relate|connect|link)|relationship|depends?|affects?)\b/i,
  /\b(between|compared to|versus|vs)\b/i,
  /\b(cause|effect|impact|influence)\b/i,
  /\b(chain|path|trace|flow)\b/i,
];

// ---- TemporalAnchor extraction patterns ----

// "after X" / "X の後" → {type:"after", direction:"asc"}
const AFTER_PATTERNS: RegExp[] = [
  /\bafter\s+(.+?)(?:\?|$|,|\band\b|\bor\b)/i,
  /\bfollowing\s+(.+?)(?:\?|$|,|\band\b|\bor\b)/i,
  /\bsince\s+(.+?)(?:\?|$|,|\band\b|\bor\b)/i,
  /(.+?)の後(?:に|で|から)?/,
  /(.+?)以降/,
  /(.+?)より後/,
  // SD-006: bilingual — Japanese/Katakana/mixed term directly suffixed with 後 (no の)
  // Matches: "API改修後", "デプロイ後", "マージ後", "migration完了後", "コードレビュー後", "テスト完了後"
  // Requires at least one CJK/Katakana char in the reference to avoid false-positives.
  // Uses non-greedy match up to 後, then allows optional particles (に/で/から).
  /(\S*[\u3040-\u9FFF\uFF00-\uFFEF]\S*)後(?:に|で|から)?/,
];

// "before X" / "X の前" → {type:"before", direction:"desc"}
const BEFORE_PATTERNS: RegExp[] = [
  /\bbefore\s+(.+?)(?:\?|$|,|\band\b|\bor\b)/i,
  /\bprior\s+to\s+(.+?)(?:\?|$|,|\band\b|\bor\b)/i,
  /\buntil\s+(.+?)(?:\?|$|,|\band\b|\bor\b)/i,
  /(.+?)の前(?:に|で)?/,
  /(.+?)以前/,
  /(.+?)より前/,
  // SD-006: bilingual — Japanese/Katakana/mixed term directly suffixed with 前 (no の)
  // Matches: "migration完了前", "リリース前", "デプロイ前"
  // Requires at least one CJK/Katakana char in the reference to avoid false-positives.
  /(\S*[\u3040-\u9FFF\uFF00-\uFFEF]\S*)前(?:に|で)?/,
];

// "between X and Y" → {type:"between", direction:"around"}
const BETWEEN_PATTERNS: RegExp[] = [
  /\bbetween\s+(.+?)\s+and\s+(.+?)(?:\?|$|,)/i,
  /(.+?)から(.+?)の間/,
  /(.+?)と(.+?)の間/,
];

// sequence words → {type:"sequence", direction:"asc"}
const SEQUENCE_EN_PATTERNS: RegExp[] = [
  /\b(first|initially|to start|to begin)\b/i,
  /\b(then|next|subsequently|after that)\b/i,
  /\b(finally|lastly|in the end)\b/i,
];
const SEQUENCE_JA_PATTERNS: RegExp[] = [
  /(最初|はじめ|まず)/,
  /(次に|それから|その後)/,
  /(最後|最終|ついに)/,
];

/**
 * FD-005: クエリからTemporalAnchorのリストを抽出する。
 *
 * TIMELINE/FRESHNESS クエリで時間的な基準点を特定し、
 * 検索方向（昇順/降順/前後）を付与する。
 * 日英両対応。
 */
export function extractTemporalAnchors(query: string): TemporalAnchor[] {
  const anchors: TemporalAnchor[] = [];
  const q = query.trim();
  if (!q) return anchors;

  // between (2点間) — 最初にチェック
  for (const pattern of BETWEEN_PATTERNS) {
    const m = q.match(pattern);
    if (m) {
      const ref1 = (m[1] ?? "").trim();
      const ref2 = (m[2] ?? "").trim();
      if (ref1 && ref2) {
        anchors.push({ type: "between", referenceText: `${ref1} and ${ref2}`, direction: "around" });
      } else if (ref1) {
        anchors.push({ type: "between", referenceText: ref1, direction: "around" });
      }
    }
  }

  // after
  for (const pattern of AFTER_PATTERNS) {
    const m = q.match(pattern);
    if (m) {
      const ref = (m[1] ?? "").trim();
      if (ref && ref.length > 0) {
        anchors.push({ type: "after", referenceText: ref, direction: "asc" });
      }
    }
  }

  // before
  for (const pattern of BEFORE_PATTERNS) {
    const m = q.match(pattern);
    if (m) {
      const ref = (m[1] ?? "").trim();
      if (ref && ref.length > 0) {
        anchors.push({ type: "before", referenceText: ref, direction: "desc" });
      }
    }
  }

  // sequence (英語)
  let hasSequence = false;
  for (const pattern of SEQUENCE_EN_PATTERNS) {
    if (pattern.test(q)) {
      hasSequence = true;
      break;
    }
  }
  if (!hasSequence) {
    for (const pattern of SEQUENCE_JA_PATTERNS) {
      if (pattern.test(q)) {
        hasSequence = true;
        break;
      }
    }
  }
  if (hasSequence) {
    anchors.push({ type: "sequence", referenceText: q, direction: "asc" });
  }

  // 重複除去: 同一 type+direction の組み合わせを dedupe
  const seen = new Set<string>();
  return anchors.filter((a) => {
    const key = `${a.type}:${a.direction}:${a.referenceText.slice(0, 40)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

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

  // Freshness detection (evaluated before timeline to avoid misrouting "currently")
  let freshnessScore = 0;
  for (const pattern of FRESHNESS_PATTERNS) {
    if (pattern.test(q)) freshnessScore += 0.4;
  }
  if (freshnessScore > 0) {
    scores.push({ kind: "freshness", score: Math.min(1, freshnessScore), reason: "freshness/current-state query pattern" });
  }

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
 *
 * FD-005: TIMELINE/FRESHNESS クエリの場合、temporalAnchors も抽出して返す。
 */
/** §34 FD-014: クエリログエントリ（プライバシー配慮: クエリ全文は記録しない） */
interface QueryLogEntry {
  ts: string;
  kind: QuestionKind;
  confidence: number;
  query_len: number;
  has_temporal_anchors: boolean;
}

/** §34 FD-014: HARNESS_MEM_QUERY_LOG に指定されたパスへ JSONL 形式でログ書き込み */
function appendQueryLog(entry: QueryLogEntry): void {
  const logPath = process.env.HARNESS_MEM_QUERY_LOG;
  if (!logPath) return;
  try {
    const { appendFileSync } = require("node:fs") as typeof import("node:fs");
    appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // ログ書き込みエラーは無視（検索の妨げにならないこと優先）
  }
}

export function routeQuery(query: string, explicitKind?: QuestionKind): RouteDecision {
  if (explicitKind && WEIGHT_MAP[explicitKind]) {
    const decision: RouteDecision = {
      kind: explicitKind,
      confidence: 1.0,
      reason: "explicit kind provided",
      weights: WEIGHT_MAP[explicitKind],
    };
    if (explicitKind === "timeline" || explicitKind === "freshness") {
      const anchors = extractTemporalAnchors(query);
      if (anchors.length > 0) {
        decision.temporalAnchors = anchors;
      }
    }
    appendQueryLog({
      ts: new Date().toISOString(),
      kind: decision.kind,
      confidence: decision.confidence,
      query_len: query.length,
      has_temporal_anchors: (decision.temporalAnchors?.length ?? 0) > 0,
    });
    return decision;
  }
  const decision = classifyQuestion(query);
  if (decision.kind === "timeline" || decision.kind === "freshness") {
    const anchors = extractTemporalAnchors(query);
    if (anchors.length > 0) {
      decision.temporalAnchors = anchors;
    }
  }
  appendQueryLog({
    ts: new Date().toISOString(),
    kind: decision.kind,
    confidence: decision.confidence,
    query_len: query.length,
    has_temporal_anchors: (decision.temporalAnchors?.length ?? 0) > 0,
  });
  return decision;
}

export { WEIGHT_MAP, HYBRID_WEIGHTS };

// ---- Cognitive Sector Classification ----

/**
 * Keyword patterns for each cognitive sector.
 * Patterns match against lowercased title + content.
 * Note: \b word boundaries do not work for Japanese text, so patterns use
 * simple substring matching for Japanese keywords.
 */
const SECTOR_PATTERNS: Record<CognitiveSector, RegExp[]> = {
  work: [
    // Japanese work keywords (no \b for Unicode compatibility)
    /(実装|コード|バグ|修正|デプロイ|プロジェクト|タスク|仕事|業務|開発|レビュー|ビルド|リファクタ)/,
    // English work keywords (ASCII, \b works)
    /\b(code|coding|implement|bug|fix|deploy|project|task|work|develop|review|commit|pull request|api|test|build|refactor)\b/i,
    // Tech stack keywords
    /\b(typescript|javascript|python|rust|golang|sql|docker|kubernetes|aws|gcp|azure|github|gitlab|ci|cd)\b/i,
    // File extensions
    /\.(ts|js|py|rs|go|tsx|jsx|vue|sql|yaml|yml|json|toml|sh|md)\b/,
  ],
  people: [
    // Japanese honorifics / social keywords
    /(さん|くん|ちゃん|チーム|同僚|メンター|上司|部下|会議|ミーティング|面談|フィードバック|コミュニケーション|友達|友人|家族|パートナー|恋人|知人|社内|社外)/,
    // English people / social keywords
    /\b(team|colleague|mentor|manager|meeting|feedback|communication|friend|family|partner|engineer|designer|product|ceo|cto|mr\.|ms\.|dr\.)\b/i,
  ],
  health: [
    // Japanese health keywords
    /(睡眠|起床|就寝|体重|体調|健康|運動|ジョギング|ランニング|ジム|筋トレ|ヨガ|食事|カロリー|水分|サプリ|病院|クリニック|医者|症状|疲労|ストレス|メンタル|気分|リラックス|瞑想)/,
    // English health keywords
    /\b(sleep|exercise|jogging|running|gym|workout|yoga|diet|nutrition|calorie|hydration|supplement|doctor|medicine|symptom|fatigue|stress|mental|mood|relax|meditation|breathing|health)\b/i,
  ],
  hobby: [
    // Japanese hobby keywords
    /(ゲーム|アニメ|マンガ|読書|小説|映画|音楽|楽器|ギター|ピアノ|趣味|旅行|料理|写真|スポーツ|レベルアップ|クリア|ステージ)/,
    // English hobby keywords
    /\b(game|play|anime|manga|book|novel|movie|music|instrument|guitar|piano|hobby|travel|cooking|photo|photography|art|sport|level up|youtube|netflix|spotify|twitch)\b/i,
  ],
  meta: [],
};

/**
 * Classify an observation into a cognitive sector based on title and content.
 * Returns the first matching sector, or "meta" as fallback.
 */
export function classifySector(title: string, content: string): CognitiveSector {
  const text = `${title} ${content}`.toLowerCase();

  for (const sector of ["work", "people", "health", "hobby"] as const) {
    const patterns = SECTOR_PATTERNS[sector];
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        return sector;
      }
    }
  }

  return "meta";
}

/**
 * Sector-specific search weight overrides.
 * All weights (including sector_boost) sum to 1.0.
 * sector_boost is applied as a bonus multiplier when filtering by this sector.
 */
export const SECTOR_WEIGHTS: Record<CognitiveSector, SearchWeights> = {
  work: {
    lexical: 0.3,
    vector: 0.25,
    recency: 0.08,
    tag_boost: 0.1,
    importance: 0.1,
    graph: 0.05,
    sector_boost: 0.12,
  },
  people: {
    lexical: 0.3,
    vector: 0.15,
    recency: 0.12,
    tag_boost: 0.15,
    importance: 0.12,
    graph: 0.04,
    sector_boost: 0.12,
  },
  health: {
    lexical: 0.25,
    vector: 0.2,
    recency: 0.2,
    tag_boost: 0.1,
    importance: 0.1,
    graph: 0.03,
    sector_boost: 0.12,
  },
  hobby: {
    lexical: 0.25,
    vector: 0.25,
    recency: 0.16,
    tag_boost: 0.1,
    importance: 0.1,
    graph: 0.02,
    sector_boost: 0.12,
  },
  meta: {
    lexical: 0.27,
    vector: 0.27,
    recency: 0.13,
    tag_boost: 0.1,
    importance: 0.1,
    graph: 0.05,
    sector_boost: 0.08,
  },
};

/**
 * Alias for SECTOR_WEIGHTS - exported for backward compatibility with tests.
 */
export const SECTOR_WEIGHT_MAP: Record<CognitiveSector, SearchWeights> = SECTOR_WEIGHTS;

/**
 * Get search weights for a specific cognitive sector.
 * Returns undefined if the sector is not recognized.
 */
export function getSectorWeights(sector: CognitiveSector): SearchWeights | undefined {
  return SECTOR_WEIGHTS[sector];
}

/**
 * Route a query with an optional sector filter.
 * When a sector is provided, blends sector-specific weights into the route decision.
 * FD-005: temporalAnchors は routeQuery から引き継がれる。
 */
export function routeQueryWithSector(query: string, sector?: CognitiveSector, explicitKind?: QuestionKind): RouteDecision {
  const base = routeQuery(query, explicitKind);
  if (!sector) {
    return base;
  }
  const sectorWeights = SECTOR_WEIGHTS[sector];
  return {
    ...base,
    weights: sectorWeights,
    sector,
  };
}
