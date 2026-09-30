/**
 * Q9 (2026-09-30): 差分抽出のプロンプト肥大と Ollama 失敗時の扱い
 *
 * - 既存ファクトは新しい順に件数上限と文字予算で絞ってからプロンプトに入れる
 * - 置き換え・削除はプロンプトで見せたファクトからだけ受け付ける
 * - Ollama には think:false と num_predict を送る
 * - 呼び出し失敗時は事実 0 件にせず heuristic へ退避する
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  llmExtractWithDiff,
  selectExistingFactsForPrompt,
  type ExistingFact,
  type ExtractFactInput,
} from "../../src/consolidation/extractor";

const ENV_KEYS = [
  "HARNESS_MEM_FACT_LLM_PROVIDER",
  "HARNESS_MEM_FACT_LLM_MODEL",
  "HARNESS_MEM_OLLAMA_HOST",
  "HARNESS_MEM_FACT_LLM_TIMEOUT_MS",
  "HARNESS_MEM_FACT_DIFF_MAX_EXISTING",
  "HARNESS_MEM_FACT_DIFF_EXISTING_CHAR_BUDGET",
];

const SAMPLE_INPUT: ExtractFactInput = {
  title: "技術選定",
  content: "TypeScript を採用することを決定した。",
  observation_type: "decision",
};

function makeFacts(count: number): ExistingFact[] {
  return Array.from({ length: count }, (_, i) => ({
    fact_id: `fact-${i}`,
    fact_type: "decision",
    fact_key: `decision:key_${i}`,
    fact_value: `value ${i}`,
  }));
}

let savedEnv: Record<string, string | undefined> = {};
let originalFetch: typeof globalThis.fetch;
let originalStderrWrite: typeof process.stderr.write;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.HARNESS_MEM_FACT_LLM_PROVIDER = "ollama";
  process.env.HARNESS_MEM_OLLAMA_HOST = "http://127.0.0.1:11434";
  process.env.HARNESS_MEM_FACT_LLM_MODEL = "qwen3.5:9b";
  originalFetch = globalThis.fetch;
  originalStderrWrite = process.stderr.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  globalThis.fetch = originalFetch;
  process.stderr.write = originalStderrWrite;
});

function captureOllama(content: string | null, status = 200): { bodies: Array<Record<string, unknown>> } {
  const bodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_url: string | URL | Request, opts?: RequestInit) => {
    bodies.push(JSON.parse(String(opts?.body ?? "{}")));
    if (content === null) return new Response("", { status });
    return new Response(JSON.stringify({ message: { content } }), { status });
  }) as typeof fetch;
  return { bodies };
}

function promptExistingIds(body: Record<string, unknown>): string[] {
  const messages = body.messages as Array<{ role: string; content: string }>;
  const user = messages.find((m) => m.role === "user")!.content;
  const line = user.split("\n").find((l) => l.startsWith("existing_facts: "))!;
  return (JSON.parse(line.slice("existing_facts: ".length)) as Array<{ fact_id: string }>).map((f) => f.fact_id);
}

describe("selectExistingFactsForPrompt", () => {
  test("keeps the newest facts up to the default cap of 50, in original order", () => {
    const selected = selectExistingFactsForPrompt(makeFacts(18_747));
    expect(selected).toHaveLength(50);
    expect(selected[0].fact_id).toBe("fact-18697");
    expect(selected[49].fact_id).toBe("fact-18746");
  });

  test("stops at the character budget", () => {
    process.env.HARNESS_MEM_FACT_DIFF_EXISTING_CHAR_BUDGET = "100";
    const selected = selectExistingFactsForPrompt(makeFacts(50));
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.length).toBeLessThan(50);
    expect(selected[selected.length - 1].fact_id).toBe("fact-49");
  });

  test("counts the serialized array exactly at the budget boundary", () => {
    const facts = makeFacts(10);
    const exact = JSON.stringify(facts.slice(-3)).length;
    process.env.HARNESS_MEM_FACT_DIFF_EXISTING_CHAR_BUDGET = String(exact);
    expect(selectExistingFactsForPrompt(facts)).toHaveLength(3);
    process.env.HARNESS_MEM_FACT_DIFF_EXISTING_CHAR_BUDGET = String(exact - 1);
    expect(selectExistingFactsForPrompt(facts)).toHaveLength(2);
  });

  test("honors the count override", () => {
    process.env.HARNESS_MEM_FACT_DIFF_MAX_EXISTING = "3";
    expect(selectExistingFactsForPrompt(makeFacts(10)).map((f) => f.fact_id)).toEqual(["fact-7", "fact-8", "fact-9"]);
  });
});

describe("llmExtractWithDiff with ollama", () => {
  test("sends think:false, num_predict, and only the bounded existing facts", async () => {
    const { bodies } = captureOllama(JSON.stringify({ facts: [], supersedes: {}, deleted: [] }));
    await llmExtractWithDiff(SAMPLE_INPUT, makeFacts(1_000));
    expect(bodies).toHaveLength(1);
    expect(bodies[0].think).toBe(false);
    expect((bodies[0].options as { num_predict: number }).num_predict).toBeGreaterThan(0);
    const ids = promptExistingIds(bodies[0]);
    expect(ids).toHaveLength(50);
    expect(ids[49]).toBe("fact-999");
  });

  test("ignores supersede and delete targets the model was not shown", async () => {
    process.env.HARNESS_MEM_FACT_DIFF_MAX_EXISTING = "2";
    captureOllama(
      JSON.stringify({
        facts: [{ fact_type: "decision", fact_key: "decision:new", fact_value: "new", confidence: 0.9 }],
        supersedes: { "decision:new": "fact-0" },
        deleted: ["fact-1", "fact-9"],
      })
    );
    const result = await llmExtractWithDiff(SAMPLE_INPUT, makeFacts(10));
    expect(result.supersedes).toEqual([undefined]);
    expect(result.deleted_fact_ids).toEqual(["fact-9"]);
  });

  test("falls back to heuristic facts when the call fails", async () => {
    captureOllama(null, 500);
    const result = await llmExtractWithDiff(SAMPLE_INPUT, makeFacts(3));
    expect(result.new_facts.length).toBeGreaterThan(0);
    expect(result.supersedes).toHaveLength(result.new_facts.length);
    expect(result.deleted_fact_ids).toEqual([]);
  });

  test("falls back to heuristic facts when the call times out", async () => {
    process.env.HARNESS_MEM_FACT_LLM_TIMEOUT_MS = "20";
    globalThis.fetch = ((_url: string | URL | Request, opts?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        opts?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as typeof fetch;
    const result = await llmExtractWithDiff(SAMPLE_INPUT, makeFacts(3));
    expect(result.new_facts.length).toBeGreaterThan(0);
  });

  test("keeps the serialized existing_facts within the character budget", async () => {
    process.env.HARNESS_MEM_FACT_DIFF_EXISTING_CHAR_BUDGET = "1000";
    const { bodies } = captureOllama(JSON.stringify({ facts: [], supersedes: {}, deleted: [] }));
    await llmExtractWithDiff(SAMPLE_INPUT, makeFacts(100));
    const messages = bodies[0].messages as Array<{ role: string; content: string }>;
    const line = messages.find((m) => m.role === "user")!.content.split("\n").find((l) => l.startsWith("existing_facts: "))!;
    expect(line.slice("existing_facts: ".length).length).toBeLessThanOrEqual(1000);
    expect(promptExistingIds(bodies[0]).length).toBeGreaterThan(0);
  });

  test("falls back to heuristic facts when the response has no facts array", async () => {
    captureOllama(JSON.stringify({ error: "model failed" }));
    const result = await llmExtractWithDiff(SAMPLE_INPUT, makeFacts(3));
    expect(result.new_facts.length).toBeGreaterThan(0);
  });

  test("falls back to heuristic facts when every returned fact is invalid", async () => {
    captureOllama(JSON.stringify({ facts: [{}], supersedes: {}, deleted: [] }));
    const result = await llmExtractWithDiff(SAMPLE_INPUT, makeFacts(3));
    expect(result.new_facts.length).toBeGreaterThan(0);
  });

  test("records a warning when ollama returns no message content", async () => {
    const warnings: string[] = [];
    process.stderr.write = ((chunk: string) => {
      warnings.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    for (const body of [{ done: true }, { message: { content: "" } }]) {
      warnings.length = 0;
      globalThis.fetch = (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
      const result = await llmExtractWithDiff(SAMPLE_INPUT, makeFacts(3));
      expect(result.new_facts.length).toBeGreaterThan(0);
      expect(warnings.some((w) => w.includes("no message content"))).toBe(true);
    }
  });

  test("keeps an empty result when the model validly returns no facts", async () => {
    captureOllama(JSON.stringify({ facts: [], supersedes: {}, deleted: [] }));
    const result = await llmExtractWithDiff(SAMPLE_INPUT, makeFacts(3));
    expect(result.new_facts).toEqual([]);
  });
});
