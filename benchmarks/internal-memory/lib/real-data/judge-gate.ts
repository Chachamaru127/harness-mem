import type { OpenRouterBudget } from "../openrouter-budget";
import { scanTextForPii } from "../pii-scan";
import type { CandidateCase, JudgeDimensionScores } from "./types";

const JUDGE_MODEL =
  process.env.INTERNAL_BENCH_JUDGE_MODEL?.trim() ??
  process.env.INTERNAL_BENCH_OPENROUTER_MODEL?.trim() ??
  "google/gemini-2.5-flash-lite";

const GENERATOR_MODEL =
  process.env.INTERNAL_BENCH_GENERATOR_MODEL?.trim() ?? "google/gemini-2.5-flash-lite";

export function getGeneratorModel(): string {
  return GENERATOR_MODEL;
}

export function getJudgeModel(): string {
  return JUDGE_MODEL;
}

function heuristicJudge(caseRow: CandidateCase): JudgeDimensionScores {
  const combined = caseRow.memories.map((m) => m.content).join(" ");
  const keywords = caseRow.expected_keywords ?? [];
  let faithfulness = 0;
  for (const kw of keywords) {
    if (combined.toLowerCase().includes(kw.toLowerCase())) faithfulness += 1;
  }
  faithfulness = keywords.length > 0 ? faithfulness / keywords.length : 1;
  const piiClean = scanTextForPii(JSON.stringify(caseRow)).length === 0 ? 1 : 0;
  return {
    faithfulness,
    answerability: faithfulness > 0 ? 1 : 0,
    difficulty: 0.5,
    language_consistency: 1,
    pii_clean: piiClean,
    reasons: { mode: "heuristic-fallback" },
  };
}

async function llmJudgeOnce(
  budget: OpenRouterBudget,
  caseRow: CandidateCase,
): Promise<JudgeDimensionScores | undefined> {
  const evidence = caseRow.memories
    .filter((m) => caseRow.relevant_ids.includes(m.id))
    .map((m) => m.content)
    .join("\n---\n");
  try {
    const payload = await budget.chatJson<{
      faithfulness?: number;
      answerability?: number;
      difficulty?: number;
      language_consistency?: number;
      pii_clean?: number;
      reason?: string;
    }>({
      model: JUDGE_MODEL,
      max_tokens: 256,
      messages: [
        {
          role: "system",
          content:
            'Grade benchmark case quality. Reply JSON only: {"faithfulness":0-1,"answerability":0-1,"difficulty":0-1,"language_consistency":0-1,"pii_clean":0-1,"reason":"..."}',
        },
        {
          role: "user",
          content: [
            `Question: ${caseRow.query}`,
            `Expected keywords: ${(caseRow.expected_keywords ?? []).join(", ")}`,
            `Gold evidence:\n${evidence}`,
          ].join("\n"),
        },
      ],
    });
    const clamp = (n: unknown) =>
      Math.min(1, Math.max(0, Number.isFinite(Number(n)) ? Number(n) : 0));
    return {
      faithfulness: clamp(payload.faithfulness),
      answerability: clamp(payload.answerability),
      difficulty: clamp(payload.difficulty),
      language_consistency: clamp(payload.language_consistency),
      pii_clean: clamp(payload.pii_clean),
      reasons: { summary: String(payload.reason ?? "") },
    };
  } catch {
    return undefined;
  }
}

export async function judgeCandidate(
  caseRow: CandidateCase,
  budget?: OpenRouterBudget,
  k = 3,
): Promise<JudgeDimensionScores> {
  if (!budget || !process.env.OPENROUTER_API_KEY?.trim()) {
    return heuristicJudge(caseRow);
  }

  const samples: JudgeDimensionScores[] = [];
  for (let i = 0; i < k; i += 1) {
    const s = await llmJudgeOnce(budget, caseRow);
    if (s) samples.push(s);
  }
  if (samples.length === 0) return heuristicJudge(caseRow);

  const avg = (key: keyof JudgeDimensionScores): number => {
    const nums = samples.map((s) => s[key]).filter((v): v is number => typeof v === "number");
    return nums.reduce((a, b) => a + b, 0) / Math.max(1, nums.length);
  };

  return {
    faithfulness: avg("faithfulness"),
    answerability: avg("answerability"),
    difficulty: avg("difficulty"),
    language_consistency: avg("language_consistency"),
    pii_clean: avg("pii_clean"),
    reasons: { mode: `llm-jury-k${samples.length}` },
  };
}

export function passesJudgeGate(scores: JudgeDimensionScores): boolean {
  return (
    scores.faithfulness >= 0.5 &&
    scores.answerability >= 0.5 &&
    scores.pii_clean >= 0.99 &&
    scores.language_consistency >= 0.5
  );
}

/** Golden agreement: compare heuristic vs expected pass on sample set. */
export function computeGoldenAgreement(
  cases: CandidateCase[],
  threshold = 0.75,
): { rate: number; pass: boolean } {
  if (cases.length === 0) return { rate: 0, pass: false };
  let agree = 0;
  for (const c of cases) {
    const h = heuristicJudge(c);
    const expectedPass = passesJudgeGate(h);
    const actualPass = c.judge_scores ? passesJudgeGate(c.judge_scores) : expectedPass;
    if (expectedPass === actualPass) agree += 1;
  }
  const rate = agree / cases.length;
  return { rate, pass: rate >= threshold };
}
