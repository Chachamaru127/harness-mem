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
export type AnswerIntentKind =
  | "generic"
  | "metric_value"
  | "current_value"
  | "reason"
  | "list_value"
  | "company"
  | "role"
  | "kind"
  | "study_field"
  | "count"
  | "language"
  | "location"
  | "person"
  | "temporal_value";

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
  /** S43-004: relative time 表現の canonical form (例: "immediately_after", "initially") */
  normalizedForm?: string;
}

export interface AnswerHints {
  intent: AnswerIntentKind;
  exactValuePreferred: boolean;
  activeFactPreferred: boolean;
  slotKeywords: string[];
  focusKeywords: string[];
  metricKeywords: string[];
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
  /** S39-005: Product-side factual/value prioritization hints. */
  answerHints?: AnswerHints;
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
  recency: 0.45,
  tag_boost: 0.05,
  importance: 0.15,
  // Graph hubs introduce unrelated "updates" noise in order-sensitive benchmarks.
  graph: 0,
  sector_boost: 0,
};

/** Freshness-focused weights: heavily boost recency for "what is current" queries. */
const FRESHNESS_WEIGHTS: SearchWeights = {
  lexical: 0.25,
  vector: 0.20,
  recency: 0.45,
  tag_boost: 0.05,
  importance: 0.05,
  // Freshness is about the newest relevant fact, not graph centrality.
  graph: 0,
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

const PREVIOUS_VALUE_PATTERNS = [
  /\b(previous|previously|former|formerly|prior|earlier|used to|old)\b/i,
  /(以前|前の|前回|前は|もともと|元は|当初|当時)/,
  /\bbefore\s+(?:changing|switching|moving|reviewing|revising)\b/i,
  /(?:変える|見直す|移す|切り替える|変更する)前/,
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
  /(前回|前は|もともと|元は|当初|当時|変える前|見直す前|移す前|切り替える前|変更前)/,
  /(どちらが先|先に|その後|あとで|後で|直後|の次に)/,
  // SD-006: bilingual — CJK/Katakana term directly suffixed with 後/前 (no の)
  // e.g. "デプロイ後", "API改修後", "リリース前", "migration完了後"
  /\S*[\u3040-\u9FFF\uFF00-\uFFEF]\S*[後前]/,
  // §35 SD-007: 日本語 ordinal temporal — "最初に", "最後に"
  /(最初|最後|直近|最近)/,
  // RQ-012: "between X and Y" は時系列範囲クエリ
  /\bbetween\s+\S+.*\s+and\s+/i,
  // RQ-012: "originally ... but later" / "at first ... then" 等の経時変化
  /\b(originally|initially|at first)\b.{0,50}\b(later|then|eventually|subsequently)\b/i,
];

const GRAPH_PATTERNS = [
  /\b(how.*(relate|connect|link)|relationship|depends?|affects?)\b/i,
  /\b(between|compared to|versus|vs)\b/i,
  /\b(cause|effect|impact|influence)\b/i,
  /\b(chain|path|trace|flow)\b/i,
];

const ANSWER_HINT_RULES: Array<{
  intent: AnswerIntentKind;
  patterns: RegExp[];
  slotKeywords: string[];
}> = [
  {
    intent: "metric_value",
    patterns: [
      /\b((?:overall\s+)?f1|accuracy|precision|recall|freshness(?:@k)?|tau|latency|p95|token\s*avg|score)\b.*\b(how much|what|which|value)\b/i,
      /\b(how much|what|which)\b.*\b((?:overall\s+)?f1|accuracy|precision|recall|freshness(?:@k)?|tau|latency|p95|token\s*avg|score)\b/i,
      /((overall\s*)?f1|accuracy|precision|recall|freshness(?:@k)?|temporal|tau|token\s*avg|p95|latency|score).*(いくつ|何点|どれくらい|何でしたか|何だった|値|スコア)/iu,
      /(日本語\s*(?:release|claim)\s*gate|ja(?:panese)?\s*(?:release|claim)\s*gate).*((overall\s*)?f1|freshness|cross[_ -]?lingual|zero[_ -]?f1|span)/iu,
    ],
    slotKeywords: [
      "f1",
      "overall f1",
      "accuracy",
      "precision",
      "recall",
      "freshness",
      "freshness@k",
      "tau",
      "latency",
      "p95",
      "token avg",
      "score",
      "値",
      "スコア",
    ],
  },
  {
    intent: "current_value",
    patterns: [
      /\b(current|currently|now|latest|active|default|primary|in use|used now)\b/i,
      /(今|現在|今の|現行|最新|いま|使っている|primary|default)/,
    ],
    slotKeywords: ["current", "currently", "now", "latest", "active", "default", "primary", "今", "現在", "最新", "使っている"],
  },
  {
    intent: "reason",
    patterns: [
      /\b(why|reason|because|what led|what caused|trigger(?:ed)?|motivat(?:ed|ion))\b/i,
      /(なぜ|理由|きっかけ|どうして|背景|原因)/,
    ],
    slotKeywords: ["why", "reason", "because", "caused", "trigger", "motivated", "理由", "きっかけ", "背景", "原因"],
  },
  {
    intent: "list_value",
    patterns: [
      /\b(list|all|enumerate|name all|which .* features|what .* features)\b/i,
      /(一覧|すべて|全て|挙げて|列挙)/,
    ],
    slotKeywords: ["list", "all", "features", "items", "tools", "一覧", "すべて", "全て", "挙げて", "列挙"],
  },
  {
    intent: "company",
    patterns: [
      /\b(company|startup|organization|organisation|employer|business)\b/i,
      /(会社|企業|組織|勤務先)/,
    ],
    slotKeywords: ["company", "startup", "organization", "org", "employer", "会社", "企業", "勤務先"],
  },
  {
    intent: "role",
    patterns: [
      /\b(role|job title|title|position|worked as|working as)\b/i,
      /(役職|肩書|職種|役割|担当)/,
    ],
    slotKeywords: ["role", "title", "position", "job", "役職", "肩書", "職種", "役割"],
  },
  {
    intent: "study_field",
    patterns: [
      /\b(what.*study|studying|study for|major|research|focus on|speciali[sz]e)\b/i,
      /(何を学|専攻|研究|勉強して|フォーカス)/,
    ],
    slotKeywords: ["study", "major", "research", "focus", "専攻", "研究", "勉強"],
  },
  {
    intent: "count",
    patterns: [
      /\b(how many|how much|number of|count of|what percentage|what percent)\b/i,
      /(いくつ|何個|何人|何回|何時間|何分|何日|割合|パーセント|件数)/,
    ],
    slotKeywords: ["count", "number", "quantity", "percentage", "percent", "rate", "hours", "件数", "割合", "数"],
  },
  {
    intent: "language",
    patterns: [
      /\b(what language|which language|language do|speak at home|speaking)\b/i,
      /(何語|言語|話す|話している)/,
    ],
    slotKeywords: ["language", "speak", "spoken", "言語", "何語", "話す"],
  },
  {
    intent: "location",
    patterns: [
      /\b(where|which city|which country|located|live|moved from|travel to|operate in)\b/i,
      /(どこ|どの都市|どの国|場所|住んで|引っ越し|出身|移動先|所在地)/,
    ],
    slotKeywords: ["where", "city", "country", "location", "live", "from", "to", "場所", "都市", "国", "所在地"],
  },
  {
    intent: "person",
    patterns: [
      /\b(who|whose|what is my .* name|name of)\b/i,
      /(誰|名前|氏名)/,
    ],
    slotKeywords: ["who", "name", "person", "whose", "誰", "名前", "氏名"],
  },
  {
    intent: "kind",
    patterns: [
      /\b(what kind of|which kind of|what type of|type of|method|approach|mode|system|workflow)\b/i,
      /(どんな|どのような|種類|種別|タイプ|方法|方式)/,
    ],
    slotKeywords: ["kind", "type", "category", "method", "approach", "system", "workflow", "種類", "種別", "タイプ", "方法", "方式"],
  },
  {
    intent: "temporal_value",
    patterns: [
      /\b(when|what year|which year|what month|which month|what day|date)\b/i,
      /(いつ|何年|何月|何日|日付|時期|どちらが先|先に|その後|あとで|後で|直後|最初|最後)/,
    ],
    slotKeywords: ["when", "year", "month", "day", "date", "timeline", "first", "last", "before", "after", "いつ", "何年", "何月", "日付", "先", "最初", "最後", "その後", "直後"],
  },
];

const METRIC_VALUE_FOCUS_RULES: Array<{ pattern: RegExp; keywords: string[] }> = [
  {
    pattern: /\boverall\s*f1\b/i,
    keywords: ["overall f1", "overall f1 mean", "overall", "f1"],
  },
  {
    pattern: /\bfreshness(?:@k)?\b/i,
    keywords: ["freshness", "freshness@k"],
  },
  {
    pattern: /\b(temporal|tau)\b/i,
    keywords: ["temporal", "tau"],
  },
  {
    pattern: /\b(bilingual|recall)\b/i,
    keywords: ["bilingual", "recall"],
  },
  {
    pattern: /\b(token\s*avg|average tokens|avg tokens)\b/i,
    keywords: ["token avg", "average tokens", "avg tokens"],
  },
  {
    pattern: /\b(search\s*p95|latency\s*p95|p95)\b/i,
    keywords: ["search p95", "latency p95", "p95", "latency"],
  },
];

const CONTEXT_FOCUS_RULES: Array<{ pattern: RegExp; keywords: string[] }> = [
  {
    pattern: /(日本語\s*(?:release|claim)\s*gate|ja(?:panese)?\s*(?:release|claim)\s*gate)/iu,
    keywords: ["ja-release-pack", "日本語 release gate", "japanese release gate", "日本語"],
  },
  {
    pattern: /(最終\s*go(?:時)?|final\s*go|run-?ci\s*final\s*go)/iu,
    keywords: ["final go", "run-ci", "最終go"],
  },
  {
    pattern: /(§\s*39|\bs39\b)/iu,
    keywords: ["§39", "s39"],
  },
];

const FOCUS_KEYWORD_STOPWORDS = new Set([
  "what",
  "which",
  "when",
  "where",
  "why",
  "how",
  "many",
  "much",
  "value",
  "values",
  "show",
  "tell",
  "me",
  "the",
  "is",
  "are",
  "was",
  "were",
  "did",
  "do",
  "does",
  "of",
  "for",
  "to",
  "and",
  "or",
  "release",
  "gate",
  "claim",
  "final",
  "go",
  "current",
  "latest",
  "now",
  "今",
  "現在",
  "いくつ",
  "どれくらい",
  "何",
  "値",
  "スコア",
]);

function extractMetricKeywords(query: string): string[] {
  const keywords = new Set<string>();
  for (const rule of METRIC_VALUE_FOCUS_RULES) {
    if (!rule.pattern.test(query)) continue;
    for (const keyword of rule.keywords) {
      keywords.add(keyword);
    }
  }
  return [...keywords].slice(0, 8);
}

function extractFocusKeywords(query: string, slotKeywords: string[], metricKeywords: string[]): string[] {
  const keywords = new Set<string>(metricKeywords);
  for (const rule of CONTEXT_FOCUS_RULES) {
    if (!rule.pattern.test(query)) continue;
    for (const keyword of rule.keywords) {
      keywords.add(keyword);
    }
  }
  const normalizedSlotKeywords = new Set(slotKeywords.map((keyword) => keyword.toLowerCase()));
  const asciiTokens = query.toLowerCase().match(/[a-z][a-z0-9-]*/g) ?? [];
  for (const token of asciiTokens) {
    if (FOCUS_KEYWORD_STOPWORDS.has(token) || normalizedSlotKeywords.has(token)) continue;
    keywords.add(token);
  }

  return [...keywords].slice(0, 12);
}

function buildAnswerHints(
  query: string,
  intent: AnswerIntentKind,
  exactValuePreferred: boolean,
  activeFactPreferred: boolean,
  slotKeywords: string[]
): AnswerHints {
  const metricKeywords = extractMetricKeywords(query);
  return {
    intent,
    exactValuePreferred,
    activeFactPreferred,
    slotKeywords,
    focusKeywords: extractFocusKeywords(query, slotKeywords, metricKeywords),
    metricKeywords,
  };
}

// ---- Temporal normalization ----

/**
 * S43-004: relative time 表現の canonical form への変換マップ。
 * キー: 正規表現パターン、値: canonical string
 */
const RELATIVE_TIME_CANON_MAP: Array<{ pattern: RegExp; canonical: string }> = [
  // 直後 = immediately after
  { pattern: /直後/, canonical: "immediately_after" },
  // の次に / 次に = next after
  { pattern: /の?次に/, canonical: "next_after" },
  // 後も = even after (後 + も particle)
  { pattern: /後も/, canonical: "even_after" },
  // 最初 (は/に/の) = initially
  { pattern: /最初[はにの]?/, canonical: "initially" },
  // 最後 (に/の) = finally / lastly
  { pattern: /最後[にの]?/, canonical: "finally" },
  // その後 / あとで / 後で = after that
  { pattern: /(その後|あとで|後で)/, canonical: "after_that" },
  // 先に = first / earlier
  { pattern: /先に/, canonical: "first_earlier" },
  // 以降 = from then on
  { pattern: /以降/, canonical: "from_then_on" },
  // 以前 = before that
  { pattern: /以前/, canonical: "before_that" },
];

/**
 * S43-004: relative time 表現を canonical form に変換する。
 * 一致する表現がない場合は null を返す。
 */
export function normalizeRelativeTimeExpression(text: string): string | null {
  for (const { pattern, canonical } of RELATIVE_TIME_CANON_MAP) {
    if (pattern.test(text)) return canonical;
  }
  return null;
}

// ---- TemporalAnchor extraction patterns ----

// "after X" / "X の後" → {type:"after", direction:"asc"}
const AFTER_PATTERNS: RegExp[] = [
  /\bafter\s+(.+?)(?:\?|$|,|\band\b|\bor\b)/i,
  /\bfollowing\s+(.+?)(?:\?|$|,|\band\b|\bor\b)/i,
  /\bsince\s+(.+?)(?:\?|$|,|\band\b|\bor\b)/i,
  /^(.+?)後も/u,
  /(.+?)の後(?:に|で|から|も)?/,
  /(.+?)以降/,
  /(.+?)より後/,
  // S43-004: 直後 (immediately after) — "X の直後に" / "X の直後"
  /(.+?)の?直後(?:に|で|から)?/,
  // S43-004: の次に (next after X) — "X の次に"
  /(.+?)の次に/,
  // SD-006: bilingual — Japanese/Katakana/mixed term directly suffixed with 後 (no の)
  // Matches: "API改修後", "デプロイ後", "マージ後", "migration完了後", "コードレビュー後", "テスト完了後"
  // Also matches 後も: "移転後も", "release後も"
  // Requires at least one CJK/Katakana char in the reference to avoid false-positives.
  // Uses non-greedy match up to 後, then allows optional particles (に/で/から/も).
  /(\S*[\u3040-\u9FFF\uFF00-\uFFEF]\S*)後(?:に|で|から|も)?/,
];

// "before X" / "X の前" → {type:"before", direction:"desc"}
const BEFORE_PATTERNS: RegExp[] = [
  /\bbefore\s+(.+?)(?:\?|$|,|\band\b|\bor\b)/i,
  /\bprior\s+to\s+(.+?)(?:\?|$|,|\band\b|\bor\b)/i,
  /\buntil\s+(.+?)(?:\?|$|,|\band\b|\bor\b)/i,
  /^以前(?:の|は)?\s*([^?。！？]+?)(?:\s+は|\s+を|\s+が|[?？]|$)/u,
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
  /(?:^|[\s(])(?:first|initially|to start|to begin)\b/i,
  /\b(then|next|subsequently|after that)\b/i,
  /\b(finally|lastly|in the end)\b/i,
];
const SEQUENCE_JA_PATTERNS: RegExp[] = [
  // S43-004: 最初は も sequence として検出（topic particle は を含む）
  /(最初[はにの]?|はじめ[はに]?|まず)/,
  /(次に|それから|その後|先に|あとで|後で)/,
  /(最後[にの]?|最終|ついに)/,
];

function matchesAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function hasPreviousValueCue(query: string): boolean {
  return matchesAnyPattern(query, PREVIOUS_VALUE_PATTERNS);
}

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
        // S43-004: クエリ全体から相対時間表現を抽出して canonical form を付与
        const normalizedForm = normalizeRelativeTimeExpression(q) ?? undefined;
        anchors.push({ type: "after", referenceText: ref, direction: "asc", normalizedForm });
      }
    }
  }

  // before
  for (const pattern of BEFORE_PATTERNS) {
    const m = q.match(pattern);
    if (m) {
      const ref = (m[1] ?? "").trim();
      if (ref && ref.length > 0) {
        const normalizedForm = normalizeRelativeTimeExpression(q) ?? undefined;
        anchors.push({ type: "before", referenceText: ref, direction: "desc", normalizedForm });
      }
    }
  }

  // sequence (英語)
  let hasSequence = false;
  let sequenceNormalizedForm: string | undefined;
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
        // S43-004: sequence の canonical form を付与
        sequenceNormalizedForm = normalizeRelativeTimeExpression(q) ?? undefined;
        break;
      }
    }
  }
  if (hasSequence) {
    anchors.push({ type: "sequence", referenceText: q, direction: "asc", normalizedForm: sequenceNormalizedForm });
  }

  // 重複除去: 同一 type+direction の組み合わせを dedupe
  const seen = new Set<string>();
  return anchors.filter((a, index) => {
    const normalizedRef = a.referenceText.trim();
    if (normalizedRef.length < 2) return false;
    const shadowedByEarlier = anchors.slice(0, index).some((existing) => {
      if (existing.type !== a.type || existing.direction !== a.direction) return false;
      const existingRef = existing.referenceText.trim();
      if (existingRef.length < normalizedRef.length) return false;
      return existingRef === normalizedRef || existingRef.includes(normalizedRef);
    });
    if (shadowedByEarlier) return false;
    const key = `${a.type}:${a.direction}:${normalizedRef.slice(0, 40)}`;
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
    return {
      kind: "hybrid",
      confidence: 0,
      reason: "empty query",
      weights: HYBRID_WEIGHTS,
      answerHints: extractAnswerHints(q),
    };
  }

  const scores: { kind: QuestionKind; score: number; reason: string }[] = [];

  // Freshness detection (evaluated before timeline to avoid misrouting "currently")
  let freshnessScore = 0;
  for (const pattern of FRESHNESS_PATTERNS) {
    if (pattern.test(q)) freshnessScore += 0.4;
  }

  // Profile detection
  let profileScore = 0;
  for (const pattern of PROFILE_PATTERNS) {
    if (pattern.test(q)) profileScore += 0.3;
  }

  // Timeline detection
  let timelineScore = 0;
  for (const pattern of TIMELINE_PATTERNS) {
    if (pattern.test(q)) timelineScore += 0.3;
  }
  const previousValueCue = hasPreviousValueCue(q);
  if (previousValueCue) {
    // previous/former/before-change questions should prefer timeline retrieval
    // even when the surface form also looks like a profile query ("What was...").
    timelineScore += 0.35;
  }
  if (freshnessScore > 0 && previousValueCue) {
    // "今の方式に変える前" のような current+previous contrast は freshness ではなく timeline 扱い。
    freshnessScore = Math.max(0, freshnessScore - 0.35);
  }
  if (freshnessScore > 0) {
    scores.push({ kind: "freshness", score: Math.min(1, freshnessScore), reason: "freshness/current-state query pattern" });
  }
  if (profileScore > 0) {
    scores.push({ kind: "profile", score: Math.min(1, profileScore), reason: "entity/profile query pattern" });
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
      answerHints: extractAnswerHints(q, best.kind),
    };
  }

  // Default to hybrid for general semantic queries
  return {
    kind: "hybrid",
    confidence: 0.5,
    reason: "no strong pattern match, using hybrid retrieval",
    weights: HYBRID_WEIGHTS,
    answerHints: extractAnswerHints(q),
  };
}

export function extractAnswerHints(query: string, questionKind?: QuestionKind): AnswerHints {
  const q = query.trim();
  const fallbackIntent: AnswerIntentKind =
    questionKind === "freshness" ? "current_value" : questionKind === "timeline" ? "temporal_value" : "generic";
  if (!q) {
    return buildAnswerHints(
      q,
      fallbackIntent,
      fallbackIntent !== "generic",
      fallbackIntent !== "generic",
      fallbackIntent === "generic" ? [] : [fallbackIntent]
    );
  }

  if (hasPreviousValueCue(q)) {
    return buildAnswerHints(q, "temporal_value", true, false, [
      "previous",
      "former",
      "before",
      "earlier",
      "以前",
      "前の",
      "前は",
      "当初",
      "当時",
      "変える前",
      "見直す前",
      "移す前",
    ]);
  }

  for (const rule of ANSWER_HINT_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(q))) {
      return buildAnswerHints(q, rule.intent, true, true, rule.slotKeywords);
    }
  }

  return buildAnswerHints(
    q,
    fallbackIntent,
    fallbackIntent !== "generic",
    fallbackIntent !== "generic",
    fallbackIntent === "generic" ? [] : [fallbackIntent]
  );
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
      answerHints: extractAnswerHints(query, explicitKind),
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
  decision.answerHints = extractAnswerHints(query, decision.kind);
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
