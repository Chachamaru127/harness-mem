import { describe, expect, test } from "bun:test";
import type { BenchmarkCase } from "../lib/types";
import {
  agentmemoryHealthCheck,
  agentmemoryRememberMemories,
  agentmemorySmartSearch,
  assertLocalhostOnly,
  normalizeAgentmemoryHits,
  resolveAgentmemoryConfig,
} from "../adapters/agentmemory-rest";

const sampleCase: BenchmarkCase = {
  case_id: "am-001",
  layer: "mixed_coding",
  category: "real_mixed_ar",
  competency: "AR",
  language_profile: "mixed",
  project: "bench-am",
  memories: [{ id: "am-001-m1", content: "Plans.md uses cc:WIP markers." }],
  query: "Plans marker?",
  relevant_ids: ["am-001-m1"],
  expected_keywords: ["cc:WIP"],
};

describe("agentmemory REST client", () => {
  test("resolveAgentmemoryConfig defaults to localhost :3111", () => {
    const prevUrl = process.env.AGENTMEMORY_URL;
    const prevSecret = process.env.AGENTMEMORY_SECRET;
    delete process.env.AGENTMEMORY_URL;
    delete process.env.AGENTMEMORY_SECRET;
    try {
      expect(resolveAgentmemoryConfig()).toEqual({
        baseUrl: "http://127.0.0.1:3111",
        secret: undefined,
      });
    } finally {
      if (prevUrl) process.env.AGENTMEMORY_URL = prevUrl;
      else delete process.env.AGENTMEMORY_URL;
      if (prevSecret) process.env.AGENTMEMORY_SECRET = prevSecret;
      else delete process.env.AGENTMEMORY_SECRET;
    }
  });

  test("assertLocalhostOnly rejects remote hosts", () => {
    expect(() => assertLocalhostOnly("https://agentmemory.example.com")).toThrow(
      /localhost-only/,
    );
    expect(() => assertLocalhostOnly("http://127.0.0.1:3111")).not.toThrow();
    expect(() => assertLocalhostOnly("http://localhost:3111")).not.toThrow();
  });

  test("remember sends Bearer AGENTMEMORY_SECRET and official path", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response("{}", { status: 200 });
    };
    await agentmemoryRememberMemories(
      { baseUrl: "http://127.0.0.1:3111", secret: "bench-secret", fetchImpl },
      sampleCase,
      "bench-run:bench-am",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://127.0.0.1:3111/agentmemory/remember");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer bench-secret");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.project).toBe("bench-run:bench-am");
    expect(body.content).toContain("cc:WIP");
    expect(body.metadata.external_id).toBe("am-001-m1");
  });

  test("remember throws on HTTP failure", async () => {
    const fetchImpl = async () => new Response("bad", { status: 500 });
    await expect(
      agentmemoryRememberMemories(
        { baseUrl: "http://127.0.0.1:3111", fetchImpl },
        sampleCase,
        "bench-run:bench-am",
      ),
    ).rejects.toThrow(/remember failed/);
  });

  test("smart-search uses official payload and normalizes results", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          results: [
            { id: "mem-1", score: 0.91, title: "Plans", content: "cc:WIP marker" },
          ],
        }),
        { status: 200 },
      );
    const result = await agentmemorySmartSearch(
      { baseUrl: "http://127.0.0.1:3111", fetchImpl },
      sampleCase,
      "bench-run:bench-am",
    );
    expect(result.status).toBe("ok");
    expect(result.hits[0]?.id).toBe("mem-1");
    expect(result.hits[0]?.content).toContain("cc:WIP");
  });

  test("smart-search maps 401 to error", async () => {
    const fetchImpl = async () => new Response("unauthorized", { status: 401 });
    const result = await agentmemorySmartSearch(
      { baseUrl: "http://127.0.0.1:3111", secret: "wrong", fetchImpl },
      sampleCase,
      "bench-run:bench-am",
    );
    expect(result.status).toBe("error");
    expect(result.error).toContain("401");
  });

  test("normalizeAgentmemoryHits accepts items and memories shapes", () => {
    expect(
      normalizeAgentmemoryHits({
        items: [{ memory_id: "a", summary: "hello" }],
      }),
    ).toEqual([{ id: "a", rank: 1, content: "hello", score: undefined }]);
    expect(
      normalizeAgentmemoryHits({
        memories: [{ memoryId: "b", text: "world", score: 0.5 }],
      }),
    ).toEqual([{ id: "b", rank: 1, content: "world", score: 0.5 }]);
  });

  test("health check uses /agentmemory/health", async () => {
    let url = "";
    const fetchImpl = async (target: string | URL) => {
      url = String(target);
      return new Response("ok", { status: 200 });
    };
    expect(await agentmemoryHealthCheck({ baseUrl: "http://127.0.0.1:3111", fetchImpl })).toBe(
      true,
    );
    expect(url).toBe("http://127.0.0.1:3111/agentmemory/health");
  });
});
