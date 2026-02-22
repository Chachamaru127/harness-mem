import { describe, expect, mock, test } from "bun:test";
import { Mem0LocomoAdapter } from "./locomo-mem0-adapter";

describe("LOCOMO mem0 adapter", () => {
  test("maps mem0 response into locomo benchmark record schema", async () => {
    const fetchMock = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(_input)).toContain("/v1/locomo/answer");
      const headers = (init?.headers || {}) as Record<string, string>;
      expect(headers.authorization).toBe("Bearer mem0-token");
      return new Response(JSON.stringify({ prediction: "Seattle" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const adapter = new Mem0LocomoAdapter({
      baseUrl: "http://mem0.local",
      token: "mem0-token",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const record = await adapter.answerQuestion({
      sample_id: "sample-1",
      question_id: "q1",
      question: "Where did I move?",
      answer: "Seattle",
      category: "profile",
    });

    expect(record.sample_id).toBe("sample-1");
    expect(record.question_id).toBe("q1");
    expect(record.prediction).toBe("Seattle");
    expect(record.em).toBe(1);
    expect(record.f1).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
