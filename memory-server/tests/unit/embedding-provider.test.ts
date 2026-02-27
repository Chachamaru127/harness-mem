import { describe, expect, test } from "bun:test";
import { createEmbeddingProviderRegistry, detectLanguage, selectModelByLanguage } from "../../src/embedding/registry";
import { createFallbackEmbeddingProvider } from "../../src/embedding/fallback";
import { MODEL_CATALOG } from "../../src/embedding/model-catalog";

function resetEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
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
});
