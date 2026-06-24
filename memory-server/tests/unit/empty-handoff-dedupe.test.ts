/**
 * S154-202: empty-handoff detection + dedupe collapse.
 *
 * Empty/boilerplate handoffs ("No explicit decisions captured", "決定事項なし") are
 * detected (precision/recall >= 0.9 on labeled fixtures), counted as a diagnostic,
 * and collapsed onto one content-dedupe hash so they never accumulate as memory.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Database } from "bun:sqlite";
import { isEmptyHandoff, countEmptyHandoffs } from "../../src/core/event-recorder";
import { HarnessMemCore, type Config, type EventEnvelope } from "../../src/core/harness-mem-core";

const POSITIVES = [
  "",
  "No explicit decisions captured.",
  "No decisions were made this session.",
  "Nothing to report.",
  "(none)",
  "N/A",
  "決定事項なし",
  "決定事項は特になし。",
  "特になし",
  "（なし）",
];

const NEGATIVES = [
  "Decided to use PostgreSQL for the main database.",
  "本番DBを PostgreSQL に決定した。",
  "問題なし、テストは全て通過した。race condition を修正済み。",
  "Fixed the race condition in worker.ts and added a regression test.",
  "次のステップ: migration を完了させる。",
  "変更なしのファイルは skip するよう実装した。",
  "リファクタリングを実施。特に問題は発生しなかった。",
  "デプロイ先を staging から production に変更した。",
];

const cleanupPaths: string[] = [];
afterEach(() => {
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("S154-202 isEmptyHandoff", () => {
  test("precision and recall >= 0.9 on labeled fixtures", () => {
    const tp = POSITIVES.filter((c) => isEmptyHandoff(c)).length;
    const fn = POSITIVES.length - tp;
    const fp = NEGATIVES.filter((c) => isEmptyHandoff(c)).length;
    const recall = tp / (tp + fn);
    const precision = tp / (tp + fp);
    expect(recall).toBeGreaterThanOrEqual(0.9);
    expect(precision).toBeGreaterThanOrEqual(0.9);
  });

  test("substantive content containing 'なし' is not flagged", () => {
    expect(isEmptyHandoff("問題なし、テストは全て通過した。")).toBe(false);
    expect(isEmptyHandoff("変更なしのファイルは skip する。")).toBe(false);
  });
});

describe("S154-202 countEmptyHandoffs diagnostic", () => {
  test("counts the empty handoffs in a batch", () => {
    expect(countEmptyHandoffs([...POSITIVES, ...NEGATIVES])).toBe(POSITIVES.length);
    expect(countEmptyHandoffs(NEGATIVES)).toBe(0);
  });
});

function createConfig(name: string): Config {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-emptyho-${name}-`));
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

function checkpoint(project: string, session: string, content: string): EventEnvelope {
  return {
    platform: "claude",
    project,
    session_id: session,
    event_type: "checkpoint",
    ts: "2026-06-08T10:00:00.000Z",
    payload: { prompt: content },
    tags: [],
    privacy_tags: [],
  };
}

describe("S154-202 empty handoffs collapse instead of accumulating", () => {
  test("many empty handoffs in a session store at most one observation", () => {
    const core = new HarnessMemCore(createConfig("collapse"));
    const project = "empty-collapse";
    const session = "s1";
    try {
      core.recordEvent(checkpoint(project, session, "No explicit decisions captured."));
      core.recordEvent(checkpoint(project, session, "決定事項なし")); // different wording
      core.recordEvent(checkpoint(project, session, "特になし"));
      core.recordEvent(checkpoint(project, session, "本番DBを PostgreSQL に決定した。")); // substantive

      const db = (core as unknown as { db: Database }).db;
      // the 3 empties (different wording, even different induced types) collapse to 1,
      // plus the substantive checkpoint = 2 observations total.
      const total = db
        .query(`SELECT COUNT(*) AS n FROM mem_observations WHERE project = ? AND session_id = ?`)
        .get(project, session) as { n: number };
      expect(total.n).toBe(2);
    } finally {
      core.shutdown("test");
    }
  });

  // §91-003 regression: a partial-finalize empty handoff and a full-finalize empty
  // handoff in the SAME session must NOT collapse onto each other. If they did, a
  // full finalize whose summary is also empty would be content-deduped to a prior
  // partial empty handoff, and resume_pack would keep returning the stale partial.
  // Partial empties still collapse among themselves; full empties collapse among
  // themselves; but partial and full are distinct dedupe buckets.
  test("partial vs full empty session_end handoffs do not collapse onto each other", () => {
    const core = new HarnessMemCore(createConfig("partial-full"));
    const project = "empty-partial-full";
    const session = "s-pf";
    const emptySummary = "No explicit decisions captured.";
    const sessionEnd = (tags: string[], isPartial: boolean): EventEnvelope => ({
      platform: "claude",
      project,
      session_id: session,
      event_type: "session_end",
      ts: "2026-06-08T10:00:00.000Z",
      payload: { summary: emptySummary, ...(isPartial ? { is_partial: true } : {}) },
      tags,
      privacy_tags: [],
    });
    try {
      // 2 partial empties collapse to 1, 2 full empties collapse to 1 → 2 total.
      core.recordEvent(sessionEnd(["finalized", "partial"], true));
      core.recordEvent(sessionEnd(["finalized", "partial"], true));
      core.recordEvent(sessionEnd(["finalized"], false));
      core.recordEvent(sessionEnd(["finalized"], false));

      const db = (core as unknown as { db: Database }).db;
      const total = db
        .query(`SELECT COUNT(*) AS n FROM mem_observations WHERE project = ? AND session_id = ?`)
        .get(project, session) as { n: number };
      expect(total.n).toBe(2);
    } finally {
      core.shutdown("test");
    }
  });
});
