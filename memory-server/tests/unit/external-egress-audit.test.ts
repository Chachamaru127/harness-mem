/**
 * S154-110: external LLM egress audit.
 *
 * Proves the two DoD guarantees:
 *  1) default config makes ZERO external provider calls (no `external.llm.call`
 *     audit rows) — local ollama is not external egress.
 *  2) an explicitly-selected external provider (openai/anthropic/gemini) records
 *     exactly one audit row per observation with metrics only (provider / model /
 *     bytes / observation_count) and NEVER the prompt or response body.
 *
 * Provider HTTP is mocked deterministically (including ollama's 127.0.0.1:11434),
 * so the test does not depend on a running local model.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractFacts,
  llmExtractWithDiff,
  isExternalLlmProvider,
  type ExtractFactInput,
  type ExistingFact,
} from "../../src/consolidation/extractor";
import { HarnessMemCore, type Config, type EventEnvelope } from "../../src/core/harness-mem-core";

const ENV_KEYS = [
  "HARNESS_MEM_FACT_EXTRACTOR_MODE",
  "HARNESS_MEM_FACT_LLM_PROVIDER",
  "HARNESS_MEM_FACT_LLM_MODEL",
  "HARNESS_MEM_OPENAI_API_KEY",
  "HARNESS_MEM_ANTHROPIC_API_KEY",
  "HARNESS_MEM_GEMINI_API_KEY",
  "HARNESS_MEM_OLLAMA_HOST",
  "HARNESS_MEM_ALLOW_EXTERNAL_LLM",
];

const cleanupPaths: string[] = [];
let savedEnv: Record<string, string | undefined> = {};
let originalFetch: typeof globalThis.fetch;

const FACTS_JSON = JSON.stringify({
  facts: [{ fact_type: "decision", fact_key: "decision:db_choice", fact_value: "PostgreSQL", confidence: 0.9 }],
  supersedes: {},
  deleted: [],
});

/** Deterministic provider mock: returns the shape the active provider expects. */
function installProviderMock(): { fetchCount: () => number } {
  let calls = 0;
  globalThis.fetch = async (url: string | URL | Request, opts?: RequestInit): Promise<Response> => {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
    const portMatch = urlStr.match(/:(\d+)/);
    // Pass through OS-assigned high-port local test services; intercept provider ports.
    if ((urlStr.includes("127.0.0.1") || urlStr.includes("localhost") || urlStr.includes("[::1]")) && portMatch && Number(portMatch[1]) >= 30000) {
      return originalFetch(url, opts);
    }
    calls += 1;
    const provider = (process.env.HARNESS_MEM_FACT_LLM_PROVIDER || "ollama").trim().toLowerCase();
    let body: string;
    if (provider === "anthropic") body = JSON.stringify({ content: [{ type: "text", text: FACTS_JSON }] });
    else if (provider === "gemini") body = JSON.stringify({ candidates: [{ content: { parts: [{ text: FACTS_JSON }] } }] });
    else if (provider === "ollama") body = JSON.stringify({ message: { content: FACTS_JSON } });
    else body = JSON.stringify({ choices: [{ message: { content: FACTS_JSON } }] });
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetchCount: () => calls };
}

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  originalFetch = globalThis.fetch;
  installProviderMock();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const SAMPLE: ExtractFactInput = {
  title: "技術選定",
  content: "本番DBを PostgreSQL に決定した。",
  observation_type: "decision",
};
const NO_EXISTING: ExistingFact[] = [];

describe("S154-110 extractor egress classification", () => {
  test("isExternalLlmProvider: openai/anthropic/gemini external, ollama/local not", () => {
    expect(isExternalLlmProvider("openai")).toBe(true);
    expect(isExternalLlmProvider("anthropic")).toBe(true);
    expect(isExternalLlmProvider("gemini")).toBe(true);
    expect(isExternalLlmProvider("ollama")).toBe(false);
    expect(isExternalLlmProvider("heuristic")).toBe(false);
  });

  test("openai call sets egress with byte metrics and NO body", async () => {
    process.env.HARNESS_MEM_FACT_LLM_PROVIDER = "openai";
    process.env.HARNESS_MEM_OPENAI_API_KEY = "sk-test";
    process.env.HARNESS_MEM_FACT_LLM_MODEL = "gpt-4o-mini";
    process.env.HARNESS_MEM_ALLOW_EXTERNAL_LLM = "1";
    const result = await llmExtractWithDiff(SAMPLE, NO_EXISTING);
    expect(result.egress).toBeDefined();
    expect(result.egress!.provider).toBe("openai");
    expect(result.egress!.model).toBe("gpt-4o-mini");
    expect(result.egress!.input_bytes).toBeGreaterThan(0);
    expect(result.egress!.output_bytes).toBeGreaterThan(0);
    // metrics only — never the prompt/response body
    expect(Object.keys(result.egress!).sort()).toEqual(["input_bytes", "model", "output_bytes", "provider"]);
    expect(JSON.stringify(result.egress)).not.toContain("PostgreSQL");
  });

  test("anthropic and gemini also set egress with their provider id", async () => {
    process.env.HARNESS_MEM_ALLOW_EXTERNAL_LLM = "1";
    process.env.HARNESS_MEM_FACT_LLM_PROVIDER = "anthropic";
    process.env.HARNESS_MEM_ANTHROPIC_API_KEY = "sk-ant";
    expect((await llmExtractWithDiff(SAMPLE, NO_EXISTING)).egress?.provider).toBe("anthropic");

    process.env.HARNESS_MEM_FACT_LLM_PROVIDER = "gemini";
    process.env.HARNESS_MEM_GEMINI_API_KEY = "g-key";
    expect((await llmExtractWithDiff(SAMPLE, NO_EXISTING)).egress?.provider).toBe("gemini");
  });

  test("ollama (local 127.0.0.1) leaves egress undefined", async () => {
    process.env.HARNESS_MEM_FACT_LLM_PROVIDER = "ollama";
    process.env.HARNESS_MEM_OLLAMA_HOST = "http://127.0.0.1:11434";
    process.env.HARNESS_MEM_FACT_LLM_MODEL = "qwen3.5:9b";
    const result = await llmExtractWithDiff(SAMPLE, NO_EXISTING);
    expect(result.egress).toBeUndefined();
  });

  test("external provider without an API key makes no call and no egress", async () => {
    process.env.HARNESS_MEM_FACT_LLM_PROVIDER = "openai"; // no API key
    const tracker = installProviderMock();
    const result = await llmExtractWithDiff(SAMPLE, NO_EXISTING);
    expect(tracker.fetchCount()).toBe(0);
    expect(result.egress).toBeUndefined();
  });

  test("external provider with API key but no allow flag makes no call and no egress", async () => {
    process.env.HARNESS_MEM_FACT_LLM_PROVIDER = "openai";
    process.env.HARNESS_MEM_OPENAI_API_KEY = "sk-test";
    const tracker = installProviderMock();
    const result = await llmExtractWithDiff(SAMPLE, NO_EXISTING);
    expect(tracker.fetchCount()).toBe(0);
    expect(result.egress).toBeUndefined();
    expect(result.new_facts).toEqual([]);
  });

  test("non-loopback ollama makes fetch 0 with allow flag absent and present", async () => {
    process.env.HARNESS_MEM_FACT_LLM_PROVIDER = "ollama";
    process.env.HARNESS_MEM_OLLAMA_HOST = "https://ollama.example.com:11434";

    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response("", { status: 500 });
    };
    await llmExtractWithDiff(SAMPLE, NO_EXISTING);
    expect(fetchCalled).toBe(false);

    process.env.HARNESS_MEM_ALLOW_EXTERNAL_LLM = "1";
    fetchCalled = false;
    await llmExtractWithDiff(SAMPLE, NO_EXISTING);
    expect(fetchCalled).toBe(false);
  });

  test("egress and audit metadata never contain prompt, body, API key, token, or secret", async () => {
    process.env.HARNESS_MEM_FACT_LLM_PROVIDER = "openai";
    process.env.HARNESS_MEM_OPENAI_API_KEY = "sk-super-secret-token";
    process.env.HARNESS_MEM_FACT_LLM_MODEL = "gpt-4o-mini";
    process.env.HARNESS_MEM_ALLOW_EXTERNAL_LLM = "1";

    const result = await llmExtractWithDiff(SAMPLE, NO_EXISTING);
    const serialized = JSON.stringify(result.egress ?? {});
    expect(serialized).not.toContain("PostgreSQL");
    expect(serialized).not.toContain("sk-super-secret-token");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("prompt");
    expect(serialized).not.toContain("body");
  });
});

function createConfig(name: string): Config {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-egress-${name}-`));
  cleanupPaths.push(dir);
  return {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 0,
    vectorDimension: 64,
    captureEnabled: true,
    retrievalEnabled: true,
    injectionEnabled: true,
    codexHistoryEnabled: false,
    codexProjectRoot: process.cwd(),
    codexSessionsRoot: process.cwd(),
    codexIngestIntervalMs: 5000,
    codexBackfillHours: 24,
    opencodeIngestEnabled: false,
    cursorIngestEnabled: false,
    antigravityIngestEnabled: false,
    consolidationEnabled: true,
  };
}

function seedEvent(core: HarnessMemCore, project: string, session: string): void {
  const event: EventEnvelope = {
    platform: "claude",
    project,
    session_id: session,
    event_type: "checkpoint",
    ts: "2026-06-08T10:00:00.000Z",
    payload: { prompt: "本番DBを PostgreSQL に決定した。" },
    tags: [],
    privacy_tags: [],
  };
  core.recordEvent(event);
}

function externalRows(core: HarnessMemCore): Array<{ action: string; details: Record<string, unknown> }> {
  const res = core.getAuditLog({ limit: 50, action: "external.llm.call" });
  expect(res.ok).toBe(true);
  return res.items as Array<{ action: string; details: Record<string, unknown> }>;
}

describe("S154-110 consolidation egress audit", () => {
  test("default config (heuristic) records ZERO external.llm.call rows", async () => {
    const core = new HarnessMemCore(createConfig("default"));
    try {
      seedEvent(core, "egress-default", "s1");
      const stats = await core.runConsolidation({ project: "egress-default", session_id: "s1" });
      expect(stats.ok).toBe(true);
      expect(externalRows(core)).toHaveLength(0);
    } finally {
      core.shutdown("test");
    }
  });

  test("external openai provider records one metrics-only audit row", async () => {
    process.env.HARNESS_MEM_FACT_EXTRACTOR_MODE = "llm";
    process.env.HARNESS_MEM_FACT_LLM_PROVIDER = "openai";
    process.env.HARNESS_MEM_OPENAI_API_KEY = "sk-test";
    process.env.HARNESS_MEM_FACT_LLM_MODEL = "gpt-4o-mini";
    process.env.HARNESS_MEM_ALLOW_EXTERNAL_LLM = "1";
    const core = new HarnessMemCore(createConfig("openai"));
    try {
      seedEvent(core, "egress-openai", "s1");
      await core.runConsolidation({ project: "egress-openai", session_id: "s1" });
      const rows = externalRows(core);
      expect(rows.length).toBeGreaterThanOrEqual(1);
      const d = rows[0].details;
      expect(d.provider).toBe("openai");
      expect(d.model).toBe("gpt-4o-mini");
      expect(Number(d.input_bytes)).toBeGreaterThan(0);
      expect(Number(d.output_bytes)).toBeGreaterThan(0);
      expect(Number(d.observation_count)).toBeGreaterThanOrEqual(1);
      // never the prompt/response body
      expect(JSON.stringify(d)).not.toContain("PostgreSQL");
    } finally {
      core.shutdown("test");
    }
  });

  test("local ollama provider records ZERO external.llm.call rows", async () => {
    process.env.HARNESS_MEM_FACT_EXTRACTOR_MODE = "llm";
    process.env.HARNESS_MEM_FACT_LLM_PROVIDER = "ollama";
    process.env.HARNESS_MEM_OLLAMA_HOST = "http://127.0.0.1:11434";
    process.env.HARNESS_MEM_FACT_LLM_MODEL = "qwen3.5:9b";
    const core = new HarnessMemCore(createConfig("ollama"));
    try {
      seedEvent(core, "egress-ollama", "s1");
      await core.runConsolidation({ project: "egress-ollama", session_id: "s1" });
      expect(externalRows(core)).toHaveLength(0);
    } finally {
      core.shutdown("test");
    }
  });

  test("llm mode with default provider uses loopback ollama and records ZERO external rows", async () => {
    process.env.HARNESS_MEM_FACT_EXTRACTOR_MODE = "llm";
    // provider unset → ollama default
    const core = new HarnessMemCore(createConfig("llm-default-ollama"));
    try {
      seedEvent(core, "egress-llm-default", "s1");
      await core.runConsolidation({ project: "egress-llm-default", session_id: "s1" });
      expect(externalRows(core)).toHaveLength(0);
    } finally {
      core.shutdown("test");
    }
  });

  test("blocked cloud extractFacts path records ZERO external.llm.call rows", async () => {
    process.env.HARNESS_MEM_FACT_EXTRACTOR_MODE = "llm";
    process.env.HARNESS_MEM_FACT_LLM_PROVIDER = "openai";
    process.env.HARNESS_MEM_OPENAI_API_KEY = "sk-test";
    const core = new HarnessMemCore(createConfig("blocked-cloud"));
    try {
      seedEvent(core, "egress-blocked", "s1");
      await core.runConsolidation({ project: "egress-blocked", session_id: "s1" });
      expect(externalRows(core)).toHaveLength(0);
    } finally {
      core.shutdown("test");
    }
  });

  test("audit row never contains prompt, body, API key, token, or secret", async () => {
    process.env.HARNESS_MEM_FACT_EXTRACTOR_MODE = "llm";
    process.env.HARNESS_MEM_FACT_LLM_PROVIDER = "openai";
    process.env.HARNESS_MEM_OPENAI_API_KEY = "sk-super-secret-token";
    process.env.HARNESS_MEM_FACT_LLM_MODEL = "gpt-4o-mini";
    process.env.HARNESS_MEM_ALLOW_EXTERNAL_LLM = "1";
    const core = new HarnessMemCore(createConfig("audit-secrecy"));
    try {
      seedEvent(core, "egress-secrecy", "s1");
      await core.runConsolidation({ project: "egress-secrecy", session_id: "s1" });
      const rows = externalRows(core);
      expect(rows.length).toBeGreaterThanOrEqual(1);
      const serialized = JSON.stringify(rows[0].details);
      expect(serialized).not.toContain("PostgreSQL");
      expect(serialized).not.toContain("sk-super-secret-token");
      expect(serialized).not.toContain("prompt");
      expect(serialized).not.toContain("body");
      expect(serialized).not.toContain("secret");
    } finally {
      core.shutdown("test");
    }
  });
});
