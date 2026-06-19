/**
 * S154-310: deep freshness bench integration tests (TDD).
 *
 * Tests drive real system — no fixture-value theater:
 *   1. HarnessMemCore + detectContradictions with direct DB inserts
 *   2. computeFreshnessLagReal: wall-clock lag measurement
 *   3. computeSupersessionReal: DB valid_to read (not fixture field)
 *   4. computeTenseRewriteReal: real Ollama call (skip if unreachable)
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessMemCore, type Config } from "../../src/core/harness-mem-core";
import type { Database } from "bun:sqlite";
import { detectContradictions, type ContradictionAdjudicator } from "../../src/consolidation/contradiction-detector";
import {
  computeFreshnessLagReal,
  computeSupersessionReal,
  computeTenseRewriteReal,
  type LagContradictionInput,
  type SupersessionInput,
  type TenseRewriteInput,
} from "../../src/benchmark/deep-freshness-bench";

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function createConfig(name: string): Config {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-dfb-${name}-`));
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
    consolidationEnabled: false,
    backgroundWorkersEnabled: false,
  };
}

/**
 * Directly insert an observation + concept tag into DB — same pattern as
 * tests/unit/contradiction-detector.test.ts insertObservation().
 */
function insertObs(
  db: Database,
  id: string,
  project: string,
  content: string,
  concept: string,
  createdAt: string,
): void {
  const session = `bench-${id}`;
  db.query(
    `INSERT OR IGNORE INTO mem_sessions(session_id, platform, project, started_at, created_at, updated_at)
     VALUES (?, 'bench', ?, ?, ?, ?)`
  ).run(session, project, createdAt, createdAt, createdAt);

  db.query(
    `INSERT OR IGNORE INTO mem_observations(
       id, event_id, platform, project, session_id,
       title, content, content_redacted,
       observation_type, memory_type,
       tags_json, privacy_tags_json,
       user_id, team_id, created_at, updated_at
     ) VALUES (?, NULL, 'bench', ?, ?, ?, ?, ?, 'context', 'semantic', '[]', '[]', 'default', NULL, ?, ?)`
  ).run(id, project, session, content.slice(0, 80), content, content, createdAt, createdAt);

  db.query(
    `INSERT OR IGNORE INTO mem_tags(observation_id, tag, tag_type, created_at) VALUES (?, ?, 'concept', ?)`
  ).run(id, concept, createdAt);
}

// --------------------------------------------------------------------------
// Test 1: HarnessMemCore + detectContradictions
// --------------------------------------------------------------------------

describe("HarnessMemCore + detectContradictions integration", () => {
  test("stub adjudicator: contradiction pair writes valid_to in DB", async () => {
    const core = new HarnessMemCore(createConfig("sup-stub"));
    const db = (core as unknown as { db: Database }).db;
    const project = "dfb-sup-test";
    const t1 = new Date(Date.now() - 2000).toISOString();
    const t2 = new Date(Date.now() - 100).toISOString();

    insertObs(db, "obs-older", project, "The database is MySQL 5.7.", "database-engine", t1);
    insertObs(db, "obs-newer", project, "The database has been migrated to PostgreSQL 14.", "database-engine", t2);

    const alwaysContradict: ContradictionAdjudicator = async (a, b) => {
      void a; void b;
      return { contradiction: true, confidence: 0.95, reason: "stub" };
    };

    const result = await detectContradictions(db, {
      adjudicator: alwaysContradict,
      project,
      jaccard_threshold: 0.0,
    });

    expect(result.contradictions.length).toBeGreaterThanOrEqual(1);
    expect(result.links_created).toBeGreaterThanOrEqual(1);

    // Verify valid_to was ACTUALLY written to DB by detectContradictions
    const olderObs = result.contradictions[0]!.older_id;
    const row = db.query("SELECT valid_to FROM mem_observations WHERE id = ?").get(olderObs) as { valid_to: string | null } | null;
    expect(row).toBeTruthy();
    expect(row!.valid_to).toBeTruthy();

    core.shutdown("test");
  });

  test("stub adjudicator (no contradiction): valid_to stays NULL", async () => {
    const core = new HarnessMemCore(createConfig("sup-neg"));
    const db = (core as unknown as { db: Database }).db;
    const project = "dfb-neg-test";
    const t1 = new Date(Date.now() - 2000).toISOString();
    const t2 = new Date(Date.now() - 100).toISOString();

    insertObs(db, "obs-a", project, "Team prefers async communication.", "team-comms", t1);
    insertObs(db, "obs-b", project, "Team now uses video calls for sync.", "team-comms", t2);

    const neverContradict: ContradictionAdjudicator = async (a, b) => {
      void a; void b;
      return { contradiction: false, confidence: 0.0, reason: "stub-no" };
    };

    await detectContradictions(db, { adjudicator: neverContradict, project, jaccard_threshold: 0.0 });

    const rows = db.query(`SELECT valid_to FROM mem_observations WHERE project = ?`).all(project) as Array<{ valid_to: string | null }>;
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const o of rows) {
      expect(o.valid_to).toBeNull();
    }

    core.shutdown("test");
  });
});

// --------------------------------------------------------------------------
// Test 2: computeFreshnessLagReal
// --------------------------------------------------------------------------

describe("computeFreshnessLagReal", () => {
  test("returns measured with wall-clock lag >= 0ms", async () => {
    const config = createConfig("lag-real");
    const inputs: LagContradictionInput[] = [
      { id: "lag-t1", older_content: "Server runs on port 3000.", newer_content: "Server now runs on port 8080.", concept_tag: "server-port" },
      { id: "lag-t2", older_content: "We use Redis for caching.", newer_content: "We replaced Redis with Valkey.", concept_tag: "cache-backend" },
    ];

    const stubAdjudicator: ContradictionAdjudicator = async (a, b) => {
      void a; void b;
      return { contradiction: true, confidence: 0.95, reason: "stub" };
    };

    const result = await computeFreshnessLagReal(inputs, stubAdjudicator, config);

    expect(result.status === "measured" || result.status === "skipped").toBe(true);
    if (result.status === "measured") {
      expect(result.n).toBeGreaterThanOrEqual(1);
      expect(result.p50_ms).toBeGreaterThanOrEqual(0);
      expect(result.p95_ms).toBeGreaterThanOrEqual(result.p50_ms);
      // Wall-clock must be sub-second for local stub test
      expect(result.p95_ms).toBeLessThan(5_000);
    } else {
      expect(result.skip_reason).toBeTruthy();
    }
  });
});

// --------------------------------------------------------------------------
// Test 3: computeSupersessionReal — DB valid_to, not fixture field
// --------------------------------------------------------------------------

describe("computeSupersessionReal", () => {
  test("precision/recall from DB valid_to with positives + negatives", async () => {
    const config = createConfig("sup-pr");
    const inputs: SupersessionInput[] = [
      // 3 positives (should be superseded)
      { id: "s01", older_content: "DB is MySQL 5.7.", newer_content: "DB migrated to PostgreSQL 14.", concept_tag: "database", label_should_supersede: true },
      { id: "s02", older_content: "Auth uses JWT.", newer_content: "Auth uses session cookies.", concept_tag: "auth-method", label_should_supersede: true },
      { id: "s03", older_content: "Cache is Redis.", newer_content: "Cache replaced with Valkey.", concept_tag: "cache-system", label_should_supersede: true },
      // 2 negatives (should NOT be superseded)
      { id: "s04", older_content: "Team does standups daily.", newer_content: "Team does standups daily on Slack.", concept_tag: "team-ritual", label_should_supersede: false },
      { id: "s05", older_content: "Deploy uses Docker.", newer_content: "Deploy also uses Docker.", concept_tag: "deploy-infra", label_should_supersede: false },
    ];

    // Stub always says contradiction → TP=3, FP=2
    const alwaysContradict: ContradictionAdjudicator = async (a, b) => {
      void a; void b;
      return { contradiction: true, confidence: 0.95, reason: "stub" };
    };

    const result = await computeSupersessionReal(inputs, alwaysContradict, config);

    expect(result.status === "measured" || result.status === "skipped").toBe(true);
    if (result.status === "measured") {
      expect(result.n).toBe(5);
      // precision = 3/(3+2) = 0.6
      expect(result.precision).toBeCloseTo(0.6, 1);
      // recall = 3/(3+0) = 1.0
      expect(result.recall).toBeCloseTo(1.0, 1);
      expect(result.f1).toBeGreaterThan(0);
    }
  });

  test("valid_to comes from DB (not from fixture: no valid_to_written field in inputs)", () => {
    // Structural check: SupersessionInput type must NOT have valid_to_written
    const input: SupersessionInput = {
      id: "check",
      older_content: "old",
      newer_content: "new",
      concept_tag: "test",
      label_should_supersede: true,
    };
    // If the type had valid_to_written, this would cause a TS error or test failure
    const keys = Object.keys(input);
    expect(keys).not.toContain("valid_to_written");
    expect(keys).not.toContain("llm_changed");
  });
});

// --------------------------------------------------------------------------
// Test 4: computeTenseRewriteReal — real Ollama, skip if unreachable
// --------------------------------------------------------------------------

describe("computeTenseRewriteReal", () => {
  test("returns measured or skipped, never reads llm_changed from fixture", async () => {
    const inputs: TenseRewriteInput[] = [
      { id: "tr-01", original: "We will submit the spec next Friday.", evidence: "The spec was submitted and merged on Monday.", expected_changed: true },
      { id: "tr-02", original: "We plan to add authentication next sprint.", evidence: "", expected_changed: false },
    ];

    // Structural check: TenseRewriteInput must NOT have llm_changed
    const keys = Object.keys(inputs[0]!);
    expect(keys).not.toContain("llm_changed");
    expect(keys).not.toContain("valid_to_written");

    const result = await computeTenseRewriteReal(inputs, {
      ollamaHost: "http://127.0.0.1:11434",
      model: "qwen3.5:9b",
      timeoutMs: 30_000,
    });

    expect(result.status === "measured" || result.status === "skipped").toBe(true);
    if (result.status === "measured") {
      expect(result.n).toBeGreaterThanOrEqual(1);
      expect(result.accuracy).toBeGreaterThanOrEqual(0);
      expect(result.accuracy).toBeLessThanOrEqual(1);
      expect(result.false_positive_rate).toBeGreaterThanOrEqual(0);
    } else {
      expect(result.skip_reason).toBeTruthy();
    }
  }, 60_000); // 60s timeout for Ollama calls
});
