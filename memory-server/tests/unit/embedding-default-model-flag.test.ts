import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createEmbeddingProviderRegistry,
  parseEmbeddingDefaultModelFlag,
} from "../../src/embedding/registry";
import {
  EMBEDDING_DEFAULT_MODEL_KEY,
  INCUMBENT_EMBEDDING_MODEL,
} from "../../src/core/config-manager";

function makeFlagDb(value?: string): Database {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE mem_meta (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)");
  if (value !== undefined) {
    db.query("INSERT INTO mem_meta(key, value, updated_at) VALUES (?, ?, ?)").run(
      EMBEDDING_DEFAULT_MODEL_KEY,
      value,
      new Date().toISOString(),
    );
  }
  return db;
}

function installFakeModel(modelsDir: string, modelId: string): void {
  const modelDir = join(modelsDir, modelId);
  mkdirSync(join(modelDir, "onnx"), { recursive: true });
  writeFileSync(join(modelDir, "tokenizer.json"), "{}");
  writeFileSync(join(modelDir, "onnx", "model.onnx"), "fake");
}

describe("embedding_default_model flag parsing", () => {
  test("bare modelId resolves to native catalog dimension", () => {
    const parsed = parseEmbeddingDefaultModelFlag("granite-embedding-311m-r2");
    expect(parsed).toEqual({ ok: true, modelId: "granite-embedding-311m-r2", dimension: 768 });
  });

  test("modelId@dimension truncates a matryoshka model", () => {
    const parsed = parseEmbeddingDefaultModelFlag("granite-embedding-311m-r2@384");
    expect(parsed).toEqual({ ok: true, modelId: "granite-embedding-311m-r2", dimension: 384 });
  });

  test("unknown modelId is rejected", () => {
    const parsed = parseEmbeddingDefaultModelFlag("not-a-real-model@384");
    expect(parsed.ok).toBe(false);
  });

  test("native-dimension truncation on a non-matryoshka model is rejected", () => {
    // multilingual-e5 has no nativeDimension/matryoshka declared; sub-native is illegal.
    const parsed = parseEmbeddingDefaultModelFlag("multilingual-e5@128");
    expect(parsed.ok).toBe(false);
  });

  test("dimension above nativeDimension is rejected", () => {
    const parsed = parseEmbeddingDefaultModelFlag("granite-embedding-311m-r2@1024");
    expect(parsed.ok).toBe(false);
  });

  test("non-numeric dimension is rejected", () => {
    const parsed = parseEmbeddingDefaultModelFlag("granite-embedding-311m-r2@abc");
    expect(parsed.ok).toBe(false);
  });

  test("trailing @ with empty dimension is rejected (not treated as bare)", () => {
    const parsed = parseEmbeddingDefaultModelFlag("granite-embedding-311m-r2@");
    expect(parsed.ok).toBe(false);
  });

  test("empty flag resolves to nothing", () => {
    expect(parseEmbeddingDefaultModelFlag("").ok).toBe(false);
    expect(parseEmbeddingDefaultModelFlag(undefined).ok).toBe(false);
  });
});

describe("registry: embedding_default_model flag wiring", () => {
  test("flag unset → behaviour identical to no-db (parity)", () => {
    const modelsDir = mkdtempSync(join(tmpdir(), "hmem-flag-parity-"));
    installFakeModel(modelsDir, "multilingual-e5");
    const prevEnv = process.env.HARNESS_MEM_EMBEDDING_MODEL;
    delete process.env.HARNESS_MEM_EMBEDDING_MODEL;
    const db = makeFlagDb();
    try {
      const withoutDb = createEmbeddingProviderRegistry({
        providerName: "local",
        dimension: 384,
        localModelId: INCUMBENT_EMBEDDING_MODEL,
        localModelsDir: modelsDir,
      });
      const withDb = createEmbeddingProviderRegistry({
        providerName: "local",
        dimension: 384,
        localModelId: INCUMBENT_EMBEDDING_MODEL,
        localModelsDir: modelsDir,
        db,
      });
      expect(withDb.provider.name).toBe(withoutDb.provider.name);
      expect(withDb.provider.model).toBe(withoutDb.provider.model);
      expect(withDb.provider.dimension).toBe(withoutDb.provider.dimension);
      expect(withDb.provider.model).toBe("multilingual-e5");
      expect(withDb.warnings).toEqual(withoutDb.warnings);
    } finally {
      db.close();
      rmSync(modelsDir, { recursive: true, force: true });
      if (prevEnv === undefined) delete process.env.HARNESS_MEM_EMBEDDING_MODEL;
      else process.env.HARNESS_MEM_EMBEDDING_MODEL = prevEnv;
    }
  });

  test("bare granite (native 768) ≠ store 384 → warn + incumbent fail-safe", () => {
    // P2 fix: a bare flag whose native dimension differs from the store's
    // effective vector dimension would store/search padded-or-sliced vectors
    // outside the local provider's Matryoshka truncate+renormalize path. Reject.
    const modelsDir = mkdtempSync(join(tmpdir(), "hmem-flag-bare-mismatch-"));
    installFakeModel(modelsDir, "multilingual-e5");
    installFakeModel(modelsDir, "granite-embedding-311m-r2");
    const prevEnv = process.env.HARNESS_MEM_EMBEDDING_MODEL;
    delete process.env.HARNESS_MEM_EMBEDDING_MODEL;
    const db = makeFlagDb("granite-embedding-311m-r2");
    try {
      const registry = createEmbeddingProviderRegistry({
        providerName: "local",
        dimension: 384,
        localModelId: INCUMBENT_EMBEDDING_MODEL,
        localModelsDir: modelsDir,
        db,
      });
      expect(registry.provider.name).toBe("local");
      expect(registry.provider.model).toBe("multilingual-e5");
      expect(registry.provider.dimension).toBe(384);
      expect(registry.warnings.some((w) => w.includes("embedding_default_model"))).toBe(true);
    } finally {
      db.close();
      rmSync(modelsDir, { recursive: true, force: true });
      if (prevEnv === undefined) delete process.env.HARNESS_MEM_EMBEDDING_MODEL;
      else process.env.HARNESS_MEM_EMBEDDING_MODEL = prevEnv;
    }
  });

  test("granite@768 (qualified) ≠ store 384 → warn + incumbent fail-safe", () => {
    // P2 fix: a dimension-qualified flag still must match the store dimension;
    // 768 ≠ 384 is rejected just like the bare form.
    const modelsDir = mkdtempSync(join(tmpdir(), "hmem-flag-qual-mismatch-"));
    installFakeModel(modelsDir, "multilingual-e5");
    installFakeModel(modelsDir, "granite-embedding-311m-r2");
    const prevEnv = process.env.HARNESS_MEM_EMBEDDING_MODEL;
    delete process.env.HARNESS_MEM_EMBEDDING_MODEL;
    const db = makeFlagDb("granite-embedding-311m-r2@768");
    try {
      const registry = createEmbeddingProviderRegistry({
        providerName: "local",
        dimension: 384,
        localModelId: INCUMBENT_EMBEDDING_MODEL,
        localModelsDir: modelsDir,
        db,
      });
      expect(registry.provider.name).toBe("local");
      expect(registry.provider.model).toBe("multilingual-e5");
      expect(registry.provider.dimension).toBe(384);
      expect(registry.warnings.some((w) => w.includes("embedding_default_model"))).toBe(true);
    } finally {
      db.close();
      rmSync(modelsDir, { recursive: true, force: true });
      if (prevEnv === undefined) delete process.env.HARNESS_MEM_EMBEDDING_MODEL;
      else process.env.HARNESS_MEM_EMBEDDING_MODEL = prevEnv;
    }
  });

  test("flag granite@384 → provider starts as local granite at 384", () => {
    const modelsDir = mkdtempSync(join(tmpdir(), "hmem-flag-granite-"));
    installFakeModel(modelsDir, "granite-embedding-311m-r2");
    const prevEnv = process.env.HARNESS_MEM_EMBEDDING_MODEL;
    delete process.env.HARNESS_MEM_EMBEDDING_MODEL;
    const db = makeFlagDb("granite-embedding-311m-r2@384");
    try {
      const registry = createEmbeddingProviderRegistry({
        providerName: "local",
        dimension: 384,
        localModelId: INCUMBENT_EMBEDDING_MODEL,
        localModelsDir: modelsDir,
        db,
      });
      expect(registry.provider.name).toBe("local");
      expect(registry.provider.model).toBe("granite-embedding-311m-r2");
      expect(registry.provider.dimension).toBe(384);
      expect(registry.warnings).toEqual([]);
    } finally {
      db.close();
      rmSync(modelsDir, { recursive: true, force: true });
      if (prevEnv === undefined) delete process.env.HARNESS_MEM_EMBEDDING_MODEL;
      else process.env.HARNESS_MEM_EMBEDDING_MODEL = prevEnv;
    }
  });

  test("flag granite@384 but granite NOT installed → incumbent e5, not synthetic", () => {
    // P2 (round 3): catalog-valid + dimension-matching flag whose model is not
    // yet installed must NOT be accepted. If accepted, the local/auto path sees
    // modelPath === null and leaves the synthetic hash fallback as the provider,
    // so searches ignore existing local:multilingual-e5 vectors until the
    // candidate is pulled. Treat uninstalled flag as failure → keep incumbent.
    const modelsDir = mkdtempSync(join(tmpdir(), "hmem-flag-granite-uninstalled-"));
    installFakeModel(modelsDir, "multilingual-e5"); // incumbent installed, granite is not
    const prevEnv = process.env.HARNESS_MEM_EMBEDDING_MODEL;
    delete process.env.HARNESS_MEM_EMBEDDING_MODEL;
    const db = makeFlagDb("granite-embedding-311m-r2@384");
    try {
      const registry = createEmbeddingProviderRegistry({
        providerName: "local",
        dimension: 384,
        localModelId: INCUMBENT_EMBEDDING_MODEL,
        localModelsDir: modelsDir,
        db,
      });
      expect(registry.provider.name).toBe("local");
      expect(registry.provider.model).toBe("multilingual-e5");
      expect(registry.provider.dimension).toBe(384);
      expect(
        registry.warnings.some((w) => w.includes("embedding_default_model") && w.includes("not installed")),
      ).toBe(true);
    } finally {
      db.close();
      rmSync(modelsDir, { recursive: true, force: true });
      if (prevEnv === undefined) delete process.env.HARNESS_MEM_EMBEDDING_MODEL;
      else process.env.HARNESS_MEM_EMBEDDING_MODEL = prevEnv;
    }
  });

  test("invalid flag → warn + incumbent fail-safe (no throw)", () => {
    const modelsDir = mkdtempSync(join(tmpdir(), "hmem-flag-invalid-"));
    installFakeModel(modelsDir, "multilingual-e5");
    const prevEnv = process.env.HARNESS_MEM_EMBEDDING_MODEL;
    delete process.env.HARNESS_MEM_EMBEDDING_MODEL;
    const db = makeFlagDb("multilingual-e5@128");
    try {
      const registry = createEmbeddingProviderRegistry({
        providerName: "local",
        dimension: 384,
        localModelId: INCUMBENT_EMBEDDING_MODEL,
        localModelsDir: modelsDir,
        db,
      });
      expect(registry.provider.name).toBe("local");
      expect(registry.provider.model).toBe("multilingual-e5");
      expect(registry.provider.dimension).toBe(384);
      expect(registry.warnings.some((w) => w.includes("embedding_default_model"))).toBe(true);
    } finally {
      db.close();
      rmSync(modelsDir, { recursive: true, force: true });
      if (prevEnv === undefined) delete process.env.HARNESS_MEM_EMBEDDING_MODEL;
      else process.env.HARNESS_MEM_EMBEDDING_MODEL = prevEnv;
    }
  });

  test("explicit env wins over flag (precedence)", () => {
    const modelsDir = mkdtempSync(join(tmpdir(), "hmem-flag-env-"));
    installFakeModel(modelsDir, "multilingual-e5");
    installFakeModel(modelsDir, "granite-embedding-311m-r2");
    const prevEnv = process.env.HARNESS_MEM_EMBEDDING_MODEL;
    process.env.HARNESS_MEM_EMBEDDING_MODEL = "multilingual-e5";
    const db = makeFlagDb("granite-embedding-311m-r2@384");
    try {
      const registry = createEmbeddingProviderRegistry({
        providerName: "local",
        dimension: 384,
        localModelId: "multilingual-e5",
        localModelsDir: modelsDir,
        db,
      });
      expect(registry.provider.model).toBe("multilingual-e5");
      expect(registry.provider.dimension).toBe(384);
    } finally {
      db.close();
      rmSync(modelsDir, { recursive: true, force: true });
      if (prevEnv === undefined) delete process.env.HARNESS_MEM_EMBEDDING_MODEL;
      else process.env.HARNESS_MEM_EMBEDDING_MODEL = prevEnv;
    }
  });
});
