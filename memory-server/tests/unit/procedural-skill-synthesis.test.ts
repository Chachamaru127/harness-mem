/**
 * §78-E04: Procedural skill synthesis — unit tests
 *
 * Tests:
 *  1. 6 observations, last tagged "deployed" → finalize returns skill_suggestion with 6 steps
 *  2. 3 observations (< 5) → no skill_suggestion in response
 *  3. 6 observations, no completion signal → no skill_suggestion
 *  4. persist_skill=true → skill saved as observation with tags ["skill", "procedural"],
 *     discoverable via search
 */

import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { configureDatabase, initSchema, migrateSchema } from "../../src/db/schema";
import { HarnessMemCore, getConfig, type Config } from "../../src/core/harness-mem-core";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { removeDirWithRetry } from "../fs-cleanup";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (!dir) continue;
    removeDirWithRetry(dir);
  }
});

function createConfig(label: string): Config {
  const dir = mkdtempSync(join(tmpdir(), `skill-synth-${label}-`));
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
  };
}

/** Insert observations directly into DB for a session */
function insertObservations(
  db: Database,
  sessionId: string,
  project: string,
  entries: Array<{ title: string; tags?: string[] }>
): string[] {
  const ids: string[] = [];
  const now = Date.now();

  // Ensure session row exists
  const sessionNow = new Date(now).toISOString();
  db.query(
    `INSERT OR IGNORE INTO mem_sessions
     (session_id, platform, project, started_at, created_at, updated_at)
     VALUES (?, 'claude', ?, ?, ?, ?)`
  ).run(sessionId, project, sessionNow, sessionNow, sessionNow);

  for (let i = 0; i < entries.length; i++) {
    const { title, tags = [] } = entries[i];
    // Stagger timestamps by 1 minute each
    const ts = new Date(now + i * 60000).toISOString();
    const id = `obs-${sessionId}-${i}`;
    ids.push(id);

    db.query(
      `INSERT INTO mem_observations
       (id, event_id, platform, project, session_id, title, content, content_redacted,
        observation_type, memory_type, tags_json, privacy_tags_json, signal_score,
        user_id, team_id, created_at, updated_at)
       VALUES (?, NULL, 'claude', ?, ?, ?, ?, ?, 'context', 'procedural', ?, '[]', 0,
               'default', NULL, ?, ?)`
    ).run(
      id,
      project,
      sessionId,
      title,
      title,
      title,
      JSON.stringify(tags),
      ts,
      ts
    );
  }

  return ids;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("§78-E04: procedural skill synthesis", () => {
  test("6 observations with 'deployed' tag on last obs → skill_suggestion returned with 6 steps", () => {
    const core = new HarnessMemCore(createConfig("t1"));
    try {
      const db = (core as unknown as { db: Database }).db;
      const sessionId = "skill-session-1";
      const project = "test-project";

      insertObservations(db, sessionId, project, [
        { title: "Clone repository" },
        { title: "Install dependencies" },
        { title: "Run tests" },
        { title: "Build artifact" },
        { title: "Push to registry" },
        { title: "Deploy to production", tags: ["deployed"] },
      ]);

      const result = core.finalizeSession({
        session_id: sessionId,
        project,
        platform: "claude",
      });

      expect(result.ok).toBe(true);
      expect(result.items.length).toBe(1);

      const item = result.items[0] as Record<string, unknown>;
      expect(item.skill_suggestion).toBeDefined();

      const skill = item.skill_suggestion as {
        title: string;
        steps: Array<{ order: number; summary: string; obs_id: string }>;
        source_session_id: string;
        estimated_duration_min: number;
        created_at: string;
      };

      expect(skill.steps.length).toBe(6);
      expect(skill.steps[0].order).toBe(1);
      expect(skill.steps[5].order).toBe(6);
      expect(skill.steps[0].summary).toBe("Clone repository");
      expect(skill.steps[5].summary).toBe("Deploy to production");
      expect(skill.source_session_id).toBe(sessionId);
      expect(skill.title).toContain("Clone repository");
      expect(skill.title).toContain("Deploy to production");
      expect(typeof skill.estimated_duration_min).toBe("number");
      expect(skill.estimated_duration_min).toBeGreaterThanOrEqual(0);
    } finally {
      core.shutdown("test");
    }
  });

  test("3 observations (< 5) → no skill_suggestion in response", () => {
    const core = new HarnessMemCore(createConfig("t2"));
    try {
      const db = (core as unknown as { db: Database }).db;
      const sessionId = "skill-session-2";
      const project = "test-project";

      insertObservations(db, sessionId, project, [
        { title: "Step one" },
        { title: "Step two" },
        { title: "Step three done", tags: ["completed"] },
      ]);

      const result = core.finalizeSession({
        session_id: sessionId,
        project,
        platform: "claude",
      });

      expect(result.ok).toBe(true);
      const item = result.items[0] as Record<string, unknown>;
      expect(item.skill_suggestion).toBeUndefined();
    } finally {
      core.shutdown("test");
    }
  });

  test("6 observations without completion signal → no skill_suggestion", () => {
    const core = new HarnessMemCore(createConfig("t3"));
    try {
      const db = (core as unknown as { db: Database }).db;
      const sessionId = "skill-session-3";
      const project = "test-project";

      insertObservations(db, sessionId, project, [
        { title: "Step one" },
        { title: "Step two" },
        { title: "Step three" },
        { title: "Step four" },
        { title: "Step five" },
        { title: "Step six — still in progress" },
      ]);

      const result = core.finalizeSession({
        session_id: sessionId,
        project,
        platform: "claude",
      });

      expect(result.ok).toBe(true);
      const item = result.items[0] as Record<string, unknown>;
      expect(item.skill_suggestion).toBeUndefined();
    } finally {
      core.shutdown("test");
    }
  });

  test("persist_skill=true → skill saved as observation with tags [skill, procedural]", () => {
    const core = new HarnessMemCore(createConfig("t4"));
    try {
      const db = (core as unknown as { db: Database }).db;
      const sessionId = "skill-session-4";
      const project = "test-project";

      insertObservations(db, sessionId, project, [
        { title: "Install deps" },
        { title: "Write code" },
        { title: "Add tests" },
        { title: "Review PR" },
        { title: "Merge PR" },
        { title: "Ship feature", tags: ["merged"] },
      ]);

      const result = core.finalizeSession({
        session_id: sessionId,
        project,
        platform: "claude",
        persist_skill: true,
      });

      expect(result.ok).toBe(true);
      const item = result.items[0] as Record<string, unknown>;
      expect(item.skill_suggestion).toBeDefined();

      // Verify the skill was persisted as an observation
      const skillObs = db
        .query(
          `SELECT id, title, content, tags_json
             FROM mem_observations
            WHERE session_id = ?
              AND tags_json LIKE '%"skill"%'
              AND tags_json LIKE '%"procedural"%'
            ORDER BY created_at DESC
            LIMIT 1`
        )
        .get(sessionId) as { id: string; title: string; content: string; tags_json: string } | null;

      expect(skillObs).not.toBeNull();
      if (skillObs) {
        const tags: string[] = JSON.parse(skillObs.tags_json);
        expect(tags).toContain("skill");
        expect(tags).toContain("procedural");
        expect(tags.some((t) => t.startsWith("skill-from:"))).toBe(true);

        // Content should be parseable JSON with skill shape
        const skillData = JSON.parse(skillObs.content) as { steps: unknown[]; source_session_id: string };
        expect(skillData.source_session_id).toBe(sessionId);
        expect(Array.isArray(skillData.steps)).toBe(true);
      }
    } finally {
      core.shutdown("test");
    }
  });
});
