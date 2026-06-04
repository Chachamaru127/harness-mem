import { describe, expect, mock, test } from "bun:test";
import {
  AgentmemoryLocomoAdapter,
  agentmemoryLocomoHealthCheck,
  resolveAgentmemoryLocomoConfig,
} from "./locomo-agentmemory-adapter";

describe("LOCOMO agentmemory adapter", () => {
  test("resolveAgentmemoryLocomoConfig enforces localhost-only", () => {
    expect(() => resolveAgentmemoryLocomoConfig({ baseUrl: "https://example.com" })).toThrow(
      /localhost-only/i,
    );
  });

  test("health check hits /agentmemory/health with bearer auth", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("http://127.0.0.1:3111/agentmemory/health");
      const headers = (init?.headers || {}) as Record<string, string>;
      expect(headers.authorization).toBe("Bearer test-secret");
      return new Response("ok", { status: 200 });
    });

    const ok = await agentmemoryLocomoHealthCheck({
      baseUrl: "http://127.0.0.1:3111",
      secret: "test-secret",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("ingests turns and answers via smart-search + shared synthesis", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      calls.push({ url, body });

      if (url.endsWith("/agentmemory/remember")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.endsWith("/agentmemory/smart-search")) {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: "mem-1",
                content: "I moved to Seattle in 2024.",
                score: 0.91,
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response("not found", { status: 404 });
    });

    const adapter = new AgentmemoryLocomoAdapter({
      baseUrl: "http://127.0.0.1:3111",
      secret: "test-secret",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await adapter.ingestSample({
      sample_id: "sample-1",
      conversation: [
        { speaker: "user", text: "I moved to Seattle in 2024." },
        { speaker: "assistant", text: "Got it." },
      ],
      qa: [],
    });

    const record = await adapter.answerQuestion(
      {
        sample_id: "sample-1",
        question_id: "q1",
        question: "Where did I move in 2024?",
        answer: "Seattle",
        category: "profile",
      },
      "sample-1",
    );

    expect(calls.some((call) => call.url.endsWith("/agentmemory/remember"))).toBe(true);
    expect(calls.some((call) => call.url.endsWith("/agentmemory/smart-search"))).toBe(true);
    expect(record.prediction.toLowerCase()).toContain("seattle");
    expect(record.f1).toBeGreaterThan(0);
  });

  test("skips health when daemon unreachable", async () => {
    const fetchMock = mock(async () => new Response("down", { status: 503 }));
    const ok = await agentmemoryLocomoHealthCheck({
      baseUrl: "http://127.0.0.1:3111",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(ok).toBe(false);
  });
});
