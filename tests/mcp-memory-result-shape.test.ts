import { afterEach, describe, expect, test } from "bun:test";

import { handleMemoryTool } from "../mcp-server/src/tools/memory";

const originalFetch = globalThis.fetch;

function installFetchMock(): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

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
        items: [
          {
            id: "obs-1",
            platform: "codex",
            session_id: "sess-1",
            created_at: "2026-04-04T00:00:00.000Z",
            type: "observation",
          },
        ],
        meta: { count: 1, latency_ms: 1, filters: {}, ranking: "test" },
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
});

describe("mcp memory result shape", () => {
  test("returns structured content, max result size metadata, and citations", async () => {
    installFetchMock();

    const result = await handleMemoryTool("harness_mem_search", {
      query: "shape test",
    });

    expect(result.isError).toBeUndefined();
    expect((result as Record<string, unknown>).structuredContent).toBeDefined();
    expect((result as Record<string, unknown>)._meta).toEqual(
      expect.objectContaining({
        "anthropic/maxResultSizeChars": 500000,
      })
    );
    expect((result as Record<string, unknown>)._citations).toEqual([
      expect.objectContaining({
        id: "obs-1",
        source: "codex",
        session_id: "sess-1",
      }),
    ]);
  });
});
