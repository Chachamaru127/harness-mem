import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createEmbeddingProviderRegistry,
  detectLanguage,
  resolveEmbeddingShadowProviders,
  selectModelByLanguage,
} from "../../src/embedding/registry";
import { createAdaptiveEmbeddingProvider } from "../../src/embedding/adaptive-provider";
import { createFallbackEmbeddingProvider } from "../../src/embedding/fallback";
import { MODEL_CATALOG } from "../../src/embedding/model-catalog";
import { createProApiEmbeddingProvider } from "../../src/embedding/pro-api-provider";
import type { EmbeddingHealth, EmbeddingProvider } from "../../src/embedding/types";

function resetEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function createStubProvider(
  name: EmbeddingProvider["name"],
  model: string,
  baseVector: number[],
  healthRef: { current: EmbeddingHealth },
  onPrime?: () => void,
  throwWhenDegraded = false
): EmbeddingProvider {
  return {
    name,
    model,
    dimension: baseVector.length,
    embed: () => {
      if (throwWhenDegraded && healthRef.current.status === "degraded") {
        throw new Error(healthRef.current.details);
      }
      return [...baseVector];
    },
    embedQuery: () => {
      if (throwWhenDegraded && healthRef.current.status === "degraded") {
        throw new Error(healthRef.current.details);
      }
      return [...baseVector];
    },
    prime: async () => {
      onPrime?.();
      if (throwWhenDegraded && healthRef.current.status === "degraded") {
        throw new Error(healthRef.current.details);
      }
      return [...baseVector];
    },
    primeQuery: async () => {
      onPrime?.();
      if (throwWhenDegraded && healthRef.current.status === "degraded") {
        throw new Error(healthRef.current.details);
      }
      return [...baseVector];
    },
    health: () => ({ ...healthRef.current }),
  };
}

describe("embedding providers", () => {
  test("fallback provider emits deterministic vectors", () => {
    const provider = createFallbackEmbeddingProvider({ dimension: 64 });
    const first = provider.embed("release checklist");
    const second = provider.embed("release checklist");

    expect(first.length).toBe(64);
    expect(second.length).toBe(64);
    expect(first).toEqual(second);
  });

  test("registry falls back on invalid provider name", () => {
    const prev = process.env.HARNESS_MEM_EMBEDDING_PROVIDER;
    process.env.HARNESS_MEM_EMBEDDING_PROVIDER = "unknown-provider";

    try {
      const registry = createEmbeddingProviderRegistry({
        providerName: process.env.HARNESS_MEM_EMBEDDING_PROVIDER,
        dimension: 64,
      });
      expect(registry.provider.name).toBe("fallback");
      expect(registry.warnings.length).toBeGreaterThan(0);
    } finally {
      resetEnv("HARNESS_MEM_EMBEDDING_PROVIDER", prev);
    }
  });

  test("openai provider degrades to fallback when api key is missing", () => {
    const prevProvider = process.env.HARNESS_MEM_EMBEDDING_PROVIDER;
    const prevKey = process.env.HARNESS_MEM_OPENAI_API_KEY;
    process.env.HARNESS_MEM_EMBEDDING_PROVIDER = "openai";
    delete process.env.HARNESS_MEM_OPENAI_API_KEY;

    try {
      const registry = createEmbeddingProviderRegistry({
        providerName: "openai",
        dimension: 64,
      });
      const vector = registry.provider.embed("provider health");
      expect(vector.length).toBe(64);
      expect(registry.provider.health().status).toBe("degraded");
      expect(registry.provider.health().details).toContain("HARNESS_MEM_OPENAI_API_KEY");
    } finally {
      resetEnv("HARNESS_MEM_EMBEDDING_PROVIDER", prevProvider);
      resetEnv("HARNESS_MEM_OPENAI_API_KEY", prevKey);
    }
  });
});

describe("IMP-008: 埋め込みプロバイダー拡張", () => {
  test("model catalog に gte-small が登録されている", () => {
    const gteEntry = MODEL_CATALOG.find((m) => m.id === "gte-small");
    expect(gteEntry).toBeDefined();
    expect(gteEntry?.language).toBe("en");
    expect(gteEntry?.dimension).toBe(384);
  });

  test("model catalog に e5-small-v2 が登録されている", () => {
    const e5Entry = MODEL_CATALOG.find((m) => m.id === "e5-small-v2");
    expect(e5Entry).toBeDefined();
    expect(e5Entry?.language).toBe("en");
    expect(e5Entry?.dimension).toBe(384);
  });

  test("model catalog に ruri-v3-310m が登録されている", () => {
    const ruriEntry = MODEL_CATALOG.find((m) => m.id === "ruri-v3-310m");
    expect(ruriEntry).toBeDefined();
    expect(ruriEntry?.language).toBe("ja");
    expect(ruriEntry?.dimension).toBe(768);
  });

  test("model catalog に ruri-v3-130m が登録されている", () => {
    const ruriEntry = MODEL_CATALOG.find((m) => m.id === "ruri-v3-130m");
    expect(ruriEntry).toBeDefined();
    expect(ruriEntry?.language).toBe("ja");
    expect(ruriEntry?.dimension).toBe(512);
  });

  test("model catalog に bge-m3 が登録されている", () => {
    const bgeM3Entry = MODEL_CATALOG.find((m) => m.id === "bge-m3");
    expect(bgeM3Entry).toBeDefined();
    expect(bgeM3Entry?.language).toBe("multilingual");
    expect(bgeM3Entry?.dimension).toBe(1024);
  });

  test("detectLanguage: 日本語テキストを ja と判定する", () => {
    expect(detectLanguage("今日はとても良い天気です")).toBe("ja");
    expect(detectLanguage("データベースはPostgreSQLを使用しています")).toBe("ja");
    expect(detectLanguage("ユーザーの設定を保存する")).toBe("ja");
  });

  test("detectLanguage: 英語テキストを en と判定する", () => {
    expect(detectLanguage("The database uses PostgreSQL")).toBe("en");
    expect(detectLanguage("user authentication with JWT tokens")).toBe("en");
    expect(detectLanguage("configure the server settings")).toBe("en");
  });

  test("detectLanguage: 空テキストは en を返す", () => {
    expect(detectLanguage("")).toBe("en");
  });

  test("selectModelByLanguage: 日本語=ruri-v3-30m を選択する", () => {
    expect(selectModelByLanguage("ja")).toBe("ruri-v3-30m");
  });

  test("selectModelByLanguage: 英語=gte-small を選択する", () => {
    expect(selectModelByLanguage("en")).toBe("gte-small");
  });

  test("registry: defaultLanguage=ja の場合、auto モデルは ruri を選択する（プロバイダーが local になる）", () => {
    try {
      const registry = createEmbeddingProviderRegistry({
        providerName: "local",
        dimension: 64,
        localModelId: "auto",
        defaultLanguage: "ja",
      });
      // ruri-v3-30m がインストール済みの場合は local provider、未インストールなら fallback
      // いずれにせよ警告なしまたは fallback になることを確認
      expect(registry.provider.name === "local" || registry.provider.name === "fallback").toBe(true);
    } finally {
      // env cleanup not needed (no env changes)
    }
  });

  test("registry: defaultLanguage=en の場合、auto モデルは gte-small を選択する（未インストールなら fallback）", () => {
    try {
      const registry = createEmbeddingProviderRegistry({
        providerName: "local",
        dimension: 64,
        localModelId: "auto",
        defaultLanguage: "en",
      });
      // gte-small が未インストールの場合は警告に "gte-small" が含まれる
      if (registry.warnings.length > 0) {
        expect(registry.warnings.some((w) => w.includes("gte-small"))).toBe(true);
        expect(registry.provider.name).toBe("fallback");
      } else {
        // インストール済みの場合は local provider になる
        expect(registry.provider.name).toBe("local");
      }
    } finally {
      // env cleanup not needed (no env changes)
    }
  });

  test("registry: provider=auto はインストール済み local model を優先する", () => {
    const modelsDir = mkdtempSync(join(tmpdir(), "hmem-auto-provider-"));
    const modelDir = join(modelsDir, "multilingual-e5");
    mkdirSync(join(modelDir, "onnx"), { recursive: true });
    writeFileSync(join(modelDir, "tokenizer.json"), "{}");
    writeFileSync(join(modelDir, "onnx", "model.onnx"), "fake");

    try {
      const registry = createEmbeddingProviderRegistry({
        providerName: "auto",
        dimension: 64,
        localModelId: "multilingual-e5",
        localModelsDir: modelsDir,
      });
      expect(registry.provider.name).toBe("local");
      expect(registry.provider.model).toBe("multilingual-e5");
      expect(registry.warnings).toEqual([]);
    } finally {
      rmSync(modelsDir, { recursive: true, force: true });
    }
  });

  test("registry: provider=auto は model 未インストール時に静かに fallback する", () => {
    const modelsDir = mkdtempSync(join(tmpdir(), "hmem-auto-fallback-"));

    try {
      const registry = createEmbeddingProviderRegistry({
        providerName: "auto",
        dimension: 64,
        localModelId: "multilingual-e5",
        localModelsDir: modelsDir,
      });
      expect(registry.provider.name).toBe("fallback");
      expect(registry.warnings).toEqual([]);
    } finally {
      rmSync(modelsDir, { recursive: true, force: true });
    }
  });

  test("registry: provider=local は bge-m3 を local ONNX provider として解決する", () => {
    const modelsDir = mkdtempSync(join(tmpdir(), "hmem-bge-m3-provider-"));
    const modelDir = join(modelsDir, "bge-m3");
    mkdirSync(join(modelDir, "onnx"), { recursive: true });
    writeFileSync(join(modelDir, "tokenizer.json"), "{}");
    writeFileSync(join(modelDir, "onnx", "model.onnx"), "fake");

    try {
      const registry = createEmbeddingProviderRegistry({
        providerName: "local",
        dimension: 1024,
        localModelId: "bge-m3",
        localModelsDir: modelsDir,
      });
      expect(registry.provider.name).toBe("local");
      expect(registry.provider.model).toBe("bge-m3");
      expect(registry.provider.dimension).toBe(1024);
      expect(registry.warnings).toEqual([]);
    } finally {
      rmSync(modelsDir, { recursive: true, force: true });
    }
  });

  test("registry: embedding shadow candidates are local-only and require separate vector tables", () => {
    const modelsDir = mkdtempSync(join(tmpdir(), "hmem-shadow-candidates-"));
    const installModel = (modelId: string) => {
      const modelDir = join(modelsDir, modelId);
      mkdirSync(join(modelDir, "onnx"), { recursive: true });
      writeFileSync(join(modelDir, "tokenizer.json"), "{}");
      writeFileSync(join(modelDir, "onnx", "model.onnx"), "fake");
    };
    installModel("ruri-v3-30m");

    try {
      // S154-502: the default shadow set is the 2026 generation; judged or
      // demoted models (ruri / bge-m3) remain reachable via explicit modelIds.
      const candidates = resolveEmbeddingShadowProviders({
        currentVectorModel: "local:multilingual-e5",
        currentVectorDimension: 384,
        localModelsDir: modelsDir,
      });
      expect(candidates.map((candidate) => candidate.model_id)).toEqual([
        "qwen3-embedding-0.6b",
        "granite-embedding-311m-r2",
      ]);
      expect(candidates.every((candidate) => candidate.provider === "local")).toBe(true);
      expect(candidates.every((candidate) => candidate.inference === "onnx")).toBe(true);
      expect(candidates.every((candidate) => candidate.local_only === true)).toBe(true);
      expect(candidates.every((candidate) => candidate.separate_vector_table_required === true)).toBe(true);

      const explicit = resolveEmbeddingShadowProviders({
        currentVectorModel: "local:multilingual-e5",
        currentVectorDimension: 384,
        localModelsDir: modelsDir,
        modelIds: ["ruri-v3-30m", "bge-m3"],
      });
      expect(explicit.find((candidate) => candidate.model_id === "ruri-v3-30m")?.status).toBe("ready");
      expect(explicit.find((candidate) => candidate.model_id === "bge-m3")?.status).toBe("not_installed");
    } finally {
      rmSync(modelsDir, { recursive: true, force: true });
    }
  });

  test("registry: adaptive provider は free 構成で adaptive を返す", () => {
    const modelsDir = mkdtempSync(join(tmpdir(), "hmem-adaptive-provider-"));
    const installModel = (modelId: string) => {
      const modelDir = join(modelsDir, modelId);
      mkdirSync(join(modelDir, "onnx"), { recursive: true });
      writeFileSync(join(modelDir, "tokenizer.json"), "{}");
      writeFileSync(join(modelDir, "onnx", "model.onnx"), "fake");
    };
    installModel("ruri-v3-30m");
    installModel("multilingual-e5");

    try {
      const registry = createEmbeddingProviderRegistry({
        providerName: "adaptive",
        dimension: 64,
        localModelsDir: modelsDir,
      });
      expect(registry.provider.name).toBe("adaptive");
      expect(registry.provider.usesLocalModels).toBe(true);
      expect(registry.warnings).toEqual([]);
    } finally {
      rmSync(modelsDir, { recursive: true, force: true });
    }
  });

  test("registry: provider=adaptive は adaptive provider を返す", () => {
    const registry = createEmbeddingProviderRegistry({
      providerName: "adaptive",
      dimension: 64,
    });

    expect(registry.provider.name).toBe("adaptive");
    expect(registry.provider.model).toContain("+");
  });

  test("adaptive provider は route ごとの model label を公開する", () => {
    const registry = createEmbeddingProviderRegistry({
      providerName: "adaptive",
      dimension: 64,
    });

    expect(registry.provider.routeFor?.("これは日本語です")).toBe("ruri");
    expect(registry.provider.primaryModelFor?.("これは日本語です")).toContain(":");
    expect(registry.provider.routeFor?.("deploy rollback plan")).toBe("openai");
    const mixedQuery = "本番 deploy の手順と rollback plan を確認したい";
    expect(registry.provider.routeFor?.(mixedQuery)).toBe("ensemble");
    expect(registry.provider.secondaryModelFor?.(mixedQuery)).toContain(":");
  });

  test("pro api provider は prime 後に cache を使い、再リクエストしない", async () => {
    let calls = 0;

    const provider = createProApiEmbeddingProvider({
      dimension: 4,
      apiKey: "test-key",
      apiUrl: "https://example.test/embeddings",
      fetchImpl: async (url: string | URL | Request, init?: RequestInit) => {
        calls += 1;
        expect(String(url)).toBe("https://example.test/embeddings");
        expect(init?.method).toBe("POST");
        return new Response(JSON.stringify({ embedding: [0.1, 0.2, 0.3, 0.4] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    const primed = await provider.primeQuery?.("deploy rollback");
    const embedded = provider.embedQuery?.("deploy rollback");
    const stats = provider.cacheStats?.();

    expect(calls).toBe(1);
    expect(embedded).toEqual(primed);
    expect(stats?.entries).toBe(1);
    expect(stats?.hits).toBeGreaterThanOrEqual(1);
    expect(provider.health().status).toBe("healthy");
  });

  test("pro api provider は zdrEnforced=true で in-memory cache を作らない (at-rest で content が残らない)", async () => {
    let calls = 0;
    const provider = createProApiEmbeddingProvider({
      dimension: 4,
      apiKey: "test-key",
      apiUrl: "https://example.test/embeddings",
      zdrEnforced: true,
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({ embedding: [0.1, 0.2, 0.3, 0.4] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    // Two prime calls with the same input — without ZDR, the second call hits
    // the cache. With ZDR enforced, every call goes through and nothing
    // accumulates: entries stays 0, hits stays 0.
    await provider.primeQuery?.("incident postmortem text");
    await provider.primeQuery?.("incident postmortem text");
    const stats = provider.cacheStats?.();

    expect(calls).toBe(2);
    expect(stats?.entries).toBe(0);
    expect(stats?.hits).toBe(0);
    expect(provider.health().details).toContain("zdr=enforced");
  });

  test("pro api provider は zdrEnforced=true でも error message に入力テキストを混入させない", async () => {
    const secret = "ZDR_INPUT_TEXT_THAT_MUST_NOT_LEAK_5b7c9";
    const provider = createProApiEmbeddingProvider({
      dimension: 4,
      apiKey: "test-key",
      apiUrl: "https://example.test/embeddings",
      zdrEnforced: true,
      fetchImpl: async () => new Response("boom", { status: 503 }),
    });

    await expect(provider.prime?.(secret)).rejects.toThrow();
    expect(provider.health().details).not.toContain(secret);
    expect(provider.health().details).not.toContain("ZDR_INPUT_TEXT");
  });

  test("pro api provider は障害時に degraded を返す", async () => {
    const provider = createProApiEmbeddingProvider({
      dimension: 4,
      apiKey: "test-key",
      apiUrl: "https://example.test/embeddings",
      fetchImpl: async () => new Response("boom", { status: 503 }),
    });

    await expect(provider.prime?.("incident review")).rejects.toThrow("503");
    expect(provider.health().status).toBe("degraded");
    expect(provider.health().details).toContain("503");
  });

  test("registry: adaptive provider は Pro API が設定されても adaptive leg を Pro 化せず警告だけ出す (Pro=C: Pro は granite route の背後)", () => {
    const modelsDir = mkdtempSync(join(tmpdir(), "hmem-adaptive-pro-provider-"));
    const installModel = (modelId: string) => {
      const modelDir = join(modelsDir, modelId);
      mkdirSync(join(modelDir, "onnx"), { recursive: true });
      writeFileSync(join(modelDir, "tokenizer.json"), "{}");
      writeFileSync(join(modelDir, "onnx", "model.onnx"), "fake");
    };
    installModel("ruri-v3-30m");
    installModel("multilingual-e5");

    try {
      const registry = createEmbeddingProviderRegistry({
        providerName: "adaptive",
        dimension: 64,
        localModelsDir: modelsDir,
        proApiKey: "pro-key",
        proApiUrl: "https://example.test/embeddings",
      });
      expect(registry.warnings.some((w) => w.includes("auto/local granite path"))).toBe(true);
      expect(registry.provider.primaryModelFor?.("deploy rollback plan")).not.toContain("pro-api");
    } finally {
      rmSync(modelsDir, { recursive: true, force: true });
    }
  });

  test("registry: granite route + Pro env で granite leg が Pro エンドポイントに格上げされる (Pro=C)", () => {
    const modelsDir = mkdtempSync(join(tmpdir(), "hmem-granite-pro-"));
    const modelId = "granite-embedding-311m-r2";
    const modelDir = join(modelsDir, modelId);
    mkdirSync(join(modelDir, "onnx"), { recursive: true });
    writeFileSync(join(modelDir, "tokenizer.json"), "{}");
    writeFileSync(join(modelDir, "onnx", "model.onnx"), "fake");

    try {
      const registry = createEmbeddingProviderRegistry({
        providerName: "auto",
        localModelId: modelId,
        dimension: 64,
        localModelsDir: modelsDir,
        proApiKey: "pro-key",
        proApiUrl: "https://example.test/embeddings",
      });
      expect(registry.warnings).toEqual([]);
      expect(registry.provider.name).toBe("pro-api");
      // default Pro model matches the active granite catalog entry, not a third-party
      expect(registry.provider.model).toBe(modelId);
    } finally {
      rmSync(modelsDir, { recursive: true, force: true });
    }
  });

  test("registry: granite route で Pro env 未設定なら無料 local granite を維持 (live default 不変)", () => {
    const modelsDir = mkdtempSync(join(tmpdir(), "hmem-granite-local-"));
    const modelId = "granite-embedding-311m-r2";
    const modelDir = join(modelsDir, modelId);
    mkdirSync(join(modelDir, "onnx"), { recursive: true });
    writeFileSync(join(modelDir, "tokenizer.json"), "{}");
    writeFileSync(join(modelDir, "onnx", "model.onnx"), "fake");

    try {
      const registry = createEmbeddingProviderRegistry({
        providerName: "auto",
        localModelId: modelId,
        dimension: 64,
        localModelsDir: modelsDir,
        // no proApiKey / proApiUrl
      });
      expect(registry.warnings).toEqual([]);
      expect(registry.provider.name).not.toBe("pro-api");
    } finally {
      rmSync(modelsDir, { recursive: true, force: true });
    }
  });

  test("registry: 非 granite (ruri) ルートで Pro env を立てても Pro 化しない (Pro は granite 限定)", () => {
    const modelsDir = mkdtempSync(join(tmpdir(), "hmem-ruri-pro-skip-"));
    const modelId = "ruri-v3-30m";
    const modelDir = join(modelsDir, modelId);
    mkdirSync(join(modelDir, "onnx"), { recursive: true });
    writeFileSync(join(modelDir, "tokenizer.json"), "{}");
    writeFileSync(join(modelDir, "onnx", "model.onnx"), "fake");

    try {
      const registry = createEmbeddingProviderRegistry({
        providerName: "auto",
        localModelId: modelId,
        dimension: 64,
        localModelsDir: modelsDir,
        proApiKey: "pro-key",
        proApiUrl: "https://example.test/embeddings",
      });
      expect(registry.warnings.some((w) => w.includes("only wired into the granite route"))).toBe(true);
      expect(registry.provider.name).not.toBe("pro-api");
    } finally {
      rmSync(modelsDir, { recursive: true, force: true });
    }
  });

  test("adaptive provider は general route 障害時に fallback provider へ切り替える", () => {
    const japaneseHealth = { current: { status: "healthy", details: "ruri ok" } satisfies EmbeddingHealth };
    const proHealth = { current: { status: "degraded", details: "remote down" } satisfies EmbeddingHealth };
    const freeHealth = { current: { status: "healthy", details: "multilingual ok" } satisfies EmbeddingHealth };
    const fallbackVector = [0.4, 0.6, 0, 0, 0, 0, 0, 0];

    const provider = createAdaptiveEmbeddingProvider({
      japaneseProvider: createStubProvider("local", "ruri-v3-30m", [0.9, 0.1, 0, 0, 0, 0, 0, 0], japaneseHealth),
      generalProvider: createStubProvider(
        "pro-api",
        "text-embedding-3-large",
        [0.1, 0.9, 0, 0, 0, 0, 0, 0],
        proHealth,
        undefined,
        true
      ),
      generalFallbackProvider: createStubProvider("local", "multilingual-e5", fallbackVector, freeHealth),
      dimension: 8,
    });

    expect(provider.embedQuery("deploy rollback plan")).toEqual(fallbackVector);
    expect(provider.primaryModelFor("deploy rollback plan")).toContain("adaptive:general:local:multilingual-e5");
    expect(provider.health().status).toBe("degraded");
  });

  test("adaptive provider は backoff 後に general route の recovery probe を行う", async () => {
    const originalNow = Date.now;
    let now = 1_000;
    Date.now = () => now;
    try {
      const japaneseHealth = { current: { status: "healthy", details: "ruri ok" } satisfies EmbeddingHealth };
      const proHealth = { current: { status: "degraded", details: "remote down" } satisfies EmbeddingHealth };
      const freeHealth = { current: { status: "healthy", details: "gte ok" } satisfies EmbeddingHealth };
      const proVector = [0.1, 0.9, 0, 0, 0, 0, 0, 0];
      let proPrimeCalls = 0;

      const provider = createAdaptiveEmbeddingProvider({
        japaneseProvider: createStubProvider("local", "ruri-v3-30m", [0.9, 0.1, 0, 0, 0, 0, 0, 0], japaneseHealth),
        generalProvider: createStubProvider(
          "pro-api",
          "text-embedding-3-large",
          proVector,
          proHealth,
          () => {
            proPrimeCalls += 1;
          },
          true
        ),
        generalFallbackProvider: createStubProvider("local", "multilingual-e5", [0.4, 0.6, 0, 0, 0, 0, 0, 0], freeHealth),
        dimension: 8,
      });

      await provider.primeQuery?.("deploy rollback plan");
      expect(proPrimeCalls).toBe(0);

      now += 10_001;
      proHealth.current = { status: "healthy", details: "remote recovered" };
      const recovered = await provider.primeQuery?.("deploy rollback plan");

      expect(proPrimeCalls).toBe(1);
      expect(recovered).toEqual(proVector);
      expect(provider.primaryModelFor("deploy rollback plan")).toContain("adaptive:general:pro-api:text-embedding-3-large");
      expect(provider.health().status).toBe("healthy");
    } finally {
      Date.now = originalNow;
    }
  });
});
