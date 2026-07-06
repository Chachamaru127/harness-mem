import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initSchema, migrateSchema } from "../../src/db/schema";
import { HarnessMemCore, type Config } from "../../src/core/harness-mem-core";
import { EMBEDDING_DEFAULT_MODEL_KEY, INCUMBENT_EMBEDDING_MODEL } from "../../src/core/config-manager";

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const target = cleanupPaths.pop();
    if (target) rmSync(target, { recursive: true, force: true });
  }
  delete process.env.HARNESS_MEM_GRANITE_MIGRATION_NOTICE_RATE_LIMIT_MS;
  delete process.env.HARNESS_MEM_EMBEDDING_MODEL;
});

function makeTempDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `hmem-granite-notice-${name}-`));
  cleanupPaths.push(dir);
  return dir;
}

function installFakeModel(modelsDir: string, modelId: string): void {
  const modelDir = join(modelsDir, modelId);
  mkdirSync(join(modelDir, "onnx"), { recursive: true });
  writeFileSync(join(modelDir, "tokenizer.json"), "{}");
  writeFileSync(join(modelDir, "onnx", "model.onnx"), "fake");
}

function insertObservation(db: Database): void {
  db.query(
    `INSERT INTO mem_observations(
      id, platform, project, session_id, content, content_redacted,
      tags_json, privacy_tags_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "obs-existing-granite-notice",
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

function setMeta(db: Database, key: string, value: string): void {
  db.query(
    `INSERT INTO mem_meta(key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, new Date().toISOString());
}

function prepareExistingDb(name: string): { dbPath: string; modelsDir: string } {
  const dir = makeTempDir(name);
  const dbPath = join(dir, "harness-mem.db");
  const modelsDir = join(dir, "models");
  const db = new Database(dbPath);
  initSchema(db);
  migrateSchema(db);
  insertObservation(db);
  db.close();
  installFakeModel(modelsDir, INCUMBENT_EMBEDDING_MODEL);
  return { dbPath, modelsDir };
}

function coreConfig(dbPath: string, modelsDir: string, extra: Partial<Config> = {}): Config {
  return {
    dbPath,
    bindHost: "127.0.0.1",
    bindPort: 0,
    vectorDimension: 384,
    embeddingProvider: "auto",
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
    freshInstallEmbeddingSeedEnabled: false,
    ...extra,
  };
}

function healthNotice(core: HarnessMemCore): Record<string, unknown> {
  const item = core.health().items[0] as Record<string, unknown>;
  return item.embedding_migration_notice as Record<string, unknown>;
}

describe("Granite migration notice", () => {
  test("existing auto/local install on incumbent gets a health notice with migration commands", () => {
    const { dbPath, modelsDir } = prepareExistingDb("auto-incumbent");
    const core = new HarnessMemCore(coreConfig(dbPath, modelsDir));
    try {
      const item = core.health().items[0] as Record<string, unknown>;
      const warnings = item.warnings as string[];
      const notice = item.embedding_migration_notice as Record<string, unknown>;

      expect(notice.required).toBe(true);
      expect(notice.fix_command).toContain("harness-mem model pull granite-embedding-311m-r2 --yes");
      expect(notice.fix_command).toContain("s154-granite-flag-set.ts");
      expect(notice.fix_command).toContain("harness-mem model use-default");
      expect(notice.rollback_command).toContain("harness-mem model use-default");
      expect(warnings.some((warning) => warning.includes("Granite embedding migration recommended"))).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });

  test("health warning is rate-limited but structured notice remains visible", () => {
    process.env.HARNESS_MEM_GRANITE_MIGRATION_NOTICE_RATE_LIMIT_MS = "60000";
    const { dbPath, modelsDir } = prepareExistingDb("rate-limit");
    const core = new HarnessMemCore(coreConfig(dbPath, modelsDir));
    try {
      const first = core.health().items[0] as Record<string, unknown>;
      const second = core.health().items[0] as Record<string, unknown>;

      expect((first.warnings as string[]).some((warning) => warning.includes("Granite embedding migration recommended"))).toBe(true);
      expect((second.warnings as string[]).some((warning) => warning.includes("Granite embedding migration recommended"))).toBe(false);
      expect(((second.embedding_migration_notice as Record<string, unknown>).required)).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });

  test("notice is silent for openai provider, env model pin, dismiss, obs=0, or granite flag", () => {
    const providerCase = prepareExistingDb("provider-openai");
    const providerCore = new HarnessMemCore(coreConfig(providerCase.dbPath, providerCase.modelsDir, { embeddingProvider: "openai" }));
    try {
      expect(healthNotice(providerCore).required).toBe(false);
    } finally {
      providerCore.shutdown("test");
    }

    process.env.HARNESS_MEM_EMBEDDING_MODEL = "operator-pinned-model";
    const envPinCase = prepareExistingDb("env-pin");
    const envPinCore = new HarnessMemCore(coreConfig(envPinCase.dbPath, envPinCase.modelsDir));
    try {
      expect(healthNotice(envPinCore).required).toBe(false);
    } finally {
      envPinCore.shutdown("test");
      delete process.env.HARNESS_MEM_EMBEDDING_MODEL;
    }

    const dismissCase = prepareExistingDb("dismissed");
    const dismissedCore = new HarnessMemCore(
      coreConfig(dismissCase.dbPath, dismissCase.modelsDir, {
        graniteMigrationNoticeDismissedAt: "2026-07-05T00:00:00.000Z",
      }),
    );
    try {
      expect(healthNotice(dismissedCore).required).toBe(false);
    } finally {
      dismissedCore.shutdown("test");
    }

    const noObsDir = makeTempDir("no-obs");
    const noObsDbPath = join(noObsDir, "harness-mem.db");
    const noObsModelsDir = join(noObsDir, "models");
    const db = new Database(noObsDbPath);
    initSchema(db);
    migrateSchema(db);
    db.close();
    installFakeModel(noObsModelsDir, INCUMBENT_EMBEDDING_MODEL);
    const noObsCore = new HarnessMemCore(coreConfig(noObsDbPath, noObsModelsDir));
    try {
      expect(healthNotice(noObsCore).required).toBe(false);
    } finally {
      noObsCore.shutdown("test");
    }

    const graniteFlagCase = prepareExistingDb("granite-flag");
    const graniteDb = new Database(graniteFlagCase.dbPath);
    setMeta(graniteDb, EMBEDDING_DEFAULT_MODEL_KEY, "granite-embedding-311m-r2@384");
    graniteDb.close();
    const graniteFlagCore = new HarnessMemCore(coreConfig(graniteFlagCase.dbPath, graniteFlagCase.modelsDir));
    try {
      expect(healthNotice(graniteFlagCore).required).toBe(false);
    } finally {
      graniteFlagCore.shutdown("test");
    }
  });
});
