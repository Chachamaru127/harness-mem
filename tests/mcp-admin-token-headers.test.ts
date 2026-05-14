import { afterEach, describe, expect, test } from "bun:test";
import { handleMemoryTool } from "../mcp-server/src/tools/memory";

type FetchCall = { url: string; headers: Record<string, string> };

const originalFetch = globalThis.fetch;
const originalToken = process.env.HARNESS_MEM_ADMIN_TOKEN;

function normalizeHeaders(raw: HeadersInit | undefined): Record<string, string> {
  if (!raw) {
    return {};
  }
  if (raw instanceof Headers) {
    const out: Record<string, string> = {};
    raw.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
    return out;
  }
  if (Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (const [key, value] of raw) {
      out[String(key).toLowerCase()] = String(value);
    }
    return out;
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    out[key.toLowerCase()] = String(value);
  }
  return out;
}

function installFetchMock(calls: FetchCall[]): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    // localhost パススルー（並列実行中の統合テストを破壊しない）
    if (url.includes("127.0.0.1") || url.includes("localhost")) {
      // MCP の callMemoryApi は 127.0.0.1:37888 を叩くので、それはキャプチャする
      if (!url.includes(":37888")) {
        return originalFetch(input, init);
      }
    }
    calls.push({ url, headers: normalizeHeaders(init?.headers) });

    if (url.endsWith("/health")) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        source: "core",
        items: [],
        meta: { count: 0, latency_ms: 1, filters: {}, ranking: "test" },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      }
    );
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (typeof originalToken === "string") {
    process.env.HARNESS_MEM_ADMIN_TOKEN = originalToken;
  } else {
    delete process.env.HARNESS_MEM_ADMIN_TOKEN;
  }
});

describe("mcp memory admin token forwarding", () => {
  test("adds token headers for POST and GET when HARNESS_MEM_ADMIN_TOKEN is set", async () => {
    process.env.HARNESS_MEM_ADMIN_TOKEN = "test-admin-token";
    const calls: FetchCall[] = [];
    installFetchMock(calls);

    const post = await handleMemoryTool("harness_mem_search", { query: "token header test" });
    expect(post.isError).toBeUndefined();

    const get = await handleMemoryTool("harness_mem_search_facets", { query: "token header test" });
    expect(get.isError).toBeUndefined();

    const apiCalls = calls.filter((call) => !call.url.includes("/health"));
    expect(apiCalls.length).toBeGreaterThanOrEqual(2);
    for (const call of apiCalls) {
      expect(call.headers["x-harness-mem-token"]).toBe("test-admin-token");
      expect(call.headers.authorization).toBe("Bearer test-admin-token");
    }
  });
});
