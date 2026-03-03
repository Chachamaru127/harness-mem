/**
 * @harness-mem/sdk - Vercel AI SDK Provider tests
 *
 * HarnessMemVercelProvider の動作を fetch モックで検証する。
 */

import { describe, expect, test } from "bun:test";
import { HarnessMemVercelProvider } from "../src/vercel-ai";
import type { VercelAIMessage } from "../src/vercel-ai";
import type { HarnessMemClient } from "../src/client";

// --- モッククライアント ---

type SearchItems = Array<{
  id: string;
  content: string;
  title?: string;
  observation_type?: string;
  created_at?: string;
}>;

function makeMockClient(items: SearchItems = []): HarnessMemClient {
  return {
    search: async () => ({
      ok: true,
      source: "mock",
      items,
      meta: { count: items.length },
    }),
  } as unknown as HarnessMemClient;
}

// --- asTool() テスト ---

describe("HarnessMemVercelProvider.asTool()", () => {
  test("正しい形式のオブジェクトを返す", () => {
    const client = makeMockClient();
    const provider = new HarnessMemVercelProvider(client);
    const tool = provider.asTool() as Record<string, unknown>;

    expect(tool.name).toBe("harness_mem_search");
    expect(tool.description).toBeTypeOf("string");
    expect((tool.parameters as { type: string }).type).toBe("object");
  });

  test("parameters に query プロパティが定義されている", () => {
    const client = makeMockClient();
    const provider = new HarnessMemVercelProvider(client);
    const tool = provider.asTool() as {
      parameters: { properties: { query: { type: string } }; required: string[] };
    };

    expect(tool.parameters.properties.query.type).toBe("string");
    expect(tool.parameters.required).toContain("query");
  });

  test("execute() が検索結果の items を返す", async () => {
    const items: SearchItems = [
      { id: "obs-1", content: "TypeScript を採用", title: "技術選定", observation_type: "decision" },
    ];
    const client = makeMockClient(items);
    const provider = new HarnessMemVercelProvider(client);
    const tool = provider.asTool() as { execute: (args: { query: string }) => Promise<unknown> };

    const result = await tool.execute({ query: "TypeScript" });
    expect(result).toEqual(items);
  });

  test("execute() が空の検索結果を返しても配列を返す", async () => {
    const client = makeMockClient([]);
    const provider = new HarnessMemVercelProvider(client);
    const tool = provider.asTool() as { execute: (args: { query: string }) => Promise<unknown[]> };

    const result = await tool.execute({ query: "unknown topic" });
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  test("maxResults オプションが search に渡される", async () => {
    let capturedLimit: number | undefined;
    const client = {
      search: async (input: { limit?: number }) => {
        capturedLimit = input.limit;
        return { ok: true, source: "mock", items: [], meta: {} };
      },
    } as unknown as HarnessMemClient;

    const provider = new HarnessMemVercelProvider(client, { maxResults: 3 });
    const tool = provider.asTool() as { execute: (args: { query: string }) => Promise<unknown> };
    await tool.execute({ query: "test" });

    expect(capturedLimit).toBe(3);
  });
});

// --- asMiddleware() テスト ---

describe("HarnessMemVercelProvider.asMiddleware()", () => {
  test("ユーザーメッセージがない場合、messages をそのまま返す", async () => {
    const client = makeMockClient();
    const provider = new HarnessMemVercelProvider(client);
    const messages: VercelAIMessage[] = [{ role: "assistant", content: "こんにちは" }];

    const result = await provider.asMiddleware().transformMessages(messages);
    expect(result).toEqual(messages);
  });

  test("検索結果が空の場合、messages をそのまま返す", async () => {
    const client = makeMockClient([]);
    const provider = new HarnessMemVercelProvider(client);
    const messages: VercelAIMessage[] = [{ role: "user", content: "テスト" }];

    const result = await provider.asMiddleware().transformMessages(messages);
    expect(result).toEqual(messages);
  });

  test("既存の system メッセージに記憶を追記する", async () => {
    const items: SearchItems = [
      { id: "obs-1", content: "React を採用", title: "技術選定", observation_type: "decision" },
    ];
    const client = makeMockClient(items);
    const provider = new HarnessMemVercelProvider(client);
    const messages: VercelAIMessage[] = [
      { role: "system", content: "あなたは優秀なアシスタントです。" },
      { role: "user", content: "フロントエンド技術について教えて" },
    ];

    const result = await provider.asMiddleware().transformMessages(messages);
    const systemMsg = result.find((m) => m.role === "system");

    expect(typeof systemMsg?.content).toBe("string");
    expect(systemMsg?.content as string).toContain("Long-term Memory");
    expect(systemMsg?.content as string).toContain("React を採用");
    expect(systemMsg?.content as string).toContain("あなたは優秀なアシスタントです。");
  });

  test("system メッセージがない場合、先頭に追加する", async () => {
    const items: SearchItems = [
      { id: "obs-2", content: "PostgreSQL を使う", title: "DB 選定", observation_type: "decision" },
    ];
    const client = makeMockClient(items);
    const provider = new HarnessMemVercelProvider(client);
    const messages: VercelAIMessage[] = [{ role: "user", content: "DB の選択について" }];

    const result = await provider.asMiddleware().transformMessages(messages);

    expect(result[0].role).toBe("system");
    expect(result[0].content as string).toContain("Long-term Memory");
    expect(result[0].content as string).toContain("PostgreSQL を使う");
    // 元の user メッセージは保持されている
    expect(result[1].role).toBe("user");
  });

  test("元の messages 配列を変更しない（イミュータブル）", async () => {
    const items: SearchItems = [
      { id: "obs-3", content: "不変性テスト用", title: "test", observation_type: "context" },
    ];
    const client = makeMockClient(items);
    const provider = new HarnessMemVercelProvider(client);
    const messages: VercelAIMessage[] = [
      { role: "system", content: "original system" },
      { role: "user", content: "query" },
    ];
    const originalSystemContent = messages[0].content;

    await provider.asMiddleware().transformMessages(messages);

    // 元の messages は変更されていない
    expect(messages[0].content).toBe(originalSystemContent);
  });

  test("ユーザーメッセージが配列形式の content でも動作する", async () => {
    const items: SearchItems = [
      { id: "obs-4", content: "配列コンテンツテスト", title: "test", observation_type: "context" },
    ];
    const client = makeMockClient(items);
    const provider = new HarnessMemVercelProvider(client);
    const messages: VercelAIMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "配列形式のコンテンツ" }],
      },
    ];

    const result = await provider.asMiddleware().transformMessages(messages);
    const systemMsg = result.find((m) => m.role === "system");

    expect(systemMsg).toBeDefined();
    expect(systemMsg?.content as string).toContain("Long-term Memory");
  });
});
