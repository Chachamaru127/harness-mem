import type { OpenRouterBudget } from "./openrouter-budget";
import type { BenchmarkCase } from "./types";

export interface LlmJudgeResult {
  llm_grounding_score: number;
  model: string;
}

export async function judgeRetrievalGrounding(
  budget: OpenRouterBudget,
  caseRow: BenchmarkCase,
  hitContents: string[],
): Promise<LlmJudgeResult | undefined> {
  if (hitContents.length === 0) return undefined;

  const model =
    process.env.INTERNAL_BENCH_OPENROUTER_MODEL?.trim() ?? "google/gemini-2.5-flash-lite";
  const snippets = hitContents.slice(0, 5).join("\n---\n");
  const keywords = caseRow.expected_keywords?.join(", ") ?? "n/a";

  const payload = await budget.chatJson<{ score?: number }>({
    model,
    max_tokens: 96,
    messages: [
      {
        role: "system",
        content:
          'You grade retrieval quality. Reply with JSON only: {"score": number between 0 and 1}. 1 means retrieved snippets clearly answer the question.',
      },
      {
        role: "user",
        content: [
          `Question: ${caseRow.query}`,
          `Expected keywords (hint): ${keywords}`,
          `Retrieved snippets:\n${snippets}`,
        ].join("\n"),
      },
    ],
  });

  const raw = Number(payload.score);
  if (!Number.isFinite(raw)) return undefined;
  return {
    llm_grounding_score: Math.min(1, Math.max(0, raw)),
    model,
  };
}
