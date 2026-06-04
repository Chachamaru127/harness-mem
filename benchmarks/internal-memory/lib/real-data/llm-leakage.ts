import type { OpenRouterBudget } from "../openrouter-budget";
import { getJudgeModel } from "./judge-gate";

function heuristicQueryAloneAnswerable(caseRow: CandidateCase): boolean {
  const q = caseRow.query.toLowerCase();
  for (const kw of caseRow.expected_keywords ?? []) {
    if (kw.length >= 3 && q.includes(kw.toLowerCase())) return true;
  }
  return false;
}

async function llmQueryAloneOnce(
  budget: OpenRouterBudget,
  caseRow: CandidateCase,
): Promise<boolean> {
  const keywords = (caseRow.expected_keywords ?? []).join(", ");
  try {
    const payload = await budget.chatJson<{ can_answer?: boolean; reason?: string }>({
      model: getJudgeModel(),
      max_tokens: 128,
      messages: [
        {
          role: "system",
          content:
            'You receive ONLY a question (no context). Reply JSON: {"can_answer":true/false,"reason":"..."}. true if you could answer using general knowledge without retrieval.',
        },
        {
          role: "user",
          content: [
            `Question: ${caseRow.query}`,
            keywords ? `Hint keywords (do NOT treat as given context): ${keywords}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    });
    return Boolean(payload.can_answer);
  } catch {
    return false;
  }
}

/** Leakage filter: query alone N=3 — reject if any trial answers without context. */
export async function hasLlmLeakage(
  caseRow: CandidateCase,
  budget?: OpenRouterBudget,
  n = 3,
): Promise<boolean> {
  if (!budget || !process.env.OPENROUTER_API_KEY?.trim()) {
    return heuristicQueryAloneAnswerable(caseRow);
  }
  for (let i = 0; i < n; i += 1) {
    const canAnswer = await llmQueryAloneOnce(budget, caseRow);
    if (canAnswer) return true;
  }
  return false;
}
