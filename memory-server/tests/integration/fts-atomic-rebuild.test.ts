/**
 * S154-101a: FTS rebuild is atomic + rollback-safe.
 *
 * reindexFtsWithSegmentation runs inside one transaction (WAL). A successful run
 * re-segments and the FTS stays searchable; a failure mid-run rolls the whole
 * rebuild back, leaving the original title_fts / content_fts and FTS rows intact —
 * there is never a partially-rebuilt or empty index visible.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Database } from "bun:sqlite";
import { reindexFtsWithSegmentation } from "../../src/db/schema";
import { segmentJapaneseForFts } from "../../src/core/core-utils";
import { HarnessMemCore, type Config, type EventEnvelope } from "../../src/core/harness-mem-core";

const cleanupPaths: string[] = [];
afterEach(() => {
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function createConfig(name: string): Config {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-fts-${name}-`));
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
    project: "fts-rebuild",
    session_id: session,
    event_type: "checkpoint",
    ts: "2026-06-08T10:00:00.000Z",
    payload: { prompt: content },
    tags: [],
    privacy_tags: [],
  };
  core.recordEvent(event);
}

function ftsCount(db: Database): number {
  return (db.query(`SELECT COUNT(*) AS n FROM mem_observations_fts`).get() as { n: number }).n;
}
function contentFts(db: Database): string[] {
  return (db.query(`SELECT content_fts FROM mem_observations`).all() as Array<{ content_fts: string | null }>)
    .map((r) => r.content_fts ?? "");
}

describe("S154-101a FTS atomic rebuild", () => {
  test("successful reindex keeps the index searchable and segmented", () => {
    const core = new HarnessMemCore(createConfig("ok"));
    try {
      seed(core, "s1", "本番環境にデプロイした");
      seed(core, "s2", "race condition を worker で修正");
      const db = (core as unknown as { db: Database }).db;

      const updated = reindexFtsWithSegmentation(db, segmentJapaneseForFts);
      expect(updated).toBeGreaterThanOrEqual(2);
      expect(ftsCount(db)).toBeGreaterThanOrEqual(2);
      // segmented content_fts makes a JA token MATCH succeed
      const hit = db
        .query(`SELECT COUNT(*) AS n FROM mem_observations_fts WHERE mem_observations_fts MATCH ?`)
        .get("デプロイ") as { n: number };
      expect(hit.n).toBeGreaterThanOrEqual(1);
    } finally {
      core.shutdown("test");
    }
  });

  test("failure mid-rebuild rolls back — original index intact, no partial writes", () => {
    const core = new HarnessMemCore(createConfig("rollback"));
    try {
      seed(core, "s1", "本番環境にデプロイした");
      seed(core, "s2", "FAILMARKER この行で失敗する");
      seed(core, "s3", "BM25 と RRF の融合");
      const db = (core as unknown as { db: Database }).db;

      // establish a known-good segmented baseline
      reindexFtsWithSegmentation(db, segmentJapaneseForFts);
      const baselineFts = contentFts(db);
      const baselineCount = ftsCount(db);

      // a rebuild that mutates rows then throws on the marker row
      const failing = (text: string): string => {
        if (text.includes("FAILMARKER")) throw new Error("boom mid-rebuild");
        return `BROKEN_${text}`;
      };
      expect(() => reindexFtsWithSegmentation(db, failing)).toThrow(/boom mid-rebuild/);

      // rollback: no row carries the BROKEN_ prefix, content_fts == baseline
      const afterFts = contentFts(db);
      expect(afterFts.some((c) => c.includes("BROKEN_"))).toBe(false);
      expect(afterFts).toEqual(baselineFts);
      // FTS still fully populated and searchable
      expect(ftsCount(db)).toBe(baselineCount);
      const hit = db
        .query(`SELECT COUNT(*) AS n FROM mem_observations_fts WHERE mem_observations_fts MATCH ?`)
        .get("デプロイ") as { n: number };
      expect(hit.n).toBeGreaterThanOrEqual(1);
    } finally {
      core.shutdown("test");
    }
  });
});
