import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  parseLocalLlmProviderGateArgs,
  runLocalLlmProviderGate,
} from "./s154-local-llm-provider-gate";

function responseForTask(prompt: string): unknown {
  if (prompt.includes("Extract stable memory facts")) {
    return {
      facts: [
        {
          fact_type: "decision",
          fact_key: "decision:default_embedding_provider",
          fact_value: "keep multilingual-e5 as the default embedding provider",
          confidence: 0.9,
        },
      ],
    };
  }
  if (prompt.includes("Summarize this current state")) {
    return {
      summary: "Run the local LLM gate across four tasks before larger model tests.",
      key_points: ["local provider gate", "four tasks", "no secret included"],
    };
  }
  if (prompt.includes("Judge whether")) {
    return { contradiction: true, confidence: 0.92, reason: "The default provider changed." };
  }
  return {
    rewritten: "We will submit the GearChange API spec on Friday.",
    changed: false,
    false_positive: false,
    reason: "No completion evidence is present.",
  };
}

describe("S154-210 local LLM provider gate", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("parses repeated --model and no-write args", () => {
    const options = parseLocalLlmProviderGateArgs([
      "--model",
      "qwen3.5:9b",
      "--model",
      "qwen3.5:27b",
      "--timeout-ms",
      "1234",
      "--no-write",
    ]);
    expect(options.models).toEqual(["qwen3.5:9b", "qwen3.5:27b"]);
    expect(options.timeoutMs).toBe(1234);
    expect(options.writeArtifacts).toBe(false);
  });

  test("sends JSON Schema format, think=false, and returns fixed report schema", async () => {
    const requests: Array<Record<string, unknown>> = [];
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      requests.push(body);
      const messages = body.messages as Array<{ role: string; content: string }>;
      const prompt = messages.at(-1)?.content ?? "";
      return {
        ok: true,
        json: async () => ({ message: { content: JSON.stringify(responseForTask(prompt)) } }),
      } as Response;
    });

    const report = await runLocalLlmProviderGate({
      models: ["qwen3.5:9b"],
      host: "http://127.0.0.1:11434",
      writeArtifacts: false,
    });

    expect(report.schema_version).toBe("s154-local-llm-provider-gate.v1");
    expect(report.models).toHaveLength(1);
    expect(report.models[0]?.tasks).toHaveLength(4);
    expect(report.models[0]?.metrics.json_schema_valid_rate).toBe(1);
    expect(report.models[0]?.metrics.tense_false_positive_rate).toBe(0);
    expect(typeof report.models[0]?.metrics.p50_latency_ms).toBe("number");
    expect(report.overall_passed).toBe(true);
    expect(requests).toHaveLength(4);
    for (const request of requests) {
      expect(request.think).toBe(false);
      expect(request.stream).toBe(false);
      expect(typeof request.format).toBe("object");
      expect((request.format as { type?: string }).type).toBe("object");
    }
  });

  test("rejects non-loopback host before fetch", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("should not fetch external host");
    });

    const report = await runLocalLlmProviderGate({
      models: ["qwen3.5:9b"],
      host: "https://example.com",
      writeArtifacts: false,
    });

    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
    expect(report.overall_passed).toBe(false);
    expect(report.models[0]?.metrics.json_schema_valid_rate).toBe(0);
    expect(report.models[0]?.tasks.every((task) => task.parse_error?.includes("non_loopback_ollama_host"))).toBe(true);
  });

  test("counts tense rewrite false positives", async () => {
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      const messages = body.messages as Array<{ role: string; content: string }>;
      const prompt = messages.at(-1)?.content ?? "";
      const payload = prompt.includes("Task: decide whether to rewrite")
        ? { rewritten: "We submitted the GearChange API spec on Friday.", changed: true, false_positive: true, reason: "Assumed completion." }
        : responseForTask(prompt);
      return {
        ok: true,
        json: async () => ({ message: { content: JSON.stringify(payload) } }),
      } as Response;
    });

    const report = await runLocalLlmProviderGate({
      models: ["qwen3.5:9b"],
      host: "http://127.0.0.1:11434",
      writeArtifacts: false,
    });

    expect(report.models[0]?.metrics.json_schema_valid_rate).toBe(1);
    expect(report.models[0]?.metrics.tense_false_positive_rate).toBe(1);
    expect(report.overall_passed).toBe(false);
  });
});
