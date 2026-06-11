/**
 * recordEvent populates segmented title_fts / content_fts at write time, so
 * Japanese tokens MATCH immediately without an offline reindexFtsWithSegmentation
 * pass. Pins the event-path default behavior introduced alongside the S154-152
 * CJK discrimination gate (other writers — SqliteObservationRepository and the
 * consolidation worker — already segment at write time).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Database } from "bun:sqlite";
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
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-event-fts-${name}-`));
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
    project: "event-fts",
    session_id: session,
    event_type: "checkpoint",
    ts: "2026-06-11T10:00:00.000Z",
    payload: { prompt: content },
    tags: [],
    privacy_tags: [],
  };
  core.recordEvent(event);
}

describe("recordEvent FTS segmentation (write path)", () => {
  test("content_fts is stored segmented at insert time", () => {
    const core = new HarnessMemCore(createConfig("segment"));
    try {
      seed(core, "s1", "本番環境にデプロイした後で索引を再構築した");
      const db = (core as unknown as { db: Database }).db;

      const row = db
        .query(`SELECT title, title_fts, content_redacted, content_fts FROM mem_observations`)
        .get() as {
        title: string | null;
        title_fts: string | null;
        content_redacted: string;
        content_fts: string | null;
      };

      expect(row.content_fts).toBe(segmentJapaneseForFts(row.content_redacted));
      // Segmentation must actually split the CJK run, not store it verbatim.
      expect(row.content_fts).not.toBe(row.content_redacted);
      if (row.title === null) {
        expect(row.title_fts).toBeNull();
      } else {
        expect(row.title_fts).toBe(segmentJapaneseForFts(row.title));
      }
    } finally {
      core.shutdown("test");
    }
  });

  test("a Japanese token MATCHes without an offline reindex", () => {
    const core = new HarnessMemCore(createConfig("match"));
    try {
      seed(core, "s1", "本番環境にデプロイした後で索引を再構築した");
      const db = (core as unknown as { db: Database }).db;

      // Unsegmented CJK would be one unicode61 token, so this MATCH only
      // succeeds when the write path indexed segmented content_fts.
      const hit = db
        .query(`SELECT COUNT(*) AS n FROM mem_observations_fts WHERE mem_observations_fts MATCH ?`)
        .get("デプロイ") as { n: number };
      expect(hit.n).toBeGreaterThanOrEqual(1);
    } finally {
      core.shutdown("test");
    }
  });
});
