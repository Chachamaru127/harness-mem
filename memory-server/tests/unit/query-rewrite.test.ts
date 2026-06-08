import { afterEach, describe, expect, test } from "bun:test";
import { queryRewriteMeta, rewriteSearchQueryIfEnabled } from "../../src/retrieval/query-rewrite";

const ENV_KEYS = [
  "HARNESS_MEM_QUERY_REWRITE",
  "HARNESS_MEM_QUERY_REWRITE_MODEL",
  "HARNESS_MEM_QUERY_REWRITE_OLLAMA_HOST",
  "HARNESS_MEM_QUERY_REWRITE_TIMEOUT_MS",
  "HARNESS_MEM_OLLAMA_HOST",
  "HARNESS_MEM_FACT_LLM_MODEL",
] as const;

const oldEnv = new Map<string, string | undefined>();
for (const key of ENV_KEYS) oldEnv.set(key, process.env[key]);

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const old = oldEnv.get(key);
    if (old === undefined) delete process.env[key];
    else process.env[key] = old;
  }
}

afterEach(() => {
  restoreEnv();
});

function fakeOllama(content: string): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ message: { content } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

describe("S154-701 query rewrite", () => {
  test("keeps query unchanged and does not call fetch when flag is off", async () => {
    delete process.env.HARNESS_MEM_QUERY_REWRITE;
    let called = false;
    const result = await rewriteSearchQueryIfEnabled("日英検索の再現率", {
      fetchImpl: (async () => {
        called = true;
        throw new Error("should not call");
      }) as typeof fetch,
    });

    expect(called).toBe(false);
    expect(result.enabled).toBe(false);
    expect(result.applied).toBe(false);
    expect(result.query).toBe("日英検索の再現率");
  });

  test("uses local Ollama JSON rewrite and appends only new retrieval terms", async () => {
    process.env.HARNESS_MEM_QUERY_REWRITE = "1";
    process.env.HARNESS_MEM_QUERY_REWRITE_OLLAMA_HOST = "http://127.0.0.1:11434";
    process.env.HARNESS_MEM_QUERY_REWRITE_MODEL = "qwen3.5:9b";

    const result = await rewriteSearchQueryIfEnabled("日英検索の再現率 scoreFusion", {
      fetchImpl: fakeOllama(JSON.stringify({ query: "bilingual retrieval recall scoreFusion fusion" })),
    });

    expect(result.enabled).toBe(true);
    expect(result.applied).toBe(true);
    expect(result.model).toBe("qwen3.5:9b");
    expect(result.query).toContain("日英検索の再現率");
    expect(result.query).toContain("bilingual");
    expect(result.query).toContain("retrieval");
    expect(result.query).toContain("recall");
    expect(result.query).toContain("fusion");
    expect(result.query.match(/scoreFusion/g)?.length).toBe(1);
    expect(result.addedTokenCount).toBeGreaterThanOrEqual(4);
    expect(result.rewrittenQueryHash).toBeTruthy();
  });

  test("skips rewrite in safe mode", async () => {
    process.env.HARNESS_MEM_QUERY_REWRITE = "1";
    const result = await rewriteSearchQueryIfEnabled("日英検索", {
      safeMode: true,
      fetchImpl: fakeOllama(JSON.stringify({ query: "bilingual retrieval" })),
    });

    expect(result.applied).toBe(false);
    expect(result.query).toBe("日英検索");
    expect(result.degradedReason).toBe("safe_mode");
  });

  test("rejects non-loopback Ollama host without external egress", async () => {
    process.env.HARNESS_MEM_QUERY_REWRITE = "1";
    process.env.HARNESS_MEM_QUERY_REWRITE_OLLAMA_HOST = "https://api.example.com";
    let called = false;
    const result = await rewriteSearchQueryIfEnabled("日英検索", {
      fetchImpl: (async () => {
        called = true;
        return new Response("{}");
      }) as typeof fetch,
    });

    expect(called).toBe(false);
    expect(result.applied).toBe(false);
    expect(result.degradedReason).toBe("non_loopback_ollama_host");
  });

  test("returns privacy-safe metadata without raw query text", async () => {
    process.env.HARNESS_MEM_QUERY_REWRITE = "1";
    const result = await rewriteSearchQueryIfEnabled("private sentinel query", {
      fetchImpl: fakeOllama(JSON.stringify({ query: "private sentinel query expanded" })),
    });
    const meta = queryRewriteMeta(result);
    const serialized = JSON.stringify(meta);

    expect(serialized).not.toContain("private sentinel query");
    expect(meta.enabled).toBe(true);
    expect(meta.original_query_hash).toBeTruthy();
  });
});
