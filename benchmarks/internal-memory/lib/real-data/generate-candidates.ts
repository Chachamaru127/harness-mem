import type { BenchmarkCase, Competency, LanguageProfile } from "../types";
import type { CorpusRound } from "../export-corpus";
import type { CandidateCase } from "./types";

function extractKeywords(content: string, max = 3): string[] {
  const words = content
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w.slice(0, 48));
    if (out.length >= max) break;
  }
  return out;
}

function makeQuery(
  content: string,
  lang: LanguageProfile,
  competency: Competency,
  caseSeq?: number,
): string {
  const kw = extractKeywords(content, 2);
  const tag = caseSeq !== undefined ? ` (#${caseSeq})` : "";
  if (competency === "CR") {
    return lang === "en"
      ? `What is the current/latest value after the update${tag}?`
      : `更新後の最新の値は${tag}？`;
  }
  if (competency === "TTL") {
    return lang === "en"
      ? `Following the recent correction, what should we use now${tag}?`
      : `直前の訂正を反映すると、今は何を使う${tag}？`;
  }
  if (competency === "LRU") {
    return lang === "en"
      ? `Summarize the key decision across these sessions${tag}.`
      : `これまでのセッションを踏まえた要点${tag}は？`;
  }
  if (lang === "en") return `What was decided about this topic${tag}?`;
  if (lang === "mixed") return `この topic について何を決めた${tag}？`;
  return `この件について覚えている内容${tag}は？`;
}

function layerForLang(lang: LanguageProfile): BenchmarkCase["layer"] {
  if (lang === "mixed") return "mixed_coding";
  if (lang === "en") return "public_compatible";
  return "ja_coding";
}

function buildArCase(round: CorpusRound, turnIdx: number, seq: number): CandidateCase | null {
  const turn = round.turns[turnIdx];
  if (!turn || turn.content.length < 30) return null;
  const lang = round.language_hint;
  const memId = `real-ar-${seq}-m1`;
  return {
    case_id: `real-ar-${String(seq).padStart(3, "0")}`,
    layer: layerForLang(lang),
    category: lang === "mixed" ? "real_mixed_ar" : "real_ar",
    competency: "AR",
    language_profile: lang,
    project: `bench-real-${round.project.slice(0, 24)}`,
    memories: [{ id: memId, content: turn.content, timestamp: round.timestamp }],
    query: makeQuery(turn.content, lang, "AR", seq),
    relevant_ids: [memId],
    expected_keywords: extractKeywords(turn.content),
    source_round_ids: [round.round_id],
    generation_model: "deterministic-corpus",
  };
}

function buildCrCase(rounds: CorpusRound[], seq: number, offset = 0): CandidateCase | null {
  const slice = rounds.slice(offset);
  const round =
    slice.find((r) => r.turns.some((t) => t.supersedes)) ??
    slice.find((r) => r.turns.length >= 2);
  if (!round) return null;
  const oldTurn = round.turns.find((t) => t.supersedes) ?? round.turns[0];
  const newTurn =
    round.turns.find((t) => t.supersedes && t !== oldTurn) ??
    round.turns[1] ??
    round.turns[round.turns.length - 1];
  if (!oldTurn?.content || !newTurn?.content) return null;
  if (oldTurn.content.length < 30 || newTurn.content.length < 30) return null;
  if (oldTurn.content === newTurn.content) return null;
  const lang = round.language_hint;
  const oldId = `real-cr-${seq}-old`;
  const newId = `real-cr-${seq}-new`;
  return {
    case_id: `real-cr-${String(seq).padStart(3, "0")}`,
    layer: layerForLang(lang),
    category: "real_conflict_resolution",
    competency: "CR",
    language_profile: lang,
    project: `bench-real-${round.project.slice(0, 24)}`,
    memories: [
      { id: oldId, content: oldTurn.content, timestamp: round.timestamp },
      { id: newId, content: newTurn.content, timestamp: round.timestamp },
    ],
    query: makeQuery(newTurn.content, lang, "CR", seq),
    relevant_ids: [newId],
    expected_keywords: extractKeywords(newTurn.content),
    source_round_ids: [round.round_id],
    generation_model: "deterministic-corpus",
  };
}

function buildTtlCase(round: CorpusRound, seq: number): CandidateCase | null {
  if (round.turns.length < 2) return null;
  const instruction = round.turns[0];
  const follow = round.turns[1];
  if (!instruction?.content || instruction.content.length < 30) return null;
  if (!follow?.content || follow.content.length < 30) return null;
  const lang = round.language_hint;
  const instrId = `real-ttl-${seq}-instr`;
  const followId = `real-ttl-${seq}-follow`;
  return {
    case_id: `real-ttl-${String(seq).padStart(3, "0")}`,
    layer: layerForLang(lang),
    category: "real_test_time_learning",
    competency: "TTL",
    language_profile: lang,
    project: `bench-real-${round.project.slice(0, 24)}`,
    memories: [
      { id: instrId, content: instruction.content, timestamp: round.timestamp },
      { id: followId, content: follow.content, timestamp: round.timestamp },
    ],
    query: makeQuery(follow.content, lang, "TTL", seq),
    relevant_ids: [followId],
    expected_keywords: extractKeywords(follow.content),
    source_round_ids: [round.round_id],
    generation_model: "deterministic-corpus",
  };
}

function buildLruCase(rounds: CorpusRound[], seq: number): CandidateCase | null {
  if (rounds.length < 2) return null;
  const a = rounds[0];
  const b = rounds[1];
  const contentA = a.turns[0]?.content ?? "";
  const contentB = b.turns[0]?.content ?? "";
  if (contentA.length < 30 || contentB.length < 30) return null;
  const lang = a.language_hint;
  const m1 = `real-lru-${seq}-m1`;
  const m2 = `real-lru-${seq}-m2`;
  return {
    case_id: `real-lru-${String(seq).padStart(3, "0")}`,
    layer: "resume",
    category: "real_long_range",
    competency: "LRU",
    language_profile: lang,
    project: `bench-real-${a.project.slice(0, 24)}`,
    memories: [
      { id: m1, content: contentA, timestamp: a.timestamp },
      { id: m2, content: contentB, timestamp: b.timestamp },
    ],
    query: makeQuery(`${contentA} ${contentB}`, lang, "LRU", seq),
    relevant_ids: [m1, m2],
    expected_keywords: [
      ...extractKeywords(a.turns[0]?.content ?? "", 2),
      ...extractKeywords(b.turns[0]?.content ?? "", 2),
    ],
    resume_must_include: extractKeywords(b.turns[0]?.content ?? "", 1),
    source_round_ids: [a.round_id, b.round_id],
    generation_model: "deterministic-corpus",
  };
}

export interface GenerateOptions {
  perCompetency?: number;
  generatorModel?: string;
}

/** Generate candidate benchmark cases from masked corpus rounds. */
export function generateCandidatesFromCorpus(
  rounds: CorpusRound[],
  options: GenerateOptions = {},
): CandidateCase[] {
  const per = options.perCompetency ?? 15;
  const candidates: CandidateCase[] = [];
  let arSeq = 1;
  let crSeq = 1;
  let ttlSeq = 1;
  let lruSeq = 1;

  for (let i = 0; i < rounds.length && arSeq <= per; i += 1) {
    const round = rounds[i];
    const turnIdx = round.turns.length > 1 ? i % round.turns.length : 0;
    const c = buildArCase(round, turnIdx, arSeq);
    if (c) {
      candidates.push(c);
      arSeq += 1;
    }
  }

  for (let i = 0; i < rounds.length && crSeq <= per; i += 3) {
    const c = buildCrCase(rounds, crSeq, i);
    if (!c) continue;
    candidates.push(c);
    crSeq += 1;
  }

  for (let i = 0; i < rounds.length && ttlSeq <= per; i += 1) {
    const c = buildTtlCase(rounds[i], ttlSeq);
    if (c) {
      candidates.push(c);
      ttlSeq += 1;
    }
  }

  for (let i = 0; i < rounds.length - 1 && lruSeq <= per; i += 1) {
    const c = buildLruCase(rounds.slice(i, i + 2), lruSeq);
    if (c) {
      candidates.push(c);
      lruSeq += 1;
    }
  }

  if (options.generatorModel) {
    for (const c of candidates) c.generation_model = options.generatorModel;
  }
  return candidates;
}
