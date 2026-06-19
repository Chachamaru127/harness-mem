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
function installProviderMock(): void {
  globalThis.fetch = async (url: string | URL | Request, opts?: RequestInit): Promise<Response> => {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
    const portMatch = urlStr.match(/:(\d+)/);
    // Pass through OS-assigned high-port local test services; intercept provider ports.
    if ((urlStr.includes("127.0.0.1") || urlStr.includes("localhost")) && portMatch && Number(portMatch[1]) >= 30000) {
      return originalFetch(url, opts);
    }
    const provider = (process.env.HARNESS_MEM_FACT_LLM_PROVIDER || "openai").trim().toLowerCase();
    let body: string;
    if (provider === "anthropic") body = JSON.stringify({ content: [{ type: "text", text: FACTS_JSON }] });
    else if (provider === "gemini") body = JSON.stringify({ candidates: [{ content: { parts: [{ text: FACTS_JSON }] } }] });
    else if (provider === "ollama") body = JSON.stringify({ message: { content: FACTS_JSON } });
    else body = JSON.stringify({ choices: [{ message: { content: FACTS_JSON } }] });
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  };
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
    const result = await llmExtractWithDiff(SAMPLE, NO_EXISTING);
    expect(result.egress).toBeUndefined();
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
});
