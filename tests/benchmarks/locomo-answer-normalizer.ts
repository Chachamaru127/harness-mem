export type LocomoQuestionKind = "temporal" | "location" | "yes_no" | "multi_hop" | "list" | "factual";

export interface LocomoEvidenceSnippet {
  id: string;
  sentence: string;
  score: number;
  created_at?: string;
}

export interface MultiHopFact {
  id: string;
  fact: string;
  relation: "support" | "cause" | "state" | "result" | "other";
  confidence: number;
}

export interface MultiHopReasoningTrace {
  facts: MultiHopFact[];
  summary: string;
  conclusion: string;
  format: "counterfactual" | "multi_hop";
}

export interface NormalizeLocomoAnswerOptions {
  question: string;
  kind: LocomoQuestionKind;
  category?: string;
  rawAnswer: string;
  evidence: LocomoEvidenceSnippet[];
  referenceIso?: string;
}

export interface NormalizeLocomoAnswerResult {
  normalized: string;
  notes: string[];
  reference_time?: string;
  multi_hop_reasoning?: MultiHopReasoningTrace;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MONTH_LOOKUP: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

const WEEKDAY_LOOKUP: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

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

function normalizeSpaces(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeLower(value: string): string {
  return normalizeSpaces(value).toLowerCase();
}

function asValidDate(value: string | undefined): Date {
  if (!value) return new Date("2026-01-01T00:00:00.000Z");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date("2026-01-01T00:00:00.000Z");
  return parsed;
}

function formatDate(date: Date): string {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

function pickReferenceTime(options: NormalizeLocomoAnswerOptions): string {
  if (options.referenceIso) return asValidDate(options.referenceIso).toISOString();
  const ordered = options.evidence
    .map((item) => item.created_at)
    .filter((value): value is string => Boolean(value))
    .sort();
  if (ordered.length === 0) return "2026-01-01T00:00:00.000Z";
  return asValidDate(ordered[ordered.length - 1]).toISOString();
}

function findExplicitDate(text: string, referenceIso: string): string | null {
  const source = normalizeSpaces(text.replace(/[,]/g, " "));

  const dayMonthYear = /\b(\d{1,2})\s+([a-zA-Z]{3,9})\s+(\d{4})\b/.exec(source);
  if (dayMonthYear) {
    const day = Number(dayMonthYear[1]);
    const month = MONTH_LOOKUP[dayMonthYear[2]?.toLowerCase() || ""];
    const year = Number(dayMonthYear[3]);
    if (Number.isFinite(month) && day >= 1 && day <= 31) {
      return formatDate(new Date(Date.UTC(year, month, day)));
    }
  }

  const monthDayYear = /\b([a-zA-Z]{3,9})\s+(\d{1,2})(?:\s+|,\s*)(\d{4})\b/.exec(source);
  if (monthDayYear) {
    const month = MONTH_LOOKUP[monthDayYear[1]?.toLowerCase() || ""];
    const day = Number(monthDayYear[2]);
    const year = Number(monthDayYear[3]);
    if (Number.isFinite(month) && day >= 1 && day <= 31) {
      return formatDate(new Date(Date.UTC(year, month, day)));
    }
  }

  const dayMonth = /\b(\d{1,2})\s+([a-zA-Z]{3,9})\b/.exec(source);
  if (dayMonth) {
    const day = Number(dayMonth[1]);
    const month = MONTH_LOOKUP[dayMonth[2]?.toLowerCase() || ""];
    const year = asValidDate(referenceIso).getUTCFullYear();
    if (Number.isFinite(month) && day >= 1 && day <= 31) {
      return formatDate(new Date(Date.UTC(year, month, day)));
    }
  }

  const monthDay = /\b([a-zA-Z]{3,9})\s+(\d{1,2})\b/.exec(source);
  if (monthDay) {
    const month = MONTH_LOOKUP[monthDay[1]?.toLowerCase() || ""];
    const day = Number(monthDay[2]);
    const year = asValidDate(referenceIso).getUTCFullYear();
    if (Number.isFinite(month) && day >= 1 && day <= 31) {
      return formatDate(new Date(Date.UTC(year, month, day)));
    }
  }

  const monthYear = /\b([a-zA-Z]{3,9})\s+(\d{4})\b/.exec(source);
  if (monthYear) {
    const month = monthYear[1];
    const year = monthYear[2];
    if (MONTH_LOOKUP[month.toLowerCase()] !== undefined) {
      const canonical = MONTHS[MONTH_LOOKUP[month.toLowerCase()] || 0];
      return `${canonical} ${year}`;
    }
  }

  const yearOnly = /\b(19\d{2}|20\d{2}|21\d{2})\b/.exec(source);
  if (yearOnly) {
    return yearOnly[1] || null;
  }

  return null;
}

function resolveRelativeWeekday(token: string, referenceIso: string): string | null {
  const match = /\b(last|next|this)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.exec(token);
  if (!match) return null;
  const mode = (match[1] || "").toLowerCase();
  const weekday = (match[2] || "").toLowerCase();
  const targetDay = WEEKDAY_LOOKUP[weekday];
  if (targetDay === undefined) return null;

  const ref = asValidDate(referenceIso);
  const currentDay = ref.getUTCDay();
  let shift = 0;

  if (mode === "last") {
    shift = -((currentDay - targetDay + 7) % 7 || 7);
  } else if (mode === "next") {
    shift = (targetDay - currentDay + 7) % 7 || 7;
  } else {
    shift = targetDay - currentDay;
  }

  const resolved = new Date(ref.getTime());
  resolved.setUTCDate(resolved.getUTCDate() + shift);
  return formatDate(resolved);
}

function normalizeTemporalAnswer(text: string, referenceIso: string): { value: string; notes: string[] } {
  const notes: string[] = [];
  const explicit = findExplicitDate(text, referenceIso);
  if (explicit) {
    notes.push("temporal:canonicalized_explicit");
    return { value: explicit, notes };
  }

  const relative = resolveRelativeWeekday(text, referenceIso);
  if (relative) {
    notes.push("temporal:resolved_relative_weekday");
    return { value: relative, notes };
  }

  return { value: normalizeSpaces(text), notes };
}

function normalizeYesNo(text: string, question: string, evidence: LocomoEvidenceSnippet[]): string {
  const source = normalizeLower(text);
  // Strip emphatic constructions that are NOT true negation before testing for negation.
  // "not only", "not just", "not merely", "not simply", "not purely" are additive/emphatic,
  // e.g. "I was not only happy but thrilled" → still affirmative.
  const withoutEmphaticNot = source.replace(/\bnot\s+(?:only|just|merely|simply|purely)\b/g, "");
  if (/\b(no|not|never|none|cannot|can't|won't|didn't|doesn't|isn't|wasn't)\b/.test(withoutEmphaticNot)) return "No";
  if (/(ありません|ないです|ません|違います|やめました|含まれていません)/u.test(text)) return "No";

  const normalizedQuestion = normalizeLower(question);
  const asksExclusive = /\bonly\b/.test(normalizedQuestion) || /だけ/u.test(question);
  if (asksExclusive && /,|、|\band\b/iu.test(text)) return "No";

  const answerCurrentCue = CURRENT_MARKER_REGEX.test(source) || JAPANESE_CURRENT_MARKER_REGEX.test(text);
  const askedCurrentCue = /\b(still|current|now)\b/.test(normalizedQuestion) || /(今も|今の|現在|まだ)/u.test(question);
  const evidenceBlob = normalizeLower([text, ...evidence.map((item) => item.sentence)].join(" "));
  const currentClause = normalizeLower((normalizeSpaces(text).split(/[。.!?]/)[0] || text).trim());
  const focusTerms = (question.match(/\b[A-Za-z][A-Za-z0-9:+.-]*\b/g) || [])
    .map((token) => token.toLowerCase())
    .filter((token) => !["is", "are", "was", "were", "do", "does", "did", "what", "which", "current", "now", "still"].includes(token));
  const timeTerms = (question.match(/\b\d{1,2}:\d{2}\s*(?:jst|utc)?\b/gi) || []).map((token) => token.toLowerCase());
  const hasFocusMention = [...focusTerms, ...timeTerms].some((token) => evidenceBlob.includes(token));
  const currentClauseMatchesFocus = [...focusTerms, ...timeTerms].some((token) => currentClause.includes(token));
  const currentClauseTimeTerms = currentClause.match(/\b\d{1,2}:\d{2}\s*(?:jst|utc)?\b/gi) || [];
  if (askedCurrentCue && answerCurrentCue && [...focusTerms, ...timeTerms].length > 0 && !currentClauseMatchesFocus) {
    return "No";
  }
  if (
    askedCurrentCue &&
    answerCurrentCue &&
    timeTerms.length > 0 &&
    !timeTerms.some((token) => currentClause.includes(token)) &&
    currentClauseTimeTerms.length > 0
  ) {
    return "No";
  }
  if (askedCurrentCue && answerCurrentCue && [...focusTerms, ...timeTerms].length > 0 && !hasFocusMention) {
    return "No";
  }

  return "Yes";
}

function normalizeLocation(text: string): string {
  const source = normalizeSpaces(text.replace(/^[^A-Za-z0-9]+/, ""));
  // "City, State/Country" - two capitalised proper nouns separated by comma
  const cityState = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}),\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,1})\b/.exec(source);
  if (cityState && cityState[1] && cityState[2]) return `${cityState[1].trim()}, ${cityState[2].trim()}`;
  const moved = /\b(?:moved|travel(?:ed)?|lived|stayed)\s+(?:to|in|at|from)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/.exec(source);
  if (moved && moved[1]) return moved[1].trim();
  const capitalized = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/.exec(source);
  if (capitalized && capitalized[1]) return capitalized[1].trim();
  return source.split(/[.?!]/)[0]?.trim() || source;
}

function normalizeList(text: string): string {
  const compact = normalizeSpaces(text.replace(/[.?!]/g, ","));
  const normalized = normalizeListItems(compact);
  if (normalized.length > 0) return normalized;
  return compact;
}

function trimToSingleSentence(text: string, maxLength = 200): string {
  const firstSentence = normalizeSpaces(text).split(/(?<=[.!?])\s+/)[0] || "";
  if (firstSentence.length <= maxLength) return firstSentence;
  return firstSentence.slice(0, maxLength).trim();
}

interface FactualHints {
  wantsNumeric: boolean;
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

function buildFactualHints(question: string): FactualHints {
  const normalized = normalizeLower(question);
  return {
    wantsNumeric: /\b(how many|how much|percent|percentage|ratio|rate|cost|price|amount)\b/.test(normalized) || /(いくら|何円|何ドル|何個|何人|何回|何時間|何分|何日|割合|パーセント)/.test(question),
    wantsLanguage: /\b(language|speak|spoken|programming language)\b/.test(normalized) || /(言語|何語)/.test(question),
    wantsProgrammingLanguage: /\b(programming language|codebase|tech stack|backend|frontend|team use)\b/.test(normalized),
    wantsName: /\b(what is the name|name of|called|named)\b/.test(normalized),
    wantsOrganization: /\b(university|school|college|company|startup|team|project|bakery|institute|lab|laboratory|employer)\b/.test(
      normalized
    ) || /(会社|企業|組織|チーム|大学|学校|研究所)/.test(question),
    wantsRole: /\b(role|job|position|title)\b/.test(normalized) || /(役職|肩書|職種|担当)/.test(question),
    wantsPerson: /\b(who|supervisor|advisor|adviser|manager|mentor|author)\b/.test(normalized) || /(誰|担当者|著者|管理者)/.test(question),
    wantsItem: /\b(item|product|book|dish|pastry|vegetable|vegetables|ingredient|ingredients|crop|crops|feature|features|tool|tools|signal|report)\b/.test(normalized) || /(機能|項目|一覧|ツール|signal|機能は何|レポート)/.test(question),
    wantsListValue: /\b(vegetables|ingredients|items|products|crops|tools|languages|features)\b/.test(normalized) || JAPANESE_LIST_MARKER_REGEX.test(question),
    wantsSingularItem: /\b(which|what)\s+(vegetable|item|product|book|dish|pastry|ingredient|crop)\b/.test(normalized),
    wantsTopic: /\b(topic|thesis|project|using .* for|use .* for|used .* for)\b/.test(normalized),
    wantsCurrent: CURRENT_MARKER_REGEX.test(normalized) || JAPANESE_CURRENT_MARKER_REGEX.test(question),
    wantsPrevious: PREVIOUS_MARKER_REGEX.test(normalized) || JAPANESE_PREVIOUS_MARKER_REGEX.test(question),
    wantsReason: REASON_MARKER_REGEX.test(normalized) || JAPANESE_REASON_MARKER_REGEX.test(question),
    wantsTemporalOrdering: TEMPORAL_ORDER_MARKER_REGEX.test(normalized) || JAPANESE_TEMPORAL_ORDER_MARKER_REGEX.test(question),
  };
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

function findLanguageValue(text: string, prefersProgramming: boolean): string | null {
  const preferred = prefersProgramming
    ? [...PROGRAMMING_LANGUAGES, ...NATURAL_LANGUAGES]
    : [...NATURAL_LANGUAGES, ...PROGRAMMING_LANGUAGES];
  for (const language of preferred) {
    const regex = language === "Go" ? /\bGo\b/u : new RegExp(String.raw`\b${language.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\b`, "iu");
    const match = regex.exec(text);
    if (match?.[0]) return match[0];
  }
  return null;
}

function extractLeadList(text: string): string | null {
  const firstClause = text.split(/[.;!?]/)[0]?.trim() || text.trim();
  const stripped = firstClause.replace(/\b(?:mostly|mainly|especially|currently|right now)\b.*$/i, "").trim();
  const itemPattern = String.raw`[A-Za-z][\p{L}\p{M}-]*(?:\s+[A-Za-z][\p{L}\p{M}-]*){0,2}`;
  const listPattern = new RegExp(
    String.raw`^(${itemPattern}(?:,\s*${itemPattern})*(?:,?\s+and\s+${itemPattern})?)$`,
    "iu"
  );
  const match = listPattern.exec(stripped);
  return match?.[1] ? cleanExtractedSpan(match[1]) : null;
}

function normalizeListItems(value: string): string {
  const rawItems = value
    .replace(/(?:for admins|for admin)$/iu, "")
    .split(/,|、| and /iu)
    .map((item) => stripTrailingJapaneseCopula(item))
    .filter(Boolean);
  return [...new Set(rawItems)].join(", ");
}

function extractJapaneseReasonSpan(text: string): string | null {
  const patterns = [
    /(?:理由|きっかけ)(?:は|になったのは)?\s*([^。!?]+?(?:から|ため|ので))(?:です|でした|だ|だった)?/u,
    /([^。!?]+?(?:から|ため|ので))(?:です|でした|だ|だった)?(?:。|$)/u,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(normalizeSpaces(text));
    if (match?.[1]) return stripTrailingJapaneseCopula(match[1]);
  }
  return null;
}

function extractJapaneseCurrentValue(text: string): string | null {
  const patterns = [
    /今(?:は|の)?\s*([^。!?]+?)\s*(?:を使っています|を使っている|です|でした|にしています|になっています|もサポートしています|が使われています)/u,
    /現在(?:は|の)?\s*([^。!?]+?)\s*(?:を使っています|です|でした|にしています|になっています|もサポートしています)/u,
    /今の[^。!?]*?は\s*([^。!?]+?)(?:です|でした|だ|だった)/u,
    /現在の[^。!?]*?は\s*([^。!?]+?)(?:です|でした|だ|だった)/u,
    /((?:平日(?:の)?\s*)?\d{1,2}:\d{2}\s*[〜~-]\s*\d{1,2}:\d{2}\s*(?:JST|UTC)?)\s*に絞りました/u,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(normalizeSpaces(text));
    if (match?.[1]) return stripTrailingJapaneseCopula(match[1]);
  }
  return null;
}

function extractJapanesePreviousValue(text: string): string | null {
  const patterns = [
    /以前(?:は|の)?\s*([^。!?]+?)\s*(?:でした|です|を使っていました|にしていました)/u,
    /前(?:は|の)?\s*([^。!?]+?)\s*(?:でした|です|を使っていました|にしていました)/u,
    /最初は[^。!?]*?を\s*([^。!?]+?)\s*にしていました/u,
    /最初の[^。!?]*?は\s*([^。!?]+?)\s*だけを対象にしていました/u,
    /元は\s*([^。!?]+?)\s*(?:でした|です|を使っていました|にしていました)/u,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(normalizeSpaces(text));
    if (match?.[1]) return stripTrailingJapaneseCopula(match[1]);
  }
  return null;
}

function extractJapaneseTemporalOrderValue(question: string, text: string): string | null {
  const normalizedQuestion = normalizeSpaces(question);
  const source = normalizeSpaces(text);
  if (/(どちらが先|先に)/u.test(normalizedQuestion)) {
    const match = /([^、,。!?]+?)が先(?:に出ました|に出た|でした|だ)/u.exec(source);
    if (match?.[1]) return stripTrailingJapaneseCopula(match[1]);
  }
  if (/(最後|last)/iu.test(normalizedQuestion)) {
    const match = /([^、,。!?]+?)が最後(?:に出ました|でした|だ)/u.exec(source);
    if (match?.[1]) return stripTrailingJapaneseCopula(match[1]);
  }
  if (/(最初|first)/iu.test(normalizedQuestion)) {
    const match = /([^、,。!?]+?)が最初(?:に出ました|でした|だ)/u.exec(source);
    if (match?.[1]) return stripTrailingJapaneseCopula(match[1]);
  }
  return null;
}

function extractJapaneseListValue(text: string): string | null {
  const patterns = [
    /(?:には|は)\s*([^。!?]+?)\s*を(?:出しました|追加しました|導入しました|含めました)/u,
    /([^。!?]+(?:,|、)\s*[^。!?]+(?:,|、)?\s*[^。!?]+)(?:を出しました|です)/u,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(normalizeSpaces(text));
    if (match?.[1]) return normalizeListItems(match[1]);
  }
  return null;
}

function extractJapaneseObjectValue(text: string): string | null {
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
    if (match?.[1]) return normalizeListItems(stripTrailingJapaneseCopula(match[1]));
  }
  return null;
}

function extractJapaneseSubjectBeforeTopic(question: string, text: string): string | null {
  const normalizedQuestion = normalizeSpaces(question);
  const source = normalizeSpaces(text);
  if (/(の後|あとで|後に)/u.test(normalizedQuestion)) {
    const match = /(?:^|[。.!?]\s*)([^、,。!?]+?)は[^。!?]*(?:の後|あとで|後に)/u.exec(source);
    if (match?.[1]) return stripTrailingJapaneseCopula(match[1]);
  }
  return null;
}

function extractEvidenceBoundedSpan(question: string, text: string, hints = buildFactualHints(question)): string | null {
  if (!text.trim()) return null;

  if (hints.wantsReason) {
    const reason = extractJapaneseReasonSpan(text);
    if (reason) return reason;
  }

  if (hints.wantsCurrent) {
    const current = extractJapaneseCurrentValue(text);
    if (current) return current;
  }

  if (hints.wantsPrevious) {
    const previous = extractJapanesePreviousValue(text);
    if (previous) return previous;
  }

  if (hints.wantsTemporalOrdering) {
    const temporalOrder = extractJapaneseTemporalOrderValue(question, text);
    if (temporalOrder) return temporalOrder;
  }

  if (hints.wantsListValue) {
    const listValue = extractJapaneseListValue(text);
    if (listValue) return listValue;
  }

  if (hints.wantsItem || hints.wantsReason || hints.wantsTopic) {
    const objectValue = extractJapaneseObjectValue(text);
    if (objectValue) return objectValue;
  }

  if (hints.wantsNumeric) {
    const numeric =
      /\b\d{1,2}:\d{2}\s*(?:JST|UTC)?\s*(?:[〜~-]\s*\d{1,2}:\d{2}\s*(?:JST|UTC)?)\b/iu.exec(text) ||
      /平日[^\d]*(\d{1,2}:\d{2}\s*[〜~-]\s*\d{1,2}:\d{2}\s*(?:JST|UTC)?)/u.exec(text) ||
      /\b\d+(?:\.\d+)?\s?%|\$\s?\d+(?:,\d{3})*(?:\.\d+)?|\b\d+(?:\.\d+)?\s+(?:minutes?|hours?|seconds?|days?|weeks?|months?|years?)\b|\b\d+(?:\.\d+)?\b/iu.exec(
        text
      );
    if (numeric?.[0]) return cleanExtractedSpan(numeric[0]);
    if (numeric?.[1]) return cleanExtractedSpan(numeric[1]);
  }

  if (hints.wantsLanguage) {
    const language = findLanguageValue(text, hints.wantsProgrammingLanguage);
    if (language) return language;
  }

  if (hints.wantsName) {
    const named = new RegExp(String.raw`\b(?:called|named|name is)\s+(${ENTITY_SEQUENCE_PATTERN})\b`, "u").exec(text);
    if (named?.[1]) return cleanExtractedSpan(named[1]);
  }

  if (hints.wantsOrganization) {
    const organization = /\b([A-Z][\p{L}\p{M}0-9]*(?:\s+[A-Z][\p{L}\p{M}0-9]*){0,3}\s+(?:University|College|School|Institute|Laboratory|Lab))\b/u.exec(
      text
    );
    if (organization?.[1]) return cleanExtractedSpan(organization[1]);
  }

  if (hints.wantsRole) {
    const role =
      /\b(?:role|job|position|title)\s+(?:at\s+\S+\s+)?(?:is|was)\s+(?:an?\s+)?([a-z][\p{L}\p{M}-]*(?:\s+[a-z][\p{L}\p{M}-]*){0,4}?)(?=\s+(?:focusing|working|specializing|using|building|at|with|on|for)\b|[.,;!?]|$)/iu.exec(
        text
      ) ||
      /\b(?:joined|work(?:ing)?|hired)(?:\s+\S+){0,3}\s+as\s+(?:an?\s+)?([a-z][\p{L}\p{M}-]*(?:\s+[a-z][\p{L}\p{M}-]*){0,4}?)(?=\s+(?:focusing|working|specializing|using|building|at|with|on|for)\b|[.,;!?]|$)/iu.exec(
        text
      );
    if (role?.[1]) return cleanExtractedSpan(role[1], { dropLeadingArticle: true });
  }

  if (hints.wantsPerson) {
    const person = new RegExp(String.raw`\b(?:supervisor|advisor|adviser|manager|mentor|author)\s+is\s+(${ENTITY_SEQUENCE_PATTERN})\b`, "u").exec(
      text
    );
    if (person?.[1]) return cleanExtractedSpan(person[1]);
  }

  if (hints.wantsItem || hints.wantsListValue || hints.wantsSingularItem) {
    const leadList = extractLeadList(text);
    if (leadList) {
      if (hints.wantsSingularItem) {
        return cleanExtractedSpan((leadList.split(/,|\band\b/i)[0] || "").trim(), { dropLeadingArticle: true });
      }
      return leadList;
    }
    const bestSeller = /\b(?:best seller|best-selling item|best selling item)\s+is\s+(?:the\s+)?([a-z][\p{L}\p{M}0-9-]*(?:\s+[a-z][\p{L}\p{M}0-9-]*){0,5})\b/iu.exec(
      text
    );
    if (bestSeller?.[1]) return cleanExtractedSpan(bestSeller[1], { dropLeadingArticle: true });
  }

  if (hints.wantsTopic) {
    const topic =
      /\bfor\s+(?:a\s+|an\s+|the\s+)?([a-z][\p{L}\p{M}0-9-]*(?:\s+[a-z][\p{L}\p{M}0-9-]*){0,6}?)(?=\s+(?:at|in|with|using|from|near|during)\b|[.,;!?]|$)/iu.exec(
        text
      ) ||
      /\bon\s+([a-z][\p{L}\p{M}0-9-]*(?:\s+[a-z][\p{L}\p{M}0-9-]*){0,8}?)(?=\s+(?:at|in|with|using|from|near|during)\b|[.,;!?]|$)/iu.exec(
        text
      );
    if (topic?.[1]) {
      return cleanExtractedSpan(topic[1], { dropLeadingArticle: true }).replace(/^(?:my|our|their|his|her)\s+/i, "");
    }
  }

  const entities = collectNamedEntities(text);
  if (entities.length > 0 && (hints.wantsName || hints.wantsPerson || (hints.wantsOrganization && !hints.wantsRole && !hints.wantsTopic))) {
    return entities.sort((lhs, rhs) => rhs.length - lhs.length)[0] || null;
  }

  const subjectBeforeTopic = extractJapaneseSubjectBeforeTopic(question, text);
  if (subjectBeforeTopic) return subjectBeforeTopic;

  return null;
}

function normalizeFactual(options: NormalizeLocomoAnswerOptions): { value: string; notes: string[] } {
  const hints = buildFactualHints(options.question);
  const sources = [...options.evidence.map((item) => item.sentence), options.rawAnswer].map((value) => normalizeSpaces(value)).filter(Boolean);
  const dedupedSources = [...new Set(sources)];

  for (const source of dedupedSources) {
    const span = extractEvidenceBoundedSpan(options.question, source, hints);
    if (span) {
      return { value: span, notes: ["factual:evidence_bounded_span"] };
    }
  }

  return {
    value: trimToSingleSentence(options.rawAnswer, 220),
    notes: ["factual:single_sentence_trim"],
  };
}

function buildFactsFromEvidence(evidence: LocomoEvidenceSnippet[]): MultiHopFact[] {
  return evidence.slice(0, 5).map((item) => {
    const source = normalizeLower(item.sentence);
    let relation: MultiHopFact["relation"] = "other";
    // English causal markers
    if (/\bbecause\b|\bsince\b|\bdue to\b/.test(source)) relation = "cause";
    // S43-008: Japanese causal markers — ので/から/ため は全て cause として扱う
    else if (/(ので|ので|のため|から|ために|ため、|ため$)/.test(item.sentence)) relation = "cause";
    else if (/\bsupport\b|\bencourag\b|\bhelp\b|\bcourage\b/.test(source)) relation = "support";
    else if (/(勧め|推薦|紹介|サポート|励まし)/.test(item.sentence)) relation = "support";
    else if (/\btherefore\b|\bso\b|\bresult\b/.test(source)) relation = "result";
    else if (/\bwas\b|\bwere\b|\bis\b|\bare\b/.test(source)) relation = "state";
    return {
      id: item.id,
      fact: trimToSingleSentence(item.sentence, 160),
      relation,
      confidence: Number(Math.max(0, Math.min(1, item.score)).toFixed(4)),
    };
  });
}

/** S43-008: causal/support facts を優先してsummaryを構築する */
function buildMultiHopSummary(facts: MultiHopFact[], question?: string): string {
  if (facts.length === 0) return "";
  const isWhyQuestion = question
    ? /\bwhy\b|\bwhat.*made\b|\bwhat.*motivated\b|\bwhat.*led\b/i.test(question) ||
      /(なぜ|どうして|理由|きっかけ)/.test(question)
    : false;

  if (isWhyQuestion) {
    // "why" 系: cause → support → other の順で優先
    const causal = facts.find((f) => f.relation === "cause" || f.relation === "support");
    if (causal) return causal.fact;
  }

  // 非 why: 最高スコアの1 fact だけを返す（2文連結しない）
  const best = facts.reduce((a, b) => (a.confidence >= b.confidence ? a : b));
  return best.fact;
}

function isCounterfactualQuestion(question: string): boolean {
  const source = normalizeLower(question);
  return /\bwould\b.+\bif\b/.test(source) || /\bif\b.+\bwould\b/.test(source) || /\bwithout\b/.test(source);
}

function inferCounterfactualConclusion(question: string, facts: MultiHopFact[]): string {
  const source = normalizeLower(question);
  const hasSupportDependency = facts.some((fact) => fact.relation === "support");
  const hasStrongIntent = facts.some((fact) => /\bplanned\b|\bdecided\b|\bcommitted\b/.test(normalizeLower(fact.fact)));
  if (hasSupportDependency && /\bwithout\b|\bhadn't\b|\bnot received\b/.test(source)) {
    return "Likely no";
  }
  if (hasStrongIntent) {
    return "Likely yes";
  }
  return "Unclear";
}

function normalizeMultiHop(options: NormalizeLocomoAnswerOptions): {
  value: string;
  reasoning: MultiHopReasoningTrace;
  notes: string[];
} {
  const facts = buildFactsFromEvidence(options.evidence);
  const summary = buildMultiHopSummary(facts, options.question);
  if (isCounterfactualQuestion(options.question)) {
    const conclusion = inferCounterfactualConclusion(options.question, facts);
    const reason = summary || trimToSingleSentence(options.rawAnswer, 160);
    return {
      value: `${conclusion}. Reason: ${reason}`.trim(),
      reasoning: {
        facts,
        summary: reason,
        conclusion,
        format: "counterfactual",
      },
      notes: ["multi_hop:counterfactual_conclusion_reason"],
    };
  }
  // S43-008: summary はすでに1文以内。rawAnswerからのfallbackも1文に制限する
  const synthesized = summary || trimToSingleSentence(options.rawAnswer, 200);
  // drop filler transitions from multi-sentence raw answers
  const compressed = synthesized
    .replace(/\b(additionally|furthermore|moreover|also,|in addition,)\b\s*/gi, "")
    .trim();
  return {
    value: compressed,
    reasoning: {
      facts,
      summary: compressed,
      conclusion: compressed,
      format: "multi_hop",
    },
    notes: ["multi_hop:two_stage_fact_then_summary"],
  };
}

export function normalizeLocomoAnswer(options: NormalizeLocomoAnswerOptions): NormalizeLocomoAnswerResult {
  const referenceIso = pickReferenceTime(options);

  if (options.kind === "temporal") {
    const orderedValue = extractJapaneseTemporalOrderValue(options.question, options.rawAnswer);
    if (orderedValue) {
      return {
        normalized: orderedValue,
        notes: ["temporal:ordinal_item_extract"],
        reference_time: referenceIso,
      };
    }
    const temporal = normalizeTemporalAnswer(options.rawAnswer, referenceIso);
    return {
      normalized: temporal.value,
      notes: temporal.notes,
      reference_time: referenceIso,
    };
  }

  if (options.kind === "location") {
    return {
      normalized: normalizeLocation(options.rawAnswer),
      notes: ["location:entity_extract"],
      reference_time: referenceIso,
    };
  }

  if (options.kind === "yes_no") {
    return {
      normalized: normalizeYesNo(options.rawAnswer, options.question, options.evidence),
      notes: ["yes_no:binary_decision"],
      reference_time: referenceIso,
    };
  }

  if (options.kind === "list") {
    return {
      normalized: normalizeList(options.rawAnswer),
      notes: ["list:compact_unique_items"],
      reference_time: referenceIso,
    };
  }

  if (options.kind === "multi_hop") {
    const multiHop = normalizeMultiHop(options);
    return {
      normalized: multiHop.value,
      notes: multiHop.notes,
      reference_time: referenceIso,
      multi_hop_reasoning: multiHop.reasoning,
    };
  }

  const factual = normalizeFactual(options);
  return {
    normalized: factual.value,
    notes: factual.notes,
    reference_time: referenceIso,
  };
}
