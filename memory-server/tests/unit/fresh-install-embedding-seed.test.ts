import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initSchema, migrateSchema } from "../../src/db/schema";
import { createEmbeddingProviderRegistry } from "../../src/embedding/registry";
import { HarnessMemCore, type Config } from "../../src/core/harness-mem-core";
import {
  EMBEDDING_DEFAULT_MODEL_KEY,
  INCUMBENT_EMBEDDING_MODEL,
  INSTALLATION_MARKER_META_KEY,
  REFERENCE_DEFAULT_EMBEDDING_MODEL_FLAG,
  getEmbeddingDefaultModel,
  setEmbeddingDefaultModel,
} from "../../src/core/config-manager";

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const target = cleanupPaths.pop();
    if (target) rmSync(target, { recursive: true, force: true });
  }
});

function makeTempDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `hmem-fresh-seed-${name}-`));
  cleanupPaths.push(dir);
  return dir;
}

function installFakeModel(modelsDir: string, modelId: string): void {
  const modelDir = join(modelsDir, modelId);
  mkdirSync(join(modelDir, "onnx"), { recursive: true });
  writeFileSync(join(modelDir, "tokenizer.json"), "{}");
  writeFileSync(join(modelDir, "onnx", "model.onnx"), "fake");
}

function coreConfig(dbPath: string, modelsDir: string, extra: Partial<Config> = {}): Config {
  return {
    dbPath,
    bindHost: "127.0.0.1",
    bindPort: 0,
    vectorDimension: 384,
    embeddingProvider: "local",
    embeddingModel: INCUMBENT_EMBEDDING_MODEL,
    localModelsDir: modelsDir,
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
    backgroundWorkersEnabled: false,
    ...extra,
  };
}

function openPreparedDb(name: string): { db: Database; dbPath: string; modelsDir: string; dir: string } {
  const dir = makeTempDir(name);
  const dbPath = join(dir, "harness-mem.db");
  const modelsDir = join(dir, "models");
  const db = new Database(dbPath);
  initSchema(db);
  migrateSchema(db);
  return { db, dbPath, modelsDir, dir };
}

function getMeta(db: Database, key: string): string | null {
  const row = db.query("SELECT value FROM mem_meta WHERE key = ?").get(key) as { value: string } | null;
  return row?.value ?? null;
}

function setMeta(db: Database, key: string, value: string): void {
  db.query(
    `INSERT INTO mem_meta(key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, new Date().toISOString());
}

function insertObservation(db: Database): void {
  db.query(
    `INSERT INTO mem_observations(
      id, platform, project, session_id, content, content_redacted,
      tags_json, privacy_tags_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "obs-existing-upgrade",
    "codex",
    "project",
    "session",
    "existing memory",
    "existing memory",
    "[]",
    "[]",
    "2026-07-05T00:00:00.000Z",
    "2026-07-05T00:00:00.000Z",
  );
}

function seedAuditCount(db: Database): number {
  const row = db
    .query("SELECT COUNT(*) AS count FROM mem_audit_log WHERE action = ?")
    .get("admin.embedding_default_model.seed") as { count: number };
  return Number(row.count);
}

function withEnv<T>(updates: Record<string, string | undefined>, fn: () => T): T {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(updates)) {
    previous[key] = process.env[key];
    const value = updates[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("fresh install embedding default seed", () => {
  test("fresh DB seeds granite@384, writes marker, and records seed audit evidence", () => {
    const dir = makeTempDir("fresh");
    const dbPath = join(dir, "harness-mem.db");
    const modelsDir = join(dir, "models");

    withEnv({ HARNESS_MEM_EMBEDDING_MODEL: undefined, HARNESS_MEM_DISABLE_FRESH_INSTALL_SEED: undefined }, () => {
      const core = new HarnessMemCore(coreConfig(dbPath, modelsDir));
      const db = core.getRawDb();
      expect(getMeta(db, EMBEDDING_DEFAULT_MODEL_KEY)).toBe(REFERENCE_DEFAULT_EMBEDDING_MODEL_FLAG);
      expect(getMeta(db, INSTALLATION_MARKER_META_KEY)).toBeTruthy();
      expect(seedAuditCount(db)).toBe(1);
    });
  });

  test("fresh DB with operator preset flag keeps the flag and writes marker only", () => {
    const { db, dbPath, modelsDir } = openPreparedDb("operator-flag");
    setMeta(db, EMBEDDING_DEFAULT_MODEL_KEY, INCUMBENT_EMBEDDING_MODEL);
    db.close();

    withEnv({ HARNESS_MEM_EMBEDDING_MODEL: undefined, HARNESS_MEM_DISABLE_FRESH_INSTALL_SEED: undefined }, () => {
      const core = new HarnessMemCore(coreConfig(dbPath, modelsDir));
      const raw = core.getRawDb();
      expect(getMeta(raw, EMBEDDING_DEFAULT_MODEL_KEY)).toBe(INCUMBENT_EMBEDDING_MODEL);
      expect(getMeta(raw, INSTALLATION_MARKER_META_KEY)).toBeTruthy();
      expect(seedAuditCount(raw)).toBe(0);
    });
  });

  test("existing user upgrade boot with observations does not seed but writes marker", () => {
    const { db, dbPath, modelsDir } = openPreparedDb("existing-user");
    insertObservation(db);
    db.close();

    withEnv({ HARNESS_MEM_EMBEDDING_MODEL: undefined, HARNESS_MEM_DISABLE_FRESH_INSTALL_SEED: undefined }, () => {
      const core = new HarnessMemCore(coreConfig(dbPath, modelsDir));
      const raw = core.getRawDb();
      expect(getMeta(raw, EMBEDDING_DEFAULT_MODEL_KEY)).toBe(null);
      expect(getEmbeddingDefaultModel(raw)).toBe(INCUMBENT_EMBEDDING_MODEL);
      expect(getMeta(raw, INSTALLATION_MARKER_META_KEY)).toBeTruthy();
      expect(seedAuditCount(raw)).toBe(0);
    });
  });

  test("marker present with empty observations does not re-seed after truncate", () => {
    const { db, dbPath, modelsDir } = openPreparedDb("marker-truncate");
    setMeta(db, INSTALLATION_MARKER_META_KEY, "2026-07-05T00:00:00.000Z");
    db.close();

    withEnv({ HARNESS_MEM_EMBEDDING_MODEL: undefined, HARNESS_MEM_DISABLE_FRESH_INSTALL_SEED: undefined }, () => {
      const core = new HarnessMemCore(coreConfig(dbPath, modelsDir));
      const raw = core.getRawDb();
      expect(getMeta(raw, EMBEDDING_DEFAULT_MODEL_KEY)).toBe(null);
      expect(getMeta(raw, INSTALLATION_MARKER_META_KEY)).toBe("2026-07-05T00:00:00.000Z");
      expect(seedAuditCount(raw)).toBe(0);
    });
  });

  test("seeded flag but granite not installed warns and fail-safes to incumbent through real registry", () => {
    const db = new Database(":memory:");
    initSchema(db);
    setMeta(db, EMBEDDING_DEFAULT_MODEL_KEY, REFERENCE_DEFAULT_EMBEDDING_MODEL_FLAG);
    const modelsDir = makeTempDir("registry-no-granite");
    installFakeModel(modelsDir, INCUMBENT_EMBEDDING_MODEL);

    withEnv({ HARNESS_MEM_EMBEDDING_MODEL: undefined }, () => {
      const registry = createEmbeddingProviderRegistry({
        providerName: "local",
        dimension: 384,
        localModelId: INCUMBENT_EMBEDDING_MODEL,
        localModelsDir: modelsDir,
        db,
      });
      expect(registry.provider.name).toBe("local");
      expect(registry.provider.model).toBe(INCUMBENT_EMBEDDING_MODEL);
      expect(registry.warnings.some((w) => w.includes("embedding_default_model") && w.includes("not installed"))).toBe(true);
    });
    db.close();
  });

  test("HARNESS_MEM_EMBEDDING_MODEL pin wins over the seeded flag end-to-end", () => {
    const dir = makeTempDir("env-pin");
    const dbPath = join(dir, "harness-mem.db");
    const modelsDir = join(dir, "models");
    installFakeModel(modelsDir, INCUMBENT_EMBEDDING_MODEL);
    installFakeModel(modelsDir, "granite-embedding-311m-r2");

    withEnv({ HARNESS_MEM_EMBEDDING_MODEL: INCUMBENT_EMBEDDING_MODEL, HARNESS_MEM_DISABLE_FRESH_INSTALL_SEED: undefined }, () => {
      const core = new HarnessMemCore(coreConfig(dbPath, modelsDir));
      const raw = core.getRawDb();
      expect(getMeta(raw, EMBEDDING_DEFAULT_MODEL_KEY)).toBe(REFERENCE_DEFAULT_EMBEDDING_MODEL_FLAG);
      expect(core.getEmbeddingRuntimeInfo().provider).toMatchObject({
        name: "local",
        model: INCUMBENT_EMBEDDING_MODEL,
        dimension: 384,
      });
    });
  });

  test("rollback is an explicit incumbent write, not row deletion", () => {
    const dir = makeTempDir("rollback");
    const dbPath = join(dir, "harness-mem.db");
    const modelsDir = join(dir, "models");

    withEnv({ HARNESS_MEM_EMBEDDING_MODEL: undefined, HARNESS_MEM_DISABLE_FRESH_INSTALL_SEED: undefined }, () => {
      const core = new HarnessMemCore(coreConfig(dbPath, modelsDir));
      const db = core.getRawDb();
      expect(getEmbeddingDefaultModel(db)).toBe(REFERENCE_DEFAULT_EMBEDDING_MODEL_FLAG);
      setEmbeddingDefaultModel(db, INCUMBENT_EMBEDDING_MODEL);
      expect(getMeta(db, EMBEDDING_DEFAULT_MODEL_KEY)).toBe(INCUMBENT_EMBEDDING_MODEL);
      expect(getEmbeddingDefaultModel(db)).toBe(INCUMBENT_EMBEDDING_MODEL);
    });
  });

  test("off-switch env disables seeding and leaves marker untouched", () => {
    const dir = makeTempDir("off-switch");
    const dbPath = join(dir, "harness-mem.db");
    const modelsDir = join(dir, "models");

    withEnv({ HARNESS_MEM_EMBEDDING_MODEL: undefined, HARNESS_MEM_DISABLE_FRESH_INSTALL_SEED: "1" }, () => {
      const core = new HarnessMemCore(coreConfig(dbPath, modelsDir));
      const db = core.getRawDb();
      expect(getMeta(db, EMBEDDING_DEFAULT_MODEL_KEY)).toBe(null);
      expect(getMeta(db, INSTALLATION_MARKER_META_KEY)).toBe(null);
      expect(seedAuditCount(db)).toBe(0);
    });
  });
});
