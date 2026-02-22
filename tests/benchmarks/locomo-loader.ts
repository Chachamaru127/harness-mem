import { readFileSync } from "node:fs";

export interface LocomoTurn {
  speaker: string;
  text: string;
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
  const sessions: Array<{ index: number; turns: unknown[] }> = [];
  for (const [key, value] of Object.entries(conversation)) {
    const match = /^session_(\d+)$/.exec(key);
    if (!match || !Array.isArray(value)) continue;
    sessions.push({ index: Number(match[1]), turns: value });
  }
  sessions.sort((a, b) => a.index - b.index);
  const turns: Array<Record<string, unknown>> = [];
  for (const session of sessions) {
    for (const turn of session.turns) {
      if (isObject(turn)) turns.push(turn);
    }
  }
  return turns;
}

function normalizeConversation(value: unknown): LocomoTurn[] {
  if (Array.isArray(value)) {
    return value
      .map((turn) => {
        const normalized = (turn || {}) as Record<string, unknown>;
        return {
          speaker: String(normalized.speaker || "").trim(),
          text: String(normalized.text || "").trim(),
        };
      })
      .filter((turn) => turn.text.length > 0);
  }

  return extractRawConversationTurns(value)
    .map((turn) => ({
      speaker: String(turn.speaker || "").trim(),
      text: String(turn.text || "").trim(),
    }))
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
