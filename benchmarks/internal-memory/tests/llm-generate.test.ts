import { describe, expect, test } from "bun:test";
import { OpenRouterBudget } from "../lib/openrouter-budget";
import type { CorpusRound } from "../lib/export-corpus";
import {
  assertGeneratorJudgeSeparated,
  capByCompetency,
  generateLlmCandidatesFromCorpus,
} from "../lib/real-data/llm-generate";

const sampleRound: CorpusRound = {
  round_id: "s1-0",
  session_id: "s1",
  project: "bench-real-test",
  timestamp: "2026-01-01T00:00:00Z",
  language_hint: "ja",
  turns: [
    {
      turn_id: "t1",
      observation_id: "o1",
      content: "認証方式は JWT を使うことに決めた。Bearer トークンで検証する。",
      observation_type: "note",
    },
    {
      turn_id: "t2",
      observation_id: "o2",
      content: "JWT の代わりに session cookie 方式に変更した。",
      observation_type: "note",
      supersedes: "o1",
    },
  ],
};

describe("llm-generate", () => {
  test("generates schema-valid seeds without OpenRouter (deterministic fallback)", async () => {
    const rounds = Array.from({ length: 20 }, (_, i) => ({
      ...sampleRound,
      round_id: `s1-${i}`,
    }));
    const cases = await generateLlmCandidatesFromCorpus(rounds, {
      targetPerCompetency: 3,
      overgenFactor: 1,
      requireLlm: false,
    });
    expect(cases.length).toBeGreaterThanOrEqual(8);
    for (const c of cases) {
      expect(c.memories.length).toBeGreaterThan(0);
      expect(c.query.length).toBeGreaterThan(5);
      expect(c.competency).toBeDefined();
    }
  });

  test("uses mock OpenRouter to diversify query", async () => {
    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"query":"認証方式の決定内容は？","expected_keywords":["JWT","Bearer"]}' } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
        { status: 200 },
      );
    const budget = new OpenRouterBudget("test-key", 30, mockFetch);
    process.env.OPENROUTER_API_KEY = "test-key";
    process.env.INTERNAL_BENCH_GENERATOR_MODEL = "openai/gpt-4o-mini";
    process.env.INTERNAL_BENCH_JUDGE_MODEL = "google/gemini-2.5-flash-lite";

    const cases = await generateLlmCandidatesFromCorpus([sampleRound], {
      targetPerCompetency: 1,
      budget,
      requireLlm: false,
    });
    expect(cases.length).toBeGreaterThanOrEqual(1);
    const ar = cases.find((c) => c.competency === "AR");
    expect(ar?.query).toContain("認証");
    delete process.env.OPENROUTER_API_KEY;
  });

  test("assertGeneratorJudgeSeparated rejects same model", () => {
    process.env.INTERNAL_BENCH_GENERATOR_MODEL = "same/model";
    process.env.INTERNAL_BENCH_JUDGE_MODEL = "same/model";
    expect(() => assertGeneratorJudgeSeparated(true)).toThrow(/must differ/);
    process.env.INTERNAL_BENCH_GENERATOR_MODEL = "openai/gpt-4o-mini";
    process.env.INTERNAL_BENCH_JUDGE_MODEL = "google/gemini-2.5-flash-lite";
  });

  test("capByCompetency limits each competency", () => {
    const cases = [
      { competency: "AR" as const, case_id: "a1" },
      { competency: "AR" as const, case_id: "a2" },
      { competency: "CR" as const, case_id: "c1" },
    ] as Parameters<typeof capByCompetency>[0];
    const capped = capByCompetency(cases, 1);
    expect(capped.length).toBe(2);
  });
});
