import { HarnessMemCore } from "../../memory-server/src/core/harness-mem-core";
import {
  normalizeLocomoAnswer,
  type LocomoEvidenceSnippet,
  type LocomoQuestionKind,
  type MultiHopReasoningTrace,
} from "./locomo-answer-normalizer";
import { type LocomoSample } from "./locomo-loader";

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

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function detectQuestionKind(question: string, category?: string): QuestionKind {
  const normalized = normalizeText(question);
  if (category === "cat-3" || /\bwould\b.+\bif\b/.test(normalized) || /\blikely\b/.test(normalized)) {
    return "multi_hop";
  }
  if (
    category === "cat-2" ||
    /\bwhen\b/.test(normalized) ||
    /\bhow long\b/.test(normalized) ||
    /\bhow often\b/.test(normalized) ||
    /\bwhat year\b/.test(normalized) ||
    /\bwhat month\b/.test(normalized) ||
    /\bwhat date\b/.test(normalized)
  ) {
    return "temporal";
  }
  if (normalized.startsWith("where ") || normalized.includes(" where ")) {
    return "location";
  }
  if (/^(is|are|was|were|do|does|did|has|have|had|can|could|would|should|will)\b/.test(normalized)) {
    return "yes_no";
  }
  if (/\bwhat activities\b|\bwhat books\b|\bwhat fields\b|\bwhich\b|\blist\b/.test(normalized)) {
    return "list";
  }
  return "factual";
}

function resolveSearchPolicy(kind: QuestionKind, category?: string): SearchPolicy {
  if (category === "cat-3" || kind === "multi_hop") {
    return { limit: 18, variant_cap: 7, candidate_limit: 5, quality_floor: 0.2 };
  }
  if (category === "cat-2" || kind === "temporal") {
    return { limit: 16, variant_cap: 6, candidate_limit: 5, quality_floor: 0.2 };
  }
  if (category === "cat-4") {
    return { limit: 14, variant_cap: 6, candidate_limit: 5, quality_floor: 0.18 };
  }
  if (kind === "list") {
    return { limit: 13, variant_cap: 6, candidate_limit: 5, quality_floor: 0.16 };
  }
  if (kind === "yes_no") {
    return { limit: 11, variant_cap: 5, candidate_limit: 5, quality_floor: 0.14 };
  }
  return { limit: 12, variant_cap: 5, candidate_limit: 5, quality_floor: 0.14 };
}

function buildQueryVariants(question: string, kind: QuestionKind, policy: SearchPolicy, category?: string): string[] {
  const variants = new Set<string>();
  const normalizedQuestion = question.trim();
  const keywords = tokenize(question).slice(0, 10);
  const keyPhrase = keywords.join(" ");

  if (normalizedQuestion) variants.add(normalizedQuestion);
  if (keyPhrase.length > 0) variants.add(keyPhrase);
  if (keywords.length >= 3) variants.add(`${keywords.slice(0, 3).join(" ")} key detail`);
  variants.add(`${keyPhrase} evidence summary`.trim());

  if (kind === "temporal") {
    variants.add(`${keyPhrase} date time timeline chronology`.trim());
    variants.add(`${keyPhrase} before after calendar`.trim());
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
  }
  if (kind === "multi_hop") {
    variants.add(`${keyPhrase} reason because causal dependency`.trim());
    variants.add(`${keyPhrase} supporting evidence chain`.trim());
  }

  if (category === "cat-2") {
    variants.add(`${keyPhrase} temporal context anchor`.trim());
  }
  if (category === "cat-3") {
    variants.add(`${keyPhrase} counterfactual if without support`.trim());
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

function extractTemporalPhrase(text: string): string | null {
  const patterns = [
    /\b(?:the\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:before|after)\s+[^.,;!?]+/i,
    /\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}\b/i,
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,\s*\d{4}|\s+\d{4})?\b/i,
    /\b(?:last|next|this)\s+(?:week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
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

function extractLocationPhrase(text: string): string | null {
  const patterns = [
    /\bmoved\s+to\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/,
    /\bmoved\s+from\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/,
    /\b(?:in|at|from|to)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function isLowQualitySentence(sentence: string): boolean {
  const source = normalizeText(sentence);
  if (!source || source.length < 8 || source.length > 260) return true;
  if (/^(i think|maybe|not sure|let me|hmm|uh|um)\b/.test(source)) return true;
  const tokenCount = source.split(" ").filter(Boolean).length;
  return tokenCount < 3;
}

function sentenceScore(
  sentence: string,
  questionTokens: string[],
  kind: QuestionKind,
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
  if (kind === "temporal" && extractTemporalPhrase(sentence)) score += 0.22;
  if (kind === "location" && extractLocationPhrase(sentence)) score += 0.2;
  if (kind === "yes_no" && /\bno\b|\bnot\b|\bnever\b|\byes\b/i.test(sentence)) score += 0.12;
  if (kind === "multi_hop" && /\bbecause\b|\bsince\b|\bsupport\b|\bmotivat/i.test(sentence)) score += 0.14;
  return score;
}

function buildCandidates(items: SearchItem[], question: string, kind: QuestionKind): CandidateSnippet[] {
  const questionTokens = tokenize(question);
  const candidates: CandidateSnippet[] = [];
  for (const item of items) {
    const sentences = splitSentences(item.text);
    for (const sentence of sentences) {
      const cleaned = conversationFillerTrim(sentence);
      if (!cleaned || isLowQualitySentence(cleaned)) continue;
      candidates.push({
        id: item.id,
        sentence: cleaned,
        score: sentenceScore(cleaned, questionTokens, kind, item.rank, item.query_order),
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

function extractAnswerDraft(
  kind: QuestionKind,
  candidates: CandidateSnippet[],
  policy: SearchPolicy,
  category?: string
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
    const phrase = extractTemporalPhrase(mergedTop) || extractTemporalPhrase(topN[0]?.sentence || "");
    return {
      raw_answer: phrase || mergedTop,
      selected_candidates: topN,
      selected_evidence_ids: selectedEvidenceIds,
      strategy: "extract:temporal-candidates",
    };
  }

  if (kind === "location") {
    const location = extractLocationPhrase(mergedTop) || extractLocationPhrase(topN[0]?.sentence || "");
    return {
      raw_answer: location || topN[0]?.sentence || "",
      selected_candidates: topN,
      selected_evidence_ids: selectedEvidenceIds,
      strategy: "extract:location-candidates",
    };
  }

  if (kind === "yes_no") {
    const withNegation = topN.find((item) => /\bno\b|\bnot\b|\bnever\b|\bnone\b/i.test(item.sentence));
    const withAffirmation = topN.find((item) => /\byes\b|\bdefinitely\b|\bconfirmed\b/i.test(item.sentence));
    const raw = withNegation?.sentence || withAffirmation?.sentence || topN[0]?.sentence || "";
    return {
      raw_answer: raw,
      selected_candidates: topN,
      selected_evidence_ids: selectedEvidenceIds,
      strategy: "extract:yes-no-candidates",
    };
  }

  if (kind === "multi_hop" || category === "cat-3") {
    return {
      raw_answer: mergedTop,
      selected_candidates: topN,
      selected_evidence_ids: selectedEvidenceIds,
      strategy: "extract:multi-hop-facts-json",
    };
  }

  if (kind === "list") {
    return {
      raw_answer: topN.map((candidate) => candidate.sentence).join(", "),
      selected_candidates: topN,
      selected_evidence_ids: selectedEvidenceIds,
      strategy: "extract:list-candidates",
    };
  }

  return {
    raw_answer: topN[0]?.sentence || "",
    selected_candidates: topN,
    selected_evidence_ids: selectedEvidenceIds,
    strategy: "extract:factual-top-candidate",
  };
}

function finalizeShortAnswer(
  kind: QuestionKind,
  normalized: string,
  question: string,
  category?: string
): FinalAnswerDraft {
  const trimmed = normalized.trim();
  if (!trimmed) {
    return { answer: "", template: "final:empty" };
  }
  if (kind === "temporal") {
    return { answer: trimmed, template: "final:temporal-short" };
  }
  if (kind === "location") {
    return { answer: trimmed.split(/[.?!]/)[0]?.trim() || trimmed, template: "final:location-short" };
  }
  if (kind === "yes_no") {
    const lower = normalizeText(trimmed);
    return { answer: lower.startsWith("no") ? "No" : "Yes", template: "final:yes-no-binary" };
  }
  if (kind === "list") {
    const compact = trimmed.replace(/\s+/g, " ").replace(/;+/g, ",");
    return { answer: compact.slice(0, 220), template: "final:list-compact" };
  }
  if (kind === "multi_hop" || category === "cat-3") {
    const asksCounterfactual = /\bwould\b.+\bif\b|\bif\b.+\bwould\b|\bwithout\b/i.test(normalizeText(question));
    if (asksCounterfactual) {
      const withReason = /reason:/i.test(trimmed) ? trimmed : `${compactToSingleSentence(trimmed, 120)} Reason: evidence pending`;
      return { answer: withReason.slice(0, 240).trim(), template: "final:counterfactual-conclusion-reason" };
    }
    return { answer: compactToSingleSentence(trimmed, 220), template: "final:multi-hop-one-sentence" };
  }
  return { answer: compactToSingleSentence(trimmed, 220), template: "final:factual-short" };
}

function compactToSingleSentence(text: string, maxLength: number): string {
  const first = text.split(/(?<=[.!?])\s+/)[0]?.trim() || text.trim();
  if (first.length <= maxLength) return first;
  return first.slice(0, maxLength).trim();
}

export class HarnessMemLocomoAdapter {
  private readonly sessionId: string;

  constructor(
    private readonly core: HarnessMemCore,
    private readonly options: HarnessLocomoAdapterOptions
  ) {
    this.sessionId = options.session_id || "locomo-session";
  }

  ingestSample(sample: LocomoSample): void {
    const baseTs = Date.parse("2026-01-01T00:00:00.000Z");
    sample.conversation.forEach((turn, index) => {
      this.core.recordEvent({
        event_id: `locomo-${sample.sample_id}-${index + 1}`,
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
    const extracted = extractAnswerDraft(kind, candidates, policy, options.category);
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
    const prediction = finalized.answer || fallback;
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
