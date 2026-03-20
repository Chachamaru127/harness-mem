import { HarnessMemCore } from "../../memory-server/src/core/harness-mem-core";
import { tokenize as tokenizeSearchText } from "../../memory-server/src/core/core-utils";
import {
  normalizeLocomoAnswer,
  type LocomoEvidenceSnippet,
  type LocomoQuestionKind,
  type MultiHopReasoningTrace,
} from "./locomo-answer-normalizer";
import { type LocomoSample } from "./locomo-loader";
import { stripHallucinationFiller } from "./japanese-companion-gate";

export interface AnswerTraceCandidate {
  id: string;
  sentence: string;
  score: number;
  created_at?: string;
}

export interface HarnessLocomoAnswerTrace {
  query_variants: string[];
  search_policy: {
    limit: number;
    variant_cap: number;
    candidate_limit: number;
    quality_floor: number;
  };
  extraction: {
    strategy: string;
    raw_answer: string;
    selected_candidates: AnswerTraceCandidate[];
  };
  normalization: {
    before: string;
    after: string;
    notes: string[];
    reference_time?: string;
    multi_hop_reasoning?: MultiHopReasoningTrace;
  };
  final_short_answer: string;
}

export interface HarnessLocomoReplayResult {
  prediction: string;
  search_hit_count: number;
  candidate_ids: string[];
  selected_evidence_ids: string[];
  answer_strategy: string;
  question_kind: string;
  answer_trace: HarnessLocomoAnswerTrace;
  search_latency_ms: number;
  token_estimate_input_tokens: number;
  token_estimate_output_tokens: number;
  token_estimate_total_tokens: number;
}

export interface HarnessLocomoAdapterOptions {
  project: string;
  session_id?: string;
}

interface AnswerQuestionOptions {
  category?: string;
}

interface SearchItem {
  id: string;
  text: string;
  rank: number;
  query_order: number;
  created_at?: string;
}

interface SearchPolicy {
  limit: number;
  variant_cap: number;
  candidate_limit: number;
  quality_floor: number;
}

interface CandidateSnippet extends LocomoEvidenceSnippet {
  rank: number;
  query_order: number;
}

interface ExtractedAnswerDraft {
  raw_answer: string;
  selected_candidates: CandidateSnippet[];
  selected_evidence_ids: string[];
  strategy: string;
}

interface FinalAnswerDraft {
  answer: string;
  template: string;
}

type QuestionKind = LocomoQuestionKind;

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "from",
  "by",
  "at",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "do",
  "does",
  "did",
  "have",
  "has",
  "had",
  "i",
  "you",
  "he",
  "she",
  "it",
  "we",
  "they",
  "my",
  "your",
  "their",
  "our",
  "what",
  "which",
  "who",
  "when",
  "where",
  "why",
  "how",
  "me",
  "about",
  "would",
  "could",
  "should",
  "if",
]);

const ENTITY_TOKEN_PATTERN = String.raw`(?:[A-Z][\p{L}\p{M}0-9]*(?:[A-Z][\p{L}\p{M}0-9]+)*|[A-Z]{2,}[A-Z0-9]*)`;
const ENTITY_SEQUENCE_PATTERN = String.raw`${ENTITY_TOKEN_PATTERN}(?:\s+${ENTITY_TOKEN_PATTERN}){0,4}`;
const ENTITY_SEQUENCE_REGEX = new RegExp(String.raw`\b${ENTITY_SEQUENCE_PATTERN}\b`, "gu");
const ENTITY_BLACKLIST = new Set([
  "I",
  "We",
  "Our",
  "My",
  "You",
  "Your",
  "He",
  "She",
  "They",
  "The",
  "A",
  "An",
  "This",
  "That",
  "These",
  "Those",
  "What",
  "When",
  "Where",
  "Why",
  "How",
]);
const NATURAL_LANGUAGES = [
  "English",
  "Spanish",
  "Japanese",
  "French",
  "German",
  "Korean",
  "Chinese",
  "Portuguese",
  "Italian",
  "Hindi",
  "Arabic",
];
const PROGRAMMING_LANGUAGES = [
  "Go",
  "Python",
  "TypeScript",
  "JavaScript",
  "Rust",
  "Java",
  "Kotlin",
  "Swift",
  "Ruby",
  "Scala",
  "Clojure",
  "C#",
  "C++",
];

const JAPANESE_STOP_TOKENS = new Set([
  "何",
  "何ですか",
  "何でしたか",
  "どこ",
  "どこですか",
  "いつ",
  "いつですか",
  "なぜ",
  "理由",
  "きっかけ",
  "です",
  "ですか",
  "でした",
  "でしたか",
  "どちら",
  "どれ",
  "こと",
  "もの",
  "今",
  "現在",
  "以前",
  "前回",
  "最後",
  "最初",
  "一覧",
  "すべて",
  "全て",
  "挙げて",
]);

const CURRENT_MARKER_REGEX = /\b(current|currently|now|latest|active|default|primary)\b/i;
const PREVIOUS_MARKER_REGEX = /\b(previous|previously|former|formerly|prior|earlier|used to|old)\b/i;
const REASON_MARKER_REGEX = /\b(why|reason|because|since|due to|trigger(?:ed)?|motivat(?:ed|ion))\b/i;
const LIST_MARKER_REGEX = /\b(list|all|enumerate|name all)\b/i;
const TEMPORAL_ORDER_MARKER_REGEX = /\b(first|last|before|after|earlier|later|previous|next|when)\b/i;
const JAPANESE_CURRENT_MARKER_REGEX = /(今|いま|現在|今の|現行|最新|使っている|使ってる)/;
const JAPANESE_PREVIOUS_MARKER_REGEX = /(以前|前の|前回|前は|もともと|元は|最初は|当初|当時|直後|初期|変える前|見直す前)/;
const JAPANESE_REASON_MARKER_REGEX = /(なぜ|理由|きっかけ|どうして|背景|原因)/;
const JAPANESE_LIST_MARKER_REGEX = /(一覧|すべて|全て|挙げて|列挙)/;
const JAPANESE_TEMPORAL_ORDER_MARKER_REGEX = /(どちらが先|先に|最後|最初|以前|前回|次に|その後|いつ|何時)/;
const CURRENT_EXACT_VALUE_DOMAIN_REGEX =
  /\b(ci|region|channel|cadence|retention|price|plan|auth|authentication|fusion|method|docs|language|support hours?|support window|start time|maintenance|headquarters|setup|tool|target)\b/i;
const JAPANESE_CURRENT_EXACT_VALUE_DOMAIN_REGEX =
  /(リージョン|認証|方式|方法|言語|料金|価格|retention|cadence|channel|サポート時間|開始時刻|メンテナンス|headquarters|docs|CI|setup|ツール|対象)/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeSpaces(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function stripJapaneseParticles(value: string): string {
  return value.replace(/^(?:は|が|を|に|で|と|の)+/u, "").replace(/(?:は|が|を|に|で|と|の)+$/u, "");
}

function tokenize(value: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const rawToken of tokenizeSearchText(value)) {
    const normalized = stripJapaneseParticles(normalizeText(rawToken));
    if (!normalized || normalized.length < 2) continue;
    if (/^[a-z0-9]+$/u.test(normalized) && STOP_WORDS.has(normalized)) continue;
    if (JAPANESE_STOP_TOKENS.has(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    tokens.push(normalized);
  }
  return tokens;
}

function stripQuestionBoilerplate(question: string): string {
  return question
    .replace(/[？?]/g, " ")
    .replace(/(教えてください|見せてください|挙げてください|列挙してください)/g, " ")
    .replace(/(何ですか|何でしたか|どこですか|どこでしたか|いつですか|いつでしたか)/g, " ")
    .replace(/(理由は何ですか|どちらが先に出ましたか|どちらが先でしたか)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractQueryKeywords(question: string): string[] {
  const stripped = stripQuestionBoilerplate(question);
  const phraseMatches = stripped.match(/[A-Za-z][A-Za-z0-9+.-]*(?:\s+[A-Za-z][A-Za-z0-9+.-]*){0,2}/g) || [];
  const candidates = [...phraseMatches, ...tokenize(stripped)];
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeText(candidate);
    if (!normalized || normalized.length < 2) continue;
    if (JAPANESE_STOP_TOKENS.has(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    keywords.push(normalized);
  }
  return keywords.slice(0, 8);
}

function detectQuestionKind(question: string, _category?: string): QuestionKind {
  const normalized = normalizeText(question);
  const looksLikeJapaneseYesNo =
    /(?:ですか|でしたか|ますか|ましたか|でしょうか|ありますか|いますか|使っていますか|使ってますか|残っていますか|対応していますか|だけですか|かけていますか)[？?]?$/.test(question) &&
    !/(何|どこ|いつ|なぜ|理由|誰|どれ|どの|いくつ|何時|何年|何月|何日|どちら|いくら|どれくらい|何個|何人|何回|何時間|何分|何語|何社)/.test(question);
  if (looksLikeJapaneseYesNo) {
    return "yes_no";
  }
  const looksLikeCurrentOrPreviousExact =
    (CURRENT_MARKER_REGEX.test(normalized) ||
      JAPANESE_CURRENT_MARKER_REGEX.test(question) ||
      PREVIOUS_MARKER_REGEX.test(normalized) ||
      JAPANESE_PREVIOUS_MARKER_REGEX.test(question)) &&
    (CURRENT_EXACT_VALUE_DOMAIN_REGEX.test(normalized) ||
      JAPANESE_CURRENT_EXACT_VALUE_DOMAIN_REGEX.test(question) ||
      /(何時|どこ|いつ)/.test(question)) &&
    !/(どちらが先|先に|最後|最初)/.test(question);
  const looksLikeInitialExactValue = /(最初はどの|最初にどの)/.test(question) && /(ツール|対象|tool|setup)/i.test(question);
  // RQ-010: cat-3 は会話コンテキストから事実を引き出すfact retrievalのため、
  // multi_hop ではなく factual として扱う（counterfactual バリアントを避けるため）
  if (/\bwould\b.+\bif\b/.test(normalized) || /\blikely\b/.test(normalized)) {
    return "multi_hop";
  }
  if (looksLikeCurrentOrPreviousExact || looksLikeInitialExactValue) {
    return "factual";
  }
  if (
    /\bwhen\b/.test(normalized) ||
    /\bhow long\b/.test(normalized) ||
    /\bhow often\b/.test(normalized) ||
    /\bwhat year\b/.test(normalized) ||
    /\bwhat month\b/.test(normalized) ||
    /\bwhat date\b/.test(normalized) ||
    JAPANESE_TEMPORAL_ORDER_MARKER_REGEX.test(question)
  ) {
    return "temporal";
  }
  if (normalized.startsWith("where ") || normalized.includes(" where ") || /(どこ|どの都市|どの国|所在地|場所)/.test(question)) {
    return "location";
  }
  if (/^(is|are|was|were|do|does|did|has|have|had|can|could|would|should|will)\b/.test(normalized) || looksLikeJapaneseYesNo) {
    return "yes_no";
  }
  // list: "what ... did you ... (plural noun)" or explicit list patterns only
  // "which" alone usually asks for a single item (factual), not a list
  if (/\bwhat activities\b|\bwhat books\b|\bwhat fields\b|\blist\b/.test(normalized) || JAPANESE_LIST_MARKER_REGEX.test(question)) {
    return "list";
  }
  return "factual";
}

function resolveSearchPolicy(kind: QuestionKind, category?: string): SearchPolicy {
  if (kind === "multi_hop") {
    // RQ-010: cat-3 multi-hop — より多くの候補を取得し、quality_floor を下げて recall 向上
    return { limit: 18, variant_cap: 6, candidate_limit: 6, quality_floor: 0.15 };
  }
  if (kind === "temporal") {
    return { limit: 13, variant_cap: 5, candidate_limit: 5, quality_floor: 0.2 };
  }
  if (category === "cat-4") {
    return { limit: 12, variant_cap: 4, candidate_limit: 5, quality_floor: 0.18 };
  }
  if (kind === "list") {
    return { limit: 10, variant_cap: 4, candidate_limit: 4, quality_floor: 0.16 };
  }
  if (kind === "yes_no") {
    return { limit: 9, variant_cap: 3, candidate_limit: 4, quality_floor: 0.14 };
  }
  return { limit: 9, variant_cap: 3, candidate_limit: 4, quality_floor: 0.14 };
}

function buildQueryVariants(question: string, kind: QuestionKind, policy: SearchPolicy, category?: string): string[] {
  const variants = new Set<string>();
  const normalizedQuestion = question.trim();
  const keywords = extractQueryKeywords(question);
  const keyPhrase = keywords.join(" ");

  if (normalizedQuestion) variants.add(normalizedQuestion);
  if (keyPhrase.length > 0) variants.add(keyPhrase);
  if (keywords.length >= 3) variants.add(`${keywords.slice(0, 3).join(" ")} key detail`);
  variants.add(`${keyPhrase} evidence summary`.trim());

  if (kind === "temporal") {
    variants.add(`${keyPhrase} date time timeline chronology`.trim());
    variants.add(`${keyPhrase} before after calendar`.trim());
    variants.add(`${keyPhrase} 先 後 最初 最後 以前 時系列`.trim());
  }
  if (kind === "location") {
    variants.add(`${keyPhrase} place location city moved`.trim());
    variants.add(`${keyPhrase} where lived stayed`.trim());
  }
  if (kind === "yes_no") {
    variants.add(`${keyPhrase} confirm true false contradiction`.trim());
  }
  if (kind === "list") {
    variants.add(`${keyPhrase} list names items`.trim());
    variants.add(`${keyPhrase} comma separated answers`.trim());
    variants.add(`${keyPhrase} 一覧 すべて 列挙`.trim());
  }
  if (kind === "multi_hop") {
    variants.add(`${keyPhrase} reason because causal dependency`.trim());
    variants.add(`${keyPhrase} supporting evidence chain`.trim());
  }
  if (JAPANESE_REASON_MARKER_REGEX.test(question) || REASON_MARKER_REGEX.test(normalizedQuestion)) {
    variants.add(`${keyPhrase} 理由 きっかけ because reason`.trim());
  }
  if (JAPANESE_CURRENT_MARKER_REGEX.test(question) || CURRENT_MARKER_REGEX.test(normalizedQuestion)) {
    variants.add(`${keyPhrase} current latest active now`.trim());
  }
  if (JAPANESE_PREVIOUS_MARKER_REGEX.test(question) || PREVIOUS_MARKER_REGEX.test(normalizedQuestion)) {
    variants.add(`${keyPhrase} previous former earlier before`.trim());
  }

  return [...variants]
    .map((variant) => normalizeText(variant))
    .filter((variant) => variant.length > 0)
    .slice(0, policy.variant_cap);
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function conversationFillerTrim(sentence: string): string {
  return sentence
    .replace(
      /^(hey|hi|wow|yeah|yep|thanks|thank you|cool|awesome|great|sounds good|sounds great|got it|okay|ok)[,!\s]+/i,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();
}

function extractDurationPhrase(text: string): string | null {
  // Matches duration expressions including optional "about/around/roughly/approximately" prefix.
  // Examples: "52 minutes", "about 2 hours", "around 3 weeks", "roughly 30 seconds"
  const durationPattern =
    /\b(?:about|around|roughly|approximately|nearly|almost|over|just\s+under\s+)?\s*\d+(?:\.\d+)?\s+(?:minutes?|hours?|seconds?|days?|weeks?|months?|years?)\b/i;
  const numericMatch = durationPattern.exec(text);
  if (numericMatch && numericMatch[0]) return numericMatch[0].trim();

  // Hyphenated durations: "5-day", "45-minute", "2-hour"
  const hyphenatedPattern = /\b(\d+)-(?:minute|hour|second|day|week|month|year)s?\b/i;
  const hyphenatedMatch = hyphenatedPattern.exec(text);
  if (hyphenatedMatch && hyphenatedMatch[0]) return hyphenatedMatch[0].trim();

  // Word-based durations: "three weeks", "four months", "two hours"
  const wordPattern =
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a\s+few)\s+(?:minutes?|hours?|seconds?|days?|weeks?|months?|years?)\b/i;
  const wordMatch = wordPattern.exec(text);
  if (wordMatch && wordMatch[0]) return wordMatch[0].trim();

  return null;
}

function extractTemporalPhrase(text: string): string | null {
  // Duration patterns are checked first — they are very specific and high precision for
  // temporal questions like "How long did it take?" or "How long ago?"
  const duration = extractDurationPhrase(text);
  if (duration) return duration;

  const patterns = [
    /\b(?:the\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:before|after)\s+[^.,;!?]+/i,
    /\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}\b/i,
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,\s*\d{4}|\s+\d{4})?\b/i,
    // Month + year: "September 2023", "January 2024" (without day)
    /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b/i,
    // Relative time references: "last March", "last quarter", "last year"
    /\b(?:last|next|this)\s+(?:week|month|year|quarter|spring|summer|autumn|fall|winter|january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    /\b\d{4}\b/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match && match[0]) {
      return match[0].trim();
    }
  }
  return null;
}

const TEMPORAL_WORDS = new Set([
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "spring", "summer", "autumn", "winter",
]);

function isTemporalWord(value: string): boolean {
  return TEMPORAL_WORDS.has(value.toLowerCase());
}

function extractLocationPhrase(text: string): string | null {
  const patterns: RegExp[] = [
    // "moved to/from City, State" - City + optional ", State"
    /\bmoved\s+to\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}(?:,\s*[A-Z][a-z]+)?)/,
    /\bmoved\s+from\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}(?:,\s*[A-Z][a-z]+)?)/,
    // "live/lives/lived/stay/stayed in City, State"
    /\b(?:live|lives|lived|stay|stayed|reside|resides|resided|based|located|operate[sd]?|work[s]?|study|studi(?:es|ed)?|attend[s]?|attending)\s+(?:in|at|from|to)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}(?:,\s*[A-Z][a-z]+)?)/,
    // "set in 1920s Shanghai" / "set in [decade] Place"
    /\bset\s+in\s+((?:\d{4}s?\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/,
    // "held/took place in City"
    /\b(?:held|took\s+place|hosted|located)\s+(?:in|at)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/,
    // "in City, State" - general pattern including City, State
    /\bin\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}(?:,\s*[A-Z][a-z]+)?)\b/,
    // "at/from City or Organization"
    /\b(?:at|from)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/,
    // "certification from deeplearning.ai" - lowercase domain
    /\b(?:from|at|via)\s+([a-z][a-z0-9-]*\.[a-z]{2,})\b/,
    // "my job at DataVision Corp"
    /\bjob\s+at\s+([A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*){0,3})\b/,
    // Abbreviation institutions: "at MIT", "at UCLA", "project at MIT"
    /\b(?:at|in|from)\s+([A-Z]{2,6})\b/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) {
      const result = match[1].trim();
      // Filter out temporal words (month names, weekdays, seasons)
      const firstWord = result.split(/[\s,]/)[0] || "";
      if (isTemporalWord(firstWord)) continue;
      return result;
    }
  }
  return null;
}

function extractNumericSlot(text: string): string | null {
  const patterns = [
    /\b\d{1,2}:\d{2}\s*(?:JST|UTC)?\s*(?:[〜~-]\s*\d{1,2}:\d{2}\s*(?:JST|UTC)?)\b/i,
    /平日[^\d]*(\d{1,2}:\d{2}\s*[〜~-]\s*\d{1,2}:\d{2}\s*(?:JST|UTC)?)/u,
    /\b\d+(?:\.\d+)?\s?%/,
    /\$\s?\d+(?:,\d{3})*(?:\.\d+)?/,
    /\b\d+(?:\.\d+)?\s+(?:minutes?|hours?|seconds?|days?|weeks?|months?|years?)\b/i,
    /\b\d+(?:\.\d+)?\b/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return match[1].trim();
    if (match?.[0]) return match[0].trim();
  }
  return null;
}

interface QuestionHints {
  wantsNumeric: boolean;
  wantsEntity: boolean;
  wantsLanguage: boolean;
  wantsProgrammingLanguage: boolean;
  wantsName: boolean;
  wantsOrganization: boolean;
  wantsRole: boolean;
  wantsPerson: boolean;
  wantsItem: boolean;
  wantsListValue: boolean;
  wantsSingularItem: boolean;
  wantsTopic: boolean;
  wantsCurrent: boolean;
  wantsPrevious: boolean;
  wantsReason: boolean;
  wantsTemporalOrdering: boolean;
}

function buildQuestionHints(question: string): QuestionHints {
  const normalized = normalizeText(question);
  return {
    wantsNumeric: /\b(how many|how much|percent|percentage|ratio|rate|cost|price|amount)\b/.test(normalized) || /(いくら|何円|何ドル|何個|何人|何回|何時間|何分|何日|割合|パーセント)/.test(question),
    wantsEntity: /\b(who|which person|name|what school|what company|what team|what university|what book|what dog)\b/.test(
      normalized
    ) || /(誰|名前|何社|どの会社|どのチーム|どの大学)/.test(question),
    wantsLanguage: /\b(language|speak|spoken|programming language)\b/.test(normalized) || /(言語|何語)/.test(question),
    wantsProgrammingLanguage: /\b(programming language|codebase|tech stack|backend|frontend|team use)\b/.test(normalized),
    wantsName: /\b(what is the name|name of|what.*name|whose name)\b/.test(normalized) || (/\b(called|named)\b/.test(normalized) && !/\bwhat\s+kind\b/.test(normalized)),
    wantsOrganization: /\b(university|school|college|company|startup|team|project|bakery|institute|lab|laboratory|employer)\b/.test(
      normalized
    ) || /(会社|企業|組織|チーム|大学|学校|研究所)/.test(question),
    wantsRole: /\b(role|job|position|title)\b/.test(normalized) || /(役職|肩書|職種|担当)/.test(question),
    wantsPerson: /\b(who|supervisor|advisor|adviser|manager|mentor|author)\b/.test(normalized) || /(誰|担当者|著者|管理者)/.test(question),
    wantsItem: /\b(item|product|book|dish|pastry|vegetable|vegetables|ingredient|ingredients|crop|crops|feature|features|tool|tools|signal|report|dog|cat|pet|breed|genre|type|kind|race|medium|sport|art|style|dance|subject|topic)\b/.test(normalized) || /(機能|項目|一覧|ツール|signal|機能は何|レポート)/.test(question),
    wantsListValue: /\b(vegetables|ingredients|items|products|crops|tools|languages|features)\b/.test(normalized) || JAPANESE_LIST_MARKER_REGEX.test(question),
    wantsSingularItem: /\b(which|what)\s+(vegetable|item|product|book|dish|pastry|ingredient|crop)\b/.test(normalized),
    wantsTopic: /\b(topic|thesis|project|using .* for|use .* for|used .* for)\b/.test(normalized),
    wantsCurrent: CURRENT_MARKER_REGEX.test(normalized) || JAPANESE_CURRENT_MARKER_REGEX.test(question),
    wantsPrevious: PREVIOUS_MARKER_REGEX.test(normalized) || JAPANESE_PREVIOUS_MARKER_REGEX.test(question),
    wantsReason: REASON_MARKER_REGEX.test(normalized) || JAPANESE_REASON_MARKER_REGEX.test(question),
    wantsTemporalOrdering: TEMPORAL_ORDER_MARKER_REGEX.test(normalized) || JAPANESE_TEMPORAL_ORDER_MARKER_REGEX.test(question),
  };
}

interface ExtractedSlot {
  value: string;
  strategy: string;
}

function cleanExtractedSpan(value: string, options: { dropLeadingArticle?: boolean } = {}): string {
  let cleaned = value
    .trim()
    .replace(/^[,;:.!?'"`\s]+/, "")
    .replace(/[,;:.!?'"`\s]+$/, "")
    .replace(/\b(?:mostly|mainly|especially|currently|right now)\b$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (options.dropLeadingArticle) {
    cleaned = cleaned.replace(/^(?:the|a|an)\s+/i, "").trim();
  }
  return cleaned;
}

function collectNamedEntities(text: string): string[] {
  const entities: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = ENTITY_SEQUENCE_REGEX.exec(text)) !== null) {
    const candidate = cleanExtractedSpan(match[0] || "");
    if (!candidate) continue;
    const firstToken = candidate.split(/\s+/)[0] || "";
    if (ENTITY_BLACKLIST.has(firstToken)) continue;
    entities.push(candidate);
  }
  return [...new Set(entities)];
}

function extractEntitySlot(text: string, questionTokens: string[], hints?: QuestionHints): string | null {
  const qSet = new Set(questionTokens);
  const entities = collectNamedEntities(text);
  if (entities.length === 0) return null;

  if (hints?.wantsOrganization) {
    const organizationLike = entities.filter((entity) => /\b(University|College|School|Institute|Laboratory|Lab)\b/u.test(entity));
    if (organizationLike.length > 0) {
      return organizationLike.sort((lhs, rhs) => rhs.length - lhs.length)[0] || null;
    }
  }

  const ranked = entities
    .map((entity) => {
      const entityTokens = tokenize(entity);
      const overlap = entityTokens.filter((token) => qSet.has(token)).length;
      const novelty = entityTokens.length - overlap;
      return { entity, novelty, wordCount: entityTokens.length };
    })
    .sort((lhs, rhs) => {
      if (rhs.novelty !== lhs.novelty) return rhs.novelty - lhs.novelty;
      if (rhs.wordCount !== lhs.wordCount) return rhs.wordCount - lhs.wordCount;
      return rhs.entity.length - lhs.entity.length;
    });

  return ranked[0]?.entity || null;
}

function extractLanguageSlot(text: string, hints: QuestionHints): string | null {
  const preferred = hints.wantsProgrammingLanguage
    ? [...PROGRAMMING_LANGUAGES, ...NATURAL_LANGUAGES]
    : [...NATURAL_LANGUAGES, ...PROGRAMMING_LANGUAGES];

  for (const language of preferred) {
    const regex = language === "Go" ? /\bGo\b/u : new RegExp(String.raw`\b${escapeRegExp(language)}\b`, "iu");
    const match = regex.exec(text);
    if (match?.[0]) return match[0];
  }
  return null;
}

function extractNameSlot(text: string): string | null {
  const cuePatterns = [
    new RegExp(String.raw`\b(?:called|named)\s+(${ENTITY_SEQUENCE_PATTERN})\b`, "u"),
    new RegExp(String.raw`\bname\s+is\s+(${ENTITY_SEQUENCE_PATTERN})\b`, "u"),
    // "My brother Leo is ..." / "My sister Emma got ..." — family member name
    /\b(?:brother|sister|cousin|nephew|niece|son|daughter|mother|father|uncle|aunt|dog|cat|pet)\s+([A-Z][a-z]{1,20})\s+(?:is|was|got|has|had|went|did|joined|works|studied|teaches)\b/u,
  ];
  for (const pattern of cuePatterns) {
    const match = pattern.exec(text);
    if (match?.[1]) {
      return cleanExtractedSpan(match[1]);
    }
  }
  return null;
}

function extractOrganizationSlot(text: string, hints: QuestionHints, questionTokens: string[]): string | null {
  const suffixMatch = /\b([A-Z][\p{L}\p{M}0-9]*(?:\s+[A-Z][\p{L}\p{M}0-9]*){0,3}\s+(?:University|College|School|Institute|Laboratory|Lab))\b/u.exec(
    text
  );
  if (suffixMatch?.[1]) {
    return cleanExtractedSpan(suffixMatch[1]);
  }

  const cuePatterns = [
    new RegExp(String.raw`\b(?:joined?|join|at|from|for|attending|attend|graduated from|research at|study(?:ing)? at)\s+(${ENTITY_SEQUENCE_PATTERN})\b`, "u"),
    new RegExp(String.raw`\b(?:team|project|company|startup|bakery)\s+(?:is|was)\s+called\s+(${ENTITY_SEQUENCE_PATTERN})\b`, "u"),
  ];
  for (const pattern of cuePatterns) {
    const match = pattern.exec(text);
    if (match?.[1]) {
      return cleanExtractedSpan(match[1]);
    }
  }

  return hints.wantsEntity ? extractEntitySlot(text, questionTokens, hints) : null;
}

function extractRoleSlot(text: string): string | null {
  const patterns = [
    /\b(?:role|job|position|title)\s+(?:at\s+\S+\s+)?(?:is|was)\s+(?:an?\s+)?([a-z][\p{L}\p{M}-]*(?:\s+[a-z][\p{L}\p{M}-]*){0,4}?)(?=\s+(?:focusing|working|specializing|using|building|at|with|on|for)\b|[.,;!?]|$)/iu,
    /\b(?:joined|work(?:ing)?|hired)(?:\s+\S+){0,3}\s+as\s+(?:an?\s+)?([a-z][\p{L}\p{M}-]*(?:\s+[a-z][\p{L}\p{M}-]*){0,4}?)(?=\s+(?:focusing|working|specializing|using|building|at|with|on|for)\b|[.,;!?]|$)/iu,
    /\bI(?:'m| am)\s+(?:an?\s+)?([a-z][\p{L}\p{M}-]*(?:\s+[a-z][\p{L}\p{M}-]*){0,5})\b/iu,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) {
      return cleanExtractedSpan(match[1], { dropLeadingArticle: true });
    }
  }
  return null;
}

function extractPersonSlot(text: string, questionTokens: string[], hints: QuestionHints): string | null {
  const cuePatterns = [
    new RegExp(String.raw`\b(?:supervisor|advisor|adviser|manager|mentor|author)\s+is\s+(${ENTITY_SEQUENCE_PATTERN})\b`, "u"),
    new RegExp(String.raw`\b(?:dog|cat|sister|brother|friend|partner)\b.*?\b(?:named|called)\s+(${ENTITY_SEQUENCE_PATTERN})\b`, "u"),
  ];
  for (const pattern of cuePatterns) {
    const match = pattern.exec(text);
    if (match?.[1]) {
      return cleanExtractedSpan(match[1]);
    }
  }
  return extractEntitySlot(text, questionTokens, hints);
}

function extractListLead(text: string): string | null {
  const firstClause = text.split(/[.;!?]/)[0]?.trim() || text.trim();
  const stripped = firstClause.replace(/\b(?:mostly|mainly|especially|currently|right now)\b.*$/i, "").trim();
  const itemPattern = String.raw`[A-Za-z][\p{L}\p{M}-]*(?:\s+[A-Za-z][\p{L}\p{M}-]*){0,2}`;
  const listPattern = new RegExp(
    String.raw`^(${itemPattern}(?:,\s*${itemPattern})*(?:,?\s+and\s+${itemPattern})?)$`,
    "iu"
  );
  const match = listPattern.exec(stripped);
  if (!match?.[1]) return null;
  return cleanExtractedSpan(match[1]);
}

function extractKindSlot(text: string, question: string): string | null {
  // "what kind/type/genre/medium/breed of X" — extract the adjective/noun kind before a proper name
  // e.g. "I adopted a golden retriever named Buddy" → "golden retriever"
  // e.g. "My band plays indie rock" → "indie rock"
  const patterns = [
    // "adopted/rescued/bought/got a <kind> named/called <Name>"
    /\b(?:adopted|rescued|got|bought|have|had|own[s]?)\s+(?:a|an)\s+([a-z][a-z0-9\s-]{2,30}?)\s+(?:named|called)\b/i,
    // "plays/played <genre> music" / "play in <genre> band"
    /\b(?:plays?|played|perform[s]?|makes?|records?|plays?\s+in\s+a\s+band\s+(?:called\s+\S+\s+)?playing)\s+([a-z][a-z\s-]{2,25}?)\s+(?:music|band|rock|pop|jazz|genre)/i,
    // "learning/studying/using <medium>"
    /\b(?:learning|learn)\s+to\s+(?:paint|play|draw|write|code|speak)\s+([a-z][a-z\s-]{2,25}?)(?:\.|,|$)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return cleanExtractedSpan(match[1]);
  }
  return null;
}

function extractItemSlot(text: string, hints: QuestionHints): string | null {
  const leadList = extractListLead(text);
  if (leadList) {
    if (hints.wantsSingularItem) {
      return cleanExtractedSpan((leadList.split(/,|\band\b/i)[0] || "").trim(), { dropLeadingArticle: true });
    }
    return cleanExtractedSpan(leadList);
  }

  const bestSeller = /\b(?:best seller|best-selling item|best selling item)\s+is\s+(?:the\s+)?([a-z][\p{L}\p{M}0-9-]*(?:\s+[a-z][\p{L}\p{M}0-9-]*){0,5})\b/iu.exec(
    text
  );
  if (bestSeller?.[1]) {
    return cleanExtractedSpan(bestSeller[1], { dropLeadingArticle: true });
  }

  return null;
}

function extractTopicSlot(text: string): string | null {
  const patterns = [
    /\bfor\s+(?:a\s+|an\s+|the\s+)?([a-z][\p{L}\p{M}0-9-]*(?:\s+[a-z][\p{L}\p{M}0-9-]*){0,6}?)(?=\s+(?:at|in|with|using|from|near|during)\b|[.,;!?]|$)/iu,
    /\bon\s+([a-z][\p{L}\p{M}0-9-]*(?:\s+[a-z][\p{L}\p{M}0-9-]*){0,8}?)(?=\s+(?:at|in|with|using|from|near|during)\b|[.,;!?]|$)/iu,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) {
      return cleanExtractedSpan(match[1], { dropLeadingArticle: true }).replace(/^(?:my|our|their|his|her)\s+/i, "");
    }
  }
  return null;
}

function stripTrailingJapaneseCopula(value: string): string {
  return cleanExtractedSpan(
    value
      .replace(/^(?:その後|そこで|まず|最初に|最後に)\s+/u, "")
      .replace(/\s*開始$/u, "")
      .replace(/(?:です|でした|だ|だった)$/u, "")
      .replace(/(?:を使っています|を使っている|にしています|にしていました|もサポートしています)$/u, "")
      .replace(/(?:が先に出ました|が先でした|が最後でした|が最初でした)$/u, "")
      .trim()
  ).replace(/(?:も|を|が)$/u, "").trim();
}

function normalizeListItems(value: string): string {
  const rawItems = value
    .replace(/(?:for admins|for admin)$/iu, "")
    .split(/,|、| and /iu)
    .map((item) => stripTrailingJapaneseCopula(item))
    .filter(Boolean);
  return [...new Set(rawItems)].join(", ");
}

function extractJapaneseReasonSlot(text: string): string | null {
  const patterns = [
    /(?:理由|きっかけ)(?:は|になったのは)?\s*([^。!?]+?(?:から|ため|ので))(?:です|でした|だ|だった)?/u,
    /([^。!?]+?(?:から|ため|ので))(?:です|でした|だ|だった)?(?:。|$)/u,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(normalizeSpaces(text));
    if (match?.[1]) {
      return stripTrailingJapaneseCopula(match[1]);
    }
  }
  return null;
}

function extractJapaneseCurrentValueSlot(text: string): string | null {
  const patterns = [
    /今(?:は|の)?\s*([^。!?]+?)\s*(?:を使っています|を使っている|です|でした|にしています|になっています|もサポートしています|が使われています)/u,
    /現在(?:は|の)?\s*([^。!?]+?)\s*(?:を使っています|です|でした|にしています|になっています|もサポートしています)/u,
    /今の[^。!?]*?は\s*([^。!?]+?)(?:です|でした|だ|だった)/u,
    /現在の[^。!?]*?は\s*([^。!?]+?)(?:です|でした|だ|だった)/u,
    /((?:平日(?:の)?\s*)?\d{1,2}:\d{2}\s*[〜~-]\s*\d{1,2}:\d{2}\s*(?:JST|UTC)?)\s*に絞りました/u,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(normalizeSpaces(text));
    if (match?.[1]) {
      return stripTrailingJapaneseCopula(match[1]);
    }
  }
  return null;
}

function extractJapanesePreviousValueSlot(text: string): string | null {
  const patterns = [
    /以前(?:は|の)?\s*([^。!?]+?)\s*(?:でした|です|を使っていました|にしていました)/u,
    /前(?:は|の)?\s*([^。!?]+?)\s*(?:でした|です|を使っていました|にしていました)/u,
    /最初は[^。!?]*?を\s*([^。!?]+?)\s*にしていました/u,
    /最初の[^。!?]*?は\s*([^。!?]+?)\s*だけを対象にしていました/u,
    /元は\s*([^。!?]+?)\s*(?:でした|です|を使っていました|にしていました)/u,
    /([^。!?]+?)では\s*([^。!?]+?)\s*を使っていました/u,
    /を\s*([^。!?]+?)\s*にしていました/u,
    // S43-FIX: 「の頃は」「当時は」パターン追加
    /(?:の頃|当時|当初)(?:は|の)?\s*[^。!?]*?\s*([A-Za-z][A-Za-z0-9 _-]+(?:\s+[A-Za-z][A-Za-z0-9 _-]*)*)\s*(?:方式|形式|構成|スタイル|パターン)/u,
    /(?:の頃|当時|当初)(?:は|の)?\s*([^。!?]+?)\s*(?:でした|です|を使っていました|にしていました|を置)/u,
    // S43-FIX: 「だけで送っていました」パターン（prev-014: "email だけで送っていました"）
    /([^。!?]+?)\s*だけで[^。!?]*?(?:いました|ました)/u,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(normalizeSpaces(text));
    if (match?.[2]) {
      return stripTrailingJapaneseCopula(match[2]);
    }
    if (match?.[1]) {
      return stripTrailingJapaneseCopula(match[1]);
    }
  }
  return null;
}

function extractJapaneseTemporalOrderSlot(question: string, text: string): string | null {
  const normalizedQuestion = normalizeSpaces(question);
  const source = normalizeSpaces(text);

  if (/(どちらが先|先に)/u.test(normalizedQuestion)) {
    const first = /([^、,。!?]+?)が先(?:に出ました|に出た|でした|だ)/u.exec(source);
    if (first?.[1]) return stripTrailingJapaneseCopula(first[1]);
  }
  if (/(最後|last)/iu.test(normalizedQuestion)) {
    const last = /([^、,。!?]+?)が最後(?:に出ました|でした|だ)/u.exec(source);
    if (last?.[1]) return stripTrailingJapaneseCopula(last[1]);
  }
  if (/(最初|first)/iu.test(normalizedQuestion)) {
    const first = /([^、,。!?]+?)が最初(?:に出ました|でした|だ)/u.exec(source);
    if (first?.[1]) return stripTrailingJapaneseCopula(first[1]);
  }
  return null;
}

function extractJapaneseListSlot(text: string): string | null {
  const patterns = [
    /(?:には|は)\s*([^。!?]+?)\s*を(?:出しました|追加しました|導入しました|含めました)/u,
    /([^。!?]+(?:,|、)\s*[^。!?]+(?:,|、)?\s*[^。!?]+)(?:を出しました|です)/u,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(normalizeSpaces(text));
    if (match?.[1]) {
      return normalizeListItems(match[1]);
    }
  }
  return null;
}

function extractJapaneseObjectValueSlot(text: string): string | null {
  const patterns = [
    /([^。!?]+?)を見て、/u,
    /から\s+([^。!?]+?の要望)がありました/u,
    /([^。!?]+?の要望)がありました/u,
    /([^。!?]+?)を bundle しました/u,
    /([^。!?]+?)を localized しました/u,
    /setup は\s*([^。!?]+?)\s*をまとめて指定します/u,
    /([^。!?]+?)をまとめて指定します/u,
    /([^。!?]+?)を削除しました/u,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(normalizeSpaces(text));
    if (match?.[1]) {
      return normalizeListItems(stripTrailingJapaneseCopula(match[1]));
    }
  }
  return null;
}

function extractJapaneseSubjectBeforeTopicSlot(question: string, text: string): string | null {
  const normalizedQuestion = normalizeSpaces(question);
  const source = normalizeSpaces(text);
  if (/(の後|あとで|後に)/u.test(normalizedQuestion)) {
    const match = /(?:^|[。.!?]\s*)([^、,。!?]+?)は[^。!?]*(?:の後|あとで|後に)/u.exec(source);
    if (match?.[1]) {
      return stripTrailingJapaneseCopula(match[1]);
    }
  }
  return null;
}

function extractQuestionAwareSpan(
  question: string,
  text: string,
  questionTokens = tokenize(question),
  hints = buildQuestionHints(question)
): ExtractedSlot | null {
  if (!text.trim()) return null;
  const prefersObjectBeforePrevious =
    hints.wantsPrevious && /(見た|レポート|要望|request|requested|追加|削除|bundle|localized)/iu.test(question);

  if (hints.wantsReason) {
    const reason = extractJapaneseReasonSlot(text);
    if (reason) return { value: reason, strategy: "reason-slot" };
  }

  if (hints.wantsCurrent) {
    const current = extractJapaneseCurrentValueSlot(text);
    if (current) return { value: current, strategy: "current-slot" };
  }

  if (prefersObjectBeforePrevious && (hints.wantsItem || hints.wantsReason || hints.wantsTopic)) {
    const objectValue = extractJapaneseObjectValueSlot(text);
    if (objectValue) return { value: objectValue, strategy: hints.wantsListValue ? "list-slot" : "object-slot" };
  }

  if (hints.wantsPrevious && !prefersObjectBeforePrevious) {
    const previous = extractJapanesePreviousValueSlot(text);
    if (previous) return { value: previous, strategy: "previous-slot" };
  }

  if (hints.wantsTemporalOrdering) {
    const temporalOrder = extractJapaneseTemporalOrderSlot(question, text);
    if (temporalOrder) return { value: temporalOrder, strategy: "temporal-order-slot" };
  }

  if (hints.wantsListValue) {
    const listValue = extractJapaneseListSlot(text);
    if (listValue) return { value: listValue, strategy: "list-slot" };
  }

  if (hints.wantsItem || hints.wantsReason || hints.wantsTopic) {
    const objectValue = extractJapaneseObjectValueSlot(text);
    if (objectValue) return { value: objectValue, strategy: hints.wantsListValue ? "list-slot" : "object-slot" };
  }

  // "what kind/type/breed/genre of X" — extract the kind/category before a proper name
  if (hints.wantsItem && /\bwhat\s+(?:kind|type|breed|genre|sort|medium|style|art)\b/i.test(question)) {
    const kind = extractKindSlot(text, question);
    if (kind) return { value: kind, strategy: "kind-slot" };
  }

  if (hints.wantsNumeric) {
    const numeric = extractNumericSlot(text);
    if (numeric) return { value: numeric, strategy: "numeric-slot" };
  }

  if (hints.wantsLanguage) {
    const language = extractLanguageSlot(text, hints);
    if (language) return { value: language, strategy: "language-slot" };
  }

  if (hints.wantsName) {
    const name = extractNameSlot(text) || extractEntitySlot(text, questionTokens, hints);
    if (name) return { value: name, strategy: "name-slot" };
  }

  if (hints.wantsOrganization) {
    const organization = extractOrganizationSlot(text, hints, questionTokens);
    if (organization) return { value: organization, strategy: "organization-slot" };
  }

  if (hints.wantsRole) {
    const role = extractRoleSlot(text);
    if (role) return { value: role, strategy: "role-slot" };
  }

  if (hints.wantsPerson) {
    const person = extractPersonSlot(text, questionTokens, hints);
    if (person) return { value: person, strategy: "person-slot" };
  }

  if (hints.wantsItem || hints.wantsListValue || hints.wantsSingularItem) {
    const item = extractItemSlot(text, hints);
    if (item) {
      return { value: item, strategy: hints.wantsListValue ? "list-slot" : "item-slot" };
    }
  }

  if (hints.wantsTopic) {
    const topic = extractTopicSlot(text);
    if (topic) return { value: topic, strategy: "topic-slot" };
  }

  const subjectBeforeTopic = extractJapaneseSubjectBeforeTopicSlot(question, text);
  if (subjectBeforeTopic) return { value: subjectBeforeTopic, strategy: "subject-before-topic-slot" };

  if (hints.wantsEntity) {
    const entity = extractEntitySlot(text, questionTokens, hints);
    if (entity) return { value: entity, strategy: "entity-slot" };
  }

  return null;
}

function isLowQualitySentence(sentence: string): boolean {
  const source = normalizeText(sentence);
  if (!source || source.length < 8 || source.length > 260) return true;
  if (/[?]$/.test(source)) return true;
  if (/^(i think|maybe|not sure|let me|hmm|uh|um)\b/.test(source)) return true;
  if (/^(that('| i)?s|what a)\s+(great|fun|nice|cool|interesting)\b/.test(source)) return true;
  const tokenCount = source.split(" ").filter(Boolean).length;
  return tokenCount < 3;
}

function sentenceScore(
  sentence: string,
  question: string,
  questionTokens: string[],
  kind: QuestionKind,
  hints: QuestionHints,
  rank: number,
  queryOrder: number
): number {
  const sentenceTokens = tokenize(sentence);
  if (sentenceTokens.length === 0) return 0;
  const sentenceSet = new Set(sentenceTokens);
  let overlap = 0;
  for (const token of questionTokens) {
    if (sentenceSet.has(token)) overlap += 1;
  }
  let score = overlap / Math.max(questionTokens.length, 1);
  score += 1 / (rank + 2);
  score += 1 / ((queryOrder + 1) * 8);
  if (kind === "temporal") {
    if (extractDurationPhrase(sentence)) score += 0.35; // duration gets higher bonus
    else if (extractTemporalPhrase(sentence)) score += 0.22;
    else if (extractJapaneseTemporalOrderSlot(question, sentence)) score += 0.26;
  }
  if (kind === "location" && extractLocationPhrase(sentence)) score += 0.2;
  if (kind === "yes_no" && /\bno\b|\bnot\b|\bnever\b|\byes\b/i.test(sentence)) score += 0.12;
  if (kind === "multi_hop" && /\bbecause\b|\bsince\b|\bsupport\b|\bmotivat/i.test(sentence)) score += 0.14;
  if (hints.wantsCurrent) {
    if (extractJapaneseCurrentValueSlot(sentence) || JAPANESE_CURRENT_MARKER_REGEX.test(sentence) || CURRENT_MARKER_REGEX.test(sentence)) {
      score += 0.26;
    }
    if (extractNumericSlot(sentence) || /に絞りました|開始です|開始でした|もサポートしています/u.test(sentence)) {
      score += 0.1;
    }
    if (extractJapanesePreviousValueSlot(sentence) || JAPANESE_PREVIOUS_MARKER_REGEX.test(sentence) || PREVIOUS_MARKER_REGEX.test(sentence)) {
      score -= 0.18;
    }
  }
  if (hints.wantsPrevious) {
    if (extractJapanesePreviousValueSlot(sentence) || JAPANESE_PREVIOUS_MARKER_REGEX.test(sentence) || PREVIOUS_MARKER_REGEX.test(sentence)) {
      score += 0.26;
    }
    if (extractJapaneseCurrentValueSlot(sentence) || JAPANESE_CURRENT_MARKER_REGEX.test(sentence) || CURRENT_MARKER_REGEX.test(sentence)) {
      score -= 0.18;
    }
  }
  if (hints.wantsReason && (extractJapaneseReasonSlot(sentence) || /because|since|due to/i.test(sentence))) {
    score += 0.24;
  }
  if (hints.wantsListValue && (extractJapaneseListSlot(sentence) || /[,、]/.test(sentence))) {
    score += 0.14;
  }
  const slot = extractQuestionAwareSpan(question, sentence, questionTokens, hints);
  if (slot) {
    score += 0.24;
    if (slot.strategy === "name-slot" || slot.strategy === "organization-slot") score += 0.08;
    if (slot.strategy === "list-slot") score += 0.06;
    if (slot.strategy === "current-slot" || slot.strategy === "reason-slot" || slot.strategy === "temporal-order-slot") {
      score += 0.08;
    }
  } else if (hints.wantsEntity || hints.wantsItem || hints.wantsLanguage || hints.wantsRole || hints.wantsTopic) {
    score -= 0.08;
  }
  return score;
}

function buildCandidates(items: SearchItem[], question: string, kind: QuestionKind): CandidateSnippet[] {
  const questionTokens = tokenize(question);
  const hints = buildQuestionHints(question);
  const candidates: CandidateSnippet[] = [];
  for (const item of items) {
    const sentences = splitSentences(item.text);
    for (const sentence of sentences) {
      const cleaned = conversationFillerTrim(sentence);
      if (!cleaned || isLowQualitySentence(cleaned)) continue;
      candidates.push({
        id: item.id,
        sentence: cleaned,
        score: sentenceScore(cleaned, question, questionTokens, kind, hints, item.rank, item.query_order),
        rank: item.rank,
        query_order: item.query_order,
        created_at: item.created_at,
      });
    }
  }
  candidates.sort((lhs, rhs) => rhs.score - lhs.score);
  return candidates;
}

function applyCandidateQualityFilter(candidates: CandidateSnippet[], floor: number, candidateLimit: number): CandidateSnippet[] {
  const deduped: CandidateSnippet[] = [];
  const seenSentence = new Set<string>();

  for (const candidate of candidates) {
    const key = normalizeText(candidate.sentence);
    if (seenSentence.has(key)) continue;
    seenSentence.add(key);
    if (candidate.score >= floor) {
      deduped.push(candidate);
    }
  }

  if (deduped.length === 0 && candidates.length > 0) {
    deduped.push(...candidates.slice(0, candidateLimit));
  }

  return deduped.slice(0, Math.max(candidateLimit, 1));
}

function selectBestFactualSpan(question: string, candidates: CandidateSnippet[]): ExtractedSlot | null {
  const questionTokens = tokenize(question);
  const hints = buildQuestionHints(question);
  const ranked = candidates
    .map((candidate) => {
      const slot = extractQuestionAwareSpan(question, candidate.sentence, questionTokens, hints);
      if (!slot) return null;
      const valueTokens = tokenize(slot.value);
      const overlap = valueTokens.filter((token) => questionTokens.includes(token)).length;
      const novelty = valueTokens.length - overlap;
      const compactness = Math.max(0, 6 - Math.min(valueTokens.length, 6)) * 0.01;
      return {
        slot,
        score: candidate.score + novelty * 0.05 + compactness,
      };
    })
    .filter((entry): entry is { slot: ExtractedSlot; score: number } => Boolean(entry))
    .sort((lhs, rhs) => rhs.score - lhs.score);

  return ranked[0]?.slot || null;
}

function extractAnswerDraft(
  question: string,
  kind: QuestionKind,
  candidates: CandidateSnippet[],
  policy: SearchPolicy,
  _category?: string
): ExtractedAnswerDraft {
  if (candidates.length === 0) {
    return {
      raw_answer: "",
      selected_candidates: [],
      selected_evidence_ids: [],
      strategy: "extract:no-candidate",
    };
  }

  const topN = applyCandidateQualityFilter(candidates, policy.quality_floor, policy.candidate_limit);
  const selectedEvidenceIds = [...new Set(topN.map((candidate) => candidate.id))];
  const mergedTop = topN.map((candidate) => candidate.sentence).join(" ");

  if (kind === "temporal") {
    const orderPhrase =
      extractJapaneseTemporalOrderSlot(question, mergedTop) ||
      extractJapaneseTemporalOrderSlot(question, topN[0]?.sentence || "");

    if (orderPhrase) {
      return {
        raw_answer: orderPhrase,
        selected_candidates: topN,
        selected_evidence_ids: selectedEvidenceIds,
        strategy: "extract:temporal-order-slot",
      };
    }

    const normalizedQuestion = normalizeText(question);
    const asksDuration = /\bhow\s+(?:long|many\s+(?:days?|weeks?|months?|years?|hours?|minutes?))\b/i.test(normalizedQuestion);
    const asksDistance = /\bhow\s+(?:long|far|many\s+(?:km|kilometer|mile))\b/i.test(normalizedQuestion);

    if (asksDuration || asksDistance) {
      // For "how long" questions: scan each candidate individually for duration, prefer duration over date
      let phrase: string | null = null;
      for (const candidate of topN) {
        phrase = extractDurationPhrase(candidate.sentence);
        if (phrase) break;
      }
      // Also check merged text in case duration spans multiple candidates
      if (!phrase) {
        phrase = extractDurationPhrase(mergedTop);
      }
      // Fall back to non-duration temporal phrase on top candidate only (not merged) to avoid wrong-candidate contamination
      if (!phrase) {
        phrase = extractTemporalPhrase(topN[0]?.sentence || "");
      }
      return {
        raw_answer: phrase || topN[0]?.sentence || mergedTop,
        selected_candidates: topN,
        selected_evidence_ids: selectedEvidenceIds,
        strategy: "extract:temporal-duration-candidates",
      };
    }

    // For "when" questions: scan candidates individually in rank order to avoid
    // wrong-candidate contamination in merged text (e.g. v1.5 vs v2.0 deployment dates)
    let phrase: string | null = null;
    for (const candidate of topN) {
      phrase = extractTemporalPhrase(candidate.sentence);
      if (phrase) break;
    }
    return {
      raw_answer: phrase || topN[0]?.sentence || mergedTop,
      selected_candidates: topN,
      selected_evidence_ids: selectedEvidenceIds,
      strategy: "extract:temporal-candidates",
    };
  }

  if (kind === "location") {
    // Try location phrase extraction first across merged text and top candidate
    let location = extractLocationPhrase(mergedTop) || extractLocationPhrase(topN[0]?.sentence || "");
    // Fallback: try entity slot (catches institution names, org names as locations)
    if (!location) {
      const questionTokens = tokenize(question);
      const hints = buildQuestionHints(question);
      for (const candidate of topN) {
        const entity = extractEntitySlot(candidate.sentence, questionTokens, hints);
        if (entity && entity.length >= 2) {
          location = entity;
          break;
        }
      }
    }
    return {
      raw_answer: location || topN[0]?.sentence || "",
      selected_candidates: topN,
      selected_evidence_ids: selectedEvidenceIds,
      strategy: "extract:location-candidates",
    };
  }

  if (kind === "yes_no") {
    const withNegation = topN.find((item) => /\bno\b|\bnot\b|\bnever\b|\bnone\b/i.test(item.sentence) || /(ありません|ないです|ません|違います|やめました)/u.test(item.sentence));
    const withAffirmation = topN.find((item) => /\byes\b|\bdefinitely\b|\bconfirmed\b/i.test(item.sentence) || /(です|います|使っています|使ってます|あります)/u.test(item.sentence));
    const raw = withNegation?.sentence || withAffirmation?.sentence || topN[0]?.sentence || "";
    return {
      raw_answer: raw,
      selected_candidates: topN,
      selected_evidence_ids: selectedEvidenceIds,
      strategy: "extract:yes-no-candidates",
    };
  }

  if (kind === "multi_hop") {
    return {
      raw_answer: mergedTop,
      selected_candidates: topN,
      selected_evidence_ids: selectedEvidenceIds,
      strategy: "extract:multi-hop-facts-json",
    };
  }

  if (kind === "list") {
    const listItems: string[] = [];
    for (const candidate of topN) {
      const japaneseList = extractJapaneseListSlot(candidate.sentence);
      if (japaneseList) {
        listItems.push(...japaneseList.split(/,|、/).map((item) => cleanExtractedSpan(item)).filter(Boolean));
        continue;
      }
      const slot = extractQuestionAwareSpan(question, candidate.sentence);
      if (slot) {
        listItems.push(slot.value);
        continue;
      }
      const extracted = collectNamedEntities(candidate.sentence);
      if (extracted.length > 0) {
        listItems.push(...extracted);
      } else {
        const clause = candidate.sentence.split(/[,;]/)[0]?.trim();
        if (clause && clause.length <= 60) listItems.push(clause);
      }
    }
    const deduped = [...new Set(listItems.map((item) => normalizeListItems(item)).filter(Boolean))].slice(0, 6);
    const raw = deduped.length > 0 ? deduped.join(", ") : topN.map((c) => c.sentence).join(", ");
    return {
      raw_answer: raw,
      selected_candidates: topN,
      selected_evidence_ids: selectedEvidenceIds,
      strategy: "extract:list-proper-nouns",
    };
  }

  const factualSlot = selectBestFactualSpan(question, topN);
  if (factualSlot) {
    return {
      raw_answer: factualSlot.value,
      selected_candidates: topN,
      selected_evidence_ids: selectedEvidenceIds,
      strategy: `extract:factual-${factualSlot.strategy}`,
    };
  }

  return {
    raw_answer: topN[0]?.sentence || "",
    selected_candidates: topN,
    selected_evidence_ids: selectedEvidenceIds,
    strategy: "extract:factual-top-candidate",
  };
}

/**
 * 文から最も短い関連フレーズ（固有名詞・名詞句）を抽出する。
 * factualクエリの precision を向上させるために使用する。
 *
 * 優先順位:
 *   1. クエリに出てこない固有名詞で最も短いもの（答え候補の可能性が高い）
 *   2. 固有名詞がない場合はクエリと重複しない短い節
 */
function extractCorePhrase(sentence: string, questionTokens: string[]): string {
  const qSet = new Set(questionTokens);
  const properNouns = collectNamedEntities(sentence);

  if (properNouns.length > 0) {
    // クエリに出てこない固有名詞を優先（答え候補）
    const scored = properNouns.map((np) => {
      const npTokens = tokenize(np);
      const overlap = npTokens.filter((t) => qSet.has(t)).length;
      const novelty = npTokens.length - overlap; // クエリ未登場語の数
      const wordCount = np.split(/\s+/).length;
      return { np, novelty, len: np.length, wordCount };
    });

    // novelty > 0（クエリに出てこない語を含む）かつ短い固有名詞を最優先
    const novel = scored.filter((s) => s.novelty > 0);
    if (novel.length > 0) {
      // ソート: 短い語数優先 → 同語数なら文字数優先 → novelty は同値扱い（全て>0）
      novel.sort((a, b) => {
        if (a.wordCount !== b.wordCount) return a.wordCount - b.wordCount;
        return a.len - b.len;
      });
      const best = novel[0];
      if (best && best.np.length >= 2) return best.np;
    }

    // クエリと完全重複する固有名詞しかなければ最短を返す
    const anyNouns = scored.slice().sort((a, b) => a.len - b.len);
    const shortest = anyNouns[0];
    if (shortest && shortest.np.length >= 2 && shortest.len < sentence.length * 0.6) {
      return shortest.np;
    }
  }

  // 固有名詞がない場合: 節ごとに分割し最短の意味ある節を返す
  const clauses = sentence.split(/[,;]/).map((c) => c.trim()).filter((c) => c.length > 2);
  // 質問トークンを含まない節（新情報）を優先
  const novelClause = clauses.find((c) => {
    const cTokens = tokenize(c);
    return cTokens.length > 0 && !cTokens.every((t) => qSet.has(t));
  });
  // 質問トークンを含む節をフォールバックとして使用
  const clauseWithOverlap = clauses.find((c) => {
    const cTokens = tokenize(c);
    return cTokens.some((t) => qSet.has(t));
  });
  const bestClause = novelClause || clauseWithOverlap || clauses[0] || sentence;
  return bestClause.length <= 100 ? bestClause : compactToSingleSentence(bestClause, 80);
}

function finalizeShortAnswer(
  kind: QuestionKind,
  normalized: string,
  question: string,
  _category?: string
): FinalAnswerDraft {
  const trimmed = normalized.trim();
  if (!trimmed) {
    return { answer: "", template: "final:empty" };
  }
  if (kind === "temporal") {
    return { answer: trimmed, template: "final:temporal-short" };
  }
  if (kind === "location") {
    // Preserve domain names like "deeplearning.ai" — only split on sentence-ending punctuation
    // when the result is not a domain name (which contains embedded dots)
    const isDomainName = /^[a-zA-Z][a-zA-Z0-9-]*\.[a-z]{2,}$/.test(trimmed);
    if (isDomainName) {
      return { answer: trimmed, template: "final:location-domain" };
    }
    return { answer: trimmed.split(/[.?!]/)[0]?.trim() || trimmed, template: "final:location-short" };
  }
  if (kind === "yes_no") {
    const lower = normalizeText(trimmed);
    // S43-FIX: 日本語否定表現も検出して正しく No を返す
    const jaNoPattern = /(ありません|ないです|ません[。.]?$|違います|やめました|ではなく|ではない|じゃない|していない|しなかった|なくなりました|廃止|中止|変更しました|変えました|移行しました|切り替えました)/u;
    const enNoPattern = /^no\b|(\bnot\b|\bnever\b|\bno longer\b|\bstopped\b|\bchanged\b|\bswitched\b|\bmoved\b|\breplaced\b)/i;
    // Question が「今も〜ですか」「まだ〜ですか」パターンで、evidence に変更・移行が含まれる → No
    const asksContinuity = /(今も|まだ|引き続き|依然|still|anymore)/u.test(question);
    const evidenceShowsChange = jaNoPattern.test(trimmed) || (asksContinuity && /(変更|移行|切り替え|changed|switched|moved|replaced|upgraded)/ui.test(trimmed));
    const isNo = enNoPattern.test(lower) || jaNoPattern.test(trimmed) || evidenceShowsChange;
    return { answer: isNo ? "No" : "Yes", template: "final:yes-no-binary" };
  }
  if (kind === "list") {
    const compact = trimmed.replace(/\s+/g, " ").replace(/;+/g, ",");
    return { answer: compact.slice(0, 220), template: "final:list-compact" };
  }
  if (kind === "multi_hop") {
    const asksCounterfactual = /\bwould\b.+\bif\b|\bif\b.+\bwould\b|\bwithout\b/i.test(normalizeText(question));
    if (asksCounterfactual) {
      // counterfactual: "Likely yes/no" のみ返す（冗長なReason句を除去してprecision向上）
      const conclusionMatch = /^(likely\s+(?:yes|no)|yes|no|unclear)/i.exec(normalizeText(trimmed));
      if (conclusionMatch) {
        const conclusion = conclusionMatch[0].trim();
        return { answer: conclusion.charAt(0).toUpperCase() + conclusion.slice(1), template: "final:counterfactual-short" };
      }
      const withReason = /reason:/i.test(trimmed) ? trimmed : `${compactToSingleSentence(trimmed, 120)} Reason: evidence pending`;
      return { answer: withReason.slice(0, 240).trim(), template: "final:counterfactual-conclusion-reason" };
    }
    // multi_hop: factualと同様の核心フレーズ抽出アプローチを適用
    const questionTokens = tokenize(question);
    const sentences = splitSentences(trimmed).filter((s) => !isLowQualitySentence(s));
    const topSentence = sentences.length > 1
      ? (selectTopSentencesByTfIdf(sentences, question, 1)[0] || compactToSingleSentence(trimmed, 180))
      : (sentences[0] || compactToSingleSentence(trimmed, 180));
    const exactSpan = extractQuestionAwareSpan(question, topSentence, questionTokens);
    if (exactSpan) {
      return { answer: exactSpan.value.slice(0, 180).trim(), template: `final:multi-hop-${exactSpan.strategy}` };
    }
    if (topSentence.length <= 80) {
      return { answer: topSentence.trim(), template: "final:multi-hop-short" };
    }
    const corePhrase = extractCorePhrase(topSentence, questionTokens);
    if (corePhrase.length > 0 && corePhrase.length < topSentence.length * 0.7) {
      return { answer: corePhrase.slice(0, 180).trim(), template: "final:multi-hop-core-phrase" };
    }
    return { answer: topSentence.slice(0, 180).trim(), template: "final:multi-hop-tfidf-1sent" };
  }
  // factual: 文分割→TF-IDFで最も関連度の高い1文を選択し、さらに核心フレーズを抽出
  const questionTokens = tokenize(question);
  const sentences = splitSentences(trimmed).filter((s) => !isLowQualitySentence(s));
  const topSentence = sentences.length > 1
    ? (selectTopSentencesByTfIdf(sentences, question, 1)[0] || compactToSingleSentence(trimmed, 180))
    : (sentences[0] || compactToSingleSentence(trimmed, 180));

  if (!/[.?!]/.test(trimmed) && trimmed.length <= 80) {
    return { answer: trimmed, template: "final:factual-normalized-short" };
  }

  const exactSpan = extractQuestionAwareSpan(question, topSentence, questionTokens);
  if (exactSpan) {
    return { answer: exactSpan.value.slice(0, 180).trim(), template: `final:factual-${exactSpan.strategy}` };
  }

  const corePhrase = extractCorePhrase(topSentence, questionTokens);
  if (corePhrase.length > 0 && corePhrase.length < topSentence.length * 0.85) {
    return { answer: corePhrase.slice(0, 180).trim(), template: "final:factual-core-phrase" };
  }

  // S43-FIX: overlong answer 圧縮 — 日本語の文構造から核心値を抽出
  if (topSentence.length > 40) {
    // 「は X です」パターンから X を抽出
    const jaValueMatch = topSentence.match(/(?:は|が)\s*([^。!?、]{2,30}?)(?:\s*(?:です|でした|になりました|に変更|に移行|を使用))/u);
    if (jaValueMatch?.[1]) {
      return { answer: jaValueMatch[1].trim(), template: "final:factual-ja-value-extract" };
    }
    // 最初の句読点までの部分から question tokens を除いた核心を取る
    const firstClause = topSentence.split(/[。.!?]/)[0]?.trim() || topSentence;
    if (firstClause.length <= 40) {
      return { answer: firstClause, template: "final:factual-first-clause" };
    }
  }

  // 短い文（コアフレーズ抽出が効かなかった場合）はそのまま返す
  if (topSentence.length <= 100) {
    return { answer: topSentence.trim(), template: "final:factual-short" };
  }
  return { answer: topSentence.slice(0, 180).trim(), template: "final:factual-tfidf-top1" };
}

function compactToSingleSentence(text: string, maxLength: number): string {
  const first = text.split(/(?<=[.!?])\s+/)[0]?.trim() || text.trim();
  if (first.length <= maxLength) return first;
  return first.slice(0, maxLength).trim();
}

/** TF-IDF コサイン類似度で文をランク付けしてクエリに最も関連する上位 N 文を返す */
function selectTopSentencesByTfIdf(sentences: string[], query: string, topN: number): string[] {
  if (sentences.length === 0) return [];
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return sentences.slice(0, topN);

  // 各文の TF スコア（クエリトークンとの重複率）＋ 固有名詞ボーナスを計算
  const scored = sentences.map((sentence) => {
    const sentTokens = tokenize(sentence);
    const sentSet = new Set(sentTokens);
    let overlap = 0;
    for (const token of queryTokens) {
      if (sentSet.has(token)) overlap++;
    }
    const tfScore = overlap / Math.max(queryTokens.length, 1);

    // 固有名詞（大文字始まり）・地名・数値を含む文を優先
    const hasProperNoun = /[A-Z][a-z]{2,}/.test(sentence);
    const hasNumber = /\b\d+\b/.test(sentence);
    const properNounBonus = (hasProperNoun ? 0.15 : 0) + (hasNumber ? 0.10 : 0);

    return { sentence, score: tfScore + properNounBonus };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN).map((item) => item.sentence);
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export class HarnessMemLocomoAdapter {
  private readonly sessionId: string;

  constructor(
    private readonly core: HarnessMemCore,
    private readonly options: HarnessLocomoAdapterOptions
  ) {
    this.sessionId = options.session_id || "locomo-session";
  }

  private getPrimeEmbeddingInvoker():
    | ((text: string, mode?: "passage" | "query") => unknown)
    | null {
    const maybeCore = this.core as unknown as {
      primeEmbedding?: (text: string, mode?: "passage" | "query") => unknown;
    };
    if (typeof maybeCore.primeEmbedding !== "function") {
      return null;
    }
    return maybeCore.primeEmbedding.bind(this.core);
  }

  private async primeEmbeddingTexts(
    texts: string[],
    mode: "passage" | "query" = "passage"
  ): Promise<boolean> {
    const invoker = this.getPrimeEmbeddingInvoker();
    if (!invoker) {
      return false;
    }

    const normalized = [...new Set(texts.map((text) => text.trim()).filter((text) => text.length > 0))];
    if (normalized.length === 0) {
      return false;
    }

    try {
      for (const text of normalized) {
        const result = invoker(text, mode);
        if (isPromiseLike(result)) {
          await result;
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  async primeBeforeIngest(sample: LocomoSample): Promise<boolean> {
    const texts = sample.conversation.map((turn) => turn.text);
    return this.primeEmbeddingTexts(texts, "passage");
  }

  async primeBeforeSearch(question: string, options: AnswerQuestionOptions = {}): Promise<boolean> {
    const kind = detectQuestionKind(question, options.category);
    const policy = resolveSearchPolicy(kind, options.category);
    const queries = buildQueryVariants(question, kind, policy, options.category);
    return this.primeEmbeddingTexts(queries, "query");
  }

  async readCacheStats(): Promise<Record<string, unknown> | null> {
    const maybeCore = this.core as unknown as {
      getEmbeddingRuntimeInfo?: () => unknown;
    };
    if (typeof maybeCore.getEmbeddingRuntimeInfo !== "function") {
      return null;
    }
    try {
      const runtime = toRecord(maybeCore.getEmbeddingRuntimeInfo.call(this.core));
      const cacheStats = toRecord(runtime.cacheStats);
      return Object.keys(cacheStats).length > 0 ? cacheStats : null;
    } catch {
      return null;
    }
  }

  ingestSample(sample: LocomoSample): void {
    void this.primeBeforeIngest(sample);
    const baseTs = Date.parse("2026-01-01T00:00:00.000Z");
    sample.conversation.forEach((turn, index) => {
      this.core.recordEvent({
        event_id: `locomo-${this.sessionId}-${sample.sample_id}-${index + 1}`,
        platform: "codex",
        project: this.options.project,
        session_id: this.sessionId,
        event_type: "user_prompt",
        ts: new Date(baseTs + index * 1000).toISOString(),
        payload: {
          content: turn.text,
          speaker: turn.speaker,
          sample_id: sample.sample_id,
        },
        tags: ["locomo", sample.sample_id],
        privacy_tags: [],
      });
    });
  }

  answerQuestion(question: string, options: AnswerQuestionOptions = {}): HarnessLocomoReplayResult {
    const kind = detectQuestionKind(question, options.category);
    const policy = resolveSearchPolicy(kind, options.category);
    const queries = buildQueryVariants(question, kind, policy, options.category);
    void this.primeEmbeddingTexts(queries, "query");

    const merged = new Map<string, SearchItem>();
    let latencyTotal = 0;
    let tokenInputTotal = 0;
    let tokenOutputTotal = 0;
    let tokenTotal = 0;

    queries.forEach((query, queryOrder) => {
      const response = this.core.search({
        query,
        project: this.options.project,
        session_id: this.sessionId,
        include_private: true,
        strict_project: true,
        limit: policy.limit,
      });
      const items = response.items as Array<Record<string, unknown>>;
      const meta = (response.meta || {}) as Record<string, unknown>;
      const tokenEstimate = (meta.token_estimate || {}) as Record<string, unknown>;

      latencyTotal += Number(meta.latency_ms || 0);
      tokenInputTotal += Number(tokenEstimate.estimated_input_tokens || 0);
      tokenOutputTotal += Number(tokenEstimate.estimated_output_tokens || 0);
      tokenTotal += Number(tokenEstimate.estimated_total_tokens || 0);

      items.forEach((item, index) => {
        const id = String(item.id || "").trim();
        if (!id) return;
        const text = String(item.content || item.summary || item.title || "").trim();
        if (!text) return;
        const createdAt = String(item.created_at || "").trim() || undefined;
        const current = merged.get(id);
        if (!current) {
          merged.set(id, { id, text, rank: index, query_order: queryOrder, created_at: createdAt });
          return;
        }
        const isBetter = queryOrder < current.query_order || (queryOrder === current.query_order && index < current.rank);
        if (isBetter) {
          merged.set(id, { id, text, rank: index, query_order: queryOrder, created_at: createdAt || current.created_at });
        }
      });
    });

    const mergedItems = [...merged.values()].sort((lhs, rhs) => {
      if (lhs.query_order !== rhs.query_order) return lhs.query_order - rhs.query_order;
      return lhs.rank - rhs.rank;
    });

    const candidates = buildCandidates(mergedItems, question, kind);
    const extracted = extractAnswerDraft(question, kind, candidates, policy, options.category);
    const normalization = normalizeLocomoAnswer({
      question,
      kind,
      category: options.category,
      rawAnswer: extracted.raw_answer,
      evidence: extracted.selected_candidates.map((candidate) => ({
        id: candidate.id,
        sentence: candidate.sentence,
        score: candidate.score,
        created_at: candidate.created_at,
      })),
      referenceIso: extracted.selected_candidates[0]?.created_at,
    });
    const finalized = finalizeShortAnswer(kind, normalization.normalized, question, options.category);
    const fallback = mergedItems[0]?.text || "";
    const prediction = stripHallucinationFiller(finalized.answer || fallback);
    const candidateIds = mergedItems.map((item) => item.id);

    const answerTrace: HarnessLocomoAnswerTrace = {
      query_variants: queries,
      search_policy: {
        limit: policy.limit,
        variant_cap: policy.variant_cap,
        candidate_limit: policy.candidate_limit,
        quality_floor: policy.quality_floor,
      },
      extraction: {
        strategy: extracted.strategy,
        raw_answer: extracted.raw_answer,
        selected_candidates: extracted.selected_candidates.map((candidate) => ({
          id: candidate.id,
          sentence: candidate.sentence,
          score: Number(candidate.score.toFixed(6)),
          ...(candidate.created_at ? { created_at: candidate.created_at } : {}),
        })),
      },
      normalization: {
        before: extracted.raw_answer,
        after: normalization.normalized,
        notes: normalization.notes,
        ...(normalization.reference_time ? { reference_time: normalization.reference_time } : {}),
        ...(normalization.multi_hop_reasoning
          ? {
              multi_hop_reasoning: normalization.multi_hop_reasoning,
            }
          : {}),
      },
      final_short_answer: prediction,
    };

    return {
      prediction,
      search_hit_count: mergedItems.length,
      candidate_ids: candidateIds,
      selected_evidence_ids: extracted.selected_evidence_ids,
      answer_strategy: `${extracted.strategy} -> normalize -> ${finalized.template}`,
      question_kind: kind,
      answer_trace: answerTrace,
      search_latency_ms: latencyTotal,
      token_estimate_input_tokens: tokenInputTotal,
      token_estimate_output_tokens: tokenOutputTotal,
      token_estimate_total_tokens: tokenTotal,
    };
  }
}
