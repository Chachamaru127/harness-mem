import { readFileSync } from "node:fs";

export interface LocomoTurn {
  speaker: string;
  text: string;
  /** ISO timestamp resolved from the session date when available */
  timestamp?: string;
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
  september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

/**
 * Parses LoCoMo session date strings like "1:56 pm on 8 May, 2023" into an ISO
 * timestamp. Returns undefined when the format is not recognized.
 */
export function parseLocomoSessionDate(raw: unknown): string | undefined {
  const value = String(raw || "").trim();
  if (!value) return undefined;
  const match =
    /(?:(\d{1,2}):(\d{2})\s*(am|pm)\s+on\s+)?(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})/i.exec(value);
  if (!match) return undefined;
  const [, hh, mm, ampm, day, monthName, year] = match;
  const month = MONTHS[(monthName || "").toLowerCase()];
  if (month == null) return undefined;
  let hour = hh != null ? Number(hh) : 0;
  const minute = mm != null ? Number(mm) : 0;
  if (ampm) {
    const lower = ampm.toLowerCase();
    if (lower === "pm" && hour < 12) hour += 12;
    if (lower === "am" && hour === 12) hour = 0;
  }
  const date = new Date(Date.UTC(Number(year), month, Number(day), hour, minute, 0));
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export interface LocomoQuestion {
  question_id: string;
  question: string;
  answer: string;
  category: string;
}

export interface LocomoSample {
  sample_id: string;
  conversation: LocomoTurn[];
  qa: LocomoQuestion[];
}

export interface LocomoValidationResult {
  ok: boolean;
  errors: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasNonEmptyText(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim().length > 0;
}

function normalizeCategory(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^cat-\d+$/i.test(raw)) return raw.toLowerCase();
  if (/^\d+$/.test(raw)) return `cat-${raw}`;
  return raw;
}

function normalizeAnswer(entry: Record<string, unknown>): string {
  if (hasNonEmptyText(entry.answer)) {
    return String(entry.answer).trim();
  }
  if (hasNonEmptyText(entry.adversarial_answer)) {
    return String(entry.adversarial_answer).trim();
  }
  return "";
}

function extractRawConversationTurns(conversation: unknown): Array<Record<string, unknown>> {
  if (!isObject(conversation)) return [];
  const sessions: Array<{ index: number; turns: unknown[]; timestamp?: string }> = [];
  for (const [key, value] of Object.entries(conversation)) {
    const match = /^session_(\d+)$/.exec(key);
    if (!match || !Array.isArray(value)) continue;
    const index = Number(match[1]);
    const timestamp = parseLocomoSessionDate(conversation[`session_${index}_date_time`]);
    sessions.push({ index, turns: value, timestamp });
  }
  sessions.sort((a, b) => a.index - b.index);
  const turns: Array<Record<string, unknown>> = [];
  for (const session of sessions) {
    for (const turn of session.turns) {
      if (isObject(turn)) {
        turns.push(session.timestamp ? { ...turn, __session_timestamp: session.timestamp } : turn);
      }
    }
  }
  return turns;
}

function normalizeConversation(value: unknown): LocomoTurn[] {
  if (Array.isArray(value)) {
    return value
      .map((turn) => {
        const normalized = (turn || {}) as Record<string, unknown>;
        const timestamp =
          typeof normalized.timestamp === "string" && normalized.timestamp.trim().length > 0
            ? normalized.timestamp.trim()
            : undefined;
        return {
          speaker: String(normalized.speaker || "").trim(),
          text: String(normalized.text || "").trim(),
          ...(timestamp ? { timestamp } : {}),
        };
      })
      .filter((turn) => turn.text.length > 0);
  }

  return extractRawConversationTurns(value)
    .map((turn) => {
      const timestamp = typeof turn.__session_timestamp === "string" ? turn.__session_timestamp : undefined;
      return {
        speaker: String(turn.speaker || "").trim(),
        text: String(turn.text || "").trim(),
        ...(timestamp ? { timestamp } : {}),
      };
    })
    .filter((turn) => turn.text.length > 0);
}

function normalizeQa(value: unknown, sampleId: string): LocomoQuestion[] {
  if (!Array.isArray(value)) return [];
  return value.map((qaEntry, qaIndex) => {
    const normalized = (qaEntry || {}) as Record<string, unknown>;
    const questionId = String(normalized.question_id || "").trim() || `${sampleId}-q${qaIndex + 1}`;
    return {
      question_id: questionId,
      question: String(normalized.question || "").trim(),
      answer: normalizeAnswer(normalized),
      category: normalizeCategory(normalized.category),
    };
  });
}

function normalizeSample(entry: unknown, sampleIndex: number): LocomoSample {
  const source = isObject(entry) ? entry : {};
  const sampleId = hasNonEmptyText(source.sample_id) ? String(source.sample_id).trim() : `sample-${sampleIndex + 1}`;
  return {
    sample_id: sampleId,
    conversation: normalizeConversation(source.conversation),
    qa: normalizeQa(source.qa, sampleId),
  };
}

export function validateLocomoDataset(raw: unknown): LocomoValidationResult {
  const errors: string[] = [];
  if (!Array.isArray(raw)) {
    return { ok: false, errors: ["dataset must be an array"] };
  }

  raw.forEach((entry, sampleIndex) => {
    if (!isObject(entry)) {
      errors.push(`sample[${sampleIndex}] must be an object`);
      return;
    }

    const sampleId = typeof entry.sample_id === "string" ? entry.sample_id.trim() : "";
    const conversation = entry.conversation;
    const hasNormalizedConversation = Array.isArray(conversation) && conversation.length > 0;
    const hasRawConversation = extractRawConversationTurns(conversation).length > 0;

    if (Array.isArray(conversation) && !sampleId) {
      errors.push(`sample[${sampleIndex}] missing sample_id`);
    }

    if (!hasNormalizedConversation && !hasRawConversation) {
      errors.push(`sample[${sampleIndex}] missing conversation`);
    }

    const qa = entry.qa;
    if (!Array.isArray(qa) || qa.length === 0) {
      errors.push(`sample[${sampleIndex}] missing qa`);
    } else {
      qa.forEach((item, qaIndex) => {
        if (!isObject(item)) {
          errors.push(`sample[${sampleIndex}].qa[${qaIndex}] must be an object`);
          return;
        }
        const category = normalizeCategory(item.category);
        if (!category) {
          errors.push(`sample[${sampleIndex}].qa[${qaIndex}] missing category`);
        }
      });
    }
  });

  return { ok: errors.length === 0, errors };
}

export function loadLocomoDataset(datasetPath: string): LocomoSample[] {
  const raw = JSON.parse(readFileSync(datasetPath, "utf8")) as unknown;
  const normalized = Array.isArray(raw) ? raw.map((entry, sampleIndex) => normalizeSample(entry, sampleIndex)) : raw;
  const validation = validateLocomoDataset(normalized);
  if (!validation.ok || !Array.isArray(normalized)) {
    throw new Error(`invalid LOCOMO dataset: ${validation.errors.join("; ")}`);
  }
  return normalized;
}
