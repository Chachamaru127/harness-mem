/**
 * S154-403: the embedding default-model flag is an atomic mem_meta upsert.
 * Both vector tables stay resident across switch/rollback, so a flag round
 * trip must leave search results and mem_vectors untouched — that property is
 * what makes rollback instantaneous and safe.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Database } from "bun:sqlite";
import {
  INCUMBENT_EMBEDDING_MODEL,
  getEmbeddingDefaultModel,
  setEmbeddingDefaultModel,
} from "../../src/core/config-manager";
import { HarnessMemCore, type Config, type EventEnvelope } from "../../src/core/harness-mem-core";

const cleanupPaths: string[] = [];
afterEach(() => {
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function createConfig(name: string): Config {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-switch-flag-${name}-`));
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
    consolidationEnabled: false,
  };
}

function seed(core: HarnessMemCore, session: string, content: string): void {
  const event: EventEnvelope = {
    platform: "claude",
    project: "switch-flag",
    session_id: session,
    event_type: "checkpoint",
    ts: "2026-06-11T10:00:00.000Z",
    payload: { prompt: content },
    tags: [],
    privacy_tags: [],
  };
  core.recordEvent(event);
}

function searchIds(core: HarnessMemCore, query: string): string[] {
  const response = core.search({
    query,
    project: "switch-flag",
    limit: 10,
    include_private: true,
  }) as { ok: boolean; items: Array<{ id: string }> };
  expect(response.ok).toBe(true);
  return response.items.map((item) => item.id);
}

describe("S154-403 embedding default-model atomic flag", () => {
  test("flag defaults to the incumbent and survives a switch -> rollback round trip", () => {
    const core = new HarnessMemCore(createConfig("roundtrip"));
    try {
      seed(core, "s1", "本番環境にデプロイした");
      seed(core, "s2", "embedding の切替判断を記録した");
      const db = (core as unknown as { db: Database }).db;

      expect(getEmbeddingDefaultModel(db)).toBe(INCUMBENT_EMBEDDING_MODEL);

      const before = searchIds(core, "デプロイ");
      expect(before.length).toBeGreaterThan(0);
      const vectorRows = (db.query("SELECT COUNT(*) AS n FROM mem_vectors").get() as { n: number }).n;

      // switch
      const previous = setEmbeddingDefaultModel(db, "ruri-v3-30m");
      expect(previous).toBe(INCUMBENT_EMBEDDING_MODEL);
      expect(getEmbeddingDefaultModel(db)).toBe("ruri-v3-30m");

      // both vector tables stay resident — the flag flip must not touch vectors
      expect((db.query("SELECT COUNT(*) AS n FROM mem_vectors").get() as { n: number }).n).toBe(vectorRows);

      // rollback
      const rolledBackFrom = setEmbeddingDefaultModel(db, INCUMBENT_EMBEDDING_MODEL);
      expect(rolledBackFrom).toBe("ruri-v3-30m");
      expect(getEmbeddingDefaultModel(db)).toBe(INCUMBENT_EMBEDDING_MODEL);

      // reversibility: search results identical to the pre-switch run
      expect(searchIds(core, "デプロイ")).toEqual(before);
      expect((db.query("SELECT COUNT(*) AS n FROM mem_vectors").get() as { n: number }).n).toBe(vectorRows);
    } finally {
      core.shutdown("test");
    }
  });

  test("rollback path: invalid model id is rejected and the flag is unchanged", () => {
    const core = new HarnessMemCore(createConfig("invalid"));
    try {
      const db = (core as unknown as { db: Database }).db;
      expect(() => setEmbeddingDefaultModel(db, "")).toThrow();
      expect(() => setEmbeddingDefaultModel(db, "no-such-model")).toThrow();
      expect(getEmbeddingDefaultModel(db)).toBe(INCUMBENT_EMBEDDING_MODEL);
    } finally {
      core.shutdown("test");
    }
  });
});
