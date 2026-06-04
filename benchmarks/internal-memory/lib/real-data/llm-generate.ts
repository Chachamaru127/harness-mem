import type { OpenRouterBudget } from "../openrouter-budget";
import type { Competency } from "../types";
import type { CorpusRound } from "../export-corpus";
import {
  buildArSeed,
  buildCrSeed,
  buildLruSeed,
  buildTtlSeed,
} from "./generate-candidates";
import { assertModelsSeparated, getGeneratorModel } from "./judge-gate";
import type { CandidateCase } from "./types";

const COMPETENCIES: Competency[] = ["AR", "CR", "TTL", "LRU"];

const COMPETENCY_PROMPTS: Record<Competency, string> = {
  AR: "Accurate Retrieval: create a question answerable ONLY from the given memory logs (single or multi-hop). Do not leak answer tokens in the question.",
  CR: "Conflict Resolution: ask for the CURRENT/LATEST value after an update sequence in the logs.",
  TTL: "Test-Time Learning: ask to apply a rule/convention defined earlier in the session logs.",
  LRU: "Long-Range Understanding: ask for a cross-session summary grounded in the provided logs.",
};

function buildSeed(
  rounds: CorpusRound[],
  competency: Competency,
  seq: number,
  offset: number,
): CandidateCase | null {
  if (competency === "AR") {
    const round = rounds[offset % rounds.length];
    if (!round) return null;
    const turnIdx = round.turns.length > 1 ? offset % round.turns.length : 0;
    return buildArSeed(round, turnIdx, seq);
  }
  if (competency === "CR") return buildCrSeed(rounds, seq, offset);
  if (competency === "TTL") {
    const round = rounds[offset % rounds.length];
    return round ? buildTtlSeed(round, seq) : null;
  }
  const slice = rounds.slice(offset, offset + 2);
  return buildLruSeed(slice.length >= 2 ? slice : [rounds[offset % rounds.length], rounds[(offset + 1) % rounds.length]], seq);
}

async function llmDiversifyQuery(
  budget: OpenRouterBudget,
  seed: CandidateCase,
): Promise<{ query: string; expected_keywords: string[] } | null> {
  const evidence = seed.memories.map((m) => m.content).join("\n---\n");
  const competency = seed.competency ?? "AR";
  try {
    const payload = await budget.chatJson<{ query?: string; expected_keywords?: string[] }>({
      model: getGeneratorModel(),
      max_tokens: 384,
      messages: [
        {
          role: "system",
          content: [
            COMPETENCY_PROMPTS[competency],
            `Language: match the memory logs (${seed.language_profile}).`,
            'Reply JSON only: {"query":"...","expected_keywords":["kw1","kw2"]}',
            "expected_keywords must appear verbatim in the gold evidence memories.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [`Memory logs:\n${evidence}`, `Seed question (rewrite for diversity): ${seed.query}`].join("\n\n"),
        },
      ],
    });
    if (!payload.query || !Array.isArray(payload.expected_keywords) || payload.expected_keywords.length === 0) {
      return null;
    }
    return {
      query: String(payload.query).slice(0, 512),
      expected_keywords: payload.expected_keywords.map((k) => String(k).slice(0, 48)).slice(0, 5),
    };
  } catch {
    return null;
  }
}

export interface LlmGenerateOptions {
  targetPerCompetency: number;
  overgenFactor?: number;
  budget?: OpenRouterBudget;
  requireLlm?: boolean;
}

export function assertGeneratorJudgeSeparated(requireLlm: boolean): void {
  if (requireLlm) assertModelsSeparated();
}

/** Generate candidates with LLM-diversified queries; corpus-grounded memories from seeds. */
export async function generateLlmCandidatesFromCorpus(
  rounds: CorpusRound[],
  options: LlmGenerateOptions,
): Promise<CandidateCase[]> {
  if (rounds.length === 0) return [];

  const target = options.targetPerCompetency;
  const overgen = options.overgenFactor ?? 2;
  const attemptPerCompetency = Math.ceil(target * overgen);
  const generatorModel = getGeneratorModel();
  const candidates: CandidateCase[] = [];

  for (const competency of COMPETENCIES) {
    let seq = 1;
    for (let attempt = 0; attempt < attemptPerCompetency * 3 && seq <= attemptPerCompetency; attempt += 1) {
      const offset = attempt + seq * 7;
      const seed = buildSeed(rounds, competency, seq, offset);
      if (!seed) continue;

      let candidate: CandidateCase = { ...seed, generation_model: generatorModel };

      if (options.budget && process.env.OPENROUTER_API_KEY?.trim()) {
        const diversified = await llmDiversifyQuery(options.budget, seed);
        if (diversified) {
          candidate = {
            ...seed,
            query: diversified.query,
            expected_keywords: diversified.expected_keywords,
            generation_model: generatorModel,
          };
        } else if (options.requireLlm) {
          continue;
        }
      } else if (options.requireLlm) {
        throw new Error("LLM generation required but OpenRouter budget unavailable");
      }

      candidate.case_id = candidate.case_id.replace(
        /-\d{3}$/,
        `-${String(seq).padStart(4, "0")}`,
      );
      candidates.push(candidate);
      seq += 1;
    }
  }

  return candidates;
}

/** Cap accepted cases to target per competency. */
export function capByCompetency(cases: CandidateCase[], targetPerCompetency: number): CandidateCase[] {
  const byComp = new Map<Competency, CandidateCase[]>();
  for (const c of cases) {
    const comp = c.competency ?? "AR";
    const list = byComp.get(comp) ?? [];
    list.push(c);
    byComp.set(comp, list);
  }
  const out: CandidateCase[] = [];
  for (const comp of COMPETENCIES) {
    out.push(...(byComp.get(comp) ?? []).slice(0, targetPerCompetency));
  }
  return out;
}
