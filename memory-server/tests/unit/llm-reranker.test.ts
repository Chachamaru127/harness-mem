/**
 * S58-008: LLM リランカーのユニットテスト
 *
 * 実際の LLM API は呼び出さず、fetch をモックして動作を検証する。
 */
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import {
  llmRerank,
  buildLlmRerankerConfigFromEnv,
  combineScores,
  type LlmRerankerConfig,
  type LlmRerankCandidate,
} from "../../src/rerank/llm-reranker";

// ---------------------------------------------------------------------------
// サンプルデータ
// ---------------------------------------------------------------------------

const sampleCandidates: LlmRerankCandidate[] = [
  { id: "obs-1", title: "パーサーの決定", content: "新しいパーサー戦略を採用した", score: 0.9 },
  { id: "obs-2", title: "ビルドログ", content: "パーサーのリグレッションを修正", score: 0.6 },
  { id: "obs-3", title: "会議メモ", content: "スプリントの計画", score: 0.3 },
];

// ---------------------------------------------------------------------------
// combineScores
// ---------------------------------------------------------------------------

describe("combineScores", () => {
  test("LLM スコアと元スコアを 0.6 / 0.4 で結合する", () => {
    const result = combineScores(1.0, 0.0);
    expect(result).toBeCloseTo(0.6);
  });

  test("両スコアが同じ場合、結果も同じ値になる", () => {
    const result = combineScores(0.5, 0.5);
    expect(result).toBeCloseTo(0.5);
  });

  test("LLM スコア 0 の場合は元スコアの 0.4 倍", () => {
    const result = combineScores(0.0, 1.0);
    expect(result).toBeCloseTo(0.4);
  });
});

// ---------------------------------------------------------------------------
// buildLlmRerankerConfigFromEnv
// ---------------------------------------------------------------------------

describe("buildLlmRerankerConfigFromEnv", () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = {
      HARNESS_MEM_LLM_ENHANCE: process.env.HARNESS_MEM_LLM_ENHANCE,
      HARNESS_MEM_LLM_PROVIDER: process.env.HARNESS_MEM_LLM_PROVIDER,
      HARNESS_MEM_LLM_MODEL: process.env.HARNESS_MEM_LLM_MODEL,
      HARNESS_MEM_LLM_API_KEY: process.env.HARNESS_MEM_LLM_API_KEY,
      HARNESS_MEM_LLM_TOP_K: process.env.HARNESS_MEM_LLM_TOP_K,
    };
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test("HARNESS_MEM_LLM_ENHANCE 未設定時は enabled=false", () => {
    delete process.env.HARNESS_MEM_LLM_ENHANCE;
    const config = buildLlmRerankerConfigFromEnv();
    expect(config.enabled).toBe(false);
  });

  test("HARNESS_MEM_LLM_ENHANCE=true で enabled=true", () => {
    process.env.HARNESS_MEM_LLM_ENHANCE = "true";
    delete process.env.HARNESS_MEM_LLM_PROVIDER;
    const config = buildLlmRerankerConfigFromEnv();
    expect(config.enabled).toBe(true);
    expect(config.provider).toBe("openai");
  });

  test("HARNESS_MEM_LLM_ENHANCE=false で enabled=false", () => {
    process.env.HARNESS_MEM_LLM_ENHANCE = "false";
    const config = buildLlmRerankerConfigFromEnv();
    expect(config.enabled).toBe(false);
  });

  test("HARNESS_MEM_LLM_PROVIDER=anthropic が反映される", () => {
    process.env.HARNESS_MEM_LLM_ENHANCE = "true";
    process.env.HARNESS_MEM_LLM_PROVIDER = "anthropic";
    const config = buildLlmRerankerConfigFromEnv();
    expect(config.provider).toBe("anthropic");
  });

  test("HARNESS_MEM_LLM_TOP_K が数値として反映される", () => {
    process.env.HARNESS_MEM_LLM_ENHANCE = "true";
    process.env.HARNESS_MEM_LLM_TOP_K = "10";
    const config = buildLlmRerankerConfigFromEnv();
    expect(config.topK).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// llmRerank — enabled=false 時のスキップ
// ---------------------------------------------------------------------------

describe("llmRerank — disabled", () => {
  test("enabled=false の場合は元の候補をそのまま返す（fetch 呼ばない）", async () => {
    const config: LlmRerankerConfig = { enabled: false, provider: "openai" };
    const result = await llmRerank("クエリ", sampleCandidates, config);

    expect(result).toHaveLength(sampleCandidates.length);
    // 順序は元のまま
    expect(result.map((r) => r.id)).toEqual(sampleCandidates.map((c) => c.id));
    // スコアも元のまま
    for (let i = 0; i < sampleCandidates.length; i++) {
      expect(result[i]!.score).toBeCloseTo(sampleCandidates[i]!.score);
    }
  });

  test("candidates が空の場合は空配列を返す", async () => {
    const config: LlmRerankerConfig = { enabled: true, provider: "openai", apiKey: "test-key" };
    const result = await llmRerank("クエリ", [], config);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// llmRerank — OpenAI モック
// ---------------------------------------------------------------------------

describe("llmRerank — OpenAI mock", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("OpenAI レスポンスに基づいてスコアを結合・再ソートする", async () => {
    // obs-3 が最高スコア（0.99）、obs-1 が中程度（0.5）
    const mockLlmScores = [
      { index: 0, score: 0.5 }, // obs-1
      { index: 1, score: 0.3 }, // obs-2
      { index: 2, score: 0.99 }, // obs-3
    ];

    globalThis.fetch = mock(async () => {
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(mockLlmScores) } }],
        }),
      } as Response;
    });

    const config: LlmRerankerConfig = {
      enabled: true,
      provider: "openai",
      apiKey: "test-openai-key",
    };

    const result = await llmRerank("パーサー", sampleCandidates, config);

    expect(result).toHaveLength(3);

    // obs-3 の結合スコア: 0.6*0.99 + 0.4*0.3 = 0.714
    // obs-1 の結合スコア: 0.6*0.5 + 0.4*0.9 = 0.66
    // obs-2 の結合スコア: 0.6*0.3 + 0.4*0.6 = 0.42
    // 順序: obs-3 > obs-1 > obs-2
    expect(result[0]!.id).toBe("obs-3");
    expect(result[1]!.id).toBe("obs-1");
    expect(result[2]!.id).toBe("obs-2");

    // スコアが combineScores で計算されていることを確認
    expect(result[0]!.score).toBeCloseTo(0.6 * 0.99 + 0.4 * 0.3, 4);
  });

  test("fetch エラー時は元の候補をそのまま返す（graceful degradation）", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("Network error");
    });

    const config: LlmRerankerConfig = {
      enabled: true,
      provider: "openai",
      apiKey: "test-openai-key",
    };

    const result = await llmRerank("クエリ", sampleCandidates, config);

    // 元の候補が順序・スコアそのままで返される
    expect(result).toHaveLength(sampleCandidates.length);
    expect(result.map((r) => r.id)).toEqual(sampleCandidates.map((c) => c.id));
    for (let i = 0; i < sampleCandidates.length; i++) {
      expect(result[i]!.score).toBeCloseTo(sampleCandidates[i]!.score);
    }
  });

  test("API が 500 を返す場合も graceful degradation", async () => {
    globalThis.fetch = mock(async () => {
      return {
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      } as Response;
    });

    const config: LlmRerankerConfig = {
      enabled: true,
      provider: "openai",
      apiKey: "test-openai-key",
    };

    const result = await llmRerank("クエリ", sampleCandidates, config);
    expect(result.map((r) => r.id)).toEqual(sampleCandidates.map((c) => c.id));
  });

  test("APIキーなしでも graceful degradation（エラーをスロー後フォールバック）", async () => {
    // fetch がそもそも呼ばれないケース（apiKey チェックでエラー）
    globalThis.fetch = mock(async () => {
      throw new Error("Should not be called");
    });

    const config: LlmRerankerConfig = {
      enabled: true,
      provider: "openai",
      // apiKey なし
    };

    const result = await llmRerank("クエリ", sampleCandidates, config);
    // graceful degradation: 元の候補を返す
    expect(result.map((r) => r.id)).toEqual(sampleCandidates.map((c) => c.id));
  });
});

// ---------------------------------------------------------------------------
// llmRerank — Anthropic モック
// ---------------------------------------------------------------------------

describe("llmRerank — Anthropic mock", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("Anthropic レスポンスに基づいてスコアを結合する", async () => {
    const mockLlmScores = [
      { index: 0, score: 0.8 }, // obs-1
      { index: 1, score: 0.4 }, // obs-2
      { index: 2, score: 0.2 }, // obs-3
    ];

    globalThis.fetch = mock(async () => {
      return {
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: JSON.stringify(mockLlmScores) }],
        }),
      } as Response;
    });

    const config: LlmRerankerConfig = {
      enabled: true,
      provider: "anthropic",
      apiKey: "test-anthropic-key",
    };

    const result = await llmRerank("パーサー", sampleCandidates, config);

    // obs-1: 0.6*0.8 + 0.4*0.9 = 0.84
    // obs-2: 0.6*0.4 + 0.4*0.6 = 0.48
    // obs-3: 0.6*0.2 + 0.4*0.3 = 0.24
    expect(result[0]!.id).toBe("obs-1");
    expect(result[0]!.score).toBeCloseTo(0.6 * 0.8 + 0.4 * 0.9, 4);
  });
});

// ---------------------------------------------------------------------------
// llmRerank — topK 制限
// ---------------------------------------------------------------------------

describe("llmRerank — topK", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("topK=2 の場合、上位2件のみ LLM に渡し、残りは元スコアで末尾に追加", async () => {
    let capturedBody: unknown;

    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify([
                  { index: 0, score: 0.9 },
                  { index: 1, score: 0.7 },
                ]),
              },
            },
          ],
        }),
      } as Response;
    });

    const config: LlmRerankerConfig = {
      enabled: true,
      provider: "openai",
      apiKey: "test-key",
      topK: 2,
    };

    const result = await llmRerank("クエリ", sampleCandidates, config);

    // 結果は3件すべて含まれる
    expect(result).toHaveLength(3);
    // obs-3 は topK 外なので末尾（元スコア 0.3）
    expect(result[2]!.id).toBe("obs-3");
    expect(result[2]!.score).toBeCloseTo(0.3);

    // LLM に送ったプロンプトに obs-3 の内容が含まれないことを確認
    const body = capturedBody as { messages: Array<{ content: string }> };
    const prompt = body.messages[0]!.content;
    expect(prompt).not.toContain("[2]");
  });
});
