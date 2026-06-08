import { describe, expect, test } from "bun:test";
import { SupermemoryAdapter } from "../adapters/supermemory";
import { httpIngestMemories } from "../adapters/http-search";
import type { BenchmarkCase } from "../lib/types";

const sampleCase: BenchmarkCase = {
  case_id: "smoke-1",
  layer: "public_compatible",
  category: "smoke",
  language_profile: "mixed",
  project: "bench-smoke",
  memories: [{ id: "m1", content: "cursor hook ingest checkpoint" }],
  query: "What platform ingested this?",
  relevant_ids: ["m1"],
};

describe("supermemory adapter", () => {
  test("skips when SUPERMEMORY_API_KEY is unset", async () => {
    const prev = process.env.SUPERMEMORY_API_KEY;
    delete process.env.SUPERMEMORY_API_KEY;
    const adapter = new SupermemoryAdapter();
    const context = { run_id: "r1", competitor_id: "supermemory", project_prefix: "bench" };
    const result = await adapter.query(sampleCase, context);
    expect(result.status).toBe("skipped_missing_credentials");
    if (prev) process.env.SUPERMEMORY_API_KEY = prev;
  });

  test("httpIngestMemories posts each memory when ingest path is configured", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? "") });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    await httpIngestMemories(
      {
        competitorId: "supermemory",
        baseUrl: "https://example.test",
        token: "test-key",
        ingestPath: "/v3/documents",
        fetchImpl,
      },
      sampleCase,
      "bench:bench-smoke",
    );

    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toContain("/v3/documents");
    expect(calls[0]?.body).toContain("cursor hook ingest checkpoint");
  });
});
