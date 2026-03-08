/**
 * S43-006: current-value shortest-span + response compression
 *
 * Provides:
 * - extractCurrentValueSpan: extract the shortest answer span for current-value queries
 * - compressCurrentValueResponse: strip filler text from a response
 * - measureOverAnswerRate: compute over-answer rate for a batch of (query, response) pairs
 */

// ---------------------------------------------------------------------------
// Span extraction patterns
// ---------------------------------------------------------------------------

/** English patterns to extract the current value span. Group 1 = the value. */
const ENGLISH_CURRENT_VALUE_PATTERNS: RegExp[] = [
  // "is/are currently/now (using) X for/as/at ..." — optional "using"
  /\b(?:is|are)\s+(?:currently|now)\s+(?:using\s+)?([A-Za-z0-9][\w./-]{0,30}(?:\s+[A-Za-z0-9][\w./-]{0,30}){0,2}?)(?:\s+(?:for|as|at)\b|[.,;!?]|$)/u,
  // "currently using X for/as ..."
  /\bcurrently\s+using\s+([A-Za-z0-9][\w./-]{0,30}(?:\s+[A-Za-z0-9][\w./-]{0,30}){0,2}?)(?:\s+(?:for|as|at)\b|[.,;!?]|$)/u,
  // "now using X as/for ..."
  /\bnow\s+using\s+([A-Za-z0-9][\w./-]{0,30}(?:\s+[A-Za-z0-9][\w./-]{0,30}){0,2}?)(?:\s+(?:for|as|at)\b|[.,;!?]|$)/u,
  // "X is the current Y" → capture X (short proper noun starting with uppercase)
  /\b([A-Z][A-Za-z0-9][\w./-]{0,30})\s+is\s+the\s+current\b/u,
  // "the current/active/default/primary Y is X"
  /\bthe\s+(?:current|active|default|primary)\s+\w+(?:\s+\w+)?\s+is\s+([A-Za-z0-9][\w./-]{0,30}(?:\s+[A-Za-z0-9][\w./-]{0,30}){0,2}?)(?:[.,;!?]|$)/iu,
  // "The default branch is main." / "The active plan is Pro."
  /\bthe\s+(?:default|active|primary)\s+\w+\s+is\s+([A-Za-z0-9][\w./-]{0,30})(?:[.,;!?]|$)/iu,
  // "default branch is main" / "active plan is Pro"
  /\b(?:default|active|primary)\s+\w+\s+is\s+([A-Za-z0-9][\w./-]{0,30})(?:[.,;!?]|$)/iu,
  // "using X as the runtime/CI/etc."
  /\busing\s+([A-Za-z0-9][\w./-]{0,30}(?:\s+[A-Za-z0-9][\w./-]{0,30}){0,2}?)\s+(?:as|for)\s+(?:the\s+)?(?:runtime|ci|database|db|backend|frontend|framework|tool)\b/iu,
];

/** Japanese patterns to extract the current value span. Group 1 = the value. */
const JAPANESE_CURRENT_VALUE_PATTERNS: RegExp[] = [
  // "今の X は Y です" → capture Y (more specific, matched BEFORE generic 今...です)
  /今の[^。]+は\s*([^は。]{1,40}?)(?:です|でした|だ|だった)/u,
  /現在の[^。]+は\s*([^は。]{1,40}?)(?:です|でした|だ|だった)/u,
  // "今は X を使っています" / "今は X です"
  /今(?:は|の)?\s*([^。]+?)\s*(?:を使っています|を使っている|にしています|になっています|もサポートしています|が使われています)/u,
  /今(?:は)?\s*([^。]+?)\s*(?:です|でした)(?:。|$)/u,
  /現在(?:は|の)?\s*([^。]+?)\s*(?:を使っています|にしています|になっています|もサポートしています)/u,
  /現在(?:は)?\s*([^。]+?)\s*(?:です|でした)(?:。|$)/u,
  // "X に絞りました" (schedule pattern)
  /((?:平日(?:の)?\s*)?\d{1,2}:\d{2}\s*[〜~-]\s*\d{1,2}:\d{2}\s*(?:JST|UTC)?)\s*に絞りました/u,
];

/** Filler cue pattern: sentences starting with these are deprioritized. */
const FILLER_LEAD_PATTERN = /^(?:ちなみに|なお|ただ|実際には|現時点では|まず|最初に|最後に|That said|Actually|Currently,|Right now,|At the moment)[,、\s]*/iu;

// ---------------------------------------------------------------------------
// Helper: clean extracted span
// ---------------------------------------------------------------------------

function cleanSpan(value: string): string {
  return value
    .trim()
    .replace(/^[,;:.!?'"`\s]+/, "")
    .replace(/[,;:.!?'"`\s]+$/, "");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract the shortest current-value span from a text.
 * Tries English patterns first, then Japanese patterns.
 * Returns null if no pattern matches.
 */
export function extractCurrentValueSpan(text: string): string | null {
  if (!text) return null;
  const source = text.trim().replace(/\s+/g, " ");

  for (const pattern of ENGLISH_CURRENT_VALUE_PATTERNS) {
    const match = pattern.exec(source);
    if (match?.[1]) {
      const span = cleanSpan(match[1]);
      if (span.length > 0) return span;
    }
  }

  for (const pattern of JAPANESE_CURRENT_VALUE_PATTERNS) {
    const match = pattern.exec(source);
    if (match?.[1]) {
      const span = cleanSpan(match[1]);
      if (span.length > 0) return span;
    }
  }

  return null;
}

/**
 * Compress a response for a current-value query:
 * 1. If a concise span can be extracted, return it.
 * 2. Otherwise, strip leading filler and return the first non-filler sentence.
 * 3. If the text is already concise (≤120 chars, ≤1 sentence), return as-is.
 */
export function compressCurrentValueResponse(text: string): string {
  if (!text) return text;
  const trimmed = text.trim();

  // If already concise, return as-is
  if (trimmed.length <= 120 && !trimmed.match(/[。.!?]\s+\S|[。.!?][\u3000-\u9FFF]/u)) {
    return trimmed;
  }

  // Try to extract a span
  const span = extractCurrentValueSpan(trimmed);
  if (span) return span;

  // Split into sentences
  const sentences = trimmed
    .split(/(?<=[。.!?])\s+|(?<=[。])/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (sentences.length === 0) return trimmed;

  // Strip leading filler sentence
  const firstNonFiller = sentences.find((s) => !FILLER_LEAD_PATTERN.test(s));
  return firstNonFiller ?? sentences[0]!;
}

// ---------------------------------------------------------------------------
// Over-answer rate
// ---------------------------------------------------------------------------

export interface OverAnswerResult {
  /** Fraction of responses that are over-answers (0–1). */
  rate: number;
  /** Total number of samples evaluated. */
  total: number;
  /** Number of samples classified as over-answers. */
  overAnswerCount: number;
}

/**
 * Determine whether a response is an over-answer for a current-value query.
 *
 * A response is an over-answer if:
 * - It contains more than 1 sentence, AND
 * - At least one sentence contains a previous-value cue (previously, formerly, 以前, 前は, etc.), OR
 * - It exceeds 220 characters and has ≥ 2 sentences with no extractable span
 */
function isOverAnswer(query: string, response: string): boolean {
  const PREVIOUS_CUE = /\b(previously|formerly|used to|prior|earlier|before|at first|originally)\b/i;
  const JAPANESE_PREVIOUS_CUE = /(以前|前は|前の|前回|もともと|元は|最初は|当初|当時)/;

  const sentences = response
    .split(/(?<=[。.!?])\s+|(?<=[。])/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (sentences.length <= 1) return false;

  // Has previous-value cue in a multi-sentence response → over-answer
  if (PREVIOUS_CUE.test(response) || JAPANESE_PREVIOUS_CUE.test(response)) {
    return true;
  }

  // Long response with no extractable span
  if (response.length > 220 && sentences.length >= 2 && extractCurrentValueSpan(response) === null) {
    return true;
  }

  return false;
}

/**
 * Measure the over-answer rate for a batch of (query, response) pairs.
 * Only meaningful for current-value queries, but works on any input.
 */
export function measureOverAnswerRate(
  samples: Array<{ query: string; response: string }>
): OverAnswerResult {
  if (samples.length === 0) {
    return { rate: 0, total: 0, overAnswerCount: 0 };
  }

  const overAnswerCount = samples.filter(({ query, response }) =>
    isOverAnswer(query, response)
  ).length;

  return {
    rate: overAnswerCount / samples.length,
    total: samples.length,
    overAnswerCount,
  };
}
