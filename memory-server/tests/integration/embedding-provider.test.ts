import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { HarnessMemCore, type Config } from "../../src/core/harness-mem-core";

function makeConfig(dir: string): Config {
  return {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 0,
    vectorDimension: 64,
    adaptiveJaThreshold: 0.85,
    adaptiveCodeThreshold: 0.5,
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
  };
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("embedding provider integration", () => {
  test("health and metrics expose embedding provider information", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-embedding-health-"));
    const previous = process.env.HARNESS_MEM_EMBEDDING_PROVIDER;
    process.env.HARNESS_MEM_EMBEDDING_PROVIDER = "fallback";

    const core = new HarnessMemCore(makeConfig(dir));
    try {
      const healthItem = core.health().items[0] as Record<string, unknown>;
      const metricsItem = core.metrics().items[0] as Record<string, unknown>;

      expect(healthItem.embedding_provider).toBe("fallback");
      expect(typeof healthItem.embedding_provider_status).toBe("string");
      expect(metricsItem.embedding_provider).toBe("fallback");
      expect(metricsItem.embedding_provider_status).toBe("healthy");
    } finally {
      core.shutdown("test");
      if (previous === undefined) {
        delete process.env.HARNESS_MEM_EMBEDDING_PROVIDER;
      } else {
        process.env.HARNESS_MEM_EMBEDDING_PROVIDER = previous;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("provider switch requires no DB migration", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-embedding-migration-"));
    const dbPath = join(dir, "harness-mem.db");

    const previousProvider = process.env.HARNESS_MEM_EMBEDDING_PROVIDER;
    delete process.env.HARNESS_MEM_OPENAI_API_KEY;

    process.env.HARNESS_MEM_EMBEDDING_PROVIDER = "fallback";
    const config1 = makeConfig(dir);
    config1.embeddingProvider = "fallback";
    const core1 = new HarnessMemCore(config1);
    try {
      core1.recordEvent({
        event_id: "provider-migration",
        platform: "codex",
        project: "provider-migration",
        session_id: "provider-migration-session",
        event_type: "user_prompt",
        payload: { content: "provider migration smoke" },
        tags: [],
        privacy_tags: [],
      });
    } finally {
      core1.shutdown("test");
    }

    const beforeDb = new Database(dbPath, { readonly: true });
    const beforeTables = beforeDb
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    beforeDb.close(false);

    process.env.HARNESS_MEM_EMBEDDING_PROVIDER = "openai";
    const config2 = makeConfig(dir);
    config2.embeddingProvider = "openai";
    const core2 = new HarnessMemCore(config2);
    try {
      const search = core2.search({
        query: "provider migration smoke",
        project: "provider-migration",
        limit: 5,
        include_private: true,
      });
      expect(search.ok).toBe(true);
      expect(search.items.length).toBeGreaterThan(0);
    } finally {
      core2.shutdown("test");
    }

    const afterDb = new Database(dbPath, { readonly: true });
    const afterTables = afterDb
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    afterDb.close(false);

    expect(afterTables.map((row) => row.name)).toEqual(beforeTables.map((row) => row.name));

    if (previousProvider === undefined) {
      delete process.env.HARNESS_MEM_EMBEDDING_PROVIDER;
    } else {
      process.env.HARNESS_MEM_EMBEDDING_PROVIDER = previousProvider;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test("adaptive provider exposes readiness and health metadata with local models", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-adaptive-health-"));
    const modelsDir = join(dir, "models");
    const installModel = (modelId: string) => {
      const modelDir = join(modelsDir, modelId);
      mkdirSync(join(modelDir, "onnx"), { recursive: true });
      writeFileSync(join(modelDir, "tokenizer.json"), "{}");
      writeFileSync(join(modelDir, "onnx", "model.onnx"), "fake");
    };
    installModel("ruri-v3-30m");
    installModel("multilingual-e5");

    const previousProvider = process.env.HARNESS_MEM_EMBEDDING_PROVIDER;
    const previousModelsDir = process.env.HARNESS_MEM_LOCAL_MODELS_DIR;
    process.env.HARNESS_MEM_EMBEDDING_PROVIDER = "adaptive";
    process.env.HARNESS_MEM_LOCAL_MODELS_DIR = modelsDir;

    const config = makeConfig(dir);
    config.embeddingProvider = "adaptive";
    config.localModelsDir = modelsDir;

    const core = new HarnessMemCore(config);
    try {
      const readinessItem = core.readiness().items[0] as Record<string, unknown>;
      const healthItem = core.health().items[0] as Record<string, unknown>;

      expect(readinessItem.embedding_ready).toBeDefined();
      expect(typeof readinessItem.embedding_readiness_required).toBe("boolean");
      expect(typeof healthItem.embedding_provider_status).toBe("string");
      expect(healthItem.embedding_provider).toBe("adaptive");
    } finally {
      core.shutdown("test");
      if (previousProvider === undefined) {
        delete process.env.HARNESS_MEM_EMBEDDING_PROVIDER;
      } else {
        process.env.HARNESS_MEM_EMBEDDING_PROVIDER = previousProvider;
      }
      if (previousModelsDir === undefined) {
        delete process.env.HARNESS_MEM_LOCAL_MODELS_DIR;
      } else {
        process.env.HARNESS_MEM_LOCAL_MODELS_DIR = previousModelsDir;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("adaptive provider records and searches mixed-language observations", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-adaptive-search-"));
    const modelsDir = join(dir, "empty-models");
    mkdirSync(modelsDir, { recursive: true });
    const previousProvider = process.env.HARNESS_MEM_EMBEDDING_PROVIDER;
    const previousModelsDir = process.env.HARNESS_MEM_LOCAL_MODELS_DIR;

    process.env.HARNESS_MEM_EMBEDDING_PROVIDER = "adaptive";
    process.env.HARNESS_MEM_LOCAL_MODELS_DIR = modelsDir;

    const config = makeConfig(dir);
    config.embeddingProvider = "adaptive";
    config.localModelsDir = modelsDir;
    const core = new HarnessMemCore(config);
    try {
      core.recordEvent({
        event_id: "adaptive-search-001",
        platform: "codex",
        project: "adaptive-search",
        session_id: "adaptive-search-session",
        event_type: "user_prompt",
        payload: { content: "本番 deploy の手順と rollback plan を確認したい" },
        tags: [],
        privacy_tags: [],
      });

      const db = new Database(config.dbPath, { readonly: true });
      const storedModels = db
        .query<{ model: string }, []>(
          `SELECT model
           FROM mem_vectors
           WHERE observation_id = 'obs_adaptive-search-001'
           ORDER BY model ASC`,
        )
        .all()
        .map((row) => row.model);
      db.close(false);
      expect(storedModels.length).toBeGreaterThanOrEqual(2);

      const result = core.search({
        query: "本番 deploy の手順",
        project: "adaptive-search",
        limit: 5,
        include_private: true,
      });

      expect(result.ok).toBe(true);
      expect(result.items.length).toBeGreaterThan(0);
    } finally {
      core.shutdown("test");
      if (previousProvider === undefined) {
        delete process.env.HARNESS_MEM_EMBEDDING_PROVIDER;
      } else {
        process.env.HARNESS_MEM_EMBEDDING_PROVIDER = previousProvider;
      }
      if (previousModelsDir === undefined) {
        delete process.env.HARNESS_MEM_LOCAL_MODELS_DIR;
      } else {
        process.env.HARNESS_MEM_LOCAL_MODELS_DIR = previousModelsDir;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("adaptive provider stores pro-api model labels when Pro API route succeeds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-adaptive-pro-success-"));
    const modelsDir = join(dir, "empty-models");
    mkdirSync(modelsDir, { recursive: true });
    let fetchCalls = 0;
    globalThis.fetch = mock(async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ embedding: [0.11, 0.22, 0.33, 0.44] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const previousProvider = process.env.HARNESS_MEM_EMBEDDING_PROVIDER;
    const previousModelsDir = process.env.HARNESS_MEM_LOCAL_MODELS_DIR;
    const previousProKey = process.env.HARNESS_MEM_PRO_API_KEY;
    const previousProUrl = process.env.HARNESS_MEM_PRO_API_URL;
    process.env.HARNESS_MEM_EMBEDDING_PROVIDER = "adaptive";
    process.env.HARNESS_MEM_LOCAL_MODELS_DIR = modelsDir;
    process.env.HARNESS_MEM_PRO_API_KEY = "pro-key";
    process.env.HARNESS_MEM_PRO_API_URL = "https://example.test/embeddings";

    const config = makeConfig(dir);
    config.embeddingProvider = "adaptive";
    config.localModelsDir = modelsDir;
    config.proApiKey = "pro-key";
    config.proApiUrl = "https://example.test/embeddings";

    const core = new HarnessMemCore(config);
    try {
      const event = {
        event_id: "adaptive-pro-success-001",
        platform: "codex",
        project: "adaptive-pro-success",
        session_id: "adaptive-pro-success-session",
        event_type: "user_prompt",
        payload: { content: "deploy rollback plan" },
        tags: [],
        privacy_tags: [],
      } as const;
      await core.primeEmbedding("deploy rollback plan", "passage");
      const response = core.recordEvent(event);
      expect(response.ok).toBe(true);

      const db = new Database(config.dbPath, { readonly: true });
      const storedModels = db
        .query<{ model: string }, []>(
          `SELECT model
           FROM mem_vectors
           WHERE observation_id = 'obs_adaptive-pro-success-001'
           ORDER BY model ASC`,
        )
        .all()
        .map((row) => row.model);
      db.close(false);

      expect(fetchCalls).toBeGreaterThan(0);
      expect(storedModels).toEqual(["adaptive:general:pro-api:text-embedding-3-large"]);
    } finally {
      core.shutdown("test");
      if (previousProvider === undefined) {
        delete process.env.HARNESS_MEM_EMBEDDING_PROVIDER;
      } else {
        process.env.HARNESS_MEM_EMBEDDING_PROVIDER = previousProvider;
      }
      if (previousModelsDir === undefined) {
        delete process.env.HARNESS_MEM_LOCAL_MODELS_DIR;
      } else {
        process.env.HARNESS_MEM_LOCAL_MODELS_DIR = previousModelsDir;
      }
      if (previousProKey === undefined) {
        delete process.env.HARNESS_MEM_PRO_API_KEY;
      } else {
        process.env.HARNESS_MEM_PRO_API_KEY = previousProKey;
      }
      if (previousProUrl === undefined) {
        delete process.env.HARNESS_MEM_PRO_API_URL;
      } else {
        process.env.HARNESS_MEM_PRO_API_URL = previousProUrl;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("adaptive provider falls back to local general model and later recovers after backoff", async () => {
    const originalNow = Date.now;
    let now = 1_000;
    Date.now = () => now;
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-adaptive-pro-recovery-"));
    const modelsDir = join(dir, "empty-models");
    mkdirSync(modelsDir, { recursive: true });

    let fetchCalls = 0;
    globalThis.fetch = mock(async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        return new Response("unavailable", { status: 503 });
      }
      return new Response(JSON.stringify({ embedding: [0.11, 0.22, 0.33, 0.44] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const previousProvider = process.env.HARNESS_MEM_EMBEDDING_PROVIDER;
    const previousModelsDir = process.env.HARNESS_MEM_LOCAL_MODELS_DIR;
    const previousProKey = process.env.HARNESS_MEM_PRO_API_KEY;
    const previousProUrl = process.env.HARNESS_MEM_PRO_API_URL;
    process.env.HARNESS_MEM_EMBEDDING_PROVIDER = "adaptive";
    process.env.HARNESS_MEM_LOCAL_MODELS_DIR = modelsDir;
    process.env.HARNESS_MEM_PRO_API_KEY = "pro-key";
    process.env.HARNESS_MEM_PRO_API_URL = "https://example.test/embeddings";

    const config = makeConfig(dir);
    config.embeddingProvider = "adaptive";
    config.localModelsDir = modelsDir;
    config.proApiKey = "pro-key";
    config.proApiUrl = "https://example.test/embeddings";

    const core = new HarnessMemCore(config);
    try {
      const firstEvent = {
        event_id: "adaptive-pro-recovery-001",
        platform: "codex",
        project: "adaptive-pro-recovery",
        session_id: "adaptive-pro-recovery-session",
        event_type: "user_prompt",
        payload: { content: "deploy rollback plan" },
        tags: [],
        privacy_tags: [],
      } as const;
      await core.primeEmbedding("deploy rollback plan", "passage");
      const firstResponse = core.recordEvent(firstEvent);
      expect(firstResponse.ok).toBe(true);

      now += 10_001;

      const secondEvent = {
        event_id: "adaptive-pro-recovery-002",
        platform: "codex",
        project: "adaptive-pro-recovery",
        session_id: "adaptive-pro-recovery-session",
        event_type: "user_prompt",
        payload: { content: "deploy rollback checklist" },
        tags: [],
        privacy_tags: [],
      } as const;
      await core.primeEmbedding("deploy rollback checklist", "passage");
      const secondResponse = core.recordEvent(secondEvent);
      expect(secondResponse.ok).toBe(true);

      const db = new Database(config.dbPath, { readonly: true });
      const rows = db
        .query<{ observation_id: string; model: string }, []>(
          `SELECT observation_id, model
           FROM mem_vectors
           WHERE observation_id IN ('obs_adaptive-pro-recovery-001', 'obs_adaptive-pro-recovery-002')
           ORDER BY observation_id ASC`,
        )
        .all();
      db.close(false);

      const firstModel = rows.find((row) => row.observation_id === "obs_adaptive-pro-recovery-001")?.model;
      const secondModel = rows.find((row) => row.observation_id === "obs_adaptive-pro-recovery-002")?.model;

      expect(fetchCalls).toBe(2);
      expect(firstModel).toBe("adaptive:general:fallback:local-hash-v3");
      expect(secondModel).toBe("adaptive:general:pro-api:text-embedding-3-large");
    } finally {
      Date.now = originalNow;
      core.shutdown("test");
      if (previousProvider === undefined) {
        delete process.env.HARNESS_MEM_EMBEDDING_PROVIDER;
      } else {
        process.env.HARNESS_MEM_EMBEDDING_PROVIDER = previousProvider;
      }
      if (previousModelsDir === undefined) {
        delete process.env.HARNESS_MEM_LOCAL_MODELS_DIR;
      } else {
        process.env.HARNESS_MEM_LOCAL_MODELS_DIR = previousModelsDir;
      }
      if (previousProKey === undefined) {
        delete process.env.HARNESS_MEM_PRO_API_KEY;
      } else {
        process.env.HARNESS_MEM_PRO_API_KEY = previousProKey;
      }
      if (previousProUrl === undefined) {
        delete process.env.HARNESS_MEM_PRO_API_URL;
      } else {
        process.env.HARNESS_MEM_PRO_API_URL = previousProUrl;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
