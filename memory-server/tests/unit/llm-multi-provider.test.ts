/**
 * COMP-004: LLM コンソリデーション マルチプロバイダー テスト
 *
 * テストケース:
 * 1. 正常: openai プロバイダーでファクト抽出が動作する
 * 2. 正常: ollama プロバイダーでファクト抽出が動作する
 * 3. 正常: anthropic プロバイダーでファクト抽出が動作する
 * 4. 正常: gemini プロバイダーでファクト抽出が動作する
 * 5. 正常: 不明なプロバイダーは graceful に空配列を返す
 * 6. 境界: API キー未設定の openai は空配列を返す
 * 7. 境界: API キー未設定の anthropic は空配列を返す
 * 8. 境界: API キー未設定の gemini は空配列を返す
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { llmExtractWithDiff, type ExtractFactInput, type ExistingFact } from "../../src/consolidation/extractor";

const MOCK_FACTS_RESPONSE = JSON.stringify({
  facts: [
    {
      fact_type: "decision",
      fact_key: "decision:use_typescript",
      fact_value: "TypeScript を使用する",
      confidence: 0.9,
    },
  ],
  supersedes: {},
  deleted: [],
});

const SAMPLE_INPUT: ExtractFactInput = {
  title: "技術選定",
  content: "TypeScript を採用することを決定した。",
  observation_type: "decision",
};

const NO_EXISTING: ExistingFact[] = [];

// 元の環境変数を保存・復元するヘルパー
let savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
  "HARNESS_MEM_FACT_LLM_PROVIDER",
  "HARNESS_MEM_FACT_LLM_MODEL",
  "HARNESS_MEM_OPENAI_API_KEY",
  "HARNESS_MEM_ANTHROPIC_API_KEY",
  "HARNESS_MEM_GEMINI_API_KEY",
  "HARNESS_MEM_OLLAMA_HOST",
  "HARNESS_MEM_FACT_EXTRACTOR_MODE",
];

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
  globalThis.fetch = originalFetch;
});

function mockFetch(responseBody: string, status = 200) {
  globalThis.fetch = async (_url: string | URL | Request, _opts?: RequestInit): Promise<Response> => {
    const body = responseBody;
    return new Response(body, { status });
  };
}

describe("COMP-004: LLM マルチプロバイダー", () => {
  test("正常: openai プロバイダーでファクト抽出が動作する", async () => {
    process.env.HARNESS_MEM_FACT_LLM_PROVIDER = "openai";
    process.env.HARNESS_MEM_OPENAI_API_KEY = "sk-test-key";
    process.env.HARNESS_MEM_FACT_LLM_MODEL = "gpt-4o-mini";

    mockFetch(
      JSON.stringify({
        choices: [{ message: { content: MOCK_FACTS_RESPONSE } }],
      })
    );

    const result = await llmExtractWithDiff(SAMPLE_INPUT, NO_EXISTING);
    expect(result.new_facts.length).toBeGreaterThan(0);
    expect(result.new_facts[0].fact_type).toBe("decision");
  });

  test("正常: ollama プロバイダーでファクト抽出が動作する", async () => {
    process.env.HARNESS_MEM_FACT_LLM_PROVIDER = "ollama";
    process.env.HARNESS_MEM_OLLAMA_HOST = "http://127.0.0.1:11434";
    process.env.HARNESS_MEM_FACT_LLM_MODEL = "llama3.2";

    mockFetch(
      JSON.stringify({
        message: { content: MOCK_FACTS_RESPONSE },
      })
    );

    const result = await llmExtractWithDiff(SAMPLE_INPUT, NO_EXISTING);
    expect(result.new_facts.length).toBeGreaterThan(0);
    expect(result.new_facts[0].fact_type).toBe("decision");
  });

  test("正常: anthropic プロバイダーでファクト抽出が動作する", async () => {
    process.env.HARNESS_MEM_FACT_LLM_PROVIDER = "anthropic";
    process.env.HARNESS_MEM_ANTHROPIC_API_KEY = "sk-ant-test-key";
    process.env.HARNESS_MEM_FACT_LLM_MODEL = "claude-haiku-4-5-20251001";

    mockFetch(
      JSON.stringify({
        content: [{ type: "text", text: MOCK_FACTS_RESPONSE }],
      })
    );

    const result = await llmExtractWithDiff(SAMPLE_INPUT, NO_EXISTING);
    expect(result.new_facts.length).toBeGreaterThan(0);
    expect(result.new_facts[0].fact_type).toBe("decision");
  });

  test("正常: gemini プロバイダーでファクト抽出が動作する", async () => {
    process.env.HARNESS_MEM_FACT_LLM_PROVIDER = "gemini";
    process.env.HARNESS_MEM_GEMINI_API_KEY = "gemini-test-key";
    process.env.HARNESS_MEM_FACT_LLM_MODEL = "gemini-2.0-flash";

    mockFetch(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: MOCK_FACTS_RESPONSE }] } }],
      })
    );

    const result = await llmExtractWithDiff(SAMPLE_INPUT, NO_EXISTING);
    expect(result.new_facts.length).toBeGreaterThan(0);
    expect(result.new_facts[0].fact_type).toBe("decision");
  });

  test("正常: 不明なプロバイダーは graceful に空配列を返す", async () => {
    process.env.HARNESS_MEM_FACT_LLM_PROVIDER = "unknown-provider";

    let fetchCalled = false;
    globalThis.fetch = async (_url: string | URL | Request, _opts?: RequestInit): Promise<Response> => {
      fetchCalled = true;
      return new Response("", { status: 500 });
    };

    const result = await llmExtractWithDiff(SAMPLE_INPUT, NO_EXISTING);
    expect(result.new_facts).toEqual([]);
    expect(result.supersedes).toEqual([]);
    expect(result.deleted_fact_ids).toEqual([]);
    expect(fetchCalled).toBe(false);
  });

  test("境界: API キー未設定の openai は空配列を返す", async () => {
    process.env.HARNESS_MEM_FACT_LLM_PROVIDER = "openai";
    // HARNESS_MEM_OPENAI_API_KEY は未設定

    const result = await llmExtractWithDiff(SAMPLE_INPUT, NO_EXISTING);
    expect(result.new_facts).toEqual([]);
    expect(result.supersedes).toEqual([]);
    expect(result.deleted_fact_ids).toEqual([]);
  });

  test("境界: API キー未設定の anthropic は空配列を返す", async () => {
    process.env.HARNESS_MEM_FACT_LLM_PROVIDER = "anthropic";
    // HARNESS_MEM_ANTHROPIC_API_KEY は未設定

    const result = await llmExtractWithDiff(SAMPLE_INPUT, NO_EXISTING);
    expect(result.new_facts).toEqual([]);
    expect(result.supersedes).toEqual([]);
    expect(result.deleted_fact_ids).toEqual([]);
  });

  test("境界: API キー未設定の gemini は空配列を返す", async () => {
    process.env.HARNESS_MEM_FACT_LLM_PROVIDER = "gemini";
    // HARNESS_MEM_GEMINI_API_KEY は未設定

    const result = await llmExtractWithDiff(SAMPLE_INPUT, NO_EXISTING);
    expect(result.new_facts).toEqual([]);
    expect(result.supersedes).toEqual([]);
    expect(result.deleted_fact_ids).toEqual([]);
  });
});
