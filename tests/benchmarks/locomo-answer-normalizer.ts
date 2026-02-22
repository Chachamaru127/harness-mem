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

function normalizeYesNo(text: string): string {
  const source = normalizeLower(text);
  if (/\b(no|not|never|none|cannot|can't|won't|didn't|doesn't|isn't|wasn't)\b/.test(source)) return "No";
  return "Yes";
}

function normalizeLocation(text: string): string {
  const source = normalizeSpaces(text.replace(/^[^A-Za-z0-9]+/, ""));
  const moved = /\b(?:moved|travel(?:ed)?|lived|stayed)\s+(?:to|in|at|from)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/.exec(source);
  if (moved && moved[1]) return moved[1].trim();
  const capitalized = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/.exec(source);
  if (capitalized && capitalized[1]) return capitalized[1].trim();
  return source.split(/[.?!]/)[0]?.trim() || source;
}

function normalizeList(text: string): string {
  const compact = normalizeSpaces(text.replace(/[.?!]/g, ","));
  const rawItems = compact.split(/,| and /i).map((item) => normalizeSpaces(item)).filter(Boolean);
  const seen = new Set<string>();
  const items: string[] = [];
  for (const item of rawItems) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  if (items.length === 0) return compact;
  return items.slice(0, 5).join(", ");
}

function trimToSingleSentence(text: string, maxLength = 200): string {
  const firstSentence = normalizeSpaces(text).split(/(?<=[.!?])\s+/)[0] || "";
  if (firstSentence.length <= maxLength) return firstSentence;
  return firstSentence.slice(0, maxLength).trim();
}

function buildFactsFromEvidence(evidence: LocomoEvidenceSnippet[]): MultiHopFact[] {
  return evidence.slice(0, 5).map((item) => {
    const source = normalizeLower(item.sentence);
    let relation: MultiHopFact["relation"] = "other";
    if (/\bbecause\b|\bsince\b|\bdue to\b/.test(source)) relation = "cause";
    else if (/\bsupport\b|\bencourag\b|\bhelp\b|\bcourage\b/.test(source)) relation = "support";
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

function buildMultiHopSummary(facts: MultiHopFact[]): string {
  if (facts.length === 0) return "";
  return facts
    .slice(0, 2)
    .map((fact) => fact.fact)
    .join(" ");
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
  const summary = buildMultiHopSummary(facts);
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
  const synthesized = summary || trimToSingleSentence(options.rawAnswer, 200);
  return {
    value: synthesized,
    reasoning: {
      facts,
      summary: synthesized,
      conclusion: synthesized,
      format: "multi_hop",
    },
    notes: ["multi_hop:two_stage_fact_then_summary"],
  };
}

export function normalizeLocomoAnswer(options: NormalizeLocomoAnswerOptions): NormalizeLocomoAnswerResult {
  const referenceIso = pickReferenceTime(options);

  if (options.kind === "temporal") {
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
      normalized: normalizeYesNo(options.rawAnswer),
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

  if (options.kind === "multi_hop" || options.category === "cat-3") {
    const multiHop = normalizeMultiHop(options);
    return {
      normalized: multiHop.value,
      notes: multiHop.notes,
      reference_time: referenceIso,
      multi_hop_reasoning: multiHop.reasoning,
    };
  }

  return {
    normalized: trimToSingleSentence(options.rawAnswer, 220),
    notes: ["factual:single_sentence_trim"],
    reference_time: referenceIso,
  };
}

